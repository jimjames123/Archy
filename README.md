# Archy

An AI-native, end-to-end architectural design platform. The differentiator is
**coordination across disciplines plus full editability** — not prettier
renders. A shared, editable building model sits at the centre; every discipline
module reads from and writes back to it, so an edit in one discipline is
automatically re-validated against the others instead of silently going stale.

## Status: model + coordination spine, with a thickened rule set

This repository contains the **spine** the whole product hangs off, plus four
cross-discipline / geometric conflict checks proven end to end. The core loop —
edit → incremental re-validation → conflict → resolve — is the thesis;
everything before it is scaffolding, everything after it is expansion.

Coordination checks proven so far:

| Rule | Discipline | Fires when |
| --- | --- | --- |
| `load-path.opening-span` | Structural | An opening in a load-bearing wall exceeds the assumed lintel span with no beam modelled |
| `load-path.support-beneath` | Structural | An upper-storey load-bearing wall has no wall/beam beneath it (e.g. the wall downstairs was removed) |
| `egress.habitable-door` | Architectural | A habitable space has no adequate door out, reasoning over the `bounds`/`hostedBy` graph edges |
| `headroom.clear-height` | Architectural ← Structural | A storey is too short, or a **beam's depth** eats the clear height of a habitable room beneath it |
| `door-clearance.min-width` | Architectural | A door is narrower than the configured minimum |

The `headroom` rule is the one that most clearly earns the shared model: it
couples a *structural* property (a beam's depth) to an *architectural*
requirement (clear ceiling height), so the beam a user adds to resolve a
load-path conflict can automatically surface a headroom conflict beneath it —
the fix for one discipline exposing a cost in another. `headroom.test.ts`
proves that exact cascade end to end.

```
src/
  model/
    schema.ts      Zod schema for the shared building model (one source of truth)
    graph.ts       BuildingModel: typed element graph, transactions, edit log
    fixtures.ts    Hand-authored one- and two-storey plans for tests/demos
  geometry/
    segments.ts    2D helpers: collinear overlap, point-in-polygon, seg/poly cross
  rules/
    engine.ts        RulesEngine: runs only the rules whose deps changed
    loadPath.ts      Structural: opening span in a load-bearing wall
    supportBeneath.ts  Structural: multi-storey support / removed load path
    headroom.ts        Architectural←Structural: beam depth vs clear ceiling height
    doorClearance.ts   Architectural: minimum door width
    egress.ts          Architectural: habitable space needs a door out
    loadPath.test.ts   Phase 0 acceptance test
    phase3.test.ts     Phase 3 rules + deletion-dispatch test
    headroom.test.ts   Headroom rule + the cross-discipline cascade
```

### A gap Phase 3 closed

Deleting an element used to leave the engine blind: the removed element's type
vanished from the model, so rules that depended on it wouldn't re-run (you could
delete a load-bearing wall and nothing would re-check what it held up). `commit`
now returns `changedTypes` — the types touched, **including removed elements'
types captured at mutation time** — and the engine dispatches on that. Knocking
out a wall now correctly re-runs the structural rules.

Run it:

```bash
npm install
npm run typecheck
npm test
```

## Key architecture decisions

- **One lean parametric graph is the source of truth — not IFC.** IFC is an
  import/export format we will add later; it is too heavy to mutate and
  re-validate in real time. Elements are parametric (a wall is a baseline +
  thickness + height), never baked meshes, so anything stays editable after
  generation.
- **Relationships are typed graph edges** (`hostedBy`, `bounds`, `supports`).
  Those edges carry the cross-discipline meaning that conflict checks query
  over. Coordination = graph queries + constraint evaluation, not pixel diffs.
- **Every mutation is a transaction** producing an append-only edit log and a
  precise `changed` set. The rules engine re-runs only the rules whose
  dependency footprint intersects that set, so editing stays responsive.
- **`provenance` on every element** (`observed | inferred | generated | user` +
  confidence) so the UI can honestly flag what was inferred rather than
  observed — and never fake certainty.
- **TypeScript end to end** so the model, geometry, and rules are shared between
  a browser editor (latency) and the server (authority).

## The honesty boundary (deliberate, not a TODO)

The structural load-path rule is a **red-flag detector, not a structural
calculation**. It flags that an opening in a load-bearing wall exceeds an
*assumed* lintel span with no beam modelled, and tells the user to have a member
sized by an engineer. It does **not** certify that any beam is adequate — real
adequacy needs loads, material grades, deflection limits, and code factors the
platform does not have. Config thresholds (`maxAssumedLintelSpan`, etc.) are
generic residential placeholders, region-configurable, and are design
assistance — never a substitute for a licensed engineer's stamped drawings.

## Roadmap

- **Phase 0 — model + coordination spine** ✅
- **Phase 3 — coordination layer, thickened** ✅ second structural rule
  (multi-storey support) + geometric egress rule + deletion-aware dispatch.
- **Phase 1 — visualization from the model:** 2D plan + 3D extrusion, both
  reading the shared model, with conflict issues surfaced on the drawing.
- **Phase 2 — interactive editing:** edits write back through transactions.
- **Phase 4 — generation:** LLM text/sketch → parametric model (constrained to
  the schema), plus land-dims → footprint/orientation proposer.
- **Phase 5+ —** electrical & plumbing modules and rules; region rulesets;
  photoreal + walkthrough; image → editable reconstruction (hardest, last).

## Riskiest assumption

That **one shared parametric model can encode real cross-discipline semantics
(load paths, drainage slopes, circuit loads) while staying editable in real
time** — that "one model to rule them all" does not collapse under
discipline-specific complexity. Phase 0 exists to pressure-test exactly that
before more is built on top of it.
