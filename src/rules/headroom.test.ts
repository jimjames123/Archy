/**
 * Headroom rule + the cross-discipline cascade it enables.
 *
 * The `it("cascade …")` case is the point of the whole platform: a STRUCTURAL
 * fix (adding a beam to carry a widened opening) automatically surfaces an
 * ARCHITECTURAL conflict (that beam eats the room's headroom) — because both
 * disciplines read and write one shared model.
 */
import { describe, expect, it } from "vitest";
import { makeRoomPlan } from "../model/fixtures.js";
import { RulesEngine } from "./engine.js";
import { loadPathRule } from "./loadPath.js";
import { headroomRule } from "./headroom.js";

const HEADROOM = "architectural.headroom.clear-height";
const LOADPATH = "structural.load-path.opening-span";

function engine() {
  return new RulesEngine().register(loadPathRule()).register(headroomRule());
}

/** A deep beam running through the middle of the room (interior endpoints). */
function deepBeam(storeyId: string, depth: number, carries?: string) {
  return [
    {
      op: "addElement" as const,
      element: {
        type: "beam" as const,
        id: "beam-mid",
        storeyId,
        provenance: { source: "user" as const, confidence: 1 },
        version: 0,
        line: [
          [500, 2000],
          [4500, 2000],
        ] as [[number, number], [number, number]],
        depth,
      },
    },
    ...(carries
      ? [{ op: "addEdge" as const, edge: { kind: "supports" as const, beam: "beam-mid", carries } }]
      : []),
  ];
}

describe("headroom", () => {
  it("baseline room (2700 floor-to-floor) clears the minimum ceiling height", () => {
    const { model } = makeRoomPlan();
    expect(engine().evaluateAll(model).filter((i) => i.ruleId === HEADROOM)).toEqual([]);
  });

  it("a deep beam over a habitable room reduces headroom below the minimum", () => {
    const { model, ids } = makeRoomPlan();
    const { changed, changedTypes } = model.commit(deepBeam(ids.storey, 600));
    const issues = engine().evaluateChanged(model, changed, changedTypes);
    const conflict = issues.find((i) => i.ruleId === HEADROOM);
    expect(conflict).toBeDefined();
    expect(conflict!.elements).toEqual(["beam-mid", ids.room]);
    expect(conflict!.message).toMatch(/1800 mm clear/);
  });

  it("a shallow beam over the same room is fine", () => {
    const { model, ids } = makeRoomPlan();
    const { changed, changedTypes } = model.commit(deepBeam(ids.storey, 200));
    expect(
      engine()
        .evaluateChanged(model, changed, changedTypes)
        .filter((i) => i.ruleId === HEADROOM),
    ).toEqual([]);
  });

  it("cascade: fixing a structural load path with a deep beam surfaces a headroom conflict", () => {
    const { model, ids } = makeRoomPlan();

    // 1. Architectural edit → structural conflict.
    model.commit([{ op: "updateElement", id: ids.window, patch: { width: 2400 } as never }]);
    expect(engine().evaluateAll(model).some((i) => i.ruleId === LOADPATH)).toBe(true);

    // 2. Structural fix: a deep beam carrying the wall, running across the room.
    const { changed, changedTypes } = model.commit(deepBeam(ids.storey, 600, ids.wallS));
    const issues = engine().evaluateChanged(model, changed, changedTypes);

    // 3. Load path is now satisfied...
    expect(issues.filter((i) => i.ruleId === LOADPATH)).toEqual([]);
    // ...but the fix created an architectural headroom conflict.
    expect(issues.some((i) => i.ruleId === HEADROOM)).toBe(true);
  });

  it("flags a storey that is simply too short for a habitable room", () => {
    const { model, ids } = makeRoomPlan();
    const { changed, changedTypes } = model.commit([
      { op: "updateElement", id: ids.storey, patch: { height: 2500 } as never },
    ]);
    const issues = engine().evaluateChanged(model, changed, changedTypes);
    const conflict = issues.find((i) => i.ruleId === HEADROOM);
    expect(conflict).toBeDefined();
    expect(conflict!.elements).toEqual([ids.room, ids.storey]);
  });

  it("does not apply to a non-habitable space", () => {
    const { model, ids } = makeRoomPlan();
    const { changed, changedTypes } = model.commit([
      { op: "updateElement", id: ids.room, patch: { program: "storage" } as never },
      ...deepBeam(ids.storey, 600),
    ]);
    expect(
      engine()
        .evaluateChanged(model, changed, changedTypes)
        .filter((i) => i.ruleId === HEADROOM),
    ).toEqual([]);
  });
});
