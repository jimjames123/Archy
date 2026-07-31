/**
 * Archy live editor (Phase 2).
 *
 * The entire coordination stack — BuildingModel, transactions, RulesEngine and
 * all five rules — is imported UNCHANGED from src/ and runs in the browser.
 * Dragging geometry commits a transaction, re-runs the engine, and repaints the
 * conflicts on the same frame. That "TypeScript everywhere so the model runs
 * client- and server-side" bet from Phase 0 is what makes this possible.
 */
import { makeRoomPlan } from "../src/model/fixtures.js";
import type { BuildingModel, EditOp } from "../src/model/graph.js";
import { RulesEngine, type Issue } from "../src/rules/engine.js";
import { loadPathRule } from "../src/rules/loadPath.js";
import { supportBeneathRule } from "../src/rules/supportBeneath.js";
import { headroomRule } from "../src/rules/headroom.js";
import { egressRule } from "../src/rules/egress.js";
import { doorClearanceRule } from "../src/rules/doorClearance.js";
import { fitViewport, type Viewport } from "../src/render/viewport.js";
import { SEVERITY_COLOR } from "../src/render/svg.js";
import type { Point } from "../src/model/schema.js";

const engine = new RulesEngine()
  .register(loadPathRule())
  .register(supportBeneathRule())
  .register(headroomRule())
  .register(egressRule())
  .register(doorClearanceRule());

type Handle =
  | { kind: "corner"; pos: Point }
  | { kind: "open-edge"; openingId: string; pos: Point };

type Drag =
  | { kind: "corner"; refs: CornerRef[] }
  | { kind: "open-edge"; openingId: string }
  | null;

type CornerRef =
  | { type: "wall"; id: string; end: 0 | 1 }
  | { type: "space"; id: string; index: number };

const SVGNS = "http://www.w3.org/2000/svg";
const EPS = 5; // mm tolerance for "same corner"

class Editor {
  model!: BuildingModel;
  issues: Issue[] = [];
  vp!: Viewport;
  handles: Handle[] = [];
  selectedWall: string | null = null;
  drag: Drag = null;

  private svg = document.createElementNS(SVGNS, "svg");

  constructor(private host: HTMLElement) {
    host.appendChild(this.svg);
    this.svg.addEventListener("pointerdown", (e) => this.onDown(e));
    this.svg.addEventListener("pointermove", (e) => this.onMove(e));
    this.svg.addEventListener("pointerup", (e) => this.onUp(e));
    this.reset();
  }

  reset() {
    this.model = makeRoomPlan().model;
    this.selectedWall = null;
    this.drag = null;
    this.fit();
    this.revalidate();
  }

  private fit() {
    const pts = this.geometryPoints();
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    // Pad so a wall can be dragged outward without leaving the viewport.
    const pad = 1200;
    const padded: Point[] = [
      [Math.min(...xs) - pad, Math.min(...ys) - pad],
      [Math.max(...xs) + pad, Math.max(...ys) + pad],
    ];
    this.vp = fitViewport(padded, 760);
    this.svg.setAttribute("width", String(this.vp.width));
    this.svg.setAttribute("height", String(this.vp.height));
  }

  private geometryPoints(): Point[] {
    return [
      ...this.model.elementsOfType("wall").flatMap((w) => [w.baseline[0], w.baseline[1]]),
      ...this.model.elementsOfType("space").flatMap((s) => s.boundary),
    ];
  }

  private revalidate() {
    this.issues = engine.evaluateAll(this.model);
    this.render();
    renderPanel(this.issues);
  }

  // ---- interaction -------------------------------------------------------

  private pointer(e: PointerEvent): Point {
    const r = this.svg.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  private onDown(e: PointerEvent) {
    const p = this.pointer(e);
    const h = this.nearestHandle(p, 12);
    if (h) {
      this.svg.setPointerCapture(e.pointerId);
      if (h.kind === "corner") this.drag = { kind: "corner", refs: this.cornerRefs(h.pos) };
      else this.drag = { kind: "open-edge", openingId: h.openingId };
      return;
    }
    // No handle: select a wall, or clear selection.
    const wall = this.nearestWall(p, 8);
    this.selectedWall = wall;
    syncToggle(wall ? this.model.getElement(wall) : undefined);
    this.render();
  }

  private onMove(e: PointerEvent) {
    if (!this.drag) return;
    const m = this.vp.toModel(this.pointer(e));
    if (this.drag.kind === "corner") this.moveCorner(this.drag.refs, m);
    else this.resizeOpening(this.drag.openingId, m);
  }

  private onUp(e: PointerEvent) {
    if (this.drag) this.svg.releasePointerCapture(e.pointerId);
    this.drag = null;
  }

  private moveCorner(refs: CornerRef[], to: Point) {
    const ops: EditOp[] = [];
    for (const ref of refs) {
      const el = this.model.getElement(ref.type === "wall" ? ref.id : ref.id);
      if (!el) continue;
      if (ref.type === "wall" && el.type === "wall") {
        const b: [Point, Point] = [el.baseline[0], el.baseline[1]];
        b[ref.end] = to;
        ops.push({ op: "updateElement", id: el.id, patch: { baseline: b } as never });
      } else if (ref.type === "space" && el.type === "space") {
        const boundary = el.boundary.map((v, i) => (i === ref.index ? to : v));
        ops.push({ op: "updateElement", id: el.id, patch: { boundary } as never });
      }
    }
    if (ops.length) {
      this.model.commit(ops);
      this.revalidate();
    }
  }

  private resizeOpening(openingId: string, to: Point) {
    const o = this.model.getElement(openingId);
    if (o?.type !== "opening") return;
    const wall = this.model.getElement(o.hostWallId);
    if (wall?.type !== "wall") return;
    const [a, b] = wall.baseline;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const u: Point = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const t = (to[0] - a[0]) * u[0] + (to[1] - a[1]) * u[1]; // mm from wall start
    const half = Math.abs(t - o.offset);
    const maxHalf = Math.min(o.offset, len - o.offset) - 50;
    const width = Math.round(Math.max(200, Math.min(half, Math.max(200, maxHalf))) * 2);
    this.model.commit([{ op: "updateElement", id: openingId, patch: { width } as never }]);
    this.revalidate();
  }

  private cornerRefs(pos: Point): CornerRef[] {
    const refs: CornerRef[] = [];
    for (const w of this.model.elementsOfType("wall")) {
      ([0, 1] as const).forEach((end) => {
        if (near(w.baseline[end], pos)) refs.push({ type: "wall", id: w.id, end });
      });
    }
    for (const s of this.model.elementsOfType("space")) {
      s.boundary.forEach((v, index) => {
        if (near(v, pos)) refs.push({ type: "space", id: s.id, index });
      });
    }
    return refs;
  }

  private nearestHandle(p: Point, radius: number): Handle | null {
    let best: Handle | null = null;
    let bestD = radius;
    for (const h of this.handles) {
      const s = this.vp.toScreen(h.pos);
      const d = Math.hypot(s[0] - p[0], s[1] - p[1]);
      if (d < bestD) {
        bestD = d;
        best = h;
      }
    }
    return best;
  }

  private nearestWall(p: Point, extra: number): string | null {
    let best: string | null = null;
    let bestD = Infinity;
    for (const w of this.model.elementsOfType("wall")) {
      const a = this.vp.toScreen(w.baseline[0]);
      const b = this.vp.toScreen(w.baseline[1]);
      const px = Math.max(2, w.thickness * this.vp.scale);
      const d = distToSeg(p, a, b);
      if (d < px / 2 + extra && d < bestD) {
        bestD = d;
        best = w.id;
      }
    }
    return best;
  }

  toggleLoadBearing() {
    if (!this.selectedWall) return;
    const w = this.model.getElement(this.selectedWall);
    if (w?.type !== "wall") return;
    this.model.commit([
      { op: "updateElement", id: w.id, patch: { isLoadBearing: !w.isLoadBearing } as never },
    ]);
    syncToggle(this.model.getElement(this.selectedWall));
    this.revalidate();
  }

  toggleBeam() {
    const existing = this.model.elementsOfType("beam")[0];
    if (existing) {
      this.model.commit([{ op: "removeElement", id: existing.id }]);
    } else {
      const pts = this.geometryPoints();
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      const midY = (Math.min(...ys) + Math.max(...ys)) / 2;
      const storey = this.model.elementsOfType("space")[0]?.storeyId ?? "storey-0";
      this.model.commit([
        {
          op: "addElement",
          element: {
            type: "beam",
            id: "beam-editor",
            storeyId: storey,
            provenance: { source: "user", confidence: 1 },
            version: 0,
            line: [
              [Math.min(...xs) + 300, midY],
              [Math.max(...xs) - 300, midY],
            ],
            depth: 600,
          },
        },
      ]);
    }
    this.revalidate();
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

    // Spaces.
    for (const s of model.elementsOfType("space")) {
      const d = s.boundary.map((p) => xy(vp.toScreen(p))).join(" ");
      parts.push(`<polygon points="${d}" fill="#eef2f6" stroke="none"/>`);
    }

    // Walls (+ selection + conflict overlay).
    for (const w of model.elementsOfType("wall")) {
      const a = vp.toScreen(w.baseline[0]);
      const b = vp.toScreen(w.baseline[1]);
      const px = Math.max(2, w.thickness * vp.scale);
      if (w.id === this.selectedWall)
        parts.push(seg(a, b, `stroke="#4c86ff" stroke-width="${px + 8}" stroke-opacity="0.35" stroke-linecap="round"`));
      parts.push(
        seg(a, b, `stroke="${w.isLoadBearing ? "#2b3a4a" : "#9aa7b4"}" stroke-width="${px}" stroke-linecap="round"`),
      );
      if (conflicted.has(w.id))
        parts.push(seg(a, b, `stroke="${SEVERITY_COLOR.conflict}" stroke-width="${px + 4}" stroke-opacity="0.4" stroke-linecap="round"`));
    }

    // Openings.
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
      parts.push(seg(s1, s2, `stroke="#ffffff" stroke-width="${px + 1}"`));
      parts.push(seg(s1, s2, `stroke="${o.kind === "door" ? "#e08a1e" : "#2ca6c4"}" stroke-width="3"`));
      if (conflicted.has(o.id))
        parts.push(seg(s1, s2, `stroke="${SEVERITY_COLOR.conflict}" stroke-width="7" stroke-opacity="0.4"`));
      // Opening-edge handles (windows are the draggable-to-widen case).
      const cModel = along(wall.baseline[0], wall.baseline[1], o.offset);
      for (const sign of [-1, 1] as const) {
        const edge = along(wall.baseline[0], wall.baseline[1], o.offset + (sign * o.width) / 2);
        this.handles.push({ kind: "open-edge", openingId: o.id, pos: edge });
      }
      void cModel;
    }

    // Beams.
    for (const bm of model.elementsOfType("beam")) {
      const a = vp.toScreen(bm.line[0]);
      const b = vp.toScreen(bm.line[1]);
      parts.push(seg(a, b, `stroke="#a4632a" stroke-width="2.5" stroke-dasharray="8 5"`));
      if (conflicted.has(bm.id))
        parts.push(seg(a, b, `stroke="${SEVERITY_COLOR.conflict}" stroke-width="7" stroke-opacity="0.4"`));
    }

    // Corner handles (unique wall endpoints).
    const seen = new Set<string>();
    for (const w of model.elementsOfType("wall")) {
      for (const end of [0, 1] as const) {
        const pos = w.baseline[end];
        const key = `${Math.round(pos[0])},${Math.round(pos[1])}`;
        if (seen.has(key)) continue;
        seen.add(key);
        this.handles.push({ kind: "corner", pos });
      }
    }

    // Draw handles last so they sit on top.
    for (const h of this.handles) {
      const s = vp.toScreen(h.pos);
      if (h.kind === "corner")
        parts.push(`<circle cx="${x(s)}" cy="${y(s)}" r="6" fill="#fff" stroke="#4c86ff" stroke-width="2"/>`);
      else
        parts.push(`<rect x="${x(s) - 5}" y="${y(s) - 5}" width="10" height="10" rx="2" fill="#fff" stroke="#e08a1e" stroke-width="2"/>`);
    }

    this.svg.innerHTML = parts.join("");
  }
}

// ---- small pure helpers --------------------------------------------------

function near(a: Point, b: Point): boolean {
  return Math.hypot(a[0] - b[0], a[1] - b[1]) <= EPS;
}
function along(a: Point, b: Point, dist: number): Point {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const t = dist / len;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}
function distToSeg(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy || 1;
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
function seg(a: Point, b: Point, attrs: string): string {
  return `<line x1="${x(a)}" y1="${y(a)}" x2="${x(b)}" y2="${y(b)}" ${attrs}/>`;
}
const x = (p: Point) => Math.round(p[0] * 100) / 100;
const y = (p: Point) => Math.round(p[1] * 100) / 100;
const xy = (p: Point) => `${x(p)},${y(p)}`;

// ---- DOM glue ------------------------------------------------------------

function renderPanel(issues: Issue[]) {
  const conflicts = issues.filter((i) => i.severity === "conflict").length;
  const status = document.getElementById("status")!;
  status.textContent = `${conflicts} conflict${conflicts === 1 ? "" : "s"}`;
  status.className = "status " + (conflicts ? "bad" : "ok");

  const ul = document.getElementById("issues")!;
  if (!issues.length) {
    ul.innerHTML = `<li class="empty">No issues — the plan is coordinated.</li>`;
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

function syncToggle(wall: unknown) {
  const btn = document.getElementById("toggle-lb") as HTMLButtonElement;
  const w = wall as { type?: string; isLoadBearing?: boolean } | undefined;
  if (w?.type === "wall") {
    btn.disabled = false;
    btn.textContent = w.isLoadBearing ? "Make non-load-bearing" : "Make load-bearing";
  } else {
    btn.disabled = true;
    btn.textContent = "Toggle load-bearing";
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const editor = new Editor(document.getElementById("canvas")!);
(window as unknown as { archy: Editor }).archy = editor; // for the screenshot harness
document.getElementById("toggle-lb")!.addEventListener("click", () => editor.toggleLoadBearing());
document.getElementById("add-beam")!.addEventListener("click", () => editor.toggleBeam());
document.getElementById("reset")!.addEventListener("click", () => editor.reset());
