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
   * Run only the rules whose `dependsOn` intersects the types touched by a
   * commit. Called on every commit; pass the `CommitResult` straight through.
   *
   * `changedTypes` comes from the commit (not re-derived from the model) so
   * that a REMOVED element still triggers the rules that depended on its type —
   * the element is gone from the model by the time we get here.
   */
  evaluateChanged(
    model: BuildingModel,
    changed: Set<Id>,
    changedTypes: Set<ElementType>,
  ): Issue[] {
    return this.rules
      .filter((r) => r.dependsOn.some((t) => changedTypes.has(t)))
      .flatMap((r) => r.evaluate(model, changed));
  }
}
