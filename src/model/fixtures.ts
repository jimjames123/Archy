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
    { op: "addEdge", edge: { kind: "bounds", wall: ids.wallS, space: ids.room } },
  ]);

  return { model, ids };
}
