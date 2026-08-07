/**
 * Room-rectangle layer for the space planner.
 *
 * The planner edits rooms as rectangles (move / attach / resize). Those rects
 * are the editable state; this module turns them into a real BuildingModel —
 * each room becomes a Space enclosed by four walls, with a door and a window —
 * so the same rules engine validates the arrangement (egress, load path,
 * headroom, and room overlap). Build the model, run the rules, render: the
 * space planner and the coordination layer stay one system.
 */
import { BuildingModel, type EditOp } from "../model/graph.js";
import type { Point, Provenance } from "../model/schema.js";

export interface RoomRect {
  id: string;
  program: string;
  /** Min corner + size, mm. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Width of the room's rear window, mm (editable to drive the load-path check). */
  windowWidth?: number;
}

export interface BuildRoomsOptions {
  storeyHeight?: number;
  wallThickness?: number;
}

const STOREY = "planner-storey-0";

export function buildRoomModel(rooms: RoomRect[], opts: BuildRoomsOptions = {}): BuildingModel {
  const h = opts.storeyHeight ?? 2700;
  const t = opts.wallThickness ?? 200;
  const prov: Provenance = { source: "user", confidence: 1 };

  const ops: EditOp[] = [
    {
      op: "addElement",
      element: {
        type: "storey",
        id: STOREY,
        storeyId: STOREY,
        provenance: prov,
        version: 0,
        level: 0,
        elevation: 0,
        height: h,
      },
    },
  ];

  for (const r of rooms) {
    const x0 = r.x;
    const y0 = r.y;
    const x1 = r.x + r.w;
    const y1 = r.y + r.h;
    const boundary: Point[] = [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ];
    ops.push({
      op: "addElement",
      element: {
        type: "space",
        id: r.id,
        storeyId: STOREY,
        provenance: prov,
        version: 0,
        program: r.program,
        boundary,
      },
    });

    // Four enclosing walls (load-bearing), named per room.
    const walls: [string, Point, Point][] = [
      [`${r.id}-wS`, [x0, y0], [x1, y0]], // front / bottom
      [`${r.id}-wN`, [x0, y1], [x1, y1]], // rear / top
      [`${r.id}-wW`, [x0, y0], [x0, y1]],
      [`${r.id}-wE`, [x1, y0], [x1, y1]],
    ];
    for (const [id, a, b] of walls) {
      ops.push({
        op: "addElement",
        element: {
          type: "wall",
          id,
          storeyId: STOREY,
          provenance: prov,
          version: 0,
          baseline: [a, b],
          thickness: t,
          height: h,
          isLoadBearing: true,
          material: "planned",
        },
      });
      ops.push({ op: "addEdge", edge: { kind: "bounds", wall: id, space: r.id } });
    }

    // Entry door on the front wall, rear window (its width drives the load-path check).
    const doorId = `${r.id}-door`;
    const doorW = Math.min(900, Math.max(700, r.w - 400));
    ops.push(opening(doorId, "door", `${r.id}-wS`, r.w / 2, doorW, 2100, 0, prov));
    ops.push({ op: "addEdge", edge: { kind: "hostedBy", opening: doorId, wall: `${r.id}-wS` } });

    const winId = `${r.id}-win`;
    const winW = Math.min(r.windowWidth ?? 1200, Math.max(400, r.w - 400));
    ops.push(opening(winId, "window", `${r.id}-wN`, r.w / 2, winW, 1200, 900, prov));
    ops.push({ op: "addEdge", edge: { kind: "hostedBy", opening: winId, wall: `${r.id}-wN` } });
  }

  const model = new BuildingModel();
  model.commit(ops);
  return model;
}

/** Recover editable room rectangles from a model's spaces (e.g. generated ones). */
export function roomsFromModel(model: BuildingModel): RoomRect[] {
  return model.elementsOfType("space").map((s) => {
    const xs = s.boundary.map((p) => p[0]);
    const ys = s.boundary.map((p) => p[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const win = model
      .elementsOfType("opening")
      .find((o) => o.kind === "window" && bounds(model, o.hostWallId, s.id));
    return {
      id: s.id,
      program: s.program,
      x,
      y,
      w: Math.max(...xs) - x,
      h: Math.max(...ys) - y,
      windowWidth: win?.width ?? 1200,
    };
  });
}

function bounds(model: BuildingModel, wallId: string, spaceId: string): boolean {
  return model.edgesOfKind("bounds").some((e) => e.wall === wallId && e.space === spaceId);
}

function opening(
  id: string,
  kind: "door" | "window",
  hostWallId: string,
  offset: number,
  width: number,
  height: number,
  sillHeight: number,
  provenance: Provenance,
): EditOp {
  return {
    op: "addElement",
    element: {
      type: "opening",
      id,
      storeyId: STOREY,
      provenance,
      version: 0,
      kind,
      hostWallId,
      offset: Math.max(0, offset),
      width,
      height,
      sillHeight,
    },
  };
}
