// Tests for the UML 2.5 class-diagram renderer's structural rules, the
// header/attribute/operation compartment arithmetic, the marker per
// relation kind, the end-label placement beside each line end, and the
// shared geometry wiring. The renderer is exercised transitively by the
// golden byte-compare, but the UML-specific facts below are easy to
// regress without noticing. Runs as part of `npm test`.
//
//   node --test test/uml-class.test.mjs   (or: npm test)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const renderer = path.join(skillRoot, 'renderers/uml-class/render-uml-class.mjs');

function render(inputPath) {
  const out = path.join(skillRoot, 'tmp-uml-class-test.html');
  execFileSync(process.execPath, [renderer, inputPath, out]);
  return out;
}

const example = JSON.parse(fs.readFileSync(
  path.join(skillRoot, 'examples/order-domain.uml-class.json'),
  'utf8',
));

const HEADER_HEIGHT = 26;
const STEREOTYPE_HEIGHT = 11;
const MEMBER_LINE_HEIGHT = 12;
const COMPARTMENT_PADDING = 5;
const EMPTY_COMPARTMENT_HEIGHT = 12;
const NAME_UNIT_WIDTH = 6.2;
const MEMBER_UNIT_WIDTH = 5.2;
const TEXT_INSET = 8;
const DEFAULT_WIDTH = 180;

function compartmentHeight(members) {
  return members.length
    ? members.length * MEMBER_LINE_HEIGHT + COMPARTMENT_PADDING * 2
    : EMPTY_COMPARTMENT_HEIGHT;
}

function measureClass(node) {
  const attributes = Array.isArray(node.attributes) ? node.attributes : [];
  const methods = Array.isArray(node.methods) ? node.methods : [];
  const hasStereotype = Boolean(node.stereotype || (node.kind === 'interface' || node.kind === 'enum'));
  const headerHeight = HEADER_HEIGHT + (hasStereotype ? STEREOTYPE_HEIGHT : 0);
  const attributesHeight = compartmentHeight(attributes);
  const methodsHeight = node.kind === 'enum' && !methods.length ? 0 : compartmentHeight(methods);
  return {
    headerHeight,
    attributesHeight,
    methodsHeight,
    contentHeight: headerHeight + attributesHeight + methodsHeight,
    width: node.width || DEFAULT_WIDTH,
  };
}

test('uml-class example renders without errors', () => {
  const input = path.join(skillRoot, 'examples/order-domain.uml-class.json');
  const out = render(input);
  const html = fs.readFileSync(out, 'utf8');
  assert.match(html, /<svg /);
  assert.match(html, /data-diagram-type="uml-class"|data-quality-profile="showcase"|diagram-guide/);
  fs.unlinkSync(out);
});

test('class ids are unique and every relation references existing classes (rule 1)', () => {
  const ids = example.classes.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, 'class ids must be unique');
  const valid = new Set(ids);
  for (const relation of example.relations) {
    assert.ok(valid.has(relation.from), `relation references unknown source "${relation.from}"`);
    assert.ok(valid.has(relation.to), `relation references unknown target "${relation.to}"`);
    assert.notEqual(relation.from, relation.to, `relation "${relation.from}" -> "${relation.to}" is a self-relation`);
  }
});

test('realization points at an interface; inheritance never does (rule 2)', () => {
  const byId = new Map(example.classes.map((c) => [c.id, c]));
  for (const relation of example.relations) {
    const to = byId.get(relation.to);
    const from = byId.get(relation.from);
    if (relation.kind === 'realization') {
      assert.equal(to.kind, 'interface', `realization "${relation.from}->${relation.to}" must point at an interface`);
      assert.notEqual(from.kind, 'interface', `an interface cannot realize another interface (${relation.from}->${relation.to})`);
    }
    if (relation.kind === 'inheritance') {
      assert.notEqual(to.kind, 'interface', `inheritance "${relation.from}->${relation.to}" must not point at an interface; use realization`);
      assert.notEqual(from.kind, 'enum', `inheritance "${relation.from}->${relation.to}" cannot involve an enumeration`);
      assert.notEqual(to.kind, 'enum', `inheritance "${relation.from}->${relation.to}" cannot involve an enumeration`);
      if (from.kind === 'interface') {
        assert.equal(to.kind, 'interface', `interface "${relation.from}" can only extend another interface`);
      }
    }
  }
});

test('no generalization cycles through inheritance/realization (rule 3)', () => {
  const parents = new Map();
  for (const relation of example.relations) {
    if (relation.kind !== 'inheritance' && relation.kind !== 'realization') continue;
    const list = parents.get(relation.from) || [];
    list.push(relation.to);
    parents.set(relation.from, list);
  }
  const visiting = new Set();
  const done = new Set();
  function walk(id) {
    if (done.has(id)) return null;
    if (visiting.has(id)) return id;
    visiting.add(id);
    for (const parent of parents.get(id) || []) {
      const cycle = walk(parent);
      if (cycle) return cycle;
    }
    visiting.delete(id);
    done.add(id);
    return null;
  }
  for (const id of parents.keys()) {
    assert.equal(walk(id), null, `generalization cycle starting at "${id}"`);
  }
});

test('multiplicities, roles, and navigable are restricted to association/aggregation/composition (rule 4)', () => {
  for (const relation of example.relations) {
    const endFields = ['fromMultiplicity', 'toMultiplicity', 'fromRole', 'toRole']
      .filter((f) => relation[f]);
    if (endFields.length) {
      assert.ok(['association', 'aggregation', 'composition'].includes(relation.kind),
        `relation "${relation.from}->${relation.to}" carries ${endFields.join('/')} but its kind is ${relation.kind}; multiplicities and roles are only valid on association, aggregation and composition`);
    }
    if (relation.navigable !== undefined) {
      assert.equal(relation.kind, 'association',
        `relation "${relation.from}->${relation.to}" declares navigable but its kind is ${relation.kind}; only association supports navigable`);
    }
  }
});

test('every interface declares at least one member (rule 5)', () => {
  for (const node of example.classes) {
    if (node.kind !== 'interface') continue;
    const members = (node.attributes || []).length + (node.methods || []).length;
    assert.ok(members > 0, `interface "${node.id}" declares no operations or attributes`);
  }
});

test('names, stereotypes, and members fit their box; declared height >= content (rule 6)', () => {
  for (const node of example.classes) {
    const measured = measureClass(node);
    const width = measured.width;
    const available = width - TEXT_INSET * 2;
    const nameWidth = node.name.length * NAME_UNIT_WIDTH;
    assert.ok(nameWidth <= available,
      `class name "${node.name}" (~${Math.round(nameWidth)}px) is wider than the ${Math.round(available)}px text area of "${node.id}"`);
    const lines = [
      ...(node.stereotype ? [`«${node.stereotype}»`] : []),
      ...(node.attributes || []),
      ...(node.methods || []),
    ];
    for (const line of lines) {
      const lineWidth = line.length * MEMBER_UNIT_WIDTH;
      assert.ok(lineWidth <= available,
        `member "${line}" (~${Math.round(lineWidth)}px) is wider than the ${Math.round(available)}px text area of "${node.id}"`);
    }
    if (node.height !== undefined) {
      assert.ok(node.height >= measured.contentHeight,
        `class "${node.id}" declares height ${node.height} but content needs ${measured.contentHeight}px`);
    }
  }
});

test('box arithmetic: header + attribute compartment + operation compartment', () => {
  // Order: header(26) + attrs(3 lines: 5+36+5=46) + methods(3 lines: 5+36+5=46) = 118.
  // Membership: order.attributes.length=3, order.methods.length=3.
  const order = example.classes.find((c) => c.id === 'order');
  const measured = measureClass(order);
  const expectedAttributesHeight = 3 * MEMBER_LINE_HEIGHT + 2 * COMPARTMENT_PADDING;
  const expectedMethodsHeight = 3 * MEMBER_LINE_HEIGHT + 2 * COMPARTMENT_PADDING;
  assert.equal(measured.attributesHeight, expectedAttributesHeight,
    `Order attribute compartment should be ${expectedAttributesHeight}, got ${measured.attributesHeight}`);
  assert.equal(measured.methodsHeight, expectedMethodsHeight,
    `Order method compartment should be ${expectedMethodsHeight}, got ${measured.methodsHeight}`);
  assert.equal(measured.headerHeight, HEADER_HEIGHT,
    'Order header (no stereotype) should be 26');
  assert.equal(measured.contentHeight, HEADER_HEIGHT + expectedAttributesHeight + expectedMethodsHeight);
});

test('box arithmetic: enumerations list literals in the attribute compartment and drop the operation compartment', () => {
  // OrderStatus has 5 enum literals, no methods. Methods height = 0.
  const orderStatus = example.classes.find((c) => c.id === 'order_status');
  assert.equal(orderStatus.kind, 'enum');
  assert.deepEqual(orderStatus.methods, undefined, 'enum OrderStatus must not define methods');
  const measured = measureClass(orderStatus);
  assert.equal(measured.methodsHeight, 0, `enum OrderStatus methodsHeight should be 0, got ${measured.methodsHeight}`);
  const expectedAttributesHeight = 5 * MEMBER_LINE_HEIGHT + 2 * COMPARTMENT_PADDING;
  assert.equal(measured.attributesHeight, expectedAttributesHeight,
    `enum OrderStatus attributes compartment should hold 5 literals (${expectedAttributesHeight}px), got ${measured.attributesHeight}`);
  // Header carries the stereotype «enumeration» (+11 px).
  assert.equal(measured.headerHeight, HEADER_HEIGHT + STEREOTYPE_HEIGHT,
    'enum header should be 26+11 = 37 with the «enumeration» stereotype');
});

test('box arithmetic: interfaces carry the «interface» stereotype line (+11 px)', () => {
  const payable = example.classes.find((c) => c.id === 'payable');
  assert.equal(payable.kind, 'interface');
  const measured = measureClass(payable);
  assert.equal(measured.headerHeight, HEADER_HEIGHT + STEREOTYPE_HEIGHT,
    'interface header should be 26+11 = 37 with the «interface» stereotype');
});

test('box arithmetic: abstract classes keep the 26 px header (no stereotype line)', () => {
  const fulfillment = example.classes.find((c) => c.id === 'fulfillment');
  assert.equal(fulfillment.kind, 'abstract');
  const measured = measureClass(fulfillment);
  assert.equal(measured.headerHeight, HEADER_HEIGHT,
    'abstract class header should be 26 with no stereotype');
});

test('marker per relation kind: solid/dashed + hollow/filled triangle/diamond/open arrow at `to`', () => {
  const out = render(path.join(skillRoot, 'examples/order-domain.uml-class.json'));
  const html2 = fs.readFileSync(out, 'utf8');
  // Marker definitions: the four ids the renderer registers
  assert.match(html2, /<marker id="uml-triangle"/);
  assert.match(html2, /<marker id="uml-diamond-hollow"/);
  assert.match(html2, /<marker id="uml-diamond-filled"/);
  assert.match(html2, /<marker id="uml-open-arrow"/);
  // Markers and dash patterns per relation kind:
  // - composition: filled diamond, no dash
  // - aggregation: hollow diamond, no dash
  // - inheritance: hollow triangle, no dash
  // - realization: hollow triangle, dashed (stroke-dasharray="6 4")
  // - dependency: open arrow, dashed (stroke-dasharray="6 4")
  // - association navigable: open arrow, no dash
  // - association plain: no marker, no dash
  const cases = [
    { id: 'order_lines', kind: 'composition', marker: 'url(#uml-diamond-filled)', dashed: false },
    { id: 'fulfilled_by', kind: 'composition', marker: 'url(#uml-diamond-filled)', dashed: false },
    { id: 'paid_by', kind: 'composition', marker: 'url(#uml-diamond-filled)', dashed: false },
    { id: 'offers', kind: 'aggregation', marker: 'url(#uml-diamond-hollow)', dashed: false },
    { id: 'delivery_is_a', kind: 'inheritance', marker: 'url(#uml-triangle)', dashed: false },
    { id: 'pickup_is_a', kind: 'inheritance', marker: 'url(#uml-triangle)', dashed: false },
    { id: 'payable_impl', kind: 'realization', marker: 'url(#uml-triangle)', dashed: true },
    { id: 'uses_status', kind: 'dependency', marker: 'url(#uml-open-arrow)', dashed: true },
    { id: 'places', kind: 'association', marker: 'url(#uml-open-arrow)', dashed: false },
    { id: 'refers_to', kind: 'association', marker: 'url(#uml-open-arrow)', dashed: false },
  ];
  for (const expected of cases) {
    const re = new RegExp(`<path[^>]*data-edge-id="${expected.id}"[^>]*`);
    const match = html2.match(re);
    assert.ok(match, `expected an edge path for "${expected.id}"`);
    const attrs = match[0];
    if (expected.marker) {
      assert.ok(attrs.includes(`marker-end="${expected.marker}"`),
        `relation "${expected.id}" (${expected.kind}) should carry marker-end="${expected.marker}"`);
    } else {
      assert.ok(!attrs.includes('marker-end="url(#'),
        `relation "${expected.id}" (${expected.kind}) should not carry a marker`);
    }
    if (expected.dashed) {
      assert.ok(attrs.includes('stroke-dasharray="6 4"'),
        `relation "${expected.id}" (${expected.kind}) should be dashed (stroke-dasharray="6 4")`);
    } else {
      assert.ok(!attrs.includes('stroke-dasharray="6 4"'),
        `relation "${expected.id}" (${expected.kind}) must not be dashed`);
    }
  }
  // Plain (non-navigable) association carries no marker
  const livesAt = html2.match(/<path[^>]*data-edge-id="lives_at"[^>]*/)[0];
  assert.ok(!livesAt.includes('marker-end="url(#'), 'plain association "lives_at" should carry no marker');
  assert.ok(!livesAt.includes('stroke-dasharray="6 4"'), 'plain association "lives_at" must not be dashed');
  // The plain in_category association should also carry no marker
  const inCategory = html2.match(/<path[^>]*data-edge-id="in_category"[^>]*/)[0];
  assert.ok(!inCategory.includes('marker-end="url(#'), 'plain association "in_category" should carry no marker');
  fs.unlinkSync(out);
});

test('end-label placement: multiplicity and role sit beside the line near each end', () => {
  const out = render(path.join(skillRoot, 'examples/order-domain.uml-class.json'));
  const html = fs.readFileSync(out, 'utf8');
  function endLabelGroup(id) {
    const matches = [...html.matchAll(new RegExp(`<g data-detail="context"[^>]*data-edge-id="${id}"[^>]*>[\\s\\S]*?</g>`, 'g'))];
    return matches.length > 1 ? matches[matches.length - 1][0] : matches[0]?.[0] || '';
  }
  // places: customer(206,100) -> order(482,100) horizontal, navigable; fromMultiplicity="1", toMultiplicity="0..*"
  // First multiplicity sits past the marker (24 px), second past the end (12 px).
  const placesGroup = endLabelGroup('places');
  assert.match(placesGroup, /x="218"[^>]*y="95"[^>]*>1</);
  assert.match(placesGroup, /x="458"[^>]*y="95"[^>]*>0\.\.\*</);
  // refers_to: order_line(662,260) -> product(938,260) horizontal, navigable; "*" -> "1"
  const refersGroup = endLabelGroup('refers_to');
  assert.match(refersGroup, /x="674"[^>]*y="255"[^>]*>\*</);
  assert.match(refersGroup, /x="914"[^>]*y="255"[^>]*>1</);
  // offers: product(1028,307) -> restaurant(1028,379) vertical, aggregation; "1..*" at top, "1" at bottom
  const offersGroup = endLabelGroup('offers');
  assert.match(offersGroup, /x="1033"[^>]*y="322"[^>]*>1\.\.\*</);
  assert.match(offersGroup, /x="1033"[^>]*y="358"[^>]*>1</);
  fs.unlinkSync(out);
});

test('shared geometry wiring: every viewBox size respects 1380 px width and 24/40/96 boundaries', () => {
  const viewBox = example.meta.viewBox;
  assert.ok(viewBox[0] <= 1380, `viewBox[0] = ${viewBox[0]} exceeds the 1380 px standalone cap`);
  assert.ok(viewBox[0] >= 800, `viewBox[0] = ${viewBox[0]} is too narrow for the grid`);
  assert.ok(viewBox[1] >= 400, `viewBox[1] = ${viewBox[1]} is too short`);
  assert.ok(viewBox[1] <= 1240, `viewBox[1] = ${viewBox[1]} exceeds the 1240 px shared ceiling for the 1440 px desktop projection`);
  const [vbW, vbH] = viewBox;
  for (const node of example.classes) {
    const cx = example.meta.grid.originX + node.col * example.meta.grid.colWidth + (node.dx || 0);
    const cy = example.meta.grid.originY + node.row * example.meta.grid.rowHeight + (node.dy || 0);
    const measured = measureClass(node);
    const halfW = measured.width / 2;
    const halfH = measured.contentHeight / 2;
    assert.ok(cx - halfW >= 24, `class "${node.id}" left edge ${cx - halfW} < 24`);
    assert.ok(cx + halfW <= vbW - 24, `class "${node.id}" right edge ${cx + halfW} > ${vbW - 24}`);
    assert.ok(cy - halfH >= 40, `class "${node.id}" top edge ${cy - halfH} < 40`);
    assert.ok(cy + halfH <= vbH - 96, `class "${node.id}" bottom edge ${cy + halfH} > ${vbH - 96} (legend reserve)`);
  }
});