# UML Use Case Diagram Renderer (Anwendungsfalldiagramm)

Render `diagram_type: "usecase"` JSON files into the standard Archify HTML
template: stick-figure actors outside a system boundary, use-case ellipses
inside it, associations as plain lines, «include» / «extend» as dashed open
arrows and generalization as a hollow triangle — the requirements view every
IHK Fachinformatiker project documentation opens with.

```bash
node archify/renderers/usecase/render-usecase.mjs input.usecase.json output.html
```

The renderer validates input against `archify/schemas/usecase.schema.json`
with the bundled standalone validator. No dependency installation is required.

## Input contract

```json
{
  "schema_version": 1,
  "diagram_type": "usecase",
  "meta": { "title": "Phone Ordering Use Cases", "viewBox": [1380, 620],
            "grid": { "colWidth": 200, "rowHeight": 96, "originX": 100, "originY": 96 } },
  "groups": [{ "id": "system", "label": "PHONE ORDERING SYSTEM", "nodes": ["place_order", "get_quote"] }],
  "nodes": [
    { "id": "customer", "kind": "actor", "label": "Customer", "col": 0, "row": 1 },
    { "id": "payment_provider", "kind": "actor", "label": "Payment provider", "secondary": true, "col": 6, "row": 1 },
    { "id": "place_order", "kind": "usecase", "label": "Place order", "col": 2, "row": 1 },
    { "id": "get_quote", "kind": "usecase", "label": "Get quote", "col": 4, "row": 0 }
  ],
  "relations": [
    { "from": "customer", "to": "place_order", "kind": "association" },
    { "from": "place_order", "to": "get_quote", "kind": "include", "channelX": 640 }
  ]
}
```

### Placement

- `meta.grid` defines the lattice; a node's centre is
  `(originX + col * colWidth + dx, originY + row * rowHeight + dy)`.
- Footprints (override with `width`/`height`): actor 60×72 (widened
  automatically to fit its label), use case 150×50. Use-case labels fit
  80 % of `width − 16` at ~6.2px per unit — widen long names.
- `groups[]` are **system boundaries**: a solid rectangle with the system
  name. Every use case must belong to exactly one boundary when boundaries
  exist; actors never do. Actors typically stand in column 0 (primary) and
  in the last column (secondary, `secondary: true` → dashed figure).
- Usable canvas `x ∈ [24, viewBox[0] − 24]`, `y ∈ [40, viewBox[1] − 96]`
  (legend band); keep `viewBox[0] ≤ 1380` so 9px text projects ≥ 6px at a
  1440px viewport.

### Relations

| `kind` | Line | End at `to` | Rule |
|---|---|---|---|
| `association` | solid | none | actor ↔ use case only |
| `include` | dashed, auto label «include» | open arrow | use case → included use case |
| `extend` | dashed, auto label «extend» | open arrow | extending use case → extended use case |
| `generalization` | solid | hollow triangle | actor → actor or use case → use case |

`label` overrides the automatic stereotype (e.g. `«extend» (voucher)`).
Routing vocabulary is the shared one: `route`, `fromSide`/`toSide`,
`channelX`/`channelY`, `via`, `cornerRadius`, `labelAt`/`labelDx`/`labelDy`/
`labelSegment`, `variant`, `width`. Several relations leaving one node share
its side through automatic port spread (14px); give fan-outs their own
`channelX` so verticals do not merge.

### Structural rules (hard errors)

1. Unique ids; relations reference existing nodes; no self-relations.
2. Associations join an actor and a use case; include/extend join two use
   cases; generalization joins two nodes of the same kind.
3. Every node is connected; every actor has at least one association.
4. Actors are outside every boundary; with boundaries present, every use
   case is inside exactly one.
5. Labels fit their symbol.

### Geometry checks

Shared composition checks apply unchanged (endpoint sides, edge-through-
node, crossings, corridors, border runs — edges must cross the system
boundary perpendicularly — route rhythm, label clearance). Under
`--quality showcase` all nine artifact checks pass with 0 errors / 0 warnings.

Known limitation: legend counters count nodes by `data-node-kind`; relation
kinds and the boundary show 0.

## Delivery task list (feat/usecase-type)

Base in place: schema, renderer (on `grid-graph.mjs` + shared
`uml-markers.mjs`), i18n keys, CLI registration, generated validators,
example `examples/phone-ordering.usecase.json` and its delivered
`examples/usecase-phone-ordering.html` (`validate --quality showcase` 0/0,
`visual-check` pass). Remaining, in order, each leaving the checks green:

1. **Review the example** in the delivered page; keep actors, use cases and
   relations; adjust placement/labels only where it reads badly. Re-run
   `deliver` and `visual-check`; both stay green.
2. **Register the type** everywhere the other nine are registered:
   `test/golden.mjs` (mode + ≥ 2 `expectFailure` cases: association between
   two use cases, actor inside the boundary), `test/diagram-guide.test.mjs`
   CASES, `test/cli.test.mjs`, `test/cli-output-types.test.mjs` if it
   enumerates types, `scripts/render-examples.mjs`, `recipes/scenarios.mjs`
   (scenario `use-case-model` with EN/ZH prompts and signals "use case",
   "Anwendungsfall", "actor", "Akteur", "system boundary", "include",
   "extend", "requirements", "UML"), `schemas/README.md`, gallery build
   (`npm run build:gallery`).
3. **Tests**: `test/usecase.test.mjs` (node:test) covering rules 1–5, the
   automatic «include»/«extend» labels, marker per relation kind, dashed
   include/extend, secondary-actor rendering and boundary frame bounds.
   Rendered golden stays byte-identical to the committed HTML unless task 1
   changes the example — then re-deliver and commit the HTML together.
4. **SKILL.md**: description, fast-authoring type list, type router row
   (`usecase` — requirements, actors and system scope, Anwendungsfalldiagramm
   for IHK project documentation), Mermaid mapping (no native Mermaid
   equivalent; `flowchart` with actor/ellipse nodes → `usecase`), and a
   "Usecase note:" paragraph beside the other type notes (grid, boundaries as
   groups, automatic stereotypes, port spread and `channelX`).
5. **Docs**: README / README_EN feature line (ten types) and table row,
   CHANGELOG under Unreleased. Never touch `skill-release.json` or versions.

Out of scope: extension points inside ellipses, packages, multiplicities on
associations, other diagram types.
