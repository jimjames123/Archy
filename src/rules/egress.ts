/**
 * Egress rule (architectural, geometric).
 *
 * A habitable space must be reachable/leavable through at least one door of
 * adequate clear width in one of its bounding walls. This is the first rule
 * that reasons over the graph's `bounds` (wall→space) and `hostedBy`
 * (opening→wall) relationships together, rather than a single element — which
 * is exactly the kind of cross-element reasoning the shared model exists for.
 *
 * Scope honesty: this is a baseline "is there a door out of this room" check,
 * not a full means-of-egress / travel-distance code analysis. It is design
 * assistance against a configurable baseline, clearly not a code review.
 */
import type { BuildingModel, Id } from "../model/graph.js";
import type { Issue, Rule } from "./engine.js";

export interface EgressConfig {
  /** Programs treated as habitable and therefore requiring egress. */
  habitablePrograms: string[];
  /** Minimum clear width (mm) for a door to count as egress. */
  minEgressWidth: number;
}

const DEFAULTS: EgressConfig = {
  habitablePrograms: ["living", "bedroom", "kitchen", "dining"],
  minEgressWidth: 800,
};

export function egressRule(config: Partial<EgressConfig> = {}): Rule {
  const cfg = { ...DEFAULTS, ...config };
  const habitable = new Set(cfg.habitablePrograms);

  return {
    id: "architectural.egress.habitable-door",
    discipline: "architectural",
    dependsOn: ["space", "wall", "opening"],
    evaluate(model: BuildingModel, _changed: Set<Id>): Issue[] {
      const issues: Issue[] = [];
      const boundsBySpace = new Map<string, Set<string>>(); // space -> wall ids
      for (const e of model.edgesOfKind("bounds")) {
        let walls = boundsBySpace.get(e.space);
        if (!walls) boundsBySpace.set(e.space, (walls = new Set()));
        walls.add(e.wall);
      }

      for (const space of model.elementsOfType("space")) {
        if (!habitable.has(space.program)) continue;
        const boundingWalls = boundsBySpace.get(space.id) ?? new Set<string>();

        const hasEgress = model
          .elementsOfType("opening")
          .some(
            (o) =>
              o.kind === "door" &&
              o.width >= cfg.minEgressWidth &&
              boundingWalls.has(o.hostWallId),
          );
        if (hasEgress) continue;

        issues.push({
          ruleId: "architectural.egress.habitable-door",
          discipline: "architectural",
          severity: "conflict",
          elements: [space.id],
          message:
            `Habitable space "${space.id}" (${space.program}) has no egress ` +
            `door of at least ${cfg.minEgressWidth} mm in any of its bounding ` +
            `walls. Add a door to a bounding wall.`,
        });
      }
      return issues;
    },
  };
}
