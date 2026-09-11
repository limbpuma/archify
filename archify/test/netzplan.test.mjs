// Tests for the activity-on-node network plan renderer (DIN 69900 / CPM):
// the forward and backward pass on the bundled example, the acyclic and
// left-to-right structural rules, the automatic emphasis variant on critical
// dependencies, and the meta.captions overrides. The renderer is exercised
// transitively by the golden byte-compare, but the schedule arithmetic and the
// network rules below are easy to regress without noticing. Runs as part of
// `npm test`.
//
//   node --test test/netzplan.test.mjs   (or: npm test)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const renderer = path.join(skillRoot, 'renderers/netzplan/render-netzplan.mjs');
const EXAMPLE_INPUT = path.join(skillRoot, 'examples/rollout.netzplan.json');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-netzplan-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));

// Memoize the example render so each test file invokes the renderer at most
// once for the happy path.
const EXAMPLE_HTML_PATH = path.join(tmp, 'netzplan-rollout.html');
let exampleHtml;
function ensureExampleRendered() {
  if (exampleHtml === undefined) {
    execFileSync(process.execPath, [renderer, EXAMPLE_INPUT, EXAMPLE_HTML_PATH]);
    exampleHtml = fs.readFileSync(EXAMPLE_HTML_PATH, 'utf8');
  }
  return exampleHtml;
}

const example = JSON.parse(fs.readFileSync(EXAMPLE_INPUT, 'utf8'));

// Independent oracle: the schedule the example must produce. Cell order inside
// an activity node is FAZ | D | FEZ over SAZ | GP | FP | SEZ.
const EXPECTED_SCHEDULE = {
  requirements: { faz: 0, fez: 3, saz: 0, sez: 3, gp: 0, fp: 0, critical: true },
  api: { faz: 3, fez: 8, saz: 3, sez: 8, gp: 0, fp: 0, critical: true },
  prompt: { faz: 3, fez: 7, saz: 4, sez: 8, gp: 1, fp: 0, critical: false },
  telephony: { faz: 8, fez: 14, saz: 8, sez: 14, gp: 0, fp: 0, critical: true },
  training: { faz: 7, fez: 9, saz: 15, sez: 17, gp: 8, fp: 8, critical: false },
  testing: { faz: 14, fez: 17, saz: 14, sez: 17, gp: 0, fp: 0, critical: true },
  golive: { faz: 17, fez: 18, saz: 17, sez: 18, gp: 0, fp: 0, critical: true },
};

function nodeGroup(html, id) {
  const match = html.match(new RegExp(`<g id="node-${id}"[\\s\\S]*?</g>`));
  assert.ok(match, `activity "${id}" has no rendered node group`);
  return match[0];
}

function nodeValues(html, id) {
  const group = nodeGroup(html, id);
  return [...group.matchAll(/<text data-detail="context"[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
}

function nodeContext(html, id) {
  const group = nodeGroup(html, id);
  return (group.match(/data-node-context="([^"]*)"/) || [])[1];
}

function renderMutated(name, mutate) {
  const base = JSON.parse(fs.readFileSync(EXAMPLE_INPUT, 'utf8'));
  mutate(base);
  const input = path.join(tmp, `${name}.json`);
  const output = path.join(tmp, `${name}.html`);
  fs.writeFileSync(input, JSON.stringify(base));
  return { input, output };
}

function expectRenderFailure(name, mutate, expectInMessage) {
  const { input, output } = renderMutated(name, mutate);
  const result = spawnSync(process.execPath, [renderer, input, output], { encoding: 'utf8' });
  assert.notEqual(result.status, 0, `${name}: renderer exited 0 on an invalid network plan`);
  const message = String(result.stderr || result.stdout || '');
  assert.ok(message.includes(expectInMessage),
    `${name}: expected "${expectInMessage}" in:\n${message.slice(0, 400)}`);
}

// ---------------------------------------------------------------------------
// Structural rules (hard errors)
// ---------------------------------------------------------------------------

test('netzplan example renders a single SVG with the computed project end', () => {
  const html = ensureExampleRendered();
  assert.match(html, /<svg /);
  assert.equal((html.match(/<svg /g) || []).length, 1);
  assert.match(html, /data-project-end="18"/);
});

test('dependencies form a cycle through every activity is rejected (rule 2)', () => {
  expectRenderFailure('cycle', (d) => {
    d.dependencies.push({ from: 'golive', to: 'requirements' });
  }, 'cycle through');
});

test('a successor placed left of its predecessor is rejected (rule 3)', () => {
  expectRenderFailure('left-to-right', (d) => {
    const training = d.activities.find((activity) => activity.id === 'training');
    const requirements = d.activities.find((activity) => activity.id === 'requirements');
    training.col = requirements.col;
    training.row = requirements.row;
  }, 'not placed further right');
});

// ---------------------------------------------------------------------------
// Forward + backward pass
// ---------------------------------------------------------------------------

test('forward and backward pass compute FAZ/FEZ/SAZ/SEZ/GP/FP for every activity', () => {
  const html = ensureExampleRendered();
  for (const [id, expected] of Object.entries(EXPECTED_SCHEDULE)) {
    const values = nodeValues(html, id);
    assert.equal(values.length, 7, `activity "${id}" must render 7 schedule cells`);
    assert.equal(Number(values[0]), expected.faz, `${id} FAZ`);
    assert.equal(Number(values[2]), expected.fez, `${id} FEZ`);
    assert.equal(Number(values[3]), expected.saz, `${id} SAZ`);
    assert.equal(Number(values[4]), expected.gp, `${id} GP`);
    assert.equal(Number(values[5]), expected.fp, `${id} FP`);
    assert.equal(Number(values[6]), expected.sez, `${id} SEZ`);
    assert.match(values[1], new RegExp(`^${example.activities.find((a) => a.id === id).duration} d$`),
      `${id} duration cell carries the unit`);
  }
});

test('project end is the latest FEZ (18) and the critical set has zero float', () => {
  const html = ensureExampleRendered();
  assert.match(html, /data-project-end="18"/);
  const critical = Object.entries(EXPECTED_SCHEDULE)
    .filter(([, entry]) => entry.critical)
    .map(([id]) => id)
    .sort();
  assert.deepEqual(critical, ['api', 'golive', 'requirements', 'telephony', 'testing']);
  for (const [id, expected] of Object.entries(EXPECTED_SCHEDULE)) {
    const context = nodeContext(html, id);
    if (expected.critical) {
      assert.equal(expected.gp, 0, `${id} is critical but GP is ${expected.gp}`);
      assert.match(context, /critical path \(GP 0\)/, `${id} must read as critical`);
    } else {
      assert.ok(expected.gp > 0, `${id} is non-critical but GP is ${expected.gp}`);
      assert.equal(context, 'activity', `${id} must read as an ordinary activity`);
    }
  }
});

test('critical dependencies render with the automatic emphasis variant', () => {
  const html = ensureExampleRendered();
  const edges = [...html.matchAll(/<path data-edge-from="([^"]+)" data-edge-to="([^"]+)"[^>]*class="([^"]*)"/g)]
    .map((match) => ({ from: match[1], to: match[2], cls: match[3] }));
  const emphasized = new Set(edges.filter((edge) => edge.cls.includes('a-emphasis'))
    .map((edge) => `${edge.from}->${edge.to}`));
  assert.deepEqual([...emphasized].sort(), [
    'api->telephony',
    'requirements->api',
    'telephony->testing',
    'testing->golive',
  ].sort());
  for (const edge of edges) {
    const key = `${edge.from}->${edge.to}`;
    if (emphasized.has(key)) continue;
    assert.ok(edge.cls.includes('a-default'), `${key} must stay a default dependency`);
  }
});

test('meta.captions override the schedule cell captions and sublabels', () => {
  const { input, output } = renderMutated('captions', (d) => {
    d.meta.captions = { faz: 'ES', fez: 'EF', saz: 'LS', sez: 'LF', gp: 'TF', fp: 'FF', d: 'DUR' };
  });
  execFileSync(process.execPath, [renderer, input, output]);
  const html = fs.readFileSync(output, 'utf8');
  for (const caption of ['ES', 'EF', 'LS', 'LF', 'TF', 'FF', 'DUR']) {
    assert.match(html, new RegExp(`>${caption}<`), `caption "${caption}" must render`);
  }
  assert.match(html, /data-node-sublabel="ES 0 · EF 3 · TF 0"/);
  assert.doesNotMatch(html, />FAZ</, 'default FAZ caption must be replaced');
});

test('rendered golden stays byte-identical to the committed example HTML', () => {
  const normalize = (text) => text.replace(/\r\n?/g, '\n');
  const fresh = normalize(ensureExampleRendered());
  for (const committed of [
    path.join(skillRoot, 'examples/netzplan-rollout.html'),
    path.resolve(skillRoot, '..', 'examples/netzplan-rollout.html'),
  ]) {
    assert.ok(fs.existsSync(committed), `${committed} is missing`);
    assert.equal(fresh, normalize(fs.readFileSync(committed, 'utf8')),
      `${committed} drifted; re-render the examples and commit them`);
  }
});
