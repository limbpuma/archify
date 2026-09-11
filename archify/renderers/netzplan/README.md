# Netzplan Renderer (activity-on-node, DIN 69900 / CPM)

Render `diagram_type: "netzplan"` JSON files into the standard Archify HTML
template: the Vorgangsknotennetzplan every IHK Fachinformatiker exam and
German project handbook uses. The author supplies activities with durations
and finish-to-start dependencies on an explicit grid; the renderer computes
the schedule — earliest/latest start and finish (FAZ/FEZ/SAZ/SEZ), total and
free float (GP/FP) — and highlights the critical path.

```bash
node archify/renderers/netzplan/render-netzplan.mjs input.netzplan.json output.html
```

The renderer validates input against `archify/schemas/netzplan.schema.json`
with the bundled standalone validator. No dependency installation is required.

## Why the numbers are computed

Placement is judgment, arithmetic is not. A network plan whose FAZ/FEZ were
typed by hand is wrong the moment one duration changes, so the renderer runs
the forward pass (`FAZ = max FEZ of predecessors`, `FEZ = FAZ + D`) and the
backward pass (`SEZ = min SAZ of successors`, `SAZ = SEZ − D`,
`GP = SAZ − FAZ`, `FP = min FAZ of successors − FEZ`) on every render.
Activities with `GP = 0` and the dependencies that join them form the
critical path (emphasis colour and stroke).

## Input contract

```json
{
  "schema_version": 1,
  "diagram_type": "netzplan",
  "meta": {
    "title": "Phone Ordering Rollout Network Plan",
    "unit": "d",
    "viewBox": [1380, 460],
    "grid": { "colWidth": 250, "rowHeight": 110, "originX": 120, "originY": 110 }
  },
  "activities": [
    { "id": "requirements", "number": "1", "label": "Requirements", "duration": 3, "col": 0, "row": 1 },
    { "id": "api", "number": "2", "label": "API v1", "duration": 5, "col": 1, "row": 0 }
  ],
  "dependencies": [
    { "from": "requirements", "to": "api" }
  ]
}
```

- `meta.start` (default 0) is the project start; `meta.unit` is appended to
  the duration cell (`5 d`). `meta.captions` overrides the cell captions
  (`faz`, `fez`, `saz`, `sez`, `gp`, `fp`, `d`) — English readers may set
  `ES/EF/LS/LF/TF/FF/D`.
- Activity box (170×66 by default, `width`/`height` override): top row
  `FAZ | D | FEZ`, middle row `number label`, bottom row `SAZ | GP | FP | SEZ`.
  Captions render as fine detail (visible when zoomed); the legend names the
  layout. Labels fit `width − 16` at ~6.2px per unit.
- `dependencies[]` are finish-to-start; the shared routing vocabulary applies
  (`route`, `fromSide`/`toSide`, `channelX`/`channelY`, `via`, `label`…).
  Critical dependencies get `variant: "emphasis"` automatically.
- `groups[]` draw dashed phase frames around activities.
- Usable canvas `x ∈ [24, viewBox[0] − 24]`, `y ∈ [40, viewBox[1] − 96]`;
  keep `viewBox[0] ≤ 1380` (9px values must project ≥ 6px at 1440px).

### Structural rules (hard errors)

1. Unique ids; dependencies reference existing activities; no self-loops; no
   duplicate dependency.
2. The dependency graph is acyclic; at least one activity has no
   predecessor and at least one has no successor; no isolated activity.
3. Time flows left to right: every successor sits in a higher column.
4. Labels fit the box; declared `height` ≥ 66.

### Geometry checks

Shared composition checks apply unchanged (endpoint sides, edge-through-
activity, crossings, corridors, border runs, route rhythm, label clearance).
Under `--quality showcase` all nine artifact checks pass with 0 errors /
0 warnings. A box with two outgoing dependencies on one side spreads its
ports by 7px; route one of them from another side (`fromSide: "top"`) to
avoid a 7px dogleg on the other.

Known limitation: legend counters count nodes by `data-node-kind`.

## Delivery task list (feat/netzplan-type)

Base in place: schema, renderer (schedule + `grid-graph.mjs`), i18n keys, CLI
registration, generated validators, example `examples/rollout.netzplan.json`
and its delivered `examples/netzplan-rollout.html` (`validate --quality
showcase` 0/0, `visual-check` pass; project end 18). Remaining, in order,
each leaving the checks green:

1. **Review the example** in the delivered page; keep activities, durations
   and dependencies; adjust placement/routes only where it reads badly.
   Re-run `deliver` and `visual-check`; both stay green.
2. **Register the type** everywhere the other types are registered:
   `test/golden.mjs` (mode + ≥ 2 `expectFailure` cases: a dependency cycle,
   a successor placed left of its predecessor), `test/diagram-guide.test.mjs`
   CASES, `test/cli.test.mjs`, `test/cli-output-types.test.mjs` if it
   enumerates types, `scripts/render-examples.mjs`, `recipes/scenarios.mjs`
   (scenario `network-plan` with EN/ZH prompts and signals "Netzplan",
   "network plan", "critical path", "kritischer Pfad", "FAZ", "Pufferzeit",
   "float", "CPM", "project schedule", "DIN 69900"), `schemas/README.md`,
   gallery build (`npm run build:gallery`).
3. **Tests**: `test/netzplan.test.mjs` (node:test) covering the forward and
   backward pass on the example (FAZ/FEZ/SAZ/SEZ/GP/FP per activity, project
   end 18, critical set {requirements, api, telephony, testing, golive}),
   cycle detection, the left-to-right rule, emphasis variant on critical
   dependencies, and `meta.captions` overrides. Rendered golden stays
   byte-identical to the committed HTML unless task 1 changes the example.
4. **SKILL.md**: description, fast-authoring type list, type router row
   (`netzplan` — project schedules, critical path, Netzplantechnik for IHK
   project documentation), Mermaid mapping (`gantt` sections with `after`
   dependencies → `netzplan` when the question is about float and the
   critical path), and a "Netzplan note:" paragraph beside the other type
   notes (grid, computed schedule, captions, left-to-right rule, port hint).
5. **Docs**: README / README_EN feature line (type count) and table row,
   CHANGELOG under Unreleased. Never touch `skill-release.json` or versions.

Out of scope: start-to-start or lag relations, calendars/dates, milestones as
a distinct symbol, activity-on-arrow (Vorgangspfeilnetzplan), other types.
