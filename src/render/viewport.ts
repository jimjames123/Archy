/**
 * Viewport fitting shared by the 2D and 3D renderers. Model space is mm with
 * y-up (north); screen space is px with y-down, so the fit flips y.
 */
import type { Point } from "../model/schema.js";

export interface Viewport {
  width: number;
  height: number;
  scale: number;
  toScreen(p: Point): Point;
}

export function bbox(points: Point[]) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  return { minX, minY, maxX, maxY };
}

export function fitViewport(points: Point[], targetWidth = 900, margin = 56): Viewport {
  const { minX, minY, maxX, maxY } = bbox(points);
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);
  const scale = (targetWidth - 2 * margin) / w;
  const height = h * scale + 2 * margin;
  return {
    width: targetWidth,
    height,
    scale,
    toScreen: ([x, y]) => [
      (x - minX) * scale + margin,
      (maxY - y) * scale + margin, // flip y
    ],
  };
}
