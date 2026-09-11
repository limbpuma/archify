# Struktogramm Renderer (Nassi-Shneiderman, DIN 66261)

Render `diagram_type: "struktogramm"` JSON files into the standard Archify HTML
template: a structured-programming diagram made of nested boxes — the form
German IT training (IHK Fachinformatiker), textbooks and specification
documents use to describe an algorithm without arrows.

```bash
node archify/renderers/struktogramm/render-struktogramm.mjs input.struktogramm.json output.html
```

## Why a seventh type

A `flowchart` shows control flow with arrows and DIN 66001 symbols. A
Struktogramm shows the same algorithm as nested blocks: sequence top to
bottom, branching as a split box, loops as an L-shaped frame around their
body. There are no edges, so no routing; the author owns the block tree and
its proportions (`split`, `weight`), the renderer owns box arithmetic. That
keeps the archify contract: authored structure, deterministic rendering,
validated text fit.

## Input contract

```json
{
  "schema_version": 1,
  "diagram_type": "struktogramm",
  "meta": { "title": "Phone Order Struktogramm", "viewBox": [980, 640], "quality_profile": "showcase" },
  "blocks": [
    { "id": "announce", "kind": "statement", "text": "Announce: a machine speaks" },
    { "kind": "if", "text": "open?", "thenLabel": "yes", "elseLabel": "no", "split": 0.62,
      "then": [ { "kind": "call", "text": "POST /api/v1/orders/quote" } ],
      "else": [ { "kind": "exit", "text": "end without order" } ] },
    { "kind": "until", "text": "until an answer arrives", "body": [ { "kind": "call", "text": "POST /api/v1/orders" } ] }
  ]
}
```

### Block kinds (DIN 66261 Sinnbilder)

| `kind` | DIN 66261 | Drawn as |
|---|---|---|
| `statement` | Verarbeitung | plain row |
| `io` | Ein-/Ausgabe | row with a left accent bar |
| `call` | Unterprogrammaufruf | row with double side bars |
| `if` | Verzweigung | header with the condition in a triangle split, `thenLabel` / `elseLabel` in the lower corners, two columns (`then`, `else`) sized by `split` (share of the left column, default 0.5) |
| `case` | Mehrfachauswahl (Fallunterscheidung) | header with the selector, one column per `cases[]` entry (label on top), widths by `weight` (default 1) |
| `while` | kopfgesteuerte Schleife | header row, body indented on the left (`layout.indent`) |
| `until` | fußgesteuerte Schleife | body indented on the left, footer row with the condition |
| `for` | Zählschleife | header row with the counter expression, body indented |
| `exit` | Aussprung / Abbruch | row with a left-pointing notch |

`tone` (`neutral`, `accent`, `success`, `failure`) tints a row using the shared
palette classes; ids are optional and used by guided views (`meta.views`).

### Layout arithmetic

- Canvas: `viewBox` (default 980×640). The root block column spans
  `viewBox[0] − 2·margin` (margin default 40) starting at y = 56 and must end
  above `viewBox[1] − 96` (legend band).
- `layout.rowHeight` (default 34) is the height of a plain row; `if` and
  `case` headers use 1.35× rowHeight; loop header/footer rows use 1×.
- Column widths: `if` → `split` and `1 − split`; `case` → `weight` shares;
  loops indent the body by `layout.indent` (default 26).
- Text must fit its box: `textUnits(text) · 6.2 ≤ innerWidth − 12` at the
  10px source size (same estimator as the other types); shrink-to-fit is
  allowed down to 8px only for `note`. Anything narrower is a validation
  error with the box width in the message, never silently clipped.

### Validation (hard errors)

1. Every `if` has `then` and `else`; every `case` has ≥ 2 cases; every loop
   has a `body`; `statement`/`io`/`call`/`exit` have no children.
2. Nesting depth ≤ 6, total rows ≤ 40.
3. The rendered tree fits the canvas horizontally and vertically (message
   names the offending block and the required viewBox).
4. Text fits its column at 10px (message names the block and the width).
5. Unique ids; guided views reference existing ids (shared check).
6. Showcase adds the desktop-readability projection like every other type.

## Delivery task list (feat/struktogramm-type)

Base in place: schema, renderer, i18n keys, CLI registration, generated
validators, example JSON. Remaining, in order, each leaving the checks green:

1. **Author the example until showcase passes**:
   `node bin/archify.mjs validate struktogramm examples/order-call.struktogramm.json --quality showcase --json`
   → all artifact checks pass, 0 composition errors/warnings; `deliver` to
   `examples/struktogramm-order-call.html`; `visual-check` on that file
   reports top-level status pass. Keep the block tree and texts; adjust
   `split`, `weight`, `viewBox`, `layout`.
2. **Register the type** everywhere the other six are registered:
   `test/golden.mjs` (mode + ≥ 2 `expectFailure` cases: `if` without `else`,
   text wider than its column), `test/diagram-guide.test.mjs` CASES,
   `test/cli.test.mjs`, `scripts/render-examples.mjs`, `recipes/scenarios.mjs`
   (scenario `structured-program` with signals "Struktogramm",
   "Nassi-Shneiderman", "structured program", "nested blocks", "DIN 66261",
   "pseudocode"), `schemas/README.md`, gallery build (`npm run build:gallery`).
3. **Tests**: commit the rendered example so golden compares against it; add
   `test/struktogramm.test.mjs` covering rules 1–4 and the layout arithmetic
   (split widths, indent, header heights).
4. **SKILL.md**: description, fast-authoring type list, type router row
   (`struktogramm` — structured programs, nested control structures, IHK-style
   algorithm descriptions), Mermaid mapping (no Mermaid equivalent: pseudocode
   → `struktogramm`), a "Struktogramm note" beside the Flowchart note.
5. **Docs**: README / README_EN feature line (seven types) and table row,
   CHANGELOG under Unreleased. Never touch `skill-release.json` or versions.

Out of scope: arrows of any kind, auto-wrapping of long texts (authors shorten
or widen), other diagram types.
