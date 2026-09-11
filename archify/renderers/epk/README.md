# EPK Renderer (ereignisgesteuerte Prozesskette, eEPK)

Render `diagram_type: "epk"` JSON files into the standard Archify HTML
template: the event-driven process chain German business-process
documentation (ARIS, IHK Fachinformatiker / Kaufleute) expects — events as
hexagons, functions as rounded rectangles, XOR / ∧ / ∨ connectors, and the
extended notation's organisational units and information objects attached
to functions.

```bash
node archify/renderers/epk/render-epk.mjs input.epk.json output.html
```

The renderer validates input against `archify/schemas/epk.schema.json` with
the bundled standalone validator. No dependency installation is required.

## Input contract

```json
{
  "schema_version": 1,
  "diagram_type": "epk",
  "meta": { "title": "Phone Order Process Chain", "viewBox": [1380, 820],
            "grid": { "colWidth": 250, "rowHeight": 60, "originX": 120, "originY": 100 } },
  "nodes": [
    { "id": "call_received", "kind": "event", "label": "Call received", "col": 2, "row": 0 },
    { "id": "take_order", "kind": "function", "label": "Take order", "col": 2, "row": 1 },
    { "id": "menu", "kind": "info", "label": "Menu", "col": 1, "row": 1 },
    { "id": "agent", "kind": "org", "label": "AI phone agent", "col": 3, "row": 1 },
    { "id": "payment_split", "kind": "connector", "operator": "xor", "col": 2, "row": 4 }
  ],
  "edges": [
    { "from": "call_received", "to": "take_order" },
    { "from": "menu", "to": "take_order" },
    { "from": "agent", "to": "take_order" },
    { "from": "payment_split", "to": "payment_ok", "fromSide": "bottom", "toSide": "top" }
  ]
}
```

### Placement

- `meta.grid` defines the lattice; a node's centre is
  `(originX + col * colWidth + dx, originY + row * rowHeight + dy)`. EPKs
  read top to bottom: keep the main chain in one column and put branches,
  organisational units and information objects in neighbouring columns.
- Footprints (override with `width`/`height`): event 150×40 (hexagon),
  function 150×42, connector 32×32, org 130×36 (ellipse with bar), info
  130×34. Labels fit the symbol's text area (event 84 %, function 90 %,
  org 72 %, info 86 % of `width − 16`; events/functions ~6.2px per unit,
  org/info ~5.2px).
- Usable canvas `x ∈ [24, viewBox[0] − 24]`, `y ∈ [40, viewBox[1] − 96]`;
  keep `viewBox[0] ≤ 1380` and the height ≤ ~820.

### Edges

Edge meaning follows the node kinds — no `kind` field:

| Between | Rendered as | Meaning |
|---|---|---|
| event / function / connector | solid line with arrowhead | control flow |
| org ↔ function | solid line, no arrowhead | assignment (who performs it) |
| info ↔ function | dashed line with arrowhead | information input/output |

Routing vocabulary is the shared one (`route`, `fromSide`/`toSide`,
`channelX`/`channelY`, `via`, `labelDx`/`labelDy`…). Give split connectors
`fromSide: "bottom"` / `toSide: "top"` so branches drop vertically.

### Structural rules (hard errors)

1. Unique ids; edges reference existing nodes; no self-loops.
2. The chain starts with ≥ 1 event without incoming control flow and ends
   with ≥ 1 event without outgoing control flow.
3. Alternation: through connectors, an event is never followed by an event
   and a function never by a function.
4. Events have ≤ 1 incoming and ≤ 1 outgoing control flow; functions have
   exactly one of each.
5. Connectors carry an `operator` (xor, and, or) and are a split (1 in,
   ≥ 2 out) or a join (≥ 2 in, 1 out). **An XOR or OR split never follows
   an event** — events cannot decide; only AND may split after an event.
6. Organisational units and information objects attach to functions only
   and never take part in the control flow; each is attached to at least one
   function.
7. Labels fit their symbol.

### Geometry checks

Shared composition checks apply unchanged (endpoint sides, edge-through-node,
crossings, corridors, border runs, route rhythm, label clearance). Under
`--quality showcase` all nine artifact checks pass with 0 errors / 0 warnings.

## Delivery task list (feat/epk-type)

Base in place: schema, renderer (on `grid-graph.mjs`), i18n keys, CLI
registration, generated validators, example `examples/phone-order.epk.json`
and its delivered `examples/epk-phone-order.html` (`validate --quality
showcase` 0/0, `visual-check` pass). Remaining, in order, each leaving the
checks green:

1. **Review the example** in the delivered page; keep nodes and edges;
   adjust placement/labels only where it reads badly. Re-run `deliver` and
   `visual-check`; both stay green.
2. **Register the type** everywhere the other types are registered:
   `test/golden.mjs` (mode + ≥ 2 `expectFailure` cases: XOR split directly
   after an event, two functions in a row), `test/diagram-guide.test.mjs`
   CASES, `test/cli.test.mjs`, `test/cli-output-types.test.mjs` if it
   enumerates types, `scripts/render-examples.mjs`, `recipes/scenarios.mjs`
   (scenario `process-chain` with EN/ZH prompts and signals "EPK",
   "ereignisgesteuerte Prozesskette", "event-driven process chain", "ARIS",
   "Geschäftsprozess", "business process", "XOR", "organisational unit"),
   `schemas/README.md`, gallery build (`npm run build:gallery`).
3. **Tests**: `test/epk.test.mjs` (node:test) covering rules 1–7, the edge
   kind inference (assignment without arrowhead, dashed information flow),
   operator glyphs, and the alternation check across connectors. Rendered
   golden stays byte-identical to the committed HTML unless task 1 changes
   the example.
4. **SKILL.md**: description, fast-authoring type list, type router row
   (`epk` — business processes, ARIS-style event-driven process chains with
   responsibilities and information objects for IHK documentation), Mermaid
   mapping (`flowchart` with alternating event/function nodes and gateway
   diamonds → `epk`; keep `flowchart` for algorithms), and an "Epk note:"
   paragraph beside the other type notes (grid, alternation, connector
   rules, org/info attachment, split routing hint).
5. **Docs**: README / README_EN feature line (type count) and table row,
   CHANGELOG under Unreleased. Never touch `skill-release.json` or versions.

Out of scope: process interfaces, application systems, loops with re-entry
connectors, horizontal layout, other diagram types.
