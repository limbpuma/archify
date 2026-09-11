// Tests for the ER diagram renderer's structural rules, box arithmetic, and
// rendered glyph selection. The renderer is exercised transitively by the
// golden byte-compare, but the structural rules below are mode-specific and
// easy to regress without noticing. Runs as part of `npm test`.
//
//   node --test test/erd.test.mjs   (or: npm test)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const chenRenderer = path.join(skillRoot, 'renderers/erd/render-erd.mjs');

function render(inputPath, outName = 'tmp-erd-test.html') {
  const out = path.join(skillRoot, outName);
  execFileSync(process.execPath, [chenRenderer, inputPath, out]);
  return out;
}

const chen = JSON.parse(fs.readFileSync(
  path.join(skillRoot, 'examples/order-chen.erd.json'), 'utf8',
));
const crowsfoot = JSON.parse(fs.readFileSync(
  path.join(skillRoot, 'examples/order-crowsfoot.erd.json'), 'utf8',
));

const chenHtml = fs.readFileSync(path.join(skillRoot, 'examples/erd-order-chen.html'), 'utf8');
const crowsfootHtml = fs.readFileSync(path.join(skillRoot, 'examples/erd-order-crowsfoot.html'), 'utf8');

const CROWSFOOT_CARDINALITIES = new Set(['one', 'zero-one', 'one-many', 'zero-many', 'many']);

// ---------------------------------------------------------------------------
// Chen notation rules
// ---------------------------------------------------------------------------

test('Chen example renders without errors', () => {
  const input = path.join(skillRoot, 'examples/order-chen.erd.json');
  const out = render(input);
  const html = fs.readFileSync(out, 'utf8');
  assert.match(html, /<svg /);
  assert.match(html, /data-erd-notation="chen"/);
  fs.unlinkSync(out);
});

test('Chen entities connect only through relationship diamonds (rule 1)', () => {
  for (const relation of chen.relations) {
    const from = chen.nodes.find((n) => n.id === relation.from);
    const to = chen.nodes.find((n) => n.id === relation.to);
    if (!from || !to) continue;
    const kinds = [from.kind || 'entity', to.kind || 'entity'];
    const entityToRelationship = (kinds.includes('relationship')) && (
      kinds.includes('entity') || kinds.includes('weak-entity')
    );
    const attributeLink = kinds.includes('attribute') && kinds.some((kind) => kind !== 'attribute');
    if (entityToRelationship || attributeLink) continue;
    assert.fail(`Relation "${relation.id ?? `${relation.from}-${relation.to}`}" links ${from.kind} "${relation.from}" to ${to.kind} "${relation.to}" — in Chen notation entities connect only through a relationship diamond, and attributes hang off one entity or relationship.`);
  }
});

test('every Chen relationship has at least two entity links (rule 1)', () => {
  const degree = new Map();
  for (const relation of chen.relations) {
    const from = chen.nodes.find((n) => n.id === relation.from);
    const to = chen.nodes.find((n) => n.id === relation.to);
    if (!from || !to) continue;
    const fromIsEntity = from.kind === 'entity' || from.kind === 'weak-entity';
    const toIsEntity = to.kind === 'entity' || to.kind === 'weak-entity';
    const entityToRelationship =
      (fromIsEntity && to.kind === 'relationship') ||
      (from.kind === 'relationship' && toIsEntity);
    if (entityToRelationship) {
      degree.set(relation.from, (degree.get(relation.from) || 0) + 1);
      degree.set(relation.to, (degree.get(relation.to) || 0) + 1);
    }
  }
  for (const node of chen.nodes) {
    if (node.kind !== 'relationship') continue;
    const links = degree.get(node.id) || 0;
    assert.ok(links >= 2,
      `relationship "${node.id}" connects ${links} entity(ies) — a Chen relationship needs at least two`);
  }
});

test('every Chen attribute hangs off exactly one entity or relationship (rule 1)', () => {
  const degree = new Map();
  for (const relation of chen.relations) {
    const from = chen.nodes.find((n) => n.id === relation.from);
    const to = chen.nodes.find((n) => n.id === relation.to);
    if (!from || !to) continue;
    const kinds = [from.kind || 'entity', to.kind || 'entity'];
    const attributeLink = kinds.includes('attribute') && kinds.some((kind) => kind !== 'attribute');
    if (!attributeLink) continue;
    degree.set(relation.from, (degree.get(relation.from) || 0) + 1);
    degree.set(relation.to, (degree.get(relation.to) || 0) + 1);
  }
  for (const node of chen.nodes) {
    if (node.kind !== 'attribute') continue;
    const links = degree.get(node.id) || 0;
    assert.equal(links, 1,
      `attribute "${node.id}" is linked ${links} times — an attribute belongs to exactly one entity or relationship`);
  }
});

test('every Chen entity–relationship line carries a cardinality (rule 1)', () => {
  for (const relation of chen.relations) {
    const from = chen.nodes.find((n) => n.id === relation.from);
    const to = chen.nodes.find((n) => n.id === relation.to);
    if (!from || !to) continue;
    const entityToRelationship = (from.kind === 'relationship' && (to.kind === 'entity' || to.kind === 'weak-entity'))
      || (to.kind === 'relationship' && (from.kind === 'entity' || from.kind === 'weak-entity'));
    if (!entityToRelationship) continue;
    assert.ok(relation.fromCardinality || relation.toCardinality,
      `Relation "${relation.id ?? `${relation.from}-${relation.to}`}" needs a cardinality (min,max), 1, n, or m at the entity end.`);
  }
});

test('Chen attribute links carry no cardinality and attribute-only entities stay inline-free (rule 1)', () => {
  for (const relation of chen.relations) {
    const from = chen.nodes.find((n) => n.id === relation.from);
    const to = chen.nodes.find((n) => n.id === relation.to);
    if (!from || !to) continue;
    const kinds = [from.kind || 'entity', to.kind || 'entity'];
    const attributeLink = kinds.includes('attribute') && kinds.some((kind) => kind !== 'attribute');
    if (attributeLink && (relation.fromCardinality || relation.toCardinality)) {
      assert.fail(`Relation "${relation.id ?? `${relation.from}-${relation.to}`}" carries a cardinality on an attribute link — cardinalities belong to entity–relationship lines.`);
    }
  }
  for (const node of chen.nodes) {
    if (Array.isArray(node.attributes) && node.attributes.length > 0) {
      assert.fail(`Entity "${node.id}" lists inline attributes — Chen notation draws attributes as ellipse nodes (kind "attribute").`);
    }
  }
});

test('Chen identifying flag applies to relationships only; key/derived/multivalued to attributes only (rule 1)', () => {
  for (const node of chen.nodes) {
    if (node.identifying && node.kind !== 'relationship') {
      assert.fail(`"identifying" applies to relationship diamonds only ("${node.id}" is ${node.kind}).`);
    }
    if ((node.key || node.derived || node.multivalued) && node.kind !== 'attribute') {
      assert.fail(`key/derived/multivalued apply to attribute nodes only ("${node.id}" is ${node.kind}).`);
    }
  }
});

// ---------------------------------------------------------------------------
// Crow's-foot notation rules
// ---------------------------------------------------------------------------

test('Crow\'s-foot example renders without errors', () => {
  const input = path.join(skillRoot, 'examples/order-crowsfoot.erd.json');
  const out = render(input, 'tmp-erd-crowsfoot-test.html');
  const html = fs.readFileSync(out, 'utf8');
  assert.match(html, /<svg /);
  assert.match(html, /data-erd-notation="crowsfoot"/);
  fs.unlinkSync(out);
});

test('crow\'s-foot nodes are entities or weak entities only (rule 2)', () => {
  for (const node of crowsfoot.nodes) {
    const kind = node.kind || 'entity';
    assert.ok(kind === 'entity' || kind === 'weak-entity',
      `Node "${node.id}" is ${kind} — crow's-foot notation draws entities only; relationships are lines, attributes are rows.`);
  }
});

test('every crow\'s-foot entity lists at least one primary key (rule 2)', () => {
  for (const node of crowsfoot.nodes) {
    if (!Array.isArray(node.attributes) || node.attributes.length === 0) {
      assert.fail(`Entity "${node.id}" has no attributes — list at least its primary key.`);
    }
    assert.ok(node.attributes.some((attribute) => attribute.pk),
      `Entity "${node.id}" has no primary key (pk: true) — every crow's-foot entity names its key.`);
  }
});

test('every crow\'s-foot relation declares both cardinalities from the bounded set (rule 2)', () => {
  for (const relation of crowsfoot.relations) {
    for (const field of ['fromCardinality', 'toCardinality']) {
      const value = relation[field];
      if (!value) {
        assert.fail(`Relation "${relation.id ?? `${relation.from}-${relation.to}`}" needs ${field} (one, zero-one, one-many, zero-many, many).`);
      }
      assert.ok(CROWSFOOT_CARDINALITIES.has(value),
        `Relation "${relation.id ?? `${relation.from}-${relation.to}`}": ${field} "${value}" is not a crow's-foot cardinality (one, zero-one, one-many, zero-many, many).`);
    }
  }
});

// ---------------------------------------------------------------------------
// Box height arithmetic and grid placement
// ---------------------------------------------------------------------------

test('Chen attribute ellipses hang on row 0 or row 2 of their owner column (rule 3)', () => {
  const attributes = chen.nodes.filter((node) => node.kind === 'attribute');
  for (const attribute of attributes) {
    assert.ok(attribute.row === 0 || attribute.row === 2,
      `Chen attribute "${attribute.id}" sits on row ${attribute.row} — place it on row 0 (above the entity) or row 2 (below) so the link line is vertical.`);
    const owner = chen.nodes.find((node) => {
      if (!node || node.id === attribute.id) return false;
      return chen.relations.some((relation) => (
        (relation.from === attribute.id && relation.to === node.id)
        || (relation.to === attribute.id && relation.from === node.id)
      ));
    });
    if (owner) {
      assert.equal(attribute.col, owner.col,
        `Chen attribute "${attribute.id}" lives in column ${attribute.col} but its owner "${owner.id}" lives in column ${owner.col} — keep them in the same column so the link is vertical.`);
    }
  }
});

test('crow\'s-foot box height = HEADER_HEIGHT + (rows × ATTRIBUTE_LINE_HEIGHT) + padding', () => {
  const HEADER_HEIGHT = 26;
  const ATTRIBUTE_LINE_HEIGHT = 12;
  const COMPARTMENT_PADDING = 10; // 5 top + 5 bottom
  for (const node of crowsfoot.nodes) {
    const expected = HEADER_HEIGHT + (node.attributes.length * ATTRIBUTE_LINE_HEIGHT) + (node.attributes.length ? COMPARTMENT_PADDING : 0);
    const renderedHeight = node.height ?? expected;
    assert.equal(renderedHeight, expected,
      `Entity "${node.id}" expected height ${expected} (= 26 + ${node.attributes.length}×12 + ${node.attributes.length ? 10 : 0}), got ${renderedHeight}`);
  }
});

test('Chen attribute ellipses use dx = ±58 to keep two ellipses 16 px apart on the same row (rule 3)', () => {
  // For each entity column, attribute ellipses on the same row should pair
  // at dx = ±58 so two 100 px wide ellipses leave a 16 px gap.
  const byColumn = new Map();
  for (const node of chen.nodes) {
    if (node.kind !== 'attribute') continue;
    const key = `${node.col}:${node.row}`;
    if (!byColumn.has(key)) byColumn.set(key, []);
    byColumn.get(key).push(node);
  }
  for (const [key, attributes] of byColumn) {
    if (attributes.length < 2) continue;
    const sorted = [...attributes].sort((a, b) => (a.dx || 0) - (b.dx || 0));
    const gap = (sorted[1].dx || 0) - (sorted[0].dx || 0);
    assert.equal(gap, 116,
      `Chen attributes ${sorted.map((a) => `"${a.id}"`).join(', ')} on ${key} use dx ${JSON.stringify(sorted.map((a) => a.dx))} — two side-by-side ellipses need dx = ±58 (gap = 116) so they leave 16 px between them.`);
  }
});

test('viewBox[0] stays ≤ 1380 so the 1440 px desktop projection keeps 9 px text ≥ 6 px', () => {
  assert.ok(chen.meta.viewBox[0] <= 1380,
    `Chen viewBox[0] = ${chen.meta.viewBox[0]} — must stay ≤ 1380 so the 1440 px desktop projection keeps the 9 px member text ≥ 6 px.`);
  assert.ok(crowsfoot.meta.viewBox[0] <= 1380,
    `Crow's-foot viewBox[0] = ${crowsfoot.meta.viewBox[0]} — must stay ≤ 1380 so the 1440 px desktop projection keeps the 9 px member text ≥ 6 px.`);
});

// ---------------------------------------------------------------------------
// Rendered SVG facts (glyphs, dashed lines, underlined keys, vertical exits)
// ---------------------------------------------------------------------------

function extractGroup(html, dataNodeId) {
  const re = new RegExp(`<g[^>]*data-node-id="${dataNodeId}"[\\s\\S]*?</g>`);
  return html.match(re)?.[0] ?? '';
}

test('Chen attribute links enter and leave vertically (rule 4)', () => {
  const attributes = chen.nodes.filter((node) => node.kind === 'attribute');
  assert.ok(attributes.length > 0, 'Chen example must include at least one attribute');
  for (const attribute of attributes) {
    const re = new RegExp(
      `<path[^>]*data-edge-from="${attribute.id}"[^>]*data-edge-to="([^"]+)"[^>]*data-composition-points="([^"]+)"`,
    );
    const match = chenHtml.match(re);
    assert.ok(match, `Chen attribute link path not found for ${attribute.id}`);
    const points = match[2].trim().split(/\s*;\s*/).map((pair) => pair.split(',').map(Number));
    assert.ok(points.length >= 2, `Chen attribute link from "${attribute.id}" should have at least two points`);
    // The first segment must be vertical (leaves the attribute bottom
    // vertically) and the last segment must be vertical (enters the
    // entity top vertically).
    const firstVertical = points[0][0] === points[1][0];
    const lastVertical = points[points.length - 1][0] === points[points.length - 2][0]
      || points[points.length - 1][0] === points[points.length - 2][0];
    assert.ok(firstVertical,
      `Chen attribute link from "${attribute.id}" must leave vertically — first segment ${points[0].join(',')} → ${points[1].join(',')}`);
    assert.ok(lastVertical,
      `Chen attribute link from "${attribute.id}" must enter vertically — last segment ${points[points.length - 2].join(',')} → ${points[points.length - 1].join(',')}`);
  }
});

test('Chen key attributes render their label with text-decoration="underline"', () => {
  const keys = chen.nodes.filter((node) => node.kind === 'attribute' && node.key);
  assert.ok(keys.length > 0, 'Chen example must include at least one key attribute');
  for (const attribute of keys) {
    const group = extractGroup(chenHtml, attribute.id);
    assert.match(group, /text-decoration="underline"/,
      `Chen key attribute "${attribute.id}" is missing the underline decoration`);
  }
});

test('Chen derived attributes render their ellipse with stroke-dasharray and multivalued with a double ellipse', () => {
  const derived = chen.nodes.find((node) => node.kind === 'attribute' && node.derived);
  assert.ok(derived, 'Chen example must include at least one derived attribute');
  const derivedGroup = extractGroup(chenHtml, derived.id);
  assert.match(derivedGroup, /stroke-dasharray="4 3"/,
    `Chen derived attribute "${derived.id}" is missing the dashed ellipse stroke`);
  const multivalued = chen.nodes.find((node) => node.kind === 'attribute' && node.multivalued);
  assert.ok(multivalued, 'Chen example must include at least one multivalued attribute');
  const multivaluedGroup = extractGroup(chenHtml, multivalued.id);
  const ellipseCount = (multivaluedGroup.match(/<ellipse /g) || []).length;
  assert.ok(ellipseCount >= 2,
    `Chen multivalued attribute "${multivalued.id}" should render a double ellipse; got ${ellipseCount}`);
});

test('Chen identifying relationships render a double diamond (rule 4)', () => {
  const identifying = chen.nodes.find((node) => node.kind === 'relationship' && node.identifying);
  assert.ok(identifying, 'Chen example must include at least one identifying relationship');
  const group = extractGroup(chenHtml, identifying.id);
  const polygonCount = (group.match(/<polygon /g) || []).length;
  assert.ok(polygonCount >= 2,
    `Chen identifying relationship "${identifying.id}" should render a double diamond; got ${polygonCount} polygons`);
});

test('crow\'s-foot non-identifying relation lines render with stroke-dasharray', () => {
  const nonIdentifying = crowsfoot.relations.find((relation) => relation.identifying === false);
  assert.ok(nonIdentifying, 'Crow\'s-foot example must include at least one non-identifying relation');
  const re = new RegExp(
    `<path[^>]*data-edge-from="${nonIdentifying.from}"[^>]*data-edge-to="${nonIdentifying.to}"[^>]*>`,
  );
  const linkPath = crowsfootHtml.match(re)?.[0] ?? '';
  assert.match(linkPath, /stroke-dasharray="6 4"/,
    `Crow's-foot non-identifying relation "${nonIdentifying.id ?? `${nonIdentifying.from}-${nonIdentifying.to}`}" should render its line dashed`);
});

test('crow\'s-foot primary keys render with PK / PK,FK badges and an underlined name', () => {
  const composite = crowsfoot.nodes
    .flatMap((node) => node.attributes.filter((attribute) => attribute.pk).map((attribute) => ({ node, attribute })));
  assert.ok(composite.length > 0, 'Crow\'s-foot example must include at least one PK attribute');
  for (const { node, attribute } of composite) {
    const entityGroup = extractGroup(crowsfootHtml, node.id);
    assert.match(entityGroup, new RegExp(`>${attribute.pk && attribute.fk ? 'PK,FK' : 'PK'}<`),
      `Crow's-foot PK attribute "${attribute.name}" on "${node.id}" is missing its PK badge`);
    assert.match(entityGroup, /text-decoration="underline"/,
      `Crow's-foot PK attribute "${attribute.name}" on "${node.id}" is missing the underline decoration`);
  }
});

test('crow\'s-foot cardinality glyphs select bars / circle / foot per cardinality (rule 5)', () => {
  // Walk the rendered SVG once per cardinality kind present in the
  // example and assert the expected primitive appears in the
  // line-end <g> group for at least one end of a relation carrying
  // that cardinality. The renderer draws bars (line), circle
  // (circle r=4) and foot (two angled lines) from the entity border
  // outward.
  const cardinalitiesInExample = new Set();
  for (const relation of crowsfoot.relations) {
    cardinalitiesInExample.add(relation.fromCardinality);
    cardinalitiesInExample.add(relation.toCardinality);
  }
  const cases = [
    { cardinality: 'one', primitive: '<line ', minCount: 2 },
    { cardinality: 'zero-one', primitive: 'r="4"', minCount: 1 },
    { cardinality: 'one-many', primitive: '<line ', minCount: 3 },
    { cardinality: 'zero-many', primitive: 'r="4"', minCount: 1 },
    { cardinality: 'many', primitive: '<line ', minCount: 1 },
  ];
  for (const { cardinality, primitive, minCount } of cases) {
    if (!cardinalitiesInExample.has(cardinality)) continue;
    const matches = crowsfoot.relations.filter((relation) => relation.fromCardinality === cardinality || relation.toCardinality === cardinality);
    const counts = matches.map((relation) => {
      const re = new RegExp(
        `<g[^>]*data-edge-from="${relation.from}"[^>]*data-edge-to="${relation.to}"[^>]*>([\\s\\S]*?)</g>`,
      );
      const group = crowsfootHtml.match(re)?.[1] ?? '';
      return (group.match(new RegExp(primitive.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
    });
    assert.ok(counts.some((count) => count >= minCount),
      `crow's-foot cardinality "${cardinality}" should render at least ${minCount} "${primitive}" glyph(s) across its examples; got [${counts.join(', ')}]`);
  }
  // Sanity: at least one cardinality must have been exercised.
  assert.ok(cases.some((entry) => cardinalitiesInExample.has(entry.cardinality)),
    'crow\'s-foot example should exercise at least one cardinality kind from the renderer contract');
});

test('crow\'s-foot one-many cardinality draws both a bar and a foot', () => {
  const matches = crowsfoot.relations.filter((relation) => relation.fromCardinality === 'one-many' || relation.toCardinality === 'one-many');
  assert.ok(matches.length > 0, 'expected at least one crow\'s-foot relation with cardinality "one-many"');
  const counts = matches.map((relation) => {
    const re = new RegExp(
      `<g[^>]*data-edge-from="${relation.from}"[^>]*data-edge-to="${relation.to}"[^>]*>([\\s\\S]*?)</g>`,
    );
    const group = crowsfootHtml.match(re)?.[1] ?? '';
    const lines = (group.match(/<line /g) || []).length;
    return lines;
  });
  assert.ok(counts.some((count) => count >= 3),
    `crow's-foot one-many should draw a foot (two lines) plus a bar (one line) per end — at least 3 lines per example; got [${counts.join(', ')}]`);
});