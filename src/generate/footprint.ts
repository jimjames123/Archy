/**
 * Site → footprint generator (deterministic, no LLM).
 *
 * Capability #4 from the brief: take land dimensions, setbacks, orientation and
 * a room program, and propose a space-efficient building footprint + a starter
 * room layout — as a real, editable BuildingModel that the rules engine then
 * validates like anything else. The point it proves: we generate the MODEL and
 * render from it (so the result is fully editable and coordination-checked),
 * rather than generating a picture.
 *
 * Everything it emits carries provenance.source = "generated" with a confidence
 * below 1, so the UI can honestly flag it as a proposal, not a fixed decision.
 *
 * Layout strategy (intentionally simple, deterministic):
 *  - The footprint fills the buildable envelope (land inset by the setbacks) —
 *    the space-efficient answer given the constraints.
 *  - The front wall is the street-facing edge; the footprint is sliced into
 *    equal-width rooms across it. Room 0 gets the front door; each partition
 *    gets an interior door, so every room has egress through a bounding wall.
 *  - Perimeter walls are load-bearing; partitions are not.
 */
import { BuildingModel, type EditOp } from "../model/graph.js";
import type { Point, Provenance } from "../model/schema.js";

export type Compass = "N" | "E" | "S" | "W";

export interface SiteInput {
  /** Land size in mm. */
  land: { width: number; depth: number };
  /** Setbacks in mm from each edge. */
  setbacks: { front: number; rear: number; left: number; right: number };
  /** Number of rooms to slice the footprint into (clamped 1..6). */
  rooms: number;
  /** Compass direction the street-facing front wall looks toward. */
  frontFaces: Compass;
  storeyHeight?: number;
  wallThickness?: number;
}

export interface SiteReport {
  landAreaM2: number;
  footprintAreaM2: number;
  /** Footprint area as a fraction of the land (site coverage). */
  coverage: number;
  footprint: { widthM: number; depthM: number };
  rooms: { name: string; program: string; areaM2: number }[];
  notes: string[];
}

const PROGRAMS = ["living", "kitchen", "bedroom", "bedroom", "dining", "study"];
const OPPOSITE: Record<Compass, Compass> = { N: "S", S: "N", E: "W", W: "E" };

export function generateFootprint(input: SiteInput): {
  model: BuildingModel;
  report: SiteReport;
} {
  const t = input.wallThickness ?? 200;
  const h = input.storeyHeight ?? 2700;
  const n = Math.max(1, Math.min(6, Math.round(input.rooms)));
  const gen = (confidence: number): Provenance => ({ source: "generated", confidence });

  // Buildable envelope (mm). Land occupies [0,0]..[W,D]; front edge is y = y0.
  const { width: W, depth: D } = input.land;
  const x0 = input.setbacks.left;
  const x1 = W - input.setbacks.right;
  const y0 = input.setbacks.front;
  const y1 = D - input.setbacks.rear;
  if (x1 - x0 < 2000 || y1 - y0 < 2000) {
    throw new Error("Setbacks leave less than a 2 m buildable envelope.");
  }

  // Interior cut lines across the front (x), including the two ends.
  const cuts = Array.from({ length: n + 1 }, (_, i) => x0 + ((x1 - x0) * i) / n);

  const storeyId = "gen-storey-0";
  const ops: EditOp[] = [
    {
      op: "addElement",
      element: {
        type: "storey",
        id: storeyId,
        storeyId,
        provenance: gen(0.8),
        version: 0,
        level: 0,
        elevation: 0,
        height: h,
      },
    },
  ];

  // Perimeter walls (load-bearing).
  const perim: [string, Point, Point][] = [
    ["gen-wall-front", [x0, y0], [x1, y0]],
    ["gen-wall-rear", [x0, y1], [x1, y1]],
    ["gen-wall-left", [x0, y0], [x0, y1]],
    ["gen-wall-right", [x1, y0], [x1, y1]],
  ];
  for (const [id, a, b] of perim) {
    ops.push(wall(id, storeyId, a, b, true, t, h, gen(0.7)));
  }

  // Interior partitions (non-load-bearing), one per internal cut.
  for (let i = 1; i < n; i++) {
    const cx = cuts[i]!;
    ops.push(
      wall(`gen-part-${i}`, storeyId, [cx, y0], [cx, y1], false, Math.round(t * 0.7), h, gen(0.6)),
    );
  }

  // Rooms, front door, interior doors, rear windows + the edges that tie them.
  const report: SiteReport["rooms"] = [];
  for (let i = 0; i < n; i++) {
    const xa = cuts[i]!;
    const xb = cuts[i + 1]!;
    const program = PROGRAMS[Math.min(i, PROGRAMS.length - 1)]!;
    const roomId = `gen-room-${i}`;
    const boundary: Point[] = [
      [xa, y0],
      [xb, y0],
      [xb, y1],
      [xa, y1],
    ];
    ops.push({
      op: "addElement",
      element: {
        type: "space",
        id: roomId,
        storeyId,
        provenance: gen(0.6),
        version: 0,
        program,
        boundary,
      },
    });
    report.push({
      name: program,
      program,
      areaM2: round1(((xb - xa) * (y1 - y0)) / 1e6),
    });

    // Bounding walls for this room: front, rear, and the two side boundaries.
    const left = i === 0 ? "gen-wall-left" : `gen-part-${i}`;
    const right = i === n - 1 ? "gen-wall-right" : `gen-part-${i + 1}`;
    for (const w of ["gen-wall-front", "gen-wall-rear", left, right]) {
      ops.push({ op: "addEdge", edge: { kind: "bounds", wall: w, space: roomId } });
    }

    // A rear window for daylight, centred on the room (safely under lintel span).
    const winId = `gen-win-${i}`;
    ops.push(
      opening(winId, storeyId, "window", "gen-wall-rear", (xa + xb) / 2 - x0, 1200, 1200, 900, gen(0.55)),
    );
    ops.push({ op: "addEdge", edge: { kind: "hostedBy", opening: winId, wall: "gen-wall-rear" } });
  }

  // Front entrance door into room 0.
  ops.push(
    opening("gen-door-front", storeyId, "door", "gen-wall-front", (cuts[0]! + cuts[1]!) / 2 - x0, 900, 2100, 0, gen(0.7)),
  );
  ops.push({ op: "addEdge", edge: { kind: "hostedBy", opening: "gen-door-front", wall: "gen-wall-front" } });

  // Interior doors on each partition so every room has egress via a bounding wall.
  for (let i = 1; i < n; i++) {
    const id = `gen-door-part-${i}`;
    ops.push(opening(id, storeyId, "door", `gen-part-${i}`, (y1 - y0) / 2, 850, 2100, 0, gen(0.6)));
    ops.push({ op: "addEdge", edge: { kind: "hostedBy", opening: id, wall: `gen-part-${i}` } });
  }

  const model = new BuildingModel();
  model.commit(ops);

  const footprintAreaM2 = round1(((x1 - x0) * (y1 - y0)) / 1e6);
  const landAreaM2 = round1((W * D) / 1e6);
  return {
    model,
    report: {
      landAreaM2,
      footprintAreaM2,
      coverage: Math.round((footprintAreaM2 / landAreaM2) * 100) / 100,
      footprint: { widthM: round1((x1 - x0) / 1000), depthM: round1((y1 - y0) / 1000) },
      rooms: report,
      notes: [
        `Footprint fills the buildable envelope: ${round1((x1 - x0) / 1000)} × ${round1((y1 - y0) / 1000)} m, ${Math.round((footprintAreaM2 / landAreaM2) * 100)}% site coverage.`,
        `Front faces ${input.frontFaces}; main glazing placed on the ${OPPOSITE[input.frontFaces]} (rear) elevation — a daylight assumption, not a solar study.`,
        `Layout is a proposal (confidence < 1) — every element is editable and re-validated on change.`,
      ],
    },
  };
}

function wall(
  id: string,
  storeyId: string,
  a: Point,
  b: Point,
  isLoadBearing: boolean,
  thickness: number,
  height: number,
  provenance: Provenance,
): EditOp {
  return {
    op: "addElement",
    element: {
      type: "wall",
      id,
      storeyId,
      provenance,
      version: 0,
      baseline: [a, b],
      thickness,
      height,
      isLoadBearing,
      material: "generated",
    },
  };
}

function opening(
  id: string,
  storeyId: string,
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
      storeyId,
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

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
