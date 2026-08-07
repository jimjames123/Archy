/**
 * Load-path rule (structural).
 *
 * An opening cut into a load-bearing wall interrupts the vertical load path and
 * must be bridged by a lintel/beam. When the opening is wider than the span a
 * plain masonry/timber head can be assumed to carry, and no beam is modelled
 * over it, that is a coordination conflict the user needs to resolve before
 * finalizing.
 *
 * IMPORTANT — honesty boundary:
 * This rule is a RED-FLAG DETECTOR, not a structural calculation. It does not
 * and cannot certify that any particular beam is adequately sized: real
 * adequacy needs loads, material grades, deflection limits, and code factors
 * the platform does not have. Every message it emits is framed as "assumed"
 * and "needs engineer review" so the platform never fakes engineering
 * certainty. Presence of a `supports` beam edge clears the flag because the
 * user has acknowledged a member is required there — it is not a claim the
 * member is sufficient.
 */
import { ft } from "../units.js";
import type { BuildingModel, Id } from "../model/graph.js";
import type { Opening } from "../model/schema.js";
import type { Issue, Rule } from "./engine.js";

export interface LoadPathConfig {
  /**
   * Widest opening, in mm, assumed to be bridgeable in a load-bearing wall
   * without an explicitly modelled beam. Region-configurable; deliberately
   * conservative. Default is a generic residential placeholder, NOT a code value.
   */
  maxAssumedLintelSpan: number;
}

const DEFAULTS: LoadPathConfig = { maxAssumedLintelSpan: 1800 };

export function loadPathRule(config: Partial<LoadPathConfig> = {}): Rule {
  const cfg = { ...DEFAULTS, ...config };

  return {
    id: "structural.load-path.opening-span",
    discipline: "structural",
    // An edit to any of these can change whether an opening is safely spanned.
    dependsOn: ["opening", "wall", "beam"],
    evaluate(model: BuildingModel, _changed: Set<Id>): Issue[] {
      const issues: Issue[] = [];
      const beamCarries = new Set(
        model.edgesOfKind("supports").map((e) => e.carries),
      );

      for (const opening of model.elementsOfType("opening")) {
        const wall = model.getElement(opening.hostWallId);
        if (!wall || wall.type !== "wall" || !wall.isLoadBearing) continue;
        if (opening.width <= cfg.maxAssumedLintelSpan) continue;
        // A beam carrying the host wall over the opening clears the flag.
        if (beamCarries.has(wall.id) || beamCarries.has(opening.id)) continue;

        issues.push({
          ruleId: "structural.load-path.opening-span",
          discipline: "structural",
          severity: "conflict",
          elements: [opening.id, wall.id],
          message: openingSpanMessage(opening, cfg),
        });
      }
      return issues;
    },
  };
}

function openingSpanMessage(opening: Opening, cfg: LoadPathConfig): string {
  return (
    `${cap(opening.kind)} "${opening.id}" (${ft(opening.width)} wide) sits in a ` +
    `load-bearing wall and exceeds the assumed ${ft(cfg.maxAssumedLintelSpan)} ` +
    `lintel span, with no beam modelled over it. Add a beam and have its size ` +
    `confirmed by an engineer — the platform flags this, it does not size it.`
  );
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
