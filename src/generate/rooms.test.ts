import { describe, expect, it } from "vitest";
import { buildRoomModel, roomsFromModel, type RoomRect } from "./rooms.js";
import { RulesEngine } from "../rules/engine.js";
import { loadPathRule } from "../rules/loadPath.js";
import { headroomRule } from "../rules/headroom.js";
import { egressRule } from "../rules/egress.js";
import { doorClearanceRule } from "../rules/doorClearance.js";
import { roomOverlapRule } from "../rules/overlap.js";

const engine = new RulesEngine()
  .register(loadPathRule())
  .register(headroomRule())
  .register(egressRule())
  .register(doorClearanceRule())
  .register(roomOverlapRule());

const A: RoomRect = { id: "a", program: "living", x: 0, y: 0, w: 4000, h: 4000 };

describe("buildRoomModel", () => {
  it("two flush (attached) rooms are conflict-free", () => {
    const rooms = [A, { id: "b", program: "kitchen", x: 4000, y: 0, w: 4000, h: 4000 }];
    const conflicts = engine.evaluateAll(buildRoomModel(rooms)).filter((i) => i.severity === "conflict");
    expect(conflicts).toEqual([]);
  });

  it("overlapping rooms raise a room-overlap conflict", () => {
    const rooms = [A, { id: "b", program: "kitchen", x: 2000, y: 0, w: 4000, h: 4000 }];
    const issues = engine.evaluateAll(buildRoomModel(rooms));
    const overlap = issues.find((i) => i.ruleId === "architectural.layout.room-overlap");
    expect(overlap).toBeDefined();
    expect(overlap!.elements.sort()).toEqual(["a", "b"]);
  });

  it("a widened room window trips the structural load-path check", () => {
    const rooms = [{ ...A, windowWidth: 3000 }];
    const issues = engine.evaluateAll(buildRoomModel(rooms));
    expect(issues.some((i) => i.ruleId === "structural.load-path.opening-span")).toBe(true);
  });

  it("roomsFromModel round-trips the rectangles", () => {
    const rooms = [A, { id: "b", program: "bedroom", x: 4000, y: 0, w: 3000, h: 4000 }];
    const back = roomsFromModel(buildRoomModel(rooms));
    expect(back.map((r) => ({ id: r.id, x: r.x, y: r.y, w: r.w, h: r.h }))).toEqual(
      rooms.map((r) => ({ id: r.id, x: r.x, y: r.y, w: r.w, h: r.h })),
    );
  });
});
