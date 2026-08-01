import { describe, expect, it } from "vitest";
import { makeRoomPlan } from "./fixtures.js";

describe("BuildingModel.commit", () => {
  it("logs by default and skips the log when told to", () => {
    const { model, ids } = makeRoomPlan();
    const before = model.editLog().length;

    model.commit([{ op: "updateElement", id: ids.window, patch: { width: 1000 } as never }]);
    expect(model.editLog().length).toBe(before + 1);

    // Preview frames of a drag: applied to the model but not logged.
    for (let w = 1100; w <= 1500; w += 100)
      model.commit([{ op: "updateElement", id: ids.window, patch: { width: w } as never }], {
        log: false,
      });
    expect(model.editLog().length).toBe(before + 1);
    expect(model.getElement(ids.window)).toMatchObject({ width: 1500 });
  });

  it("reports a removed element's type in changedTypes", () => {
    const { model, ids } = makeRoomPlan();
    const { changedTypes } = model.commit([{ op: "removeElement", id: ids.window }]);
    expect(changedTypes.has("opening")).toBe(true);
    expect(model.getElement(ids.window)).toBeUndefined();
  });
});
