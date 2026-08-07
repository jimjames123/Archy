/**
 * Headroom rule (architectural, reads structural).
 *
 * This is the rule that best shows why a shared model matters: it couples a
 * STRUCTURAL element (a beam's depth) to an ARCHITECTURAL requirement (clear
 * ceiling height in a habitable room). The characteristic cascade:
 *
 *   1. widen an opening in a load-bearing wall  → load-path conflict
 *   2. add a beam to carry it                   → load-path clears
 *   3. that beam is deep and runs over a room   → HEADROOM conflict (here)
 *   4. raise the storey / use a shallower beam   → clears
 *
 * The fix for one discipline's conflict surfaces another discipline's conflict,
 * automatically, because both read and write the same model.
 *
 * Scope honesty: clear height is derived as floor-to-floor minus an *assumed*
 * floor/ceiling build-up (a configurable placeholder, not a surveyed value),
 * and the beam contribution assumes the soffit hangs its full depth below the
 * ceiling. It is design assistance against a baseline, not a certified check.
 */
import { ft } from "../units.js";
import type { BuildingModel, Id } from "../model/graph.js";
import { segmentIntersectsPolygon, type Segment } from "../geometry/segments.js";
import type { Issue, Rule } from "./engine.js";

export interface HeadroomConfig {
  /** Minimum clear ceiling height for a habitable room, mm. */
  minCeilingHeight: number;
  /** Minimum clear height directly under a beam/bulkhead, mm. */
  minHeadroomUnderBeam: number;
  /** Assumed floor + ceiling build-up taken off floor-to-floor height, mm. */
  assumedFloorCeilingBuildup: number;
  /** Programs treated as habitable and therefore subject to the check. */
  habitablePrograms: string[];
}

const DEFAULTS: HeadroomConfig = {
  minCeilingHeight: 2400,
  minHeadroomUnderBeam: 2100,
  assumedFloorCeilingBuildup: 300,
  habitablePrograms: ["living", "bedroom", "kitchen", "dining"],
};

export function headroomRule(config: Partial<HeadroomConfig> = {}): Rule {
  const cfg = { ...DEFAULTS, ...config };
  const habitable = new Set(cfg.habitablePrograms);

  return {
    id: "architectural.headroom.clear-height",
    discipline: "architectural",
    dependsOn: ["space", "storey", "beam"],
    evaluate(model: BuildingModel, _changed: Set<Id>): Issue[] {
      const issues: Issue[] = [];
      const beams = model.elementsOfType("beam");

      for (const space of model.elementsOfType("space")) {
        if (!habitable.has(space.program)) continue;
        const storey = model.getElement(space.storeyId);
        if (!storey || storey.type !== "storey") continue;

        const clear = storey.height - cfg.assumedFloorCeilingBuildup;

        if (clear < cfg.minCeilingHeight) {
          issues.push({
            ruleId: "architectural.headroom.clear-height",
            discipline: "architectural",
            severity: "conflict",
            elements: [space.id, storey.id],
            message:
              `Habitable space "${space.id}" has a clear ceiling height of ` +
              `${ft(clear)} (assuming ${ft(cfg.assumedFloorCeilingBuildup)} ` +
              `floor/ceiling build-up), below the ${ft(cfg.minCeilingHeight)} ` +
              `minimum. Increase the storey height.`,
          });
          continue; // room is already too short; beam check is moot
        }

        for (const beam of beams) {
          if (beam.storeyId !== space.storeyId) continue;
          if (!segmentIntersectsPolygon(beam.line as Segment, space.boundary)) continue;
          const under = clear - beam.depth;
          if (under >= cfg.minHeadroomUnderBeam) continue;
          issues.push({
            ruleId: "architectural.headroom.clear-height",
            discipline: "architectural",
            severity: "conflict",
            elements: [beam.id, space.id],
            message:
              `Beam "${beam.id}" (${ft(beam.depth)} deep) runs over habitable ` +
              `space "${space.id}", leaving ${ft(under)} clear beneath it — ` +
              `below the ${ft(cfg.minHeadroomUnderBeam)} minimum. Use a shallower ` +
              `member, raise the storey, or reroute the beam.`,
          });
        }
      }
      return issues;
    },
  };
}
