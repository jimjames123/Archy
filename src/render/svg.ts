/** Tiny SVG string helpers — no dependencies, output is a standalone document. */
import type { BuildingModel } from "../model/graph.js";
import type { Point } from "../model/schema.js";
import type { Issue, Severity } from "../rules/engine.js";

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const SEVERITY_COLOR: Record<Severity, string> = {
  conflict: "#e5484d",
  warn: "#f5a623",
  info: "#4c86ff",
};

export function line(a: Point, b: Point, attrs: string): string {
  return `<line x1="${r(a[0])}" y1="${r(a[1])}" x2="${r(b[0])}" y2="${r(b[1])}" ${attrs}/>`;
}

export function polygon(pts: Point[], attrs: string): string {
  const d = pts.map((p) => `${r(p[0])},${r(p[1])}`).join(" ");
  return `<polygon points="${d}" ${attrs}/>`;
}

export function text(p: Point, s: string, attrs = ""): string {
  return `<text x="${r(p[0])}" y="${r(p[1])}" ${attrs}>${esc(s)}</text>`;
}

export function circle(c: Point, radius: number, attrs: string): string {
  return `<circle cx="${r(c[0])}" cy="${r(c[1])}" r="${r(radius)}" ${attrs}/>`;
}

function r(n: number): number {
  return Math.round(n * 100) / 100;
}

/** A representative point for an element, for placing conflict badges. */
export function elementAnchor(model: BuildingModel, id: string): Point | undefined {
  const el = model.getElement(id);
  if (!el) return undefined;
  switch (el.type) {
    case "wall":
      return mid(el.baseline[0], el.baseline[1]);
    case "beam":
      return mid(el.line[0], el.line[1]);
    case "space":
      return centroid(el.boundary);
    case "opening": {
      const wall = model.getElement(el.hostWallId);
      if (wall?.type !== "wall") return undefined;
      return along(wall.baseline[0], wall.baseline[1], el.offset);
    }
    default:
      return undefined; // storeys have no plan geometry
  }
}

/** Index issues by the elements they touch, and by a stable 1-based number. */
export function indexIssues(issues: Issue[]) {
  const numbered = issues.map((issue, i) => ({ n: i + 1, issue }));
  const byElement = new Map<string, { n: number; issue: Issue }[]>();
  for (const item of numbered) {
    for (const id of item.issue.elements) {
      const list = byElement.get(id) ?? [];
      list.push(item);
      byElement.set(id, list);
    }
  }
  return { numbered, byElement };
}

export function mid(a: Point, b: Point): Point {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function centroid(pts: Point[]): Point {
  const s = pts.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0] as Point);
  return [s[0] / pts.length, s[1] / pts.length];
}

function along(a: Point, b: Point, dist: number): Point {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const t = dist / len;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}
