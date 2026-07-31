/**
 * Minimal 2D segment geometry used by structural rules. Kept tiny and
 * dependency-free for Phase 0/3; a heavier computational-geometry lib (turf/
 * JSTS) comes in when we need boolean ops and offsets for the plan editor.
 *
 * All coordinates are mm in the storey plane.
 */
import type { Point } from "../model/schema.js";

export type Segment = readonly [Point, Point];

export function length(seg: Segment): number {
  const [[ax, ay], [bx, by]] = seg;
  return Math.hypot(bx - ax, by - ay);
}

function sub(a: Point, b: Point): Point {
  return [a[0] - b[0], a[1] - b[1]];
}
function dot(a: Point, b: Point): number {
  return a[0] * b[0] + a[1] * b[1];
}
/** Perpendicular distance from point p to the infinite line through segment s. */
function perpDistanceToLine(p: Point, s: Segment): number {
  const [a, b] = s;
  const ab = sub(b, a);
  const len = Math.hypot(ab[0], ab[1]);
  if (len === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  // 2D cross product magnitude / |ab|.
  const ap = sub(p, a);
  const cross = ab[0] * ap[1] - ab[1] * ap[0];
  return Math.abs(cross) / len;
}

/**
 * Length over which two segments overlap when treated as (near-)collinear —
 * i.e. how much of one lies directly above/along the other in plan. Returns 0
 * if they are not collinear within `tol`.
 *
 * `tol` is the perpendicular slack (mm) allowed before two segments count as
 * off the same line — roughly a wall thickness by default.
 */
export function collinearOverlapLength(a: Segment, b: Segment, tol = 150): number {
  if (length(a) === 0 || length(b) === 0) return 0;
  // b must lie on a's line (both endpoints within tol perpendicular distance).
  if (perpDistanceToLine(b[0], a) > tol) return 0;
  if (perpDistanceToLine(b[1], a) > tol) return 0;

  // Project everything onto a's direction and intersect the 1D spans.
  const [a0] = a;
  const u: Point = [(a[1][0] - a0[0]) / length(a), (a[1][1] - a0[1]) / length(a)];
  const proj = (p: Point) => dot(sub(p, a0), u);
  const aSpan = [0, length(a)] as const;
  const bProj = [proj(b[0]), proj(b[1])].sort((x, y) => x - y) as [number, number];

  const lo = Math.max(aSpan[0], bProj[0]);
  const hi = Math.min(aSpan[1], bProj[1]);
  return Math.max(0, hi - lo);
}
