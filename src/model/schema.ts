/**
 * Shared building model — the single source of truth every discipline reads
 * from and writes back to.
 *
 * Design notes:
 * - All lengths are in millimetres (mm). Points are [x, y] in the storey plane.
 * - Every element is a node in a typed graph. Relationships between elements
 *   live as typed `Edge`s (see below) — those edges ARE the coordination
 *   substrate that cross-discipline checks query over.
 * - Geometry is kept parametric (a wall is a baseline + thickness + height),
 *   never a baked mesh, so any element stays editable after generation.
 * - `provenance` records whether a value was observed, inferred, generated, or
 *   set by the user, plus a confidence. This is what lets the UI honestly flag
 *   "inferred, not certain" instead of faking certainty.
 */
import { z } from "zod";

export const Point = z.tuple([z.number(), z.number()]);
export type Point = z.infer<typeof Point>;

export const Provenance = z.object({
  source: z.enum(["observed", "inferred", "generated", "user"]),
  /** 0..1 — how much to trust this element's values. */
  confidence: z.number().min(0).max(1),
});
export type Provenance = z.infer<typeof Provenance>;

const base = {
  id: z.string().min(1),
  storeyId: z.string().min(1),
  provenance: Provenance,
  /** Bumped on every mutation; used for optimistic concurrency later. */
  version: z.number().int().nonnegative().default(0),
};

/** A horizontal level of the building. */
export const Storey = z.object({
  ...base,
  type: z.literal("storey"),
  /** Level index; 0 = ground. */
  level: z.number().int(),
  /** Finished-floor elevation from datum, mm. */
  elevation: z.number(),
  /** Floor-to-floor height, mm. */
  height: z.number().positive(),
});
export type Storey = z.infer<typeof Storey>;

/** A vertical wall. Structural semantics ride on the same element as geometry. */
export const Wall = z.object({
  ...base,
  type: z.literal("wall"),
  /** Centre-line, [start, end], mm. */
  baseline: z.tuple([Point, Point]),
  thickness: z.number().positive(),
  height: z.number().positive(),
  /**
   * Whether this wall carries vertical load. This is the single structural
   * fact that makes an Architectural edit a Structural event. It may be
   * user-set, inferred from position, or generated — see `provenance`.
   */
  isLoadBearing: z.boolean(),
  material: z.string().default("unspecified"),
});
export type Wall = z.infer<typeof Wall>;

/** A door or window cut into a host wall. */
export const Opening = z.object({
  ...base,
  type: z.literal("opening"),
  kind: z.enum(["door", "window"]),
  /** The wall this opening is cut into. */
  hostWallId: z.string().min(1),
  /** Distance of the opening's centre from the host wall's baseline start, mm. */
  offset: z.number().nonnegative(),
  width: z.number().positive(),
  height: z.number().positive(),
  sillHeight: z.number().nonnegative().default(0),
});
export type Opening = z.infer<typeof Opening>;

/** An enclosed room; its boundary is derived from bounding walls. */
export const Space = z.object({
  ...base,
  type: z.literal("space"),
  program: z.string().default("unspecified"),
  /** Closed polygon of the room, mm. Derived from walls, cached here. */
  boundary: z.array(Point).min(3),
});
export type Space = z.infer<typeof Space>;

/**
 * A structural beam / lintel spanning between supports. In the MVP its job is
 * to represent the member a user must add when they open up or remove a
 * load-bearing element. Sizing is deliberately NOT asserted here — see the
 * load-path rule for why the platform flags rather than certifies.
 */
export const Beam = z.object({
  ...base,
  type: z.literal("beam"),
  /** Line the beam runs along, mm. */
  line: z.tuple([Point, Point]),
  /**
   * Structural depth of the member, mm — how far its soffit hangs below the
   * ceiling. This is what couples structure to habitability: a deep beam added
   * to fix a load path can eat the headroom of the room beneath it.
   */
  depth: z.number().positive(),
});
export type Beam = z.infer<typeof Beam>;

export const Element = z.discriminatedUnion("type", [
  Storey,
  Wall,
  Opening,
  Space,
  Beam,
]);
export type Element = z.infer<typeof Element>;
export type ElementType = Element["type"];

/**
 * Typed relationships between elements. The graph edges carry cross-discipline
 * meaning that no single element could express on its own.
 */
export const Edge = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("bounds"), wall: z.string(), space: z.string() }),
  z.object({ kind: z.literal("hostedBy"), opening: z.string(), wall: z.string() }),
  /** A beam that carries the load previously (or newly) taken by `carries`. */
  z.object({ kind: z.literal("supports"), beam: z.string(), carries: z.string() }),
]);
export type Edge = z.infer<typeof Edge>;
export type EdgeKind = Edge["kind"];

export const Project = z.object({
  id: z.string().min(1),
  name: z.string(),
  /** Region ruleset id (e.g. "generic-residential-v1"). */
  region: z.string().default("generic-residential-v1"),
  units: z.literal("mm").default("mm"),
});
export type Project = z.infer<typeof Project>;
