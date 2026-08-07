/**
 * Minimum clear door width (architectural).
 *
 * A lightweight second rule so the engine has more than one thing to dispatch.
 * Together with the load-path rule it lets us prove the engine runs ONLY the
 * rules whose dependencies changed (e.g. editing a Space triggers neither).
 *
 * Like every rule here this is design assistance against a configurable
 * baseline, not a certified code review.
 */
import { ft } from "../units.js";
import type { BuildingModel, Id } from "../model/graph.js";
import type { Issue, Rule } from "./engine.js";

export interface DoorClearanceConfig {
  /** Minimum clear door leaf width, mm. Generic baseline, region-configurable. */
  minDoorWidth: number;
}

const DEFAULTS: DoorClearanceConfig = { minDoorWidth: 800 };

export function doorClearanceRule(config: Partial<DoorClearanceConfig> = {}): Rule {
  const cfg = { ...DEFAULTS, ...config };
  return {
    id: "architectural.door-clearance.min-width",
    discipline: "architectural",
    dependsOn: ["opening"],
    evaluate(model: BuildingModel, _changed: Set<Id>): Issue[] {
      const issues: Issue[] = [];
      for (const opening of model.elementsOfType("opening")) {
        if (opening.kind !== "door") continue;
        if (opening.width >= cfg.minDoorWidth) continue;
        issues.push({
          ruleId: "architectural.door-clearance.min-width",
          discipline: "architectural",
          severity: "warn",
          elements: [opening.id],
          message:
            `Door "${opening.id}" is ${ft(opening.width)} wide, below the ` +
            `configured ${ft(cfg.minDoorWidth)} minimum clear width.`,
        });
      }
      return issues;
    },
  };
}
