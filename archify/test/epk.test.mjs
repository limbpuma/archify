// Tests for the EPK (ereignisgesteuerte Prozesskette, eEPK) renderer's
// structural rules, edge-kind inference, operator glyphs, and the
// event/function alternation across connectors. The renderer is also
// exercised by the golden byte-compare; the rules below are mode-specific
// and easy to regress without noticing. Runs as part of `npm test`.
//
//   node --test test/epk.test.mjs   (or: npm test)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const renderer = path.join(skillRoot, 'renderers/epk/render-epk.mjs');
const examplePath = path.join(skillRoot, 'examples/phone-order.epk.json');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-epk-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));

const example = JSON.parse(fs.readFileSync(examplePath, 'utf8'));
const exampleHtml = fs.readFileSync(path.join(skillRoot, 'examples/epk-phone-order.html'), 'utf8');

function clone() {
  return JSON.parse(JSON.stringify(example));
}

function render(doc, name = 'epk') {
  const input = path.join(tmp, `${name}.json`);
  const output = path.join(tmp, `${name}.html`);
  fs.writeFileSync(input, JSON.stringify(doc));
  execFileSync(process.execPath, [renderer, input, output], { stdio: ['ignore', 'ignore', 'pipe'] });
  return fs.readFileSync(output, 'utf8');
}

function expectFailure(name, mutate, expected) {
  const doc = clone();
  mutate(doc);
  const input = path.join(tmp, `neg-${name.replace(/[^a-z0-9]+/gi, '-')}.json`);
  fs.writeFileSync(input, JSON.stringify(doc));
  try {
    execFileSync(process.execPath, [renderer, input, path.join(tmp, 'neg-out.html')], { stdio: ['ignore', 'ignore', 'pipe'] });
    assert.fail(`renderer exited 0 on invalid input for "${name}"`);
  } catch (err) {
    const message = String(err.stderr || err.message);
    assert.ok(message.includes(expected),
      `expected "${expected}" for "${name}" in:\n${message.slice(0, 500)}`);
  }
}

function nodeGroup(id) {
  const re = new RegExp(`<g[^>]*data-node-id="${id}"[\\s\\S]*?</g>`);
  return exampleHtml.match(re)?.[0] ?? '';
}

function edgeElement(from, to) {
  const marker = `data-edge-from="${from}" data-edge-to="${to}"`;
  const index = exampleHtml.indexOf(marker);
  if (index < 0) return '';
  const start = exampleHtml.lastIndexOf('<path', index);
  const end = exampleHtml.indexOf('/>', index);
  return exampleHtml.slice(start, end + 2);
}

// ---------------------------------------------------------------------------
// Rule 1 — unique ids, existing endpoints, no self-loops
// ---------------------------------------------------------------------------

test('rule 1: duplicate node ids are rejected', () => {
  expectFailure('duplicate ids', (d) => { d.nodes.find((n) => n.id === 'menu').id = 'agent'; }, 'unique');
});

test('rule 1: edges must reference existing nodes', () => {
  expectFailure('unknown target', (d) => { d.edges[0].to = 'ghost'; }, 'unknown target "ghost"');
});

test('rule 1: self-loops are rejected', () => {
  expectFailure('self loop', (d) => { d.edges.push({ from: 'take_order', to: 'take_order' }); }, 'loops onto itself');
});

// ---------------------------------------------------------------------------
// Rule 2 — the chain starts and ends with an event
// ---------------------------------------------------------------------------

test('rule 2: the example starts and ends with events', () => {
  const incoming = new Set(example.edges.map((e) => e.to));
  const outgoing = new Set(example.edges.map((e) => e.from));
  const events = example.nodes.filter((node) => node.kind === 'event');
  const starts = events.filter((node) => !incoming.has(node.id));
  const ends = events.filter((node) => !outgoing.has(node.id));
  assert.ok(starts.length >= 1, 'the example needs at least one start event');
  assert.ok(ends.length >= 1, 'the example needs at least one end event');
  assert.equal(starts[0].id, 'call_received');
});

test('rule 2: a chain without a start event is rejected', () => {
  expectFailure('no start event', (d) => { d.edges.push({ from: 'handed_over', to: 'call_received' }); },
    'starts with at least one event');
});

test('rule 2: a chain without an end event is rejected', () => {
  expectFailure('no end event', (d) => {
    for (const id of ['cancelled', 'notified', 'handed_over']) d.edges.push({ from: id, to: 'call_received' });
  }, 'ends with at least one event');
});

// ---------------------------------------------------------------------------
// Rule 3 — event/function alternation, checked across connectors
// ---------------------------------------------------------------------------

test('rule 3: an event followed by an event across a connector is rejected', () => {
  // order_ready (event) → ready_split (AND connector) → notify (function);
  // turning notify into an event makes the connector bridge two events.
  expectFailure('event after connector', (d) => { d.nodes.find((n) => n.id === 'notify').kind = 'event'; },
    'followed by event');
});

test('rule 3: a function followed by a function across a connector is rejected', () => {
  // check_payment (function) → payment_split (XOR connector) → payment_ok (event);
  // turning payment_ok into a function makes the connector bridge two functions.
  expectFailure('function after connector', (d) => { d.nodes.find((n) => n.id === 'payment_ok').kind = 'function'; },
    'followed by function');
});

test('rule 3: the example alternates event → function → event across every connector', () => {
  const kinds = new Map(example.nodes.map((node) => [node.id, node.kind]));
  const outgoing = new Map();
  const incoming = new Map();
  for (const edge of example.edges) {
    if (kinds.get(edge.from) === 'org' || kinds.get(edge.from) === 'info'
      || kinds.get(edge.to) === 'org' || kinds.get(edge.to) === 'info') continue;
    outgoing.set(edge.from, [...(outgoing.get(edge.from) || []), edge.to]);
    incoming.set(edge.to, [...(incoming.get(edge.to) || []), edge.from]);
  }
  const neighbours = (id, direction) => {
    const result = [];
    const seen = new Set();
    const stack = [...((direction === 'out' ? outgoing : incoming).get(id) || [])];
    while (stack.length) {
      const next = stack.pop();
      if (seen.has(next)) continue;
      seen.add(next);
      if (kinds.get(next) === 'connector') {
        stack.push(...((direction === 'out' ? outgoing : incoming).get(next) || []));
      } else {
        result.push(next);
      }
    }
    return result;
  };
  for (const node of example.nodes) {
    if (node.kind === 'event') {
      for (const next of neighbours(node.id, 'out')) {
        assert.notEqual(kinds.get(next), 'event', `event "${node.id}" must not reach event "${next}" across connectors`);
      }
    }
    if (node.kind === 'function') {
      for (const next of neighbours(node.id, 'out')) {
        assert.notEqual(kinds.get(next), 'function', `function "${node.id}" must not reach function "${next}" across connectors`);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Rule 4 — control-flow degrees
// ---------------------------------------------------------------------------

test('rule 4: an event with more than one incoming control flow is rejected', () => {
  expectFailure('event two incoming', (d) => { d.edges.push({ from: 'prepare', to: 'order_recorded' }); },
    'incoming control flows');
});

test('rule 4: an event with more than one outgoing control flow is rejected', () => {
  expectFailure('event two outgoing', (d) => { d.edges.push({ from: 'order_recorded', to: 'prepare' }); },
    'outgoing control flows');
});

test('rule 4: a function without exactly one incoming control flow is rejected', () => {
  expectFailure('function no incoming', (d) => {
    d.edges = d.edges.filter((e) => !(e.from === 'call_received' && e.to === 'take_order'));
  }, 'exactly one incoming control flow (has 0)');
});

test('rule 4: a function without exactly one outgoing control flow is rejected', () => {
  expectFailure('function no outgoing', (d) => {
    d.edges = d.edges.filter((e) => !(e.from === 'take_order' && e.to === 'order_recorded'));
  }, 'exactly one outgoing control flow (has 0)');
});

// ---------------------------------------------------------------------------
// Rule 5 — connector operators, split/join shape, no XOR/OR split after event
// ---------------------------------------------------------------------------

test('rule 5: a connector without an operator is rejected', () => {
  expectFailure('connector no operator', (d) => { delete d.nodes.find((n) => n.id === 'payment_split').operator; },
    'needs an operator');
});

test('rule 5: a connector that is neither a split nor a join is rejected', () => {
  expectFailure('connector neither', (d) => {
    d.edges = d.edges.filter((e) => !(e.from === 'payment_split' && e.to === 'payment_declined'));
  }, 'must be a split');
});

test('rule 5: an XOR split directly after an event is rejected', () => {
  expectFailure('xor after event', (d) => { d.nodes.find((n) => n.id === 'ready_split').operator = 'xor'; },
    'XOR split');
});

test('rule 5: an AND split after an event is allowed (example renders)', () => {
  assert.equal(example.nodes.find((n) => n.id === 'ready_split').operator, 'and');
  assert.match(exampleHtml, /∧/, 'the AND connector glyph must render');
});

// ---------------------------------------------------------------------------
// Rule 6 — organisational units and information objects attach to functions
// ---------------------------------------------------------------------------

test('rule 6: an organisational unit attached to a non-function is rejected', () => {
  expectFailure('org on connector', (d) => { d.edges.push({ from: 'agent', to: 'payment_split' }); },
    'attach it to a function');
});

test('rule 6: an unattached information object is rejected', () => {
  expectFailure('info unattached', (d) => {
    d.edges = d.edges.filter((e) => e.from !== 'menu' && e.to !== 'menu');
  }, 'not attached to any function');
});

test('rule 6: linking two organisational units is rejected', () => {
  expectFailure('two orgs', (d) => { d.edges.push({ from: 'agent', to: 'kitchen' }); },
    'links two organisational units');
});

test('rule 6: the example attaches every satellite to a function', () => {
  const kinds = new Map(example.nodes.map((node) => [node.id, node.kind]));
  for (const node of example.nodes) {
    if (node.kind !== 'org' && node.kind !== 'info') continue;
    const links = example.edges.filter((e) => e.from === node.id || e.to === node.id);
    assert.ok(links.length >= 1, `satellite "${node.id}" is unattached`);
    for (const link of links) {
      const other = link.from === node.id ? link.to : link.from;
      assert.equal(kinds.get(other), 'function', `satellite "${node.id}" must attach to a function, not ${kinds.get(other)}`);
    }
  }
});

// ---------------------------------------------------------------------------
// Rule 7 — labels fit their symbol
// ---------------------------------------------------------------------------

test('rule 7: a label wider than its symbol text area is rejected', () => {
  expectFailure('label overflow', (d) => {
    d.nodes.find((n) => n.id === 'take_order').label = 'X'.repeat(60);
  }, 'wider than');
});

test('rule 7: the example keeps viewBox[0] ≤ 1380 for the 1440 px projection', () => {
  assert.ok(example.meta.viewBox[0] <= 1380,
    `viewBox[0] = ${example.meta.viewBox[0]} must stay ≤ 1380 so the 1440 px desktop projection keeps the 9 px satellite text above the 6 px floor`);
});

// ---------------------------------------------------------------------------
// Edge-kind inference from node kinds
// ---------------------------------------------------------------------------

test('control flow renders a solid line with an arrowhead', () => {
  const path = edgeElement('call_received', 'take_order');
  assert.match(path, /marker-end="url\(#arrowhead\)"/, 'control flow needs an arrowhead');
  assert.doesNotMatch(path, /stroke-dasharray/, 'control flow must be solid');
});

test('assignment (org ↔ function) renders a solid line without an arrowhead', () => {
  const path = edgeElement('agent', 'take_order');
  assert.ok(path.length > 0, 'assignment edge not found');
  assert.doesNotMatch(path, /marker-end/, 'assignment must not carry an arrowhead');
  assert.doesNotMatch(path, /stroke-dasharray/, 'assignment must be solid');
});

test('information flow (info ↔ function) renders a dashed line with an arrowhead', () => {
  const path = edgeElement('menu', 'take_order');
  assert.match(path, /marker-end="url\(#arrowhead\)"/, 'information flow needs an arrowhead');
  assert.match(path, /stroke-dasharray="5 4"/, 'information flow must be dashed');
});

// ---------------------------------------------------------------------------
// Operator glyphs and symbol shapes
// ---------------------------------------------------------------------------

test('operator glyphs render XOR, AND, and OR', () => {
  assert.match(exampleHtml, /XOR/, 'XOR glyph missing');
  assert.match(exampleHtml, /∧/, 'AND glyph missing');
  const allLegend = clone();
  allLegend.meta.legend = { mode: 'all' };
  assert.match(render(allLegend, 'or-legend'), /∨/, 'OR glyph missing');
});

test('symbol shapes match the eEPK notation', () => {
  assert.match(nodeGroup('call_received'), /<polygon /, 'events are hexagons');
  assert.match(nodeGroup('take_order'), /rx="9"/, 'functions are rounded rectangles');
  assert.match(nodeGroup('payment_split'), /<circle /, 'connectors are circles');
  const org = nodeGroup('agent');
  assert.match(org, /<ellipse /, 'organisational units are ellipses');
  assert.match(org, /<line /, 'organisational units carry the vertical bar');
  const info = nodeGroup('menu');
  assert.match(info, /<rect /, 'information objects are rectangles');
  assert.doesNotMatch(info, /rx="9"/, 'information objects are plain rectangles');
});

// ---------------------------------------------------------------------------
// Golden byte-parity with the committed example
// ---------------------------------------------------------------------------

test('rendered example stays byte-identical to the committed HTML', () => {
  const fresh = render(clone(), 'golden').replace(/\r\n?/g, '\n');
  const committed = exampleHtml.replace(/\r\n?/g, '\n');
  assert.equal(fresh, committed, 're-render the example and commit the result');
});
