/**
 * A tiny hand-authored plan used by tests and demos: a single 5.0 x 4.0 m room
 * with four load-bearing walls and one window in the south wall. Deliberately
 * built by hand (not generated) so Phase 0 can prove the model + rules spine
 * before any generation exists.
 */
import { BuildingModel } from "./graph.js";
import type { Provenance } from "./schema.js";

const user: Provenance = { source: "user", confidence: 1 };

export function makeRoomPlan() {
  const model = new BuildingModel();
  const storeyId = "storey-0";

  const ids = {
    storey: storeyId,
    wallS: "wall-south",
    wallN: "wall-north",
    wallE: "wall-east",
    wallW: "wall-west",
    window: "opening-window-1",
    door: "opening-door-1",
    room: "space-room-1",
  };

  model.commit([
    {
      op: "addElement",
      element: {
        type: "storey",
        id: ids.storey,
        storeyId,
        provenance: user,
        version: 0,
        level: 0,
        elevation: 0,
        height: 2700,
      },
    },
    ...(
      [
        [ids.wallS, [0, 0], [5000, 0]],
        [ids.wallN, [0, 4000], [5000, 4000]],
        [ids.wallW, [0, 0], [0, 4000]],
        [ids.wallE, [5000, 0], [5000, 4000]],
      ] as const
    ).map(([id, a, b]) => ({
      op: "addElement" as const,
      element: {
        type: "wall" as const,
        id,
        storeyId,
        provenance: user,
        version: 0,
        baseline: [a, b] as [[number, number], [number, number]],
        thickness: 200,
        height: 2700,
        isLoadBearing: true,
        material: "brick",
      },
    })),
    {
      op: "addElement",
      element: {
        type: "opening",
        id: ids.window,
        storeyId,
        provenance: user,
        version: 0,
        kind: "window",
        hostWallId: ids.wallS,
        offset: 2500,
        width: 900,
        height: 1200,
        sillHeight: 900,
      },
    },
    {
      op: "addElement",
      element: {
        type: "opening",
        id: ids.door,
        storeyId,
        provenance: user,
        version: 0,
        kind: "door",
        hostWallId: ids.wallW,
        offset: 2000,
        width: 900,
        height: 2100,
        sillHeight: 0,
      },
    },
    {
      op: "addElement",
      element: {
        type: "space",
        id: ids.room,
        storeyId,
        provenance: user,
        version: 0,
        program: "living",
        boundary: [
          [0, 0],
          [5000, 0],
          [5000, 4000],
          [0, 4000],
        ],
      },
    },
    { op: "addEdge", edge: { kind: "hostedBy", opening: ids.window, wall: ids.wallS } },
    { op: "addEdge", edge: { kind: "hostedBy", opening: ids.door, wall: ids.wallW } },
    { op: "addEdge", edge: { kind: "bounds", wall: ids.wallS, space: ids.room } },
    { op: "addEdge", edge: { kind: "bounds", wall: ids.wallN, space: ids.room } },
    { op: "addEdge", edge: { kind: "bounds", wall: ids.wallE, space: ids.room } },
    { op: "addEdge", edge: { kind: "bounds", wall: ids.wallW, space: ids.room } },
  ]);

  return { model, ids };
}

/**
 * A two-storey shell: four load-bearing walls on the ground floor with four
 * more stacked directly above on the first floor. Used to test the
 * support-beneath rule — knocking out a ground-floor wall should flag the wall
 * above it as unsupported.
 */
export function makeTwoStoreyPlan() {
  const model = new BuildingModel();
  const rect = [
    ["S", [0, 0], [6000, 0]],
    ["N", [0, 4000], [6000, 4000]],
    ["W", [0, 0], [0, 4000]],
    ["E", [6000, 0], [6000, 4000]],
  ] as const;

  const ids = {
    storey0: "storey-0",
    storey1: "storey-1",
    ground: { S: "g-S", N: "g-N", W: "g-W", E: "g-E" },
    first: { S: "f-S", N: "f-N", W: "f-W", E: "f-E" },
  };

  const storey = (id: string, level: number, elevation: number) => ({
    op: "addElement" as const,
    element: {
      type: "storey" as const,
      id,
      storeyId: id,
      provenance: user,
      version: 0,
      level,
      elevation,
      height: 2700,
    },
  });

  const wall = (id: string, storeyId: string, a: readonly number[], b: readonly number[]) => ({
    op: "addElement" as const,
    element: {
      type: "wall" as const,
      id,
      storeyId,
      provenance: user,
      version: 0,
      baseline: [
        [a[0]!, a[1]!],
        [b[0]!, b[1]!],
      ] as [[number, number], [number, number]],
      thickness: 200,
      height: 2700,
      isLoadBearing: true,
      material: "brick",
    },
  });

  model.commit([
    storey(ids.storey0, 0, 0),
    storey(ids.storey1, 1, 2700),
    ...rect.map(([tag, a, b]) => wall(ids.ground[tag], ids.storey0, a, b)),
    ...rect.map(([tag, a, b]) => wall(ids.first[tag], ids.storey1, a, b)),
  ]);

  return { model, ids };
}
