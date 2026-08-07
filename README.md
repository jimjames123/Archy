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
    *.test.ts          Acceptance tests (25 total)
  render/
    viewport.ts    Model→screen fitting (mm, y-up → px, y-down)
    plan2d.ts      2D plan SVG with conflicts drawn onto the drawing + legend
    iso.ts         Isometric 3D view: walls extruded from the same model
    report.ts      Self-contained HTML: both views + the issue list
  demo/
    generate.ts    Worked example → demo/plan.svg, iso.svg, report.html
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
npm test        # 25 tests
npm run demo    # writes demo/report.html — open it in a browser
```

## Generate from site (Phase 4a)

`src/generate/footprint.ts` turns structured site input — land dimensions,
setbacks, orientation, room count — into a **space-efficient footprint and
starter room layout, as a real editable `BuildingModel`**, not a picture. The
footprint fills the buildable envelope (land inset by setbacks); the front wall
is the street edge; rooms are sliced across it with a front door and interior
doors so every room has egress. Every element carries `provenance.source =
"generated"` with confidence < 1, so it reads as a proposal.

The payoff: the generated plan is validated by the *same* rules engine and drops
into the *same* editor — it comes up coordinated (0 conflicts across 1–6 rooms,
covered by tests), and you can immediately drag it and watch coordination
respond. In the live editor, the "Generate from site" bar builds one on demand.
This proves the core move — generate the model, then render from it — with the
LLM `text → model` path (Phase 4b) slotting into the same pipeline later.

## Visualization (Phase 1)

The renderers are pure functions of the model — no browser, no external deps —
so the same model drives both a 2D plan and a 3D view, and the engine's
conflicts are drawn **onto** the plan (red overlays + numbered badges matching a
legend) rather than shown in a separate list. `npm run demo` builds one plan
carrying a structural load-path conflict, an architectural headroom conflict,
and an egress conflict at once, and renders all three across both views. The
real-time editor will swap the isometric SVG for three.js, but the contract —
every view is derived from the one model — is already the whole point.

## Live editor (Phase 2)

`web/` is a real browser editor. The entire coordination stack — `BuildingModel`,
transactions, `RulesEngine`, and all five rules — is imported **unchanged** from
`src/` and runs client-side; dragging geometry commits a transaction, re-runs the
engine, and repaints conflicts on the same frame. This is the payoff of the
Phase 0 "TypeScript everywhere" decision: one model, running in the browser.

```bash
npm run web:dev     # esbuild dev server at http://localhost:8000
# or:
npm run web:build   # bundle to web/dist/bundle.js, then serve web/ statically
```

The editor shows the **2D plan and the 3D massing side by side, both driven by
the same model** — the isometric renderer from `src/render/iso.ts` re-runs on
every edit, so a conflict (e.g. a widened opening in a load-bearing wall) tints
that wall red in both views at once.

Interactions: drag a corner (○) to reshape the room (coincident wall + space
vertices move together so it stays watertight); drag a window edge (▫) to widen
the opening; click a wall to select it and toggle its load-bearing state; add a
transfer beam. The panel and the header conflict count update on every edit —
widen the window past the lintel span and the structural conflict appears live;
add a deep beam and the headroom conflict cascades in beneath it.

Polish notes: drags are coalesced to one repaint per animation frame and applied
as unlogged preview commits, so a gesture stays smooth and lands as a single
entry in the edit log; both views share one fixed padded envelope so neither
rescales while you edit; the cursor reflects what's under it (grab / move /
select).

`node scripts/shoot.mjs` drives the built app in headless Chromium (real pointer
drags) and captures before/after screenshots — a regression check that the live
loop works, not just the rules in isolation.

## Deploying to GitHub Pages

The editor is a static site. `npm run build:pages` bundles it into `docs/`
(`index.html` + minified `dist/bundle.js` + `.nojekyll`), which is committed so
Pages can serve it directly. `node scripts/verify-pages.mjs` serves `docs/` and
confirms the minified build renders with no console errors.

To publish: in the repo, **Settings → Pages → Build and deployment → Source:
"Deploy from a branch"**, pick this branch and the **`/docs`** folder, Save. The
site comes up at `https://<owner>.github.io/<repo>/` (relative asset paths make
the project subpath work). Re-run `npm run build:pages` and commit after changes.

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
- **Phase 4a — site → footprint generation** ✅ deterministic land-dims +
  setbacks + orientation → a space-efficient footprint and starter room layout,
  emitted as a real editable model and validated by the same engine.
- **Phase 4b — generation:** LLM text/sketch → parametric model (constrained to
  the schema, server-side since it needs an API key).
- **Phase 5+ —** electrical & plumbing modules and rules; region rulesets;
  photoreal + walkthrough; image → editable reconstruction (hardest, last).

## Riskiest assumption

That **one shared parametric model can encode real cross-discipline semantics
(load paths, drainage slopes, circuit loads) while staying editable in real
time** — that "one model to rule them all" does not collapse under
discipline-specific complexity. Phase 0 exists to pressure-test exactly that
before more is built on top of it.
