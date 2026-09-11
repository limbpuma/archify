// Tests for the usecase renderer's structural rules, automatic «include»
// and «extend» stereotypes, marker/dashing per relation kind, the dashed
// secondary-actor figure, and the system boundary frame bounds. The
// renderer is exercised transitively by the golden byte-compare, but the
// structural rules below are mode-specific and easy to regress without
// noticing. Runs as part of `npm test`.
//
//   node --test test/usecase.test.mjs   (or: npm test)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const renderer = path.join(skillRoot, 'renderers/usecase/render-usecase.mjs');

function render(inputPath) {
  const out = path.join(skillRoot, 'tmp-usecase-test.html');
  execFileSync(process.execPath, [renderer, inputPath, out]);
  return out;
}

const example = JSON.parse(fs.readFileSync(
  path.join(skillRoot, 'examples/phone-ordering.usecase.json'),
  'utf8',
));

test('usecase example renders without errors', () => {
  const input = path.join(skillRoot, 'examples/phone-ordering.usecase.json');
  const out = render(input);
  const html = fs.readFileSync(out, 'utf8');
  assert.match(html, /<svg /);
  assert.match(html, /data-diagram-type="usecase"|data-quality-profile="showcase"|diagram-guide/);
  fs.unlinkSync(out);
});

test('node ids are unique and every relation references existing nodes (rule 1)', () => {
  const ids = example.nodes.map((n) => n.id);
  assert.equal(new Set(ids).size, ids.length, 'node ids must be unique');
  const validIds = new Set(ids);
  for (const relation of example.relations) {
    assert.ok(validIds.has(relation.from),
      `relation "${relation.id || `${relation.from}->${relation.to}`}" references unknown source "${relation.from}"`);
    assert.ok(validIds.has(relation.to),
      `relation "${relation.id || `${relation.from}->${relation.to}`}" references unknown target "${relation.to}"`);
    assert.notEqual(relation.from, relation.to,
      `relation "${relation.id || `${relation.from}->${relation.to}`}" is a self-relation`);
  }
});

test('association joins an actor and a use case (rule 2)', () => {
  const kindById = new Map(example.nodes.map((n) => [n.id, n.kind]));
  for (const relation of example.relations) {
    if (relation.kind !== 'association') continue;
    const fromKind = kindById.get(relation.from);
    const toKind = kindById.get(relation.to);
    assert.ok(fromKind && toKind,
      `association "${relation.from}" -> "${relation.to}" references an unknown node`);
    assert.notEqual(fromKind, toKind,
      `association "${relation.from}" -> "${relation.to}" links two ${fromKind}s; an association joins an actor and a use case`);
    assert.ok(new Set(['actor', 'usecase']).has(fromKind) && new Set(['actor', 'usecase']).has(toKind),
      `association endpoints must be actors or use cases (got ${fromKind} and ${toKind})`);
  }
});

test('include and extend join two use cases (rule 2)', () => {
  const kindById = new Map(example.nodes.map((n) => [n.id, n.kind]));
  for (const relation of example.relations) {
    if (relation.kind !== 'include' && relation.kind !== 'extend') continue;
    assert.equal(kindById.get(relation.from), 'usecase',
      `«${relation.kind}» "${relation.from}" -> "${relation.to}" must start at a use case`);
    assert.equal(kindById.get(relation.to), 'usecase',
      `«${relation.kind}» "${relation.from}" -> "${relation.to}" must end at a use case`);
  }
});

test('generalization joins two nodes of the same kind (rule 2)', () => {
  const kindById = new Map(example.nodes.map((n) => [n.id, n.kind]));
  for (const relation of example.relations) {
    if (relation.kind !== 'generalization') continue;
    assert.equal(kindById.get(relation.from), kindById.get(relation.to),
      `generalization "${relation.from}" -> "${relation.to}" must link two nodes of the same kind`);
  }
});

test('every node is connected and every actor participates in at least one association (rule 3)', () => {
  const linked = new Set();
  const actors = new Set();
  const actorAssociations = new Set();
  for (const relation of example.relations) {
    linked.add(relation.from);
    linked.add(relation.to);
    if (relation.kind === 'association') {
      actorAssociations.add(relation.from);
      actorAssociations.add(relation.to);
    }
  }
  for (const node of example.nodes) {
    assert.ok(linked.has(node.id),
      `${node.kind === 'actor' ? 'Actor' : 'Use case'} "${node.id}" is isolated — connect it`);
    if (node.kind === 'actor') {
      actors.add(node.id);
      assert.ok(actorAssociations.has(node.id),
        `actor "${node.id}" has no association — an actor must take part in at least one use case`);
    }
  }
  for (const actor of actors) {
    assert.ok(actorAssociations.has(actor),
      `actor "${actor}" must participate in at least one association`);
  }
});

test('actors stay outside every system boundary and every use case sits inside exactly one (rule 4)', () => {
  const boundaryOf = new Map();
  for (const group of example.groups) {
    for (const id of group.nodes) {
      assert.ok(!boundaryOf.has(id),
        `node "${id}" is inside two system boundaries ("${boundaryOf.get(id)}" and "${group.id}")`);
      boundaryOf.set(id, group.id);
    }
  }
  for (const node of example.nodes) {
    if (node.kind === 'actor') {
      assert.ok(!boundaryOf.has(node.id),
        `actor "${node.id}" is inside system boundary "${boundaryOf.get(node.id)}" — actors stand outside the system`);
    } else {
      assert.ok(boundaryOf.has(node.id),
        `use case "${node.id}" is outside every system boundary — add it to a group`);
    }
  }
});

test('use case label fits its symbol (rule 5)', () => {
  const NAME_UNIT_WIDTH = 6.2;
  const SUBLABEL_UNIT_WIDTH = 5.2;
  const TEXT_INSET = 8;
  const USECASE_INNER_FACTOR = 0.8;
  for (const node of example.nodes.filter((n) => n.kind === 'usecase')) {
    const labelWidth = node.label.length * NAME_UNIT_WIDTH;
    const width = node.width || 150;
    const available = (width - TEXT_INSET * 2) * USECASE_INNER_FACTOR;
    assert.ok(labelWidth <= available + 1,
      `use case "${node.id}" label "${node.label}" (~${Math.round(labelWidth)}px) is wider than the ${Math.round(available)}px text area — shorten it or increase width`);
    if (node.sublabel) {
      const sublabelWidth = node.sublabel.length * SUBLABEL_UNIT_WIDTH;
      assert.ok(sublabelWidth <= available,
        `use case "${node.id}" sublabel "${node.sublabel}" does not fit (${Math.round(sublabelWidth)}px > ${Math.round(available)}px)`);
    }
  }
});

test('include and extend relations carry the automatic «include» / «extend» stereotype', () => {
  const html = fs.readFileSync(path.join(skillRoot, 'examples/usecase-phone-ordering.html'), 'utf8');
  let includeCount = 0;
  let extendCount = 0;
  for (const relation of example.relations) {
    if (relation.kind !== 'include' && relation.kind !== 'extend') continue;
    const expected = relation.kind === 'include' ? '«include»' : '«extend»';
    if (relation.kind === 'include') includeCount += 1;
    else extendCount += 1;
    if (relation.label) {
      assert.equal(relation.label, expected,
        `authored label on "${relation.id || `${relation.from}->${relation.to}`}" must match the stereotype "${expected}"`);
    }
    const expectedEscaped = expected;
    const edgeBlock = html.match(new RegExp(`<g[^>]*data-edge-from="${relation.from}"[^>]*data-edge-to="${relation.to}"[\\s\\S]*?<\\/g>`));
    assert.ok(edgeBlock, `relation "${relation.from}" -> "${relation.to}" missing from the rendered SVG`);
    assert.ok(edgeBlock[0].includes(expectedEscaped),
      `relation "${relation.from}" -> "${relation.to}" must carry the automatic stereotype "${expectedEscaped}" in the rendered SVG`);
  }
  assert.ok(includeCount >= 1, 'example must include at least one «include» relation');
  assert.ok(extendCount >= 1, 'example must include at least one «extend» relation');
  // Spot-check that the labels reach the rendered SVG.
  assert.match(html, /«include»/);
  assert.match(html, /«extend»/);
});

test('marker and dashing match the relation kind', () => {
  const html = fs.readFileSync(path.join(skillRoot, 'examples/usecase-phone-ordering.html'), 'utf8');
  const pathRe = /<path[^>]*data-edge-from="([^"]+)"[^>]*data-edge-to="([^"]+)"[^>]*\/?>/g;
  const renderedEdges = [];
  let match;
  while ((match = pathRe.exec(html)) !== null) {
    renderedEdges.push({
      from: match[1],
      to: match[2],
      block: match[0],
    });
  }
  assert.ok(renderedEdges.length === example.relations.length,
    `expected ${example.relations.length} rendered edges, found ${renderedEdges.length}`);

  for (const relation of example.relations) {
    const edge = renderedEdges.find((entry) => entry.from === relation.from && entry.to === relation.to);
    assert.ok(edge, `relation "${relation.from}" -> "${relation.to}" missing from the rendered SVG`);
    if (relation.kind === 'association') {
      assert.doesNotMatch(edge.block, /marker-end="url\(#uml-/);
      assert.doesNotMatch(edge.block, /stroke-dasharray="6 4"/);
    } else if (relation.kind === 'generalization') {
      assert.match(edge.block, /marker-end="url\(#uml-triangle\)"/);
      assert.doesNotMatch(edge.block, /stroke-dasharray="6 4"/);
    } else if (relation.kind === 'include' || relation.kind === 'extend') {
      assert.match(edge.block, /marker-end="url\(#uml-open-arrow\)"/);
      assert.match(edge.block, /stroke-dasharray="6 4"/);
    }
  }
});

test('secondary actors render with a dashed figure and a renderer-owned sublabel', () => {
  const html = fs.readFileSync(path.join(skillRoot, 'examples/usecase-phone-ordering.html'), 'utf8');
  for (const node of example.nodes.filter((n) => n.kind === 'actor' && n.secondary)) {
    const groupMatch = html.match(new RegExp(`<g id="node-${node.id}"[\\s\\S]*?<\\/g>`));
    assert.ok(groupMatch, `actor "${node.id}" is missing from the rendered SVG`);
    assert.match(groupMatch[0], /stroke-dasharray="3 2"/,
      `secondary actor "${node.id}" must render its figure with stroke-dasharray="3 2"`);
    assert.match(groupMatch[0], /data-node-sublabel="secondary actor"/,
      `secondary actor "${node.id}" must carry the renderer-owned "secondary actor" sublabel`);
  }
  for (const node of example.nodes.filter((n) => n.kind === 'actor' && !n.secondary)) {
    const groupMatch = html.match(new RegExp(`<g id="node-${node.id}"[\\s\\S]*?<\\/g>`));
    assert.ok(groupMatch, `primary actor "${node.id}" is missing from the rendered SVG`);
    assert.doesNotMatch(groupMatch[0], /stroke-dasharray="3 2"/,
      `primary actor "${node.id}" must NOT carry the secondary-actor dasharray`);
  }
});

test('system boundary frame bounds enclose every member use case', () => {
  const html = fs.readFileSync(path.join(skillRoot, 'examples/usecase-phone-ordering.html'), 'utf8');
  const frameMatch = html.match(/<rect[^>]*class="c-region"[^>]*style="stroke-dasharray:none"[^>]*\/>/);
  assert.ok(frameMatch, 'expected exactly one solid boundary rectangle');
  const frame = frameMatch[0];
  const x = Number(frame.match(/x="([^"]+)"/)[1]);
  const y = Number(frame.match(/y="([^"]+)"/)[1]);
  const width = Number(frame.match(/width="([^"]+)"/)[1]);
  const height = Number(frame.match(/height="([^"]+)"/)[1]);
  assert.ok(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(width) && Number.isFinite(height),
    'boundary frame must declare numeric x, y, width, and height');
  for (const group of example.groups) {
    for (const member of group.nodes) {
      const node = example.nodes.find((n) => n.id === member);
      assert.ok(node && node.kind === 'usecase',
        `boundary member "${member}" must be a use case`);
      const nodeMatch = html.match(new RegExp(`<g id="node-${node.id}"[\\s\\S]*?<ellipse cx="([^"]+)" cy="([^"]+)" rx="([^"]+)" ry="([^"]+)"[\\s\\S]*?<\\/g>`));
      assert.ok(nodeMatch, `use case "${node.id}" must render an ellipse`);
      const cx = Number(nodeMatch[1]);
      const cy = Number(nodeMatch[2]);
      const rx = Number(nodeMatch[3]);
      const ry = Number(nodeMatch[4]);
      assert.ok(cx - rx >= x - 0.5 && cx + rx <= x + width + 0.5,
        `use case "${node.id}" horizontal extent ${cx - rx}..${cx + rx} is not inside boundary ${x}..${x + width}`);
      assert.ok(cy - ry >= y - 0.5 && cy + ry <= y + height + 0.5,
        `use case "${node.id}" vertical extent ${cy - ry}..${cy + ry} is not inside boundary ${y}..${y + height}`);
    }
  }
  // Actors must sit outside the boundary. Find each actor and check its
  // circle centre against the frame.
  for (const node of example.nodes.filter((n) => n.kind === 'actor')) {
    const actorMatch = html.match(new RegExp(`<g id="node-${node.id}"[\\s\\S]*?<circle cx="([^"]+)" cy="([^"]+)" r="([^"]+)"[\\s\\S]*?<\\/g>`));
    assert.ok(actorMatch, `actor "${node.id}" must render a head circle`);
    const cx = Number(actorMatch[1]);
    const cy = Number(actorMatch[2]);
    const r = Number(actorMatch[3]);
    const insideX = cx + r > x && cx - r < x + width;
    const insideY = cy + r > y && cy - r < y + height;
    assert.ok(!(insideX && insideY),
      `actor "${node.id}" centre (${cx}, ${cy}) must sit outside the boundary frame`);
  }
});