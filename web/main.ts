/**
 * Archy space planner.
 *
 * Rooms are the editable unit: drag a room to move it, snap it flush against
 * another to attach them, drag a corner to resize. Each change rebuilds a real
 * BuildingModel (via buildRoomModel) and re-runs the SAME rules engine — so
 * moving rooms is validated live (egress, load path, headroom, and room
 * overlap), and the same model drives both the plan and the 3D.
 */
import type { BuildingModel } from "../src/model/graph.js";
import { RulesEngine, type Issue } from "../src/rules/engine.js";
import { loadPathRule } from "../src/rules/loadPath.js";
import { headroomRule } from "../src/rules/headroom.js";
import { egressRule } from "../src/rules/egress.js";
import { doorClearanceRule } from "../src/rules/doorClearance.js";
import { roomOverlapRule } from "../src/rules/overlap.js";
import { fitViewport, type Viewport } from "../src/render/viewport.js";
import { SEVERITY_COLOR } from "../src/render/svg.js";
import { renderIsoSVG } from "../src/render/iso.js";
import { generateFootprint, type Compass } from "../src/generate/footprint.js";
import { buildRoomModel, roomsFromModel, type RoomRect } from "../src/generate/rooms.js";
import type { Point } from "../src/model/schema.js";

const engine = new RulesEngine()
  .register(loadPathRule())
  .register(headroomRule())
  .register(egressRule())
  .register(doorClearanceRule())
  .register(roomOverlapRule());

const SVGNS = "http://www.w3.org/2000/svg";
const MM_PER_FT = 304.8;
const SNAP = 500; // mm — attach/align threshold while dragging
const MIN_SIZE = 1800; // mm — smallest room edge

/** Drawing palette, aligned with the Archy design system in index.html. */
const C = {
  gap: "#fffefb",
  wall: "#23211c",
  door: "#c2761e",
  window: "#2ca6c4",
  beam: "#a4632a",
  accent: "#b0542f",
} as const;

type Handle =
  | { kind: "corner"; roomId: string; ci: 0 | 1 | 2 | 3; pos: Point }
  | { kind: "window"; roomId: string; pos: Point };

type Drag =
  | { kind: "move"; roomId: string; grab: Point }
  | { kind: "corner"; roomId: string; ci: 0 | 1 | 2 | 3 }
  | { kind: "window"; roomId: string }
  | null;

class Editor {
  rooms: RoomRect[] = [];
  model!: BuildingModel;
  issues: Issue[] = [];
  vp!: Viewport;
  handles: Handle[] = [];
  selected: string | null = null;
  drag: Drag = null;

  private padPts: Point[] = [];
  private pendingTo: Point | null = null;
  private frame = 0;
  private svg = document.createElementNS(SVGNS, "svg");
  private view3d = document.getElementById("view3d");

  constructor(host: HTMLElement) {
    host.appendChild(this.svg);
    this.svg.style.cursor = "default";
    this.svg.addEventListener("pointerdown", (e) => this.onDown(e));
    this.svg.addEventListener("pointermove", (e) => this.onMove(e));
    this.svg.addEventListener("pointerup", (e) => this.onUp(e));
    this.svg.addEventListener("pointercancel", (e) => this.onUp(e));
    this.reset();
  }

  reset() {
    this.setRooms(defaultRooms());
  }

  setRooms(rooms: RoomRect[]) {
    this.rooms = rooms;
    this.selected = null;
    this.drag = null;
    this.fit();
    this.revalidate();
  }

  private fit() {
    const xs = this.rooms.flatMap((r) => [r.x, r.x + r.w]);
    const ys = this.rooms.flatMap((r) => [r.y, r.y + r.h]);
    const pad = 1500;
    this.padPts = [
      [Math.min(...xs) - pad, Math.min(...ys) - pad],
      [Math.max(...xs) + pad, Math.max(...ys) + pad],
    ];
    this.vp = fitViewport(this.padPts, 520);
    this.svg.setAttribute("width", String(this.vp.width));
    this.svg.setAttribute("height", String(this.vp.height));
  }

  private revalidate() {
    this.model = buildRoomModel(this.rooms);
    this.issues = engine.evaluateAll(this.model);
    this.render();
    if (this.view3d)
      this.view3d.innerHTML = renderIsoSVG(this.model, this.issues, { width: 520, padPoints: this.padPts });
    renderPanel(this.issues);
  }

  // ---- interaction -------------------------------------------------------

  private pointer(e: PointerEvent): Point {
    const r = this.svg.getBoundingClientRect();
    return this.vp.toModel([e.clientX - r.left, e.clientY - r.top]);
  }
  private screenOf(e: PointerEvent): Point {
    const r = this.svg.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  private onDown(e: PointerEvent) {
    const s = this.screenOf(e);
    const h = this.nearestHandle(s, 12);
    const m = this.pointer(e);
    if (h) {
      this.svg.setPointerCapture(e.pointerId);
      this.selected = h.roomId;
      this.drag = h.kind === "corner" ? { kind: "corner", roomId: h.roomId, ci: h.ci } : { kind: "window", roomId: h.roomId };
      this.svg.style.cursor = "grabbing";
      this.render();
      return;
    }
    const room = this.roomAt(m);
    if (room) {
      this.svg.setPointerCapture(e.pointerId);
      this.selected = room.id;
      this.drag = { kind: "move", roomId: room.id, grab: [m[0] - room.x, m[1] - room.y] };
      this.svg.style.cursor = "grabbing";
      this.render();
    } else {
      this.selected = null;
      this.render();
    }
  }

  private onMove(e: PointerEvent) {
    if (this.drag) {
      this.pendingTo = this.pointer(e);
      this.scheduleFrame();
      return;
    }
    const s = this.screenOf(e);
    this.svg.style.cursor = this.nearestHandle(s, 12)
      ? "grab"
      : this.roomAt(this.pointer(e))
        ? "move"
        : "default";
  }

  private onUp(e: PointerEvent) {
    if (!this.drag) return;
    this.svg.releasePointerCapture?.(e.pointerId);
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    if (this.pendingTo) this.applyDrag(this.pendingTo);
    this.pendingTo = null;
    this.drag = null;
    this.svg.style.cursor = "default";
    this.revalidate();
  }

  private scheduleFrame() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (this.pendingTo) this.applyDrag(this.pendingTo);
      this.revalidate();
    });
  }

  private applyDrag(to: Point) {
    if (!this.drag) return;
    const room = this.rooms.find((r) => r.id === this.drag!.roomId);
    if (!room) return;
    const others = this.rooms.filter((r) => r.id !== room.id);

    if (this.drag.kind === "move") {
      room.x = to[0] - this.drag.grab[0];
      room.y = to[1] - this.drag.grab[1];
      snapMove(room, others);
    } else if (this.drag.kind === "corner") {
      // The opposite corner stays fixed; the grabbed corner follows the pointer.
      const corners = cornersOf(room);
      const fixed = corners[((this.drag.ci + 2) % 4) as 0 | 1 | 2 | 3];
      let tx = snapValue(to[0], others.flatMap((o) => [o.x, o.x + o.w]));
      let ty = snapValue(to[1], others.flatMap((o) => [o.y, o.y + o.h]));
      const x0 = Math.min(fixed[0], tx);
      const x1 = Math.max(fixed[0], tx);
      const y0 = Math.min(fixed[1], ty);
      const y1 = Math.max(fixed[1], ty);
      room.x = x0;
      room.y = y0;
      room.w = Math.max(MIN_SIZE, x1 - x0);
      room.h = Math.max(MIN_SIZE, y1 - y0);
    } else {
      // Widen/narrow the rear window symmetrically about the room centre.
      const cx = room.x + room.w / 2;
      room.windowWidth = Math.round(Math.max(400, Math.min(Math.abs(to[0] - cx) * 2, room.w - 300)));
    }
  }

  private roomAt(m: Point): RoomRect | undefined {
    for (let i = this.rooms.length - 1; i >= 0; i--) {
      const r = this.rooms[i]!;
      if (m[0] >= r.x && m[0] <= r.x + r.w && m[1] >= r.y && m[1] <= r.y + r.h) return r;
    }
    return undefined;
  }

  private nearestHandle(s: Point, radius: number): Handle | null {
    let best: Handle | null = null;
    let bestD = radius;
    for (const h of this.handles) {
      const p = this.vp.toScreen(h.pos);
      const d = Math.hypot(p[0] - s[0], p[1] - s[1]);
      if (d < bestD) {
        bestD = d;
        best = h;
      }
    }
    return best;
  }

  // ---- rendering ---------------------------------------------------------

  private render() {
    const vp = this.vp;
    const model = this.model;
    const conflicted = new Set<string>();
    for (const i of this.issues)
      if (i.severity === "conflict") for (const id of i.elements) conflicted.add(id);

    const parts: string[] = [];
    this.handles = [];

    // Rooms: fill (per-program tint), selection ring, overlap outline.
    for (const s of model.elementsOfType("space")) {
      const poly = s.boundary.map((p) => vp.toScreen(p));
      parts.push(`<polygon points="${poly.map(xy).join(" ")}" fill="${roomTint(s.program)}" stroke="none"/>`);
      if (s.id === this.selected)
        parts.push(`<polygon points="${poly.map(xy).join(" ")}" fill="none" stroke="${C.accent}" stroke-width="2.5" stroke-opacity="0.7"/>`);
      if (conflicted.has(s.id))
        parts.push(`<polygon points="${poly.map(xy).join(" ")}" fill="none" stroke="${SEVERITY_COLOR.conflict}" stroke-width="2" stroke-dasharray="7 5"/>`);
    }

    // Walls.
    for (const w of model.elementsOfType("wall")) {
      const a = vp.toScreen(w.baseline[0]);
      const b = vp.toScreen(w.baseline[1]);
      const px = Math.max(2, w.thickness * vp.scale);
      parts.push(seg(a, b, `stroke="${C.wall}" stroke-width="${px}" stroke-linecap="round"`));
      if (conflicted.has(w.id))
        parts.push(seg(a, b, `stroke="${SEVERITY_COLOR.conflict}" stroke-width="${px + 4}" stroke-opacity="0.4" stroke-linecap="round"`));
    }

    // Openings (door swing / window) + window handles.
    for (const o of model.elementsOfType("opening")) {
      const wall = model.getElement(o.hostWallId);
      if (wall?.type !== "wall") continue;
      const a = vp.toScreen(wall.baseline[0]);
      const b = vp.toScreen(wall.baseline[1]);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const u: Point = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
      const px = Math.max(2, wall.thickness * vp.scale);
      const cOff = o.offset * vp.scale;
      const halfPx = (o.width / 2) * vp.scale;
      const s1: Point = [a[0] + u[0] * (cOff - halfPx), a[1] + u[1] * (cOff - halfPx)];
      const s2: Point = [a[0] + u[0] * (cOff + halfPx), a[1] + u[1] * (cOff + halfPx)];
      parts.push(seg(s1, s2, `stroke="${C.gap}" stroke-width="${px + 1}"`));
      if (o.kind === "door") {
        const n: Point = [-u[1], u[0]];
        const wpx = o.width * vp.scale;
        const leaf: Point = [s1[0] + n[0] * wpx, s1[1] + n[1] * wpx];
        const closed: Point = [s1[0] + u[0] * wpx, s1[1] + u[1] * wpx];
        const sw = u[0] * n[1] - u[1] * n[0] > 0 ? 1 : 0;
        parts.push(seg(s1, s2, `stroke="${C.door}" stroke-width="3"`));
        parts.push(seg(s1, leaf, `stroke="${C.door}" stroke-width="1.5"`));
        parts.push(`<path d="M ${x(closed)} ${y(closed)} A ${wpx.toFixed(1)} ${wpx.toFixed(1)} 0 0 ${sw} ${x(leaf)} ${y(leaf)}" fill="none" stroke="${C.door}" stroke-width="1" stroke-dasharray="3 3"/>`);
      } else {
        parts.push(seg(s1, s2, `stroke="${C.window}" stroke-width="3"`));
        this.handles.push({ kind: "window", roomId: hostRoom(o.id), pos: vp.toModel(s2) });
      }
      if (conflicted.has(o.id))
        parts.push(seg(s1, s2, `stroke="${SEVERITY_COLOR.conflict}" stroke-width="7" stroke-opacity="0.4"`));
    }

    // Room labels — name + area (ft²); duplicate programs numbered.
    const spaces = model.elementsOfType("space");
    const totals = new Map<string, number>();
    for (const s of spaces) totals.set(s.program, (totals.get(s.program) ?? 0) + 1);
    const seenProg = new Map<string, number>();
    for (const s of spaces) {
      const scr = s.boundary.map((p) => vp.toScreen(p));
      const cx = scr.reduce((a, p) => a + p[0], 0) / scr.length;
      const ys = scr.map((p) => p[1]);
      const labelY = Math.min(...ys) + 0.26 * (Math.max(...ys) - Math.min(...ys));
      const nth = (seenProg.set(s.program, (seenProg.get(s.program) ?? 0) + 1), seenProg.get(s.program)!);
      const name = totals.get(s.program)! > 1 ? `${cap(s.program)} ${nth}` : cap(s.program);
      const areaFt2 = Math.round(polyArea(s.boundary) / (MM_PER_FT * MM_PER_FT));
      parts.push(svgText([cx, labelY], name, `fill="#57544d" font-size="13" font-weight="600" text-anchor="middle"`));
      parts.push(svgText([cx, labelY + 15], `${areaFt2} ft²`, `fill="#8b877c" font-size="11" text-anchor="middle"`));
    }

    // Corner handles per room.
    for (const r of this.rooms) {
      cornersOf(r).forEach((pos, ci) => this.handles.push({ kind: "corner", roomId: r.id, ci: ci as 0 | 1 | 2 | 3, pos }));
    }

    for (const h of this.handles) {
      const p = vp.toScreen(h.pos);
      if (h.kind === "corner")
        parts.push(`<circle cx="${x(p)}" cy="${y(p)}" r="6" fill="${C.gap}" stroke="${C.accent}" stroke-width="2"/>`);
      else
        parts.push(`<rect x="${x(p) - 5}" y="${y(p) - 5}" width="10" height="10" rx="2" fill="${C.gap}" stroke="${C.window}" stroke-width="2"/>`);
    }

    this.svg.innerHTML = parts.join("");
  }

  // ---- external ----------------------------------------------------------

  generate(input: Parameters<typeof generateFootprint>[0]) {
    const { model, report } = generateFootprint(input);
    this.setRooms(roomsFromModel(model));
    return report;
  }
}

// ---- pure helpers --------------------------------------------------------

function defaultRooms(): RoomRect[] {
  // Three attached rooms to start from.
  return [
    { id: "room-living", program: "living", x: 0, y: 0, w: 4200, h: 4200, windowWidth: 1500 },
    { id: "room-kitchen", program: "kitchen", x: 4200, y: 0, w: 3200, h: 4200, windowWidth: 1200 },
    { id: "room-bedroom", program: "bedroom", x: 0, y: 4200, w: 4200, h: 3400, windowWidth: 1200 },
  ];
}

function cornersOf(r: RoomRect): [Point, Point, Point, Point] {
  return [
    [r.x, r.y],
    [r.x + r.w, r.y],
    [r.x + r.w, r.y + r.h],
    [r.x, r.y + r.h],
  ];
}

/** The room id an opening's id belongs to (openings are named "<roomId>-door/-win"). */
function hostRoom(openingId: string): string {
  return openingId.replace(/-(win|door)$/, "");
}

/** Snap a moved room's edges to nearby rooms so they attach flush or align. */
function snapMove(room: RoomRect, others: RoomRect[]) {
  const rx0 = room.x, rx1 = room.x + room.w, ry0 = room.y, ry1 = room.y + room.h;
  let bestX: number | null = null, bestXd = SNAP;
  let bestY: number | null = null, bestYd = SNAP;
  const tryX = (target: number, newX: number) => {
    const d = Math.abs(target);
    if (d < bestXd) { bestXd = d; bestX = newX; }
  };
  const tryY = (target: number, newY: number) => {
    const d = Math.abs(target);
    if (d < bestYd) { bestYd = d; bestY = newY; }
  };
  for (const o of others) {
    const ox0 = o.x, ox1 = o.x + o.w, oy0 = o.y, oy1 = o.y + o.h;
    const yOverlap = ry0 < oy1 && ry1 > oy0;
    const xOverlap = rx0 < ox1 && rx1 > ox0;
    if (yOverlap) {
      tryX(rx1 - ox0, ox0 - room.w); // right edge attaches to o's left
      tryX(rx0 - ox1, ox1); // left edge attaches to o's right
    }
    if (xOverlap) {
      tryY(ry1 - oy0, oy0 - room.h); // bottom attaches to o's top
      tryY(ry0 - oy1, oy1); // top attaches to o's bottom
    }
    tryX(rx0 - ox0, ox0); // align left edges
    tryY(ry0 - oy0, oy0); // align top edges
  }
  if (bestX !== null) room.x = bestX;
  if (bestY !== null) room.y = bestY;
}

/** Snap a scalar to the nearest candidate within SNAP. */
function snapValue(v: number, candidates: number[]): number {
  let best = v, bestD = SNAP;
  for (const c of candidates) {
    const d = Math.abs(v - c);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

function roomTint(program: string): string {
  const tints: Record<string, string> = {
    living: "#efeadd", kitchen: "#e8e6d3", bedroom: "#f1eadf",
    dining: "#ebe4d2", study: "#e9e8dc", bathroom: "#e6ebe4",
  };
  return tints[program] ?? "#efeadd";
}

function seg(a: Point, b: Point, attrs: string): string {
  return `<line x1="${x(a)}" y1="${y(a)}" x2="${x(b)}" y2="${y(b)}" ${attrs}/>`;
}
function svgText(p: Point, s: string, attrs: string): string {
  return `<text x="${x(p)}" y="${y(p)}" ${attrs}>${escapeHtml(s)}</text>`;
}
const x = (p: Point) => Math.round(p[0] * 100) / 100;
const y = (p: Point) => Math.round(p[1] * 100) / 100;
const xy = (p: Point) => `${x(p)},${y(p)}`;
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function polyArea(pts: Point[]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += (pts[j]![0] + pts[i]![0]) * (pts[j]![1] - pts[i]![1]);
  }
  return Math.abs(a / 2);
}
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---- DOM glue ------------------------------------------------------------

function renderPanel(issues: Issue[]) {
  const conflicts = issues.filter((i) => i.severity === "conflict").length;
  const status = document.getElementById("status")!;
  status.textContent = `${conflicts} conflict${conflicts === 1 ? "" : "s"}`;
  status.className = "status " + (conflicts ? "bad" : "ok");

  const ul = document.getElementById("issues")!;
  if (!issues.length) {
    ul.innerHTML = `<li class="empty">No issues — the layout is coordinated.</li>`;
    return;
  }
  ul.innerHTML = issues
    .map((i) => {
      const col = SEVERITY_COLOR[i.severity];
      return `<li><span class="dot" style="background:${col}"></span>
        <span><span class="disc">${i.discipline}</span> — <span class="msg">${escapeHtml(i.message)}</span></span></li>`;
    })
    .join("");
}

const editor = new Editor(document.getElementById("canvas")!);
(window as unknown as { archy: Editor }).archy = editor; // for the screenshot harness
document.getElementById("reset")!.addEventListener("click", () => editor.reset());

function num(id: string): number {
  return parseFloat((document.getElementById(id) as HTMLInputElement).value);
}
document.getElementById("generate")!.addEventListener("click", () => {
  const note = document.getElementById("gen-note")!;
  try {
    const set = num("in-set") * MM_PER_FT;
    const report = editor.generate({
      land: { width: num("in-w") * MM_PER_FT, depth: num("in-d") * MM_PER_FT },
      setbacks: { front: set, rear: set, left: set, right: set },
      rooms: num("in-rooms"),
      frontFaces: (document.getElementById("in-front") as HTMLSelectElement).value as Compass,
    });
    note.className = "gen-note";
    const wFt = Math.round(report.footprint.widthM * 3.28084);
    const dFt = Math.round(report.footprint.depthM * 3.28084);
    note.textContent = `${wFt}×${dFt} ft · ${report.rooms.length} rooms — drag rooms to rearrange, snap to attach.`;
  } catch (e) {
    note.className = "gen-note error";
    note.textContent = (e as Error).message;
  }
});
