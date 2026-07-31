# Archy

An AI-native, end-to-end architectural design platform. The differentiator is
**coordination across disciplines plus full editability** — not prettier
renders. A shared, editable building model sits at the centre; every discipline
module reads from and writes back to it, so an edit in one discipline is
automatically re-validated against the others instead of silently going stale.

## Status: Phase 0 — the model + coordination spine

This repository currently contains the **spine** the whole product hangs off,
plus the first cross-discipline conflict check proven end to end:

> An architectural edit (widen a window) is automatically re-validated by a
> **structural** load-path rule through the shared model, surfaces a
> cross-discipline conflict, and clears when the user resolves it (add a beam,
> or narrow the opening).

That loop — edit → incremental re-validation → cross-discipline conflict — is
the core thesis. Everything before it is scaffolding; everything after it is
expansion.

```
src/
  model/
    schema.ts      Zod schema for the shared building model (one source of truth)
    graph.ts       BuildingModel: typed element graph, transactions, edit log
    fixtures.ts    A hand-authored room plan for tests/demos
  rules/
    engine.ts      RulesEngine: runs only the rules whose deps changed
    loadPath.ts    Structural load-path rule (Architectural ↔ Structural)
    doorClearance.ts  A second, architectural rule (proves dispatch)
    loadPath.test.ts  Phase 0 acceptance test
```

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

- **Phase 0 — model + coordination spine** ✅ (this commit)
- **Phase 1 — visualization from the model:** 2D plan + 3D extrusion, both
  reading the shared model.
- **Phase 2 — interactive editing:** edits write back through transactions.
- **Phase 3 — coordination layer, expanded:** more Architectural ↔ Structural
  rules + a geometric egress/clearance check firing live on every edit.
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
