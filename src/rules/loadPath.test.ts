/**
 * Phase 0 acceptance test — proves the differentiator end to end:
 *
 *   an architectural edit (widen a window) is automatically re-validated by a
 *   structural rule through the shared model, surfaces a cross-discipline
 *   conflict, and clears when the user resolves it.
 *
 * The `it("flags …")` case is the "failing-then-passing" pivot: the model
 * SHOULD report a conflict after the edit; the later cases show the two honest
 * ways to resolve it.
 */
import { describe, expect, it } from "vitest";
import { makeRoomPlan } from "../model/fixtures.js";
import { RulesEngine } from "./engine.js";
import { loadPathRule } from "./loadPath.js";
import { doorClearanceRule } from "./doorClearance.js";

function engine() {
  return new RulesEngine().register(loadPathRule()).register(doorClearanceRule());
}

describe("load-path coordination", () => {
  it("baseline plan has no structural conflicts", () => {
    const { model } = makeRoomPlan();
    const issues = engine().evaluateAll(model);
    expect(issues.filter((i) => i.severity === "conflict")).toEqual([]);
  });

  it("flags a widened opening in a load-bearing wall as a structural conflict", () => {
    const { model, ids } = makeRoomPlan();

    // Architectural edit: widen the window from 900 mm to 2400 mm.
    const { changed } = model.commit([
      { op: "updateElement", id: ids.window, patch: { width: 2400 } as never },
    ]);

    const issues = engine().evaluateChanged(model, changed);
    const conflict = issues.find(
      (i) => i.ruleId === "structural.load-path.opening-span",
    );
    expect(conflict).toBeDefined();
    expect(conflict!.discipline).toBe("structural");
    expect(conflict!.elements).toContain(ids.window);
    expect(conflict!.elements).toContain(ids.wallS);
    // Honesty boundary: it flags, it does not certify a size.
    expect(conflict!.message).toMatch(/engineer/i);
  });

  it("clears the conflict when a supporting beam is modelled over the opening", () => {
    const { model, ids } = makeRoomPlan();
    model.commit([
      { op: "updateElement", id: ids.window, patch: { width: 2400 } as never },
    ]);

    // Structural fix: add a beam and record that it carries the host wall.
    const { changed } = model.commit([
      {
        op: "addElement",
        element: {
          type: "beam",
          id: "beam-1",
          storeyId: ids.storey,
          provenance: { source: "user", confidence: 1 },
          version: 0,
          line: [
            [1000, 0],
            [4000, 0],
          ],
        },
      },
      { op: "addEdge", edge: { kind: "supports", beam: "beam-1", carries: ids.wallS } },
    ]);

    const issues = engine().evaluateChanged(model, changed);
    expect(
      issues.filter((i) => i.ruleId === "structural.load-path.opening-span"),
    ).toEqual([]);
  });

  it("clears the conflict when the opening is narrowed back under the span", () => {
    const { model, ids } = makeRoomPlan();
    model.commit([
      { op: "updateElement", id: ids.window, patch: { width: 2400 } as never },
    ]);
    const { changed } = model.commit([
      { op: "updateElement", id: ids.window, patch: { width: 1500 } as never },
    ]);
    expect(engine().evaluateChanged(model, changed)).toEqual([]);
  });

  it("does not mark a load-bearing wall's opening broken when the wall is non-structural", () => {
    const { model, ids } = makeRoomPlan();
    model.commit([
      { op: "updateElement", id: ids.wallS, patch: { isLoadBearing: false } as never },
      { op: "updateElement", id: ids.window, patch: { width: 2400 } as never },
    ]);
    const issues = engine().evaluateAll(model);
    expect(
      issues.filter((i) => i.ruleId === "structural.load-path.opening-span"),
    ).toEqual([]);
  });
});

describe("incremental engine dispatch", () => {
  it("runs only rules whose dependencies changed", () => {
    const { model, ids } = makeRoomPlan();
    // Pre-existing latent conflict from a wide opening.
    model.commit([
      { op: "updateElement", id: ids.window, patch: { width: 2400 } as never },
    ]);

    // A Space-only edit must NOT re-run the structural (opening/wall/beam) rule.
    const { changed } = model.commit([
      { op: "updateElement", id: ids.room, patch: { program: "kitchen" } as never },
    ]);
    const issues = engine().evaluateChanged(model, changed);
    expect(issues).toEqual([]);

    // A full pass, by contrast, still sees the latent conflict.
    expect(
      engine()
        .evaluateAll(model)
        .filter((i) => i.severity === "conflict"),
    ).toHaveLength(1);
  });
});
