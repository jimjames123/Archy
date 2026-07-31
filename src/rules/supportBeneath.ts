/**
 * Support-beneath rule (structural) — the multi-storey load-path case.
 *
 * A load-bearing wall on an upper storey has to land on something below it: a
 * load-bearing wall directly under it on the storey below, or a beam spanning
 * beneath it (a transfer beam). If a user removes that ground-floor wall — or
 * generation places an upper wall with nothing under it — the wall above is
 * left unsupported. That is the classic "knocked through the wall downstairs
 * and forgot what it was holding up" conflict.
 *
 * This closes the gap the Phase 0 engine had: because a REMOVED element's type
 * is carried in the commit's `changedTypes`, deleting the wall below now
 * re-runs this rule and flags the wall above.
 *
 * Honesty boundary (same as the load-path rule): this detects the ABSENCE of a
 * support path from geometry and storey stacking. It does not verify that any
 * wall or beam below is adequately sized to carry the load — that needs an
 * engineer. Messages say so.
 */
import type { BuildingModel, Id } from "../model/graph.js";
import { collinearOverlapLength, type Segment } from "../geometry/segments.js";
import type { Issue, Rule } from "./engine.js";

export interface SupportBeneathConfig {
  /**
   * Minimum plan overlap (mm) between an upper wall and a support below it for
   * that support to count. Guards against a wall that merely clips a corner.
   */
  minSupportOverlap: number;
}

const DEFAULTS: SupportBeneathConfig = { minSupportOverlap: 300 };

export function supportBeneathRule(config: Partial<SupportBeneathConfig> = {}): Rule {
  const cfg = { ...DEFAULTS, ...config };

  return {
    id: "structural.load-path.support-beneath",
    discipline: "structural",
    dependsOn: ["wall", "beam", "storey"],
    evaluate(model: BuildingModel, _changed: Set<Id>): Issue[] {
      const level = storeyLevels(model);
      const beams = model.elementsOfType("beam");
      const walls = model.elementsOfType("wall");
      const issues: Issue[] = [];

      for (const wall of walls) {
        if (!wall.isLoadBearing) continue;
        const myLevel = level.get(wall.storeyId);
        // Ground/foundation level and walls on unknown storeys are assumed
        // founded — nothing to check beneath them.
        if (myLevel === undefined || myLevel <= 0) continue;

        const footprint = wall.baseline as Segment;

        const wallBelow = walls.some(
          (w) =>
            w.id !== wall.id &&
            w.isLoadBearing &&
            level.get(w.storeyId) === myLevel - 1 &&
            collinearOverlapLength(footprint, w.baseline as Segment) >=
              cfg.minSupportOverlap,
        );
        const beamBelow = beams.some(
          (b) =>
            collinearOverlapLength(footprint, b.line as Segment) >=
            cfg.minSupportOverlap,
        );
        if (wallBelow || beamBelow) continue;

        issues.push({
          ruleId: "structural.load-path.support-beneath",
          discipline: "structural",
          severity: "conflict",
          elements: [wall.id],
          message:
            `Load-bearing wall "${wall.id}" on level ${myLevel} has no support ` +
            `beneath it — no load-bearing wall or beam on level ${myLevel - 1} ` +
            `runs under its line. Add a supporting wall or a transfer beam and ` +
            `have it sized by an engineer; the platform flags the missing load ` +
            `path, it does not size the member.`,
        });
      }
      return issues;
    },
  };
}

function storeyLevels(model: BuildingModel): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of model.elementsOfType("storey")) m.set(s.id, s.level);
  return m;
}
