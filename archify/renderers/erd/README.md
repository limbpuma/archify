# ER Diagram Renderer (Chen · IE crow's foot)

Render `diagram_type: "erd"` JSON files into the standard Archify HTML
template in either of the two notations German IT documentation and the IHK
exams use:

- **Chen** (`meta.notation: "chen"`, default): entities as rectangles, weak
  entities double-framed, relationships as diamonds (double for identifying),
  attributes as ellipses (key underlined, derived dashed, multivalued double),
  cardinalities as text at the entity end — `(min,max)` or `1 / n / m`.
- **Crow's foot** (`meta.notation: "crowsfoot"`, IE/Martin): entities as
  boxes with an attribute list (`PK`/`FK` badges, keys underlined), relations
  as lines with cardinality glyphs at both ends, dashed when non-identifying.

```bash
node archify/renderers/erd/render-erd.mjs input.erd.json output.html
```

The renderer validates input against `archify/schemas/erd.schema.json` with the
bundled standalone validator. No dependency installation is required.

## Input contract

```json
{
  "schema_version": 1,
  "diagram_type": "erd",
  "meta": { "title": "Phone Order ER Model", "notation": "chen", "viewBox": [1380, 420],
            "grid": { "colWidth": 185, "rowHeight": 84, "originX": 132, "originY": 100 } },
  "nodes": [
    { "id": "customer", "name": "Customer", "kind": "entity", "col": 0, "row": 1, "width": 130 },
    { "id": "customer_no", "name": "customerNo", "kind": "attribute", "key": true, "col": 0, "row": 0, "dx": -58 },
    { "id": "places", "name": "places", "kind": "relationship", "col": 1, "row": 1 },
    { "id": "order", "name": "Order", "kind": "entity", "col": 2, "row": 1 }
  ],
  "relations": [
    { "from": "customer", "to": "places", "fromCardinality": "(0,n)" },
    { "from": "places", "to": "order", "toCardinality": "(1,1)" },
    { "from": "customer_no", "to": "customer" }
  ]
}
```

Crow's foot entities carry their attributes inline:

```json
{ "id": "order", "name": "Order", "col": 1, "row": 0,
  "attributes": [
    { "name": "id", "type": "INT", "pk": true },
    { "name": "customer_id", "type": "INT", "fk": true },
    { "name": "placed_at", "type": "TIMESTAMP", "optional": true }
  ] }
```

and relations name both ends:

```json
{ "from": "customer", "to": "order", "label": "places",
  "fromCardinality": "one", "toCardinality": "zero-many", "identifying": false }
```

### Placement

- `meta.grid` defines the lattice; a node's centre is
  `(originX + col * colWidth + dx, originY + row * rowHeight + dy)`.
- Chen footprints (override with `width`/`height`): entity 150×46,
  relationship 150×62, attribute 100×28. Put attribute ellipses on the row
  above/below their owner and nudge them sideways with `dx` (±58 keeps two
  100px ellipses 16px apart); attribute links leave and enter vertically.
- Crow's foot boxes are 200 wide by default; height = 26 header +
  `5 + 12 × attributes + 5`. Lines need ≥ 56px between boxes so both
  cardinality glyphs (24px each) stay readable.
- Usable canvas `x ∈ [24, viewBox[0] − 24]`, `y ∈ [40, viewBox[1] − 96]`
  (legend band). Keep `viewBox[0] ≤ 1380`: members and cardinalities render
  at 9px and must project to ≥ 6px at a 1440px viewport.

### Node kinds

| `kind` | Chen shape | Crow's foot | Palette |
|---|---|---|---|
| `entity` (default) | rectangle | box with attribute rows | `c-backend` |
| `weak-entity` | double rectangle | box with inner frame | `c-backend` |
| `relationship` | diamond; `identifying: true` → double diamond | not allowed | `c-security` |
| `attribute` | ellipse; `key` underlined, `derived` dashed, `multivalued` double | not allowed (use `attributes[]`) | `c-cloud` |

### Cardinalities

- Chen: free text on the entity end of an entity–relationship line
  (`fromCardinality` when the entity is `from`, `toCardinality` when it is
  `to`). Attribute links carry none.
- Crow's foot: `fromCardinality` and `toCardinality` are both required and
  one of `one` (‖), `zero-one` (|o), `one-many` (|<), `zero-many` (o<),
  `many` (<). `identifying: false` draws the line dashed.

### Structural rules (hard errors)

Both: unique ids, relations reference existing nodes, no self-relations, names
and attribute rows fit their shapes.

Chen: entities connect only through relationship diamonds; a relationship
links ≥ 2 entities; every entity–relationship line carries a cardinality;
each attribute hangs off exactly one entity or relationship; entities have no
inline `attributes[]`; `identifying` only on relationships; `key`/`derived`/
`multivalued` only on attributes; no isolated entity.

Crow's foot: entity/weak-entity nodes only; every entity lists attributes
with at least one `pk`; both cardinalities present and valid; no isolated
entity.

### Geometry checks

Shared composition checks apply unchanged (endpoint sides, edge-through-node,
crossings, corridors, border runs, route rhythm, label clearance); the minimum
edge length in crow's foot is 56px so both glyphs fit. Under
`--quality showcase` all nine artifact checks pass with 0 errors / 0 warnings.

Known limitation: legend counters count nodes by `data-node-kind`; crow's-foot
cardinality kinds show 0 until the viewer counts line ends.

## Delivery task list (feat/erd-type)

Base in place: schema, renderer (on the shared `grid-graph.mjs` core), i18n
keys, CLI registration, generated validators, two examples with delivered HTML
(`examples/order-chen.erd.json` → `erd-order-chen.html`,
`examples/order-crowsfoot.erd.json` → `erd-order-crowsfoot.html`; both
`validate --quality showcase` 0/0 and `visual-check` pass). Remaining, in
order, each leaving the checks green:

1. **Review both examples** for readability in the delivered pages (labels,
   `labelDy`, `dx`); keep node sets, names and relations. Re-run `deliver` and
   `visual-check`; both stay green.
2. **Register the type** everywhere the other eight are registered:
   `test/golden.mjs` (both examples as modes + ≥ 2 `expectFailure` cases:
   Chen entity linked directly to an entity, crow's-foot relation without
   `toCardinality`), `test/diagram-guide.test.mjs` CASES,
   `test/cli.test.mjs`, `test/cli-output-types.test.mjs` if it enumerates
   types, `scripts/render-examples.mjs` (both), `recipes/scenarios.mjs`
   (scenario `er-model` with EN/ZH prompts and signals "ER diagram", "ERM",
   "entity relationship", "Chen", "crow's foot", "Krähenfuß", "cardinality",
   "(min,max)", "data model", "database schema"), `schemas/README.md`,
   gallery build (`npm run build:gallery`).
3. **Tests**: `test/erd.test.mjs` (node:test) covering the Chen rules, the
   crow's-foot rules, box height arithmetic, glyph selection per cardinality
   (bars/circle/foot in the rendered SVG), dashed non-identifying lines,
   underlined keys, and that attribute links leave/enter vertically. Rendered
   goldens stay byte-identical to the committed HTML unless task 1 changes an
   example — then re-deliver and commit the HTML in the same commit.
4. **SKILL.md**: description, fast-authoring type list, type router row
   (`erd` — data models, database schemas, ER models in Chen or crow's-foot
   notation for IHK/relational design), Mermaid mapping (`erDiagram` →
   `erd` with `notation: "crowsfoot"`; `||--o{` → one / zero-many, `}|..|{`
   → one-many both ends, dashed → `identifying: false`; entity blocks →
   `attributes[]` with `PK`/`FK`), and an "Erd note:" paragraph beside the
   Flowchart, Struktogramm and UML-class notes (notation switch, attribute
   placement with `dx`, cardinality fields, the 1380px width rule).
5. **Docs**: README / README_EN feature line (nine types) and table row,
   CHANGELOG under Unreleased. Never touch `skill-release.json` or versions.

Out of scope: ternary relationships, ISA/generalization hierarchies,
composite attributes, auto-placement of attributes, other diagram types.
