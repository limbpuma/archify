# UML Class Diagram Renderer (Klassendiagramm, UML 2.5)

Render `diagram_type: "uml-class"` JSON files into the standard Archify HTML
template: classifiers as three-compartment boxes (name, attributes,
operations) and relations with the normed UML line ends — the diagram every
German IT curriculum (IHK Fachinformatiker AE/SI) and every domain model
review expects.

```bash
node archify/renderers/uml-class/render-uml-class.mjs input.uml-class.json output.html
```

The renderer validates input against `archify/schemas/uml-class.schema.json`
with the bundled standalone validator. No dependency installation is required.

## Why an eighth type

`architecture` draws components and their runtime connections; it cannot say
"Delivery *is a* Fulfillment", "an Order *owns* its OrderLines" or "1 customer
places 0..* orders". A class diagram is the static structure of a domain:
inheritance, interfaces, aggregation/composition and multiplicities. The type
keeps the archify contract — the author places every classifier on an explicit
grid, the renderer measures, validates and draws, nothing auto-layouts.

## Input contract

```json
{
  "schema_version": 1,
  "diagram_type": "uml-class",
  "meta": {
    "title": "Phone Order Domain Model",
    "viewBox": [1380, 740],
    "grid": { "colWidth": 228, "rowHeight": 160, "originX": 116, "originY": 100 },
    "quality_profile": "showcase"
  },
  "groups": [{ "id": "ordering", "label": "ordering", "nodes": ["order", "order_line"] }],
  "classes": [
    { "id": "order", "name": "Order", "col": 2, "row": 0,
      "attributes": ["- number: String", "- status: OrderStatus"],
      "methods": ["+ total(): Money"] },
    { "id": "payable", "name": "Payable", "kind": "interface", "col": 5, "row": 0,
      "methods": ["+ pay(amount: Money): boolean"] }
  ],
  "relations": [
    { "from": "order_line", "to": "order", "kind": "composition", "fromMultiplicity": "1..*", "toMultiplicity": "1" },
    { "from": "payment", "to": "payable", "kind": "realization" }
  ]
}
```

### Placement

- `meta.grid` defines the lattice. A classifier's centre is
  `(originX + col * colWidth + dx, originY + row * rowHeight + dy)`.
  `col`/`row` are `0..15`; `dx`/`dy` are pixel nudges.
- Default width 180 (override with `width`). Height is computed from the
  compartments: header 26 (+11 with a stereotype line) + each compartment
  `5 + 12 × members + 5` (12 when empty). Enumerations list their literals
  in the attribute compartment and drop the operation compartment unless
  operations are given. An explicit `height` must be ≥ the computed one.
- The usable canvas is `x ∈ [24, viewBox[0] − 24]`, `y ∈ [40, viewBox[1] − 96]`;
  the bottom 96px is reserved for the legend. Classifiers keep ≥ 24px apart.
- `groups[]` draw a dashed package frame with a title around member classes.
- Keep `viewBox[0] ≤ 1380` for standalone delivery: members render at 9px and
  must still project to ≥ 6px at a 1440px desktop viewport
  (`composition/desktop-readability`). Wider diagrams: split or embed.

### Classifiers

| `kind` | Header | Palette class |
|---|---|---|
| `class` (default) | name, bold | `c-backend` |
| `abstract` | name in italics | `c-frontend` |
| `interface` | `«interface»` over the name | `c-cloud` |
| `enum` | `«enumeration»` over the name, literals in the first compartment | `c-database` |

`stereotype` overrides the guillemet line for any kind (`«entity»`,
`«service»` …). `attributes[]` and `methods[]` are plain strings in UML
member syntax; the author writes visibility (`+ - # ~`), types and
signatures: `"- price: Money"`, `"+ eta(): Duration"`. Text must fit:
names at ~6.2px per unit and members at ~5.2px per unit inside `width − 16`.

### Relations

| `kind` | Line | End at `to` | Meaning of `to` |
|---|---|---|---|
| `association` | solid | none, open arrow with `navigable: true` | the navigated class |
| `aggregation` | solid | hollow diamond | the whole |
| `composition` | solid | filled diamond | the owning whole |
| `inheritance` | solid | hollow triangle | the parent class |
| `realization` | dashed | hollow triangle | the interface |
| `dependency` | dashed | open arrow | the supplier |

`fromMultiplicity`/`toMultiplicity` (`1`, `0..1`, `*`, `1..*`, `2..4`) and
`fromRole`/`toRole` sit beside the line near each end; they are allowed on
association, aggregation and composition only. `label`/`note` render at the
route midpoint like every other type. Routing vocabulary is the shared one:
`route`, `fromSide`/`toSide`, `channelX`/`channelY`, `via`, `cornerRadius`,
`labelAt`/`labelDx`/`labelDy`/`labelSegment`, `variant`, `width`.

### Structural rules (hard errors)

1. Unique class ids; relations reference existing classes; no self-relations.
2. `realization` points at an `interface`; `inheritance` never points at an
   interface (use realization), never involves an `enum`, and an interface
   only extends interfaces.
3. No generalization cycles across inheritance/realization.
4. Multiplicities, roles and `navigable` only where the table above allows.
5. An interface declares at least one member.
6. Names, stereotypes and members fit the box; declared `height` ≥ content.

### Geometry checks

The shared composition checks apply unchanged: endpoint sides, edge-through-
class, proper crossings, ambiguous corridors, container border runs, route
rhythm and label/route clearance. Under `--quality showcase` all nine
artifact checks must pass with 0 errors and 0 warnings.

Known limitation: the legend counters count classifiers by `data-node-kind`;
relation kinds show a count of 0 until the viewer counts relations.

## Delivery task list (feat/uml-class-type)

Base in place: schema, renderer (on the shared `grid-graph.mjs` core), i18n
keys, CLI registration, generated validators, example JSON and its delivered
HTML (`validate --quality showcase` 0/0, `visual-check` pass). Remaining, in
order, each leaving the checks green:

1. **Review the example** `examples/order-domain.uml-class.json`: keep the
   class set, members and relations; adjust placement, `labelDx/labelDy`,
   channels and `width` only where the delivered page reads badly (e.g. the
   `1..*` / `1` multiplicities between Product and Category are cramped —
   widen the gap with `dx` or move the multiplicity via `fromRole`-free
   layout). Re-run `deliver` to `examples/uml-class-order-domain.html` and
   `visual-check`; both must stay green.
2. **Register the type** everywhere the other seven are registered:
   `test/golden.mjs` (mode + ≥ 2 `expectFailure` cases: realization pointing
   at a class, inheritance cycle), `test/diagram-guide.test.mjs` CASES,
   `test/cli.test.mjs`, `test/cli-output-types.test.mjs` if it enumerates
   types, `scripts/render-examples.mjs`, `recipes/scenarios.mjs` (scenario
   `class-diagram` with EN/ZH prompts and signals "class diagram",
   "Klassendiagramm", "UML", "domain model", "inheritance", "interface",
   "composition", "multiplicity"), `schemas/README.md`, gallery build
   (`npm run build:gallery`).
3. **Tests**: `test/uml-class.test.mjs` (node:test) covering structural rules
   1–6, the box arithmetic (header/compartment heights, enum without
   operation compartment), the marker per relation kind (`marker-end` ids
   and `stroke-dasharray` for realization/dependency) and the end-label
   placement (multiplicity beside each end). Rendered golden stays
   byte-identical to the committed HTML unless task 1 changes the example —
   then re-deliver and commit the new HTML in the same commit.
4. **SKILL.md**: description, fast-authoring type list, type router row
   (`uml-class` — domain models, class structure, inheritance/interfaces,
   Klassendiagramm for IHK/UML documentation), Mermaid mapping
   (`classDiagram` → `uml-class`; `<|--` inheritance, `*--` composition,
   `o--` aggregation, `..|>` realization, `..>` dependency, `"1" -- "0..*"`
   multiplicities), and a "UML-class note:" paragraph beside the Flowchart
   and Struktogramm notes (grid, compartments, marker at `to`, multiplicity
   fields, the 1380px width rule).
5. **Docs**: README / README_EN feature line (eight types) and table row,
   CHANGELOG under Unreleased. Never touch `skill-release.json` or versions.

Out of scope: auto-layout, self-associations, association classes, nested
packages, n-ary associations, other diagram types.
