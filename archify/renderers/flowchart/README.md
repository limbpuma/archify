# Flowchart Renderer (DIN 66001 / ISO 5807)

Render `diagram_type: "flowchart"` JSON files into the standard Archify HTML
template: a program flowchart with the normed symbols German and ISO
documentation expects — terminator, process, decision, input/output,
subroutine (predefined process) and connector.

```bash
node archify/renderers/flowchart/render-flowchart.mjs input.flowchart.json output.html
```

The renderer validates input against `archify/schemas/flowchart.schema.json`
with the bundled standalone validator. No dependency installation is required.

## Why a sixth type

`workflow` draws lanes and phases; decisions there are edge labels, not
symbols. `lifecycle` draws states. Neither can express a control-flow
algorithm the way a Programmablaufplan (PAP) does: one start, decisions as
diamonds with a labelled answer on every outgoing edge, I/O as parallelograms,
calls as double-edged boxes, explicit loops back to an earlier step. This type
keeps the archify contract — the author places every symbol on an explicit
grid, the renderer validates and draws, nothing auto-layouts.

## Input contract

```json
{
  "schema_version": 1,
  "diagram_type": "flowchart",
  "meta": {
    "title": "Phone Order Flowchart",
    "viewBox": [1120, 1420],
    "grid": { "colWidth": 176, "rowHeight": 88, "originX": 96, "originY": 84 },
    "quality_profile": "showcase"
  },
  "groups": [{ "id": "advise", "label": "A · Advise", "nodes": ["announce", "get_menu"] }],
  "nodes": [
    { "id": "start", "symbol": "terminator", "label": "Call comes in", "col": 2, "row": 0 },
    { "id": "is_open", "symbol": "decision", "label": "Open?", "col": 2, "row": 5 }
  ],
  "edges": [
    { "from": "start", "to": "is_open" },
    { "from": "is_open", "to": "read_hours", "label": "No" }
  ]
}
```

### Placement

- `meta.grid` defines the lattice. A node's centre is
  `(originX + col * colWidth + dx, originY + row * rowHeight + dy)`.
  `col` is `0..15`, `row` is `0..31`; `dx`/`dy` are pixel nudges.
- Default footprints per symbol (override with `width`/`height`):
  terminator 128×38 · process 148×52 · decision 132×64 · io 156×52 ·
  subroutine 156×46 · connector 30×30.
- The usable canvas is `x ∈ [24, viewBox[0] − 24]` and
  `y ∈ [40, viewBox[1] − 96]`; the bottom 96px is reserved for the legend.
- `groups[]` draw a dashed frame around member nodes with a small title.
  Frames are reading guides; edges may cross them only perpendicularly
  (shared `container_border_runs` check).

### Symbols (DIN 66001 names)

| `symbol` | DIN 66001 | Shape | Palette class |
|---|---|---|---|
| `terminator` | Grenzstelle | stadium (rx = h/2) | `c-database` |
| `process` | Verarbeitung | rectangle | `c-backend` |
| `decision` | Verzweigung | diamond | `c-security` |
| `io` | Ein-/Ausgabe | parallelogram | `c-cloud` |
| `subroutine` | Unterprogramm | rectangle with double side bars | `c-frontend` |
| `connector` | Übergangsstelle | small circle, label = reference | `c-external` |

Palette classes are the shared ones from `assets/template.html`, so every
`visual_preset` (classic, signal-flow, blueprint, editorial) and both themes
style flowcharts without template changes.

### Edges

Same routing vocabulary as `lifecycle`: `route` (`auto`, `straight`, `drop`,
`bottom-channel`, `top-channel`, `right-channel`, `left-channel`),
`fromSide`/`toSide`, `channelX`/`channelY`, `via`, `cornerRadius`,
`labelAt`/`labelDx`/`labelDy`/`labelSegment`, `variant`
(`default`, `emphasis`, `security`, `dashed`), `width`.

Decision convention: with automatic sides the main continuation leaves the
bottom vertex and a branch leaves the side vertex facing its target. Loops
back to an earlier step should use `dashed` and a channel route so the
return corridor stays outside the main column.

### Structural rules (hard errors)

1. At least one `terminator` with no incoming edge (start) and one with no
   outgoing edge (end). A terminator never has both.
2. Every `decision` has ≥ 2 outgoing edges and every one of them carries a
   `label` (the answer).
3. No non-decision symbol has more than one outgoing edge (connectors may).
4. Every non-terminator node is reachable (has an incoming edge).
5. No self-loops; unique node ids; groups reference existing nodes.
6. Labels must fit the symbol's text area: decision 52 %, io 78 %,
   subroutine 82 %, others 90 % of `width`. Nodes keep ≥ 12px apart.

### Geometry checks

The shared composition checks apply unchanged: endpoint sides, edge-through-
node, proper crossings, ambiguous corridors, container border runs, route
rhythm and label/route clearance. Under `--quality showcase` all nine
artifact checks must pass with 0 errors and 0 warnings, exactly like the
other types.

## Delivery task list (feat/flowchart-type)

The base (schema, renderer, i18n keys, CLI registration, generated
validators, example JSON) is in place. Remaining work, in order; each item is
verifiable and must leave `npm test` green:

1. **Author the example until showcase passes.** Iterate
   `examples/order-call.flowchart.json` (labels, `width`, `viewBox`, `grid`,
   `route`/`channelX`/`channelY`, `labelDy`) until
   `node bin/archify.mjs validate flowchart examples/order-call.flowchart.json --quality showcase --json`
   reports 9/9 checks, 0 composition errors, 0 warnings. Do not change the
   node set, the edge set, the symbols or the edge labels — only placement,
   sizes and routing. Then `deliver` it to `examples/flowchart-order-call.html`
   and run `visual-check` on that file; fix any reported readability issue.
2. **Register the type everywhere the other five are registered**: `test/golden.mjs`
   (mode list + at least two `expectFailure` negative cases: decision without
   labels, terminator with in+out edges), `test/diagram-guide.test.mjs`
   `CASES`, `test/cli-output-types.test.mjs` if it enumerates types,
   `scripts/render-examples.mjs` `TARGETS`, `recipes/scenarios.mjs`
   (one `program-flowchart` scenario with EN/ZH prompts and signals such as
   "flowchart", "Programmablaufplan", "PAP", "decision diamond", "algorithm",
   "DIN 66001"), `schemas/README.md` table.
3. **Golden output**: commit the rendered `examples/flowchart-order-call.html`
   so `test/golden.mjs` compares against it, and add
   `test/flowchart.test.mjs` (node:test) covering: structural rules 1–5,
   decision default sides, label-fit factors per symbol, group frame bounds.
4. **SKILL.md**: add `flowchart` to the description, the fast-authoring type
   list, the type router table (`flowchart` — algorithms, decision logic,
   Programmablaufplan, call scripts, exception handling), the Mermaid
   mapping (`flowchart` with decision nodes → `flowchart`; plain step graphs
   stay `workflow`), and a short "Flowchart note" beside the Lifecycle note
   describing the grid and the decision convention.
5. **Docs**: keep this README as the canonical contract; update
   `README.md` / `README_EN.md` feature list (six types) and `CHANGELOG.md`
   under an "Unreleased" heading. Do not touch `skill-release.json` or
   version numbers.
6. **Final evidence**: `npm test` from `archify/` green; paste the
   `validate --json` receipt for the example and the `visual-check --json`
   summary into the PR body draft at `docs/flowchart-type-pr.md`.

Out of scope for this branch: new visual presets, template CSS changes,
auto-layout of any kind, other diagram types (Struktogramm / Nassi-
Shneiderman, EPK, ER, UML class) — those are follow-up types on their own
branches.
