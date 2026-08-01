/**
 * 2D plan renderer: turns a BuildingModel + the rules engine's Issues into a
 * standalone SVG. Conflicts are drawn ONTO the drawing (red overlays + numbered
 * badges) with a matching legend, so the coordination results live on the plan
 * the user is editing — not in a separate list.
 */
import type { BuildingModel } from "../model/graph.js";
import type { Point } from "../model/schema.js";
import type { Issue } from "../rules/engine.js";
import { fitViewport, type Viewport } from "./viewport.js";
import {
  SEVERITY_COLOR,
  circle,
  elementAnchor,
  esc,
  indexIssues,
  line,
  mid,
  polygon,
  text,
} from "./svg.js";

export interface PlanOptions {
  width?: number;
  title?: string;
}

export function renderPlanSVG(
  model: BuildingModel,
  issues: Issue[] = [],
  opts: PlanOptions = {},
): string {
  const width = opts.width ?? 900;
  const walls = model.elementsOfType("wall");
  const spaces = model.elementsOfType("space");
  const beams = model.elementsOfType("beam");
  const openings = model.elementsOfType("opening");

  const pts: Point[] = [
    ...walls.flatMap((w) => [w.baseline[0], w.baseline[1]]),
    ...spaces.flatMap((s) => s.boundary),
    ...beams.flatMap((b) => [b.line[0], b.line[1]]),
  ];
  const vp = fitViewport(pts, width);
  const { byElement, numbered } = indexIssues(issues);
  const conflicted = (id: string) =>
    byElement.get(id)?.some((x) => x.issue.severity === "conflict") ?? false;

  const layers: string[] = [];

  // Spaces (fill + label). Label sits high in the room so a mid-span beam
  // running through the centre never lands on top of it.
  for (const s of spaces) {
    const poly = s.boundary.map((p) => vp.toScreen(p));
    layers.push(polygon(poly, `fill="#efeadd" stroke="none"`));
    const ys = poly.map((p) => p[1]);
    const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length;
    const labelY = Math.min(...ys) + 0.28 * (Math.max(...ys) - Math.min(...ys));
    layers.push(
      text([cx, labelY], s.program, `fill="#57544d" font-size="13" text-anchor="middle"`),
    );
    layers.push(
      text(
        [cx, labelY + 16],
        `${(areaOf(s.boundary) / 1e6).toFixed(1)} m²`,
        `fill="#8b877c" font-size="11" text-anchor="middle"`,
      ),
    );
  }

  // Walls.
  for (const w of walls) {
    const a = vp.toScreen(w.baseline[0]);
    const b = vp.toScreen(w.baseline[1]);
    const px = Math.max(2, w.thickness * vp.scale);
    const color = w.isLoadBearing ? "#23211c" : "#b3ab99";
    layers.push(line(a, b, `stroke="${color}" stroke-width="${px}" stroke-linecap="round"`));
  }

  // Openings (cut a gap, then a discipline-coloured symbol).
  for (const o of openings) {
    const wall = model.getElement(o.hostWallId);
    if (wall?.type !== "wall") continue;
    const a = vp.toScreen(wall.baseline[0]);
    const b = vp.toScreen(wall.baseline[1]);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const u: Point = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const n: Point = [-u[1], u[0]];
    const cOff = o.offset * vp.scale;
    const halfW = (o.width / 2) * vp.scale;
    const start: Point = [a[0] + u[0] * (cOff - halfW), a[1] + u[1] * (cOff - halfW)];
    const end: Point = [a[0] + u[0] * (cOff + halfW), a[1] + u[1] * (cOff + halfW)];
    const px = Math.max(2, wall.thickness * vp.scale);
    // Cut the wall.
    layers.push(line(start, end, `stroke="#fffefb" stroke-width="${px + 1}"`));
    if (o.kind === "door") {
      const w2 = o.width * vp.scale;
      const tip: Point = [start[0] + n[0] * w2, start[1] + n[1] * w2];
      const closed: Point = [start[0] + u[0] * w2, start[1] + u[1] * w2];
      layers.push(line(start, tip, `stroke="#c2761e" stroke-width="1.5"`));
      layers.push(
        `<path d="M ${closed[0].toFixed(1)} ${closed[1].toFixed(1)} A ${w2.toFixed(1)} ${w2.toFixed(1)} 0 0 ${sweep(u, n)} ${tip[0].toFixed(1)} ${tip[1].toFixed(1)}" fill="none" stroke="#c2761e" stroke-width="1" stroke-dasharray="3 3"/>`,
      );
    } else {
      layers.push(line(start, end, `stroke="#2ca6c4" stroke-width="3"`));
    }
  }

  // Beams (dashed, with depth label).
  for (const b of beams) {
    const a = vp.toScreen(b.line[0]);
    const z = vp.toScreen(b.line[1]);
    layers.push(
      line(a, z, `stroke="#a4632a" stroke-width="2.5" stroke-dasharray="8 5"`),
    );
    // Offset the label perpendicular to the beam so it clears the room label.
    const len = Math.hypot(z[0] - a[0], z[1] - a[1]) || 1;
    const nrm: Point = [-(z[1] - a[1]) / len, (z[0] - a[0]) / len];
    const m = mid(a, z);
    layers.push(
      text(
        [m[0] + nrm[0] * 14, m[1] + nrm[1] * 14 - 4],
        `beam ${b.depth}mm`,
        `fill="#a4632a" font-size="10" text-anchor="middle"`,
      ),
    );
  }

  // Conflict overlays on the geometry.
  for (const w of walls) if (conflicted(w.id)) layers.push(overlaySeg(vp, w.baseline));
  for (const b of beams) if (conflicted(b.id)) layers.push(overlaySeg(vp, b.line));
  for (const s of spaces)
    if (conflicted(s.id))
      layers.push(
        polygon(
          s.boundary.map((p) => vp.toScreen(p)),
          `fill="none" stroke="${SEVERITY_COLOR.conflict}" stroke-width="2" stroke-dasharray="6 4"`,
        ),
      );

  // Numbered badges, nudged apart so multiple conflicts on one spot stay legible.
  const badges: string[] = [];
  const placed: Point[] = [];
  for (const { n, issue } of numbered) {
    const anchorId = issue.elements.find((id) => elementAnchor(model, id));
    if (!anchorId) continue;
    const c = spread(vp.toScreen(elementAnchor(model, anchorId)!), placed);
    placed.push(c);
    const col = SEVERITY_COLOR[issue.severity];
    badges.push(circle([c[0], c[1]], 10, `fill="${col}" stroke="#fff" stroke-width="1.5"`));
    badges.push(
      text([c[0], c[1] + 4], String(n), `fill="#fff" font-size="12" font-weight="700" text-anchor="middle"`),
    );
  }

  const drawingH = vp.height;
  const legend = renderLegend(numbered, width, drawingH);
  const totalH = drawingH + legend.height;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${totalH}" viewBox="0 0 ${width} ${totalH}" font-family="ui-sans-serif, system-ui, sans-serif">`,
    `<rect width="${width}" height="${totalH}" fill="#fffefb"/>`,
    opts.title
      ? text([24, 30], opts.title, `fill="#1b1a17" font-size="16" font-weight="700"`)
      : "",
    ...layers,
    ...badges,
    legend.svg,
    `</svg>`,
  ].join("\n");
}

function overlaySeg(vp: Viewport, seg: readonly [Point, Point]): string {
  return line(vp.toScreen(seg[0]), vp.toScreen(seg[1]), `stroke="${SEVERITY_COLOR.conflict}" stroke-width="6" stroke-opacity="0.35" stroke-linecap="round"`);
}

function renderLegend(
  numbered: { n: number; issue: Issue }[],
  width: number,
  top: number,
): { svg: string; height: number } {
  if (numbered.length === 0) {
    return {
      height: 40,
      svg: text([24, top + 24], "No conflicts detected.", `fill="#3e7d52" font-size="13"`),
    };
  }
  const rowH = 24;
  const height = numbered.length * rowH + 36;
  const rows: string[] = [
    line([0, top], [width, top], `stroke="#e7e3d8" stroke-width="1"`),
    text([24, top + 22], `${numbered.length} issue(s)`, `fill="#1b1a17" font-size="13" font-weight="700"`),
  ];
  numbered.forEach(({ n, issue }, i) => {
    const y = top + 40 + i * rowH;
    const col = SEVERITY_COLOR[issue.severity];
    rows.push(circle([32, y - 4], 9, `fill="${col}"`));
    rows.push(text([32, y], String(n), `fill="#fff" font-size="11" font-weight="700" text-anchor="middle"`));
    rows.push(
      text([52, y], truncate(`[${issue.discipline}] ${issue.message}`, 120), `fill="#57544d" font-size="12"`),
    );
  });
  return { svg: rows.join("\n"), height };
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/** Nudge a badge position so it doesn't sit on top of an already-placed one. */
function spread(c: Point, placed: Point[]): Point {
  const min = 24;
  let [x, y] = c;
  for (let i = 0; i < 12; i++) {
    const hit = placed.some((p) => Math.hypot(p[0] - x, p[1] - y) < min);
    if (!hit) break;
    x += 22;
    y -= 4;
  }
  return [x, y];
}

function sweep(u: Point, n: Point): 0 | 1 {
  // Cross product sign of u→n decides the arc direction in screen space.
  return u[0] * n[1] - u[1] * n[0] > 0 ? 1 : 0;
}

function areaOf(pts: Point[]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += (pts[j]![0] + pts[i]![0]) * (pts[j]![1] - pts[i]![1]);
  }
  return Math.abs(a / 2);
}
