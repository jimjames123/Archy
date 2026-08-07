/**
 * Room-overlap rule (architectural / spatial).
 *
 * When rooms are moved around as blocks, two of them landing on top of each
 * other is a layout conflict: they should sit flush (attached, sharing a wall)
 * or apart, never overlapping. Attaching cleanly clears the flag; dropping one
 * room over another raises it — the same live edit → re-validate loop, applied
 * to space planning.
 *
 * Uses axis-aligned bounding boxes, which is exact for the rectangular rooms the
 * planner produces.
 */
import type { BuildingModel, Id } from "../model/graph.js";
import type { Point } from "../model/schema.js";
import { ft2 } from "../units.js";
import type { Issue, Rule } from "./engine.js";

export interface OverlapConfig {
  /** Ignore slivers below this overlap area (mm²) — e.g. shared wall lines. */
  minOverlapArea: number;
}

const DEFAULTS: OverlapConfig = { minOverlapArea: 20000 }; // 0.02 m²

export function roomOverlapRule(config: Partial<OverlapConfig> = {}): Rule {
  const cfg = { ...DEFAULTS, ...config };
  return {
    id: "architectural.layout.room-overlap",
    discipline: "architectural",
    dependsOn: ["space"],
    evaluate(model: BuildingModel, _changed: Set<Id>): Issue[] {
      const spaces = model.elementsOfType("space");
      const issues: Issue[] = [];
      for (let i = 0; i < spaces.length; i++) {
        for (let j = i + 1; j < spaces.length; j++) {
          const a = spaces[i]!;
          const b = spaces[j]!;
          if (a.storeyId !== b.storeyId) continue;
          const area = overlapArea(bbox(a.boundary), bbox(b.boundary));
          if (area <= cfg.minOverlapArea) continue;
          issues.push({
            ruleId: "architectural.layout.room-overlap",
            discipline: "architectural",
            severity: "conflict",
            elements: [a.id, b.id],
            message:
              `Rooms "${a.program}" and "${b.program}" overlap by ` +
              `${ft2(area)}. Attach them flush or move them apart.`,
          });
        }
      }
      return issues;
    },
  };
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
function bbox(pts: Point[]): Box {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}
function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}
