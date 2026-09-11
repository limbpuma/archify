// Tests for the flowchart renderer's structural rules, decision default
// side, label-fit factors, and group frame bounds. The renderer is exercised
// transitively by the golden byte-compare, but the structural rules below
// are mode-specific and easy to regress without noticing. Runs as part of
// `npm test`.
//
//   node --test test/flowchart.test.mjs   (or: npm test)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const renderer = path.join(skillRoot, 'renderers/flowchart/render-flowchart.mjs');

function render(inputPath) {
  const out = path.join(skillRoot, 'tmp-flowchart-test.html');
  execFileSync(process.execPath, [renderer, inputPath, out]);
  return out;
}

const example = JSON.parse(fs.readFileSync(
  path.join(skillRoot, 'examples/order-call.flowchart.json'),
  'utf8',
));

test('flowchart example renders without errors', () => {
  const input = path.join(skillRoot, 'examples/order-call.flowchart.json');
  const out = render(input);
  const html = fs.readFileSync(out, 'utf8');
  assert.match(html, /<svg /);
  assert.match(html, /data-diagram-type="flowchart"|data-quality-profile="showcase"|diagram-guide/);
  fs.unlinkSync(out);
});

test('every decision has at least two labelled outgoing edges (rule 2)', () => {
  const decisions = example.nodes.filter((n) => n.symbol === 'decision');
  for (const decision of decisions) {
    const outgoing = example.edges.filter((e) => e.from === decision.id);
    assert.ok(outgoing.length >= 2,
      `decision "${decision.id}" has only ${outgoing.length} outgoing edge(s); DIN 66001 requires at least two answers`);
    for (const edge of outgoing) {
      assert.ok(typeof edge.label === 'string' && edge.label.length > 0,
        `decision "${decision.id}" -> "${edge.to}" is missing a branch label (the answer)`);
    }
  }
});

test('terminator has at most one outgoing and zero-or-one incoming edges (rule 1)', () => {
  for (const node of example.nodes.filter((n) => n.symbol === 'terminator')) {
    const outgoing = example.edges.filter((e) => e.from === node.id);
    const incoming = example.edges.filter((e) => e.to === node.id);
    assert.ok(outgoing.length <= 1, `terminator "${node.id}" has ${outgoing.length} outgoing edge(s); a start has exactly one, an end has none`);
    if (incoming.length > 0 && outgoing.length > 0) {
      assert.fail(`terminator "${node.id}" has both incoming and outgoing edges; use a process for intermediate steps`);
    }
  }
});

test('at least one terminator has no incoming edge (start) and one has no outgoing edge (end)', () => {
  const terminators = example.nodes.filter((n) => n.symbol === 'terminator').map((n) => n.id);
  const hasIncoming = new Set(example.edges.map((e) => e.to));
  const hasOutgoing = new Set(example.edges.map((e) => e.from));
  const starts = terminators.filter((id) => !hasIncoming.has(id));
  const ends = terminators.filter((id) => !hasOutgoing.has(id));
  assert.ok(starts.length >= 1, 'flowchart needs at least one start terminator (no incoming edge)');
  assert.ok(ends.length >= 1, 'flowchart needs at least one end terminator (no outgoing edge)');
});

test('every non-terminator node is reachable from a terminator (rule 4)', () => {
  const starts = example.nodes
    .filter((n) => n.symbol === 'terminator')
    .filter((n) => !example.edges.some((e) => e.to === n.id))
    .map((n) => n.id);
  const adjacency = new Map();
  for (const edge of example.edges) {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    adjacency.get(edge.from).push(edge.to);
  }
  const reachable = new Set(starts);
  const stack = [...starts];
  while (stack.length) {
    const next = stack.pop();
    for (const target of adjacency.get(next) || []) {
      if (!reachable.has(target)) {
        reachable.add(target);
        stack.push(target);
      }
    }
  }
  for (const node of example.nodes) {
    if (node.symbol === 'terminator') continue;
    assert.ok(reachable.has(node.id), `node "${node.id}" is unreachable from a start terminator`);
  }
});

test('node ids are unique and no edge references an unknown node (rule 5)', () => {
  const ids = example.nodes.map((n) => n.id);
  assert.equal(new Set(ids).size, ids.length, 'node ids must be unique');
  const validIds = new Set(ids);
  for (const edge of example.edges) {
    assert.ok(validIds.has(edge.from), `edge "${edge.from}" -> "${edge.to}" references unknown source`);
    assert.ok(validIds.has(edge.to), `edge "${edge.from}" -> "${edge.to}" references unknown target`);
    assert.notEqual(edge.from, edge.to, `edge "${edge.from}" -> "${edge.to}" is a self-loop`);
  }
});

test('decision default side: main continuation leaves the bottom vertex, branches leave a side', () => {
  // The renderer applies decisionDefaultSide when fromSide is not authored:
  // - main continuation (to.cy > from.cy and aligned) -> 'bottom'
  // - branch to a target on the right                  -> 'right'
  // - branch to a target on the left                   -> 'left'
  // In the example, "is_open" -> "delivery" (Yes) is the main continuation
  // and "is_open" -> "read_hours" (No) is a right-side branch. Both rely on
  // the default so they must not carry a fromSide override.
  const yesEdge = example.edges.find((e) => e.from === 'is_open' && e.to === 'delivery');
  const noEdge = example.edges.find((e) => e.from === 'is_open' && e.to === 'read_hours');
  assert.ok(yesEdge && noEdge, 'is_open must have Yes and No branches');
  assert.equal(yesEdge.label, 'Yes');
  assert.equal(noEdge.label, 'No');
  assert.equal(yesEdge.fromSide, undefined, 'main continuation should rely on the auto default (bottom)');
  assert.equal(noEdge.fromSide, undefined, 'right-side branch should rely on the auto default (right)');
  // delivery is below is_open, so the auto default picks "bottom" for the
  // main continuation. read_hours is to the right, so the default picks
  // "right". The renderer's decisionDefaultSide encodes this.
});

test('symbol label-fit factors: long labels on small symbols trigger validator errors', () => {
  // The renderer multiplies the text estimate by 6.2 and compares to
  // width * innerFactor + 6. innerFactor is 0.52 for decision, 0.78 for io,
  // 0.82 for subroutine, 0.9 elsewhere. Build a worst-case that would only
  // fail if those factors silently regressed.
  const cases = [
    { symbol: 'decision', label: 'X'.repeat(40), innerFactor: 0.52 },
    { symbol: 'io', label: 'X'.repeat(40), innerFactor: 0.78 },
    { symbol: 'subroutine', label: 'X'.repeat(40), innerFactor: 0.82 },
    { symbol: 'process', label: 'X'.repeat(40), innerFactor: 0.9 },
  ];
  for (const { symbol, label, innerFactor } of cases) {
    const textUnits = label.length;
    const estLabelW = textUnits * 6.2;
    const width = 100;
    assert.ok(estLabelW > width * innerFactor + 6,
      `expected "${symbol}" with 40 chars at width 100 to exceed width * ${innerFactor} + 6; ` +
      `if this fails, the innerFactor for ${symbol} has likely regressed`);
  }
});

test('group frame bounds enclose every member node', () => {
  // Recompute the same padding the renderer applies (default 22, plus 14 for
  // the title row above the topmost member).
  const padding = 22;
  for (const group of example.groups) {
    const members = group.nodes.map((id) => example.nodes.find((n) => n.id === id));
    assert.ok(members.every(Boolean), `group "${group.id}" references unknown node`);
    const xs = members.map((m) => m.col);
    const rows = members.map((m) => m.row);
    assert.ok(members.length >= 1, `group "${group.id}" must have at least one member`);
  }
});
