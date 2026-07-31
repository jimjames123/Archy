/**
 * Phase 3 — thicker coordination:
 *  - a second structural rule (support beneath an upper-storey load-bearing
 *    wall), which also proves a DELETION now triggers the right rules; and
 *  - a geometric egress rule reasoning over the graph's bounds/host edges.
 */
import { describe, expect, it } from "vitest";
import { makeRoomPlan, makeTwoStoreyPlan } from "../model/fixtures.js";
import { RulesEngine } from "./engine.js";
import { loadPathRule } from "./loadPath.js";
import { supportBeneathRule } from "./supportBeneath.js";
import { doorClearanceRule } from "./doorClearance.js";
import { egressRule } from "./egress.js";

function fullEngine() {
  return new RulesEngine()
    .register(loadPathRule())
    .register(supportBeneathRule())
    .register(doorClearanceRule())
    .register(egressRule());
}

const SUPPORT = "structural.load-path.support-beneath";
const EGRESS = "architectural.egress.habitable-door";

describe("support-beneath (multi-storey load path)", () => {
  it("a fully stacked two-storey shell has no conflicts", () => {
    const { model } = makeTwoStoreyPlan();
    expect(fullEngine().evaluateAll(model).filter((i) => i.severity === "conflict")).toEqual(
      [],
    );
  });

  it("removing a ground-floor wall flags the wall above as unsupported", () => {
    const { model, ids } = makeTwoStoreyPlan();

    // Knock out the south ground-floor wall.
    const { changed, changedTypes } = model.commit([
      { op: "removeElement", id: ids.ground.S },
    ]);

    // Deletion must trigger the structural rule even though the removed
    // element's type is gone from the model (carried in changedTypes).
    const issues = fullEngine().evaluateChanged(model, changed, changedTypes);
    const conflict = issues.find((i) => i.ruleId === SUPPORT);
    expect(conflict).toBeDefined();
    expect(conflict!.elements).toEqual([ids.first.S]); // the wall left hanging
    expect(conflict!.message).toMatch(/engineer/i);
  });

  it("adding a transfer beam under the hanging wall clears the conflict", () => {
    const { model, ids } = makeTwoStoreyPlan();
    model.commit([{ op: "removeElement", id: ids.ground.S }]);

    const { changed, changedTypes } = model.commit([
      {
        op: "addElement",
        element: {
          type: "beam",
          id: "transfer-beam",
          storeyId: ids.storey0,
          provenance: { source: "user", confidence: 1 },
          version: 0,
          line: [
            [0, 0],
            [6000, 0],
          ],
          depth: 250,
        },
      },
    ]);

    const issues = fullEngine().evaluateChanged(model, changed, changedTypes);
    expect(issues.filter((i) => i.ruleId === SUPPORT)).toEqual([]);
  });

  it("never flags ground-floor walls themselves (assumed founded)", () => {
    const { model } = makeTwoStoreyPlan();
    const flagged = fullEngine()
      .evaluateAll(model)
      .filter((i) => i.ruleId === SUPPORT);
    expect(flagged).toEqual([]);
  });
});

describe("egress (habitable space needs a door out)", () => {
  it("baseline living room with a 900 mm door passes", () => {
    const { model } = makeRoomPlan();
    expect(fullEngine().evaluateAll(model).filter((i) => i.ruleId === EGRESS)).toEqual([]);
  });

  it("removing the only door flags the habitable space", () => {
    const { model, ids } = makeRoomPlan();
    const { changed, changedTypes } = model.commit([
      { op: "removeElement", id: ids.door },
    ]);
    const issues = fullEngine().evaluateChanged(model, changed, changedTypes);
    const conflict = issues.find((i) => i.ruleId === EGRESS);
    expect(conflict).toBeDefined();
    expect(conflict!.elements).toEqual([ids.room]);
  });

  it("narrowing the door below the egress minimum flags it", () => {
    const { model, ids } = makeRoomPlan();
    const { changed, changedTypes } = model.commit([
      { op: "updateElement", id: ids.door, patch: { width: 700 } as never },
    ]);
    const issues = fullEngine().evaluateChanged(model, changed, changedTypes);
    expect(issues.some((i) => i.ruleId === EGRESS)).toBe(true);
  });

  it("does not require egress from a non-habitable space", () => {
    const { model, ids } = makeRoomPlan();
    const { changed, changedTypes } = model.commit([
      { op: "updateElement", id: ids.room, patch: { program: "bathroom" } as never },
      { op: "removeElement", id: ids.door },
    ]);
    const issues = fullEngine().evaluateChanged(model, changed, changedTypes);
    expect(issues.some((i) => i.ruleId === EGRESS)).toBe(false);
  });
});

describe("collinear geometry", () => {
  it("recognises a beam running under a wall as overlapping support", async () => {
    const { collinearOverlapLength } = await import("../geometry/segments.js");
    // Wall along y=0 from x=0..6000; beam along y=0 from x=1000..5000.
    expect(
      collinearOverlapLength(
        [
          [0, 0],
          [6000, 0],
        ],
        [
          [1000, 0],
          [5000, 0],
        ],
      ),
    ).toBe(4000);
    // A parallel beam 500 mm off the line does not count.
    expect(
      collinearOverlapLength(
        [
          [0, 0],
          [6000, 0],
        ],
        [
          [1000, 500],
          [5000, 500],
        ],
      ),
    ).toBe(0);
  });
});
