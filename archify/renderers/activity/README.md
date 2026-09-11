# UML Activity Diagram Renderer (Aktivitätsdiagramm)

Render `diagram_type: "activity"` JSON files into the standard Archify HTML
template: initial and final nodes, rounded actions, decision/merge diamonds
with guards on the outgoing flows, fork/join bars, object nodes and vertical
swimlanes (partitions) — the process view IHK project documentation and
every UML course expects.

```bash
node archify/renderers/activity/render-activity.mjs input.activity.json output.html
```

The renderer validates input against `archify/schemas/activity.schema.json`
with the bundled standalone validator. No dependency installation is required.

## Why an eleventh type

`flowchart` is DIN 66001: one control thread, no parallelism, no
responsibilities. An activity diagram adds fork/join for parallel work,
explicit merge nodes for loops, and swimlanes that say *who* does each step.
The type keeps the archify contract — every node on an explicit grid, lanes
defined by column ranges, the renderer validates and draws.

## Input contract

```json
{
  "schema_version": 1,
  "diagram_type": "activity",
  "meta": {
    "title": "Phone Order Activity",
    "viewBox": [1380, 790],
    "grid": { "colWidth": 230, "rowHeight": 72, "originX": 140, "originY": 100 },
    "lanes": [
      { "id": "customer", "label": "CUSTOMER", "cols": [0, 0] },
      { "id": "agent", "label": "AI PHONE AGENT", "cols": [1, 3] },
      { "id": "kitchen", "label": "KITCHEN", "cols": [4, 4] }
    ]
  },
  "nodes": [
    { "id": "start", "kind": "initial", "col": 0, "row": 0 },
    { "id": "greet", "kind": "action", "label": "Greet and take wish", "col": 2, "row": 0 },
    { "id": "is_open", "kind": "decision", "label": "open?", "col": 2, "row": 1 },
    { "id": "fork_confirm", "kind": "fork", "col": 2, "row": 5 }
  ],
  "edges": [
    { "from": "start", "to": "greet" },
    { "from": "is_open", "to": "read_hours", "label": "no" }
  ]
}
```

### Placement

- `meta.grid` defines the lattice; a node's centre is
  `(originX + col * colWidth + dx, originY + row * rowHeight + dy)`.
- Footprints (override with `width`/`height`): initial 20×20, final 26×26,
  action 150×46, decision/merge 44×44, fork/join 140×6 (`orientation:
  "vertical"` → 6×140), object 130×40. Action labels fit 90 % of
  `width − 16` at ~6.2px per unit; `sublabel` renders at 9px.
- `meta.lanes[]` are vertical swimlanes covering the column range `cols`
  (inclusive). Each node must lie inside exactly one lane and below the lane
  header (`y ≥ 70`). Without lanes the canvas is one partition.
- Usable canvas `x ∈ [24, viewBox[0] − 24]`, `y ∈ [40, viewBox[1] − 96]`
  (legend band). Keep `viewBox[0] ≤ 1380` (9px text ≥ 6px at 1440px) and
  the height ≤ ~800 so the standalone viewer fits a desktop viewport.

### Nodes

| `kind` | Shape | Rule |
|---|---|---|
| `initial` | filled circle | exactly one; no incoming, one outgoing |
| `final` | bull's-eye | ≥ 1; incoming only |
| `action` | rounded rectangle, `label` (+ `sublabel`) | ≥ 1 incoming, exactly 1 outgoing |
| `decision` | diamond, optional question `label` beside it | 1 incoming, ≥ 2 outgoing, each with a guard |
| `merge` | diamond | ≥ 2 incoming, 1 outgoing |
| `fork` | bar | 1 incoming, ≥ 2 outgoing |
| `join` | bar | ≥ 2 incoming, 1 outgoing |
| `object` | rectangle | like an action (object flow) |

### Flows

`edges[]` are control flows with the standard arrowhead. Guards on flows
leaving a decision are written as `label` and rendered as `[label]` (brackets
added when missing). The routing vocabulary is the shared one: `route`,
`fromSide`/`toSide`, `channelX`/`channelY`, `via`, `cornerRadius`,
`labelAt`/`labelDx`/`labelDy`/`labelSegment`, `variant` (`dashed` for loops
back to a merge), `width`. With automatic sides the continuation of a
decision leaves the bottom vertex and a branch leaves the side facing its
target.

### Structural rules (hard errors)

1. Unique ids; edges reference existing nodes; no self-loops.
2. Exactly one initial node, at least one final node.
3. Per-kind in/out degrees as in the table; guards on every decision branch.
4. Every node reachable from the initial node.
5. Lanes: every node inside exactly one lane, below the header.
6. Labels fit their symbol.

### Geometry checks

Shared composition checks apply unchanged (endpoint sides, edge-through-node,
crossings, corridors, border runs, route rhythm, label clearance). Under
`--quality showcase` all nine artifact checks pass with 0 errors / 0 warnings.

Known limitation: legend counters count nodes by `data-node-kind`; the
swimlane entry shows 0.

## Delivery task list (feat/activity-type)

Base in place: schema, renderer (on `grid-graph.mjs`), i18n keys, CLI
registration, generated validators, example `examples/phone-order.activity.json`
and its delivered `examples/activity-phone-order.html` (`validate --quality
showcase` 0/0, `visual-check` pass). Remaining, in order, each leaving the
checks green:

1. **Review the example** in the delivered page; keep nodes, lanes and flows;
   adjust placement/labels only where it reads badly. Re-run `deliver` and
   `visual-check`; both stay green.
2. **Register the type** everywhere the other ten are registered:
   `test/golden.mjs` (mode + ≥ 2 `expectFailure` cases: decision branch
   without guard, two initial nodes), `test/diagram-guide.test.mjs` CASES,
   `test/cli.test.mjs`, `test/cli-output-types.test.mjs` if it enumerates
   types, `scripts/render-examples.mjs`, `recipes/scenarios.mjs` (scenario
   `activity-flow` with EN/ZH prompts and signals "activity diagram",
   "Aktivitätsdiagramm", "swimlane", "Schwimmbahn", "fork", "join",
   "parallel", "business process", "UML"), `schemas/README.md`, gallery
   build (`npm run build:gallery`).
3. **Tests**: `test/activity.test.mjs` (node:test) covering rules 1–6, guard
   bracketing, lane rectangles from column ranges, bar orientation, and the
   reachability check. Rendered golden stays byte-identical to the committed
   HTML unless task 1 changes the example — then re-deliver and commit the
   HTML together.
4. **SKILL.md**: description, fast-authoring type list, type router row
   (`activity` — process flows with responsibilities, parallel steps,
   Aktivitätsdiagramm with swimlanes for IHK documentation), Mermaid mapping
   (`flowchart` with subgraphs as lanes and `{ }` decisions → `activity`
   when parallel bars or responsibilities matter; otherwise `flowchart`), and
   an "Activity note:" paragraph beside the other type notes (grid, lanes by
   column range, guards, fork/join degrees, decision side convention).
5. **Docs**: README / README_EN feature line (eleven types) and table row,
   CHANGELOG under Unreleased. Never touch `skill-release.json` or versions.

Out of scope: horizontal lanes, nested partitions, signal/time events,
interruptible regions, pins, other diagram types.
