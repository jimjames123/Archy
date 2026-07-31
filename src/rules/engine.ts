/**
 * The coordination layer. A Rule declares which element types it depends on;
 * after each commit the engine runs only the rules whose dependency footprint
 * intersects the changed set — so editing stays responsive as the model grows.
 *
 * This is the module that turns "a shared model" into the product's actual
 * differentiator: an edit in one discipline is automatically re-checked
 * against the others.
 */
import type { BuildingModel, Id } from "../model/graph.js";
import type { ElementType } from "../model/schema.js";

export type Discipline = "architectural" | "structural" | "electrical" | "plumbing";
export type Severity = "info" | "warn" | "conflict";

export interface Issue {
  ruleId: string;
  discipline: Discipline;
  severity: Severity;
  /** Elements the user should look at to understand / resolve the issue. */
  elements: Id[];
  message: string;
}

export interface Rule {
  id: string;
  discipline: Discipline;
  /** Element types whose change should trigger this rule. */
  dependsOn: ElementType[];
  /**
   * `changed` is the set of ids touched by the commit. Rules may read the whole
   * model but should scope their work to the changed neighbourhood.
   */
  evaluate(model: BuildingModel, changed: Set<Id>): Issue[];
}

export class RulesEngine {
  private rules: Rule[] = [];

  register(rule: Rule): this {
    this.rules.push(rule);
    return this;
  }

  /** Run every registered rule (e.g. for a full validation pass). */
  evaluateAll(model: BuildingModel): Issue[] {
    const all = new Set<Id>(model.allElements().map((e) => e.id));
    return this.rules.flatMap((r) => r.evaluate(model, all));
  }

  /**
   * Run only the rules whose `dependsOn` intersects the types present in the
   * changed set. Called on every commit.
   */
  evaluateChanged(model: BuildingModel, changed: Set<Id>): Issue[] {
    const changedTypes = typesOf(model, changed);
    return this.rules
      .filter((r) => r.dependsOn.some((t) => changedTypes.has(t)))
      .flatMap((r) => r.evaluate(model, changed));
  }
}

/**
 * Types present in the changed set. A removed element is no longer in the
 * model, so we fall back to scanning edges/refs is unnecessary here: removal
 * cascades already re-mark neighbouring elements as changed (see graph.commit),
 * and those neighbours carry the types the affected rules depend on.
 */
function typesOf(model: BuildingModel, changed: Set<Id>): Set<ElementType> {
  const types = new Set<ElementType>();
  for (const id of changed) {
    const el = model.getElement(id);
    if (el) types.add(el.type);
  }
  return types;
}
