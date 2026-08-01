/**
 * Isometric 3D view — walls extruded to height, projected axonometrically. It
 * reads the SAME model as the 2D plan (no separate 3D data), which is the whole
 * point: one edit changes both views because there is one model.
 *
 * Dependency-free: a 2:1-ish axonometric projection, painter's-algorithm depth
 * sort. Enough to read the massing; the real-time editor will use three.js.
 */
import type { BuildingModel } from "../model/graph.js";
import type { Point } from "../model/schema.js";
import type { Issue } from "../rules/engine.js";
import { SEVERITY_COLOR, esc, indexIssues, polygon } from "./svg.js";

const COS = Math.cos(Math.PI / 6); // 30°
const SIN = Math.sin(Math.PI / 6);

type P3 = [number, number, number];
function project(p: P3): Point {
  const [x, y, z] = p;
  return [(x - y) * COS, (x + y) * SIN - z];
}

export function renderIsoSVG(
  model: BuildingModel,
  issues: Issue[] = [],
  opts: { width?: number; title?: string; padPoints?: Point[] } = {},
): string {
  const width = opts.width ?? 900;
  const margin = 56;
  const walls = model.elementsOfType("wall");
  const spaces = model.elementsOfType("space");
  const { byElement } = indexIssues(issues);
  const conflicted = (id: string) =>
    byElement.get(id)?.some((x) => x.issue.severity === "conflict") ?? false;

  // Project everything once to fit the viewport.
  const proj: Point[] = [];
  for (const w of walls) {
    for (const z of [0, w.height])
      for (const b of [w.baseline[0], w.baseline[1]]) proj.push(project([b[0], b[1], z]));
  }
  for (const s of spaces) for (const b of s.boundary) proj.push(project([b[0], b[1], 0]));
  // Optional padding points keep the fit stable across edits: if the caller
  // passes a fixed envelope, the view doesn't rescale/recenter every frame.
  if (opts.padPoints) {
    const maxH = Math.max(2700, ...walls.map((w) => w.height));
    for (const p of opts.padPoints)
      for (const z of [0, maxH]) proj.push(project([p[0], p[1], z]));
  }

  const xs = proj.map((p) => p[0]);
  const ys = proj.map((p) => p[1]);
  const minX = Math.min(...xs, 0),
    maxX = Math.max(...xs, 1),
    minY = Math.min(...ys, 0),
    maxY = Math.max(...ys, 1);
  const scale = (width - 2 * margin) / Math.max(1, maxX - minX);
  const height = (maxY - minY) * scale + 2 * margin;
  const toScreen = (p: P3): Point => {
    const [px, py] = project(p);
    return [(px - minX) * scale + margin, (py - minY) * scale + margin];
  };

  const layers: string[] = [];

  // Floor slabs first (furthest back).
  for (const s of spaces) {
    layers.push(
      polygon(
        s.boundary.map((b) => toScreen([b[0], b[1], 0])),
        `fill="#efeadd" stroke="#d8d3c5" stroke-width="1"`,
      ),
    );
  }

  // Walls, far-to-near (painter's algorithm).
  const sorted = [...walls].sort(
    (a, b) => depth(b.baseline) - depth(a.baseline),
  );
  for (const w of walls.length ? sorted : []) {
    const [a, b] = w.baseline;
    const quad: Point[] = [
      toScreen([a[0], a[1], 0]),
      toScreen([b[0], b[1], 0]),
      toScreen([b[0], b[1], w.height]),
      toScreen([a[0], a[1], w.height]),
    ];
    const alongX = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]);
    let fill = conflicted(w.id)
      ? SEVERITY_COLOR.conflict
      : w.isLoadBearing
        ? alongX
          ? "#4a4640"
          : "#37342e"
        : alongX
          ? "#a89f8d"
          : "#948b7b";
    layers.push(
      polygon(quad, `fill="${fill}" fill-opacity="${conflicted(w.id) ? 0.55 : 0.96}" stroke="#2b2823" stroke-width="1" stroke-linejoin="round"`),
    );
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="ui-sans-serif, system-ui, sans-serif">`,
    `<rect width="${width}" height="${height}" fill="#ffffff"/>`,
    opts.title
      ? `<text x="24" y="30" fill="#1e2a36" font-size="16" font-weight="700">${esc(opts.title)}</text>`
      : "",
    ...layers,
    `</svg>`,
  ].join("\n");
}

function depth(seg: readonly [Point, Point]): number {
  return (seg[0][0] + seg[0][1] + seg[1][0] + seg[1][1]) / 2;
}
