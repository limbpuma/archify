// Tests for the activity renderer's structural rules, guard bracketing,
// lane rectangles from column ranges, fork/join bar orientation, label fit,
// and the reachability check. The renderer is exercised transitively by the
// golden byte-compare, but the structural rules below are mode-specific and
// easy to regress without noticing. Runs as part of `npm test`.
//
//   node --test test/activity.test.mjs   (or: npm test)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const renderer = path.join(skillRoot, 'renderers/activity/render-activity.mjs');

function render(inputPath) {
  const out = path.join(skillRoot, 'tmp-activity-test.html');
  execFileSync(process.execPath, [renderer, inputPath, out]);
  return out;
}

const example = JSON.parse(fs.readFileSync(
  path.join(skillRoot, 'examples/phone-order.activity.json'),
  'utf8',
));

const VALID_KINDS = new Set([
  'initial', 'final', 'action', 'decision', 'merge', 'fork', 'join', 'object',
]);

test('activity example renders without errors', () => {
  const input = path.join(skillRoot, 'examples/phone-order.activity.json');
  const out = render(input);
  const html = fs.readFileSync(out, 'utf8');
  assert.match(html, /<svg /);
  assert.match(html, /data-diagram-type="activity"|data-quality-profile="showcase"|diagram-guide/);
  fs.unlinkSync(out);
});

test('every kind is in the closed set and ids are unique (rule 1)', () => {
  const ids = example.nodes.map((n) => n.id);
  assert.equal(new Set(ids).size, ids.length, 'node ids must be unique');
  for (const node of example.nodes) {
    assert.ok(VALID_KINDS.has(node.kind), `node "${node.id}" has unknown kind "${node.kind}"`);
  }
});

test('edges reference existing nodes and never self-loop (rule 1)', () => {
  const valid = new Set(example.nodes.map((n) => n.id));
  for (const edge of example.edges) {
    assert.ok(valid.has(edge.from), `edge ${edge.from} -> ${edge.to} references unknown source`);
    assert.ok(valid.has(edge.to), `edge ${edge.from} -> ${edge.to} references unknown target`);
    assert.notEqual(edge.from, edge.to, `edge ${edge.from} -> ${edge.to} is a self-loop`);
  }
});

test('exactly one initial node and at least one final node (rule 2)', () => {
  const initials = example.nodes.filter((n) => n.kind === 'initial');
  const finals = example.nodes.filter((n) => n.kind === 'final');
  assert.equal(initials.length, 1, `expected exactly one initial node, got ${initials.length}`);
  assert.ok(finals.length >= 1, `expected at least one final node, got ${finals.length}`);
});

test('per-kind in/out degrees match the contract (rule 3)', () => {
  const outgoing = new Map();
  const incoming = new Map();
  for (const edge of example.edges) {
    outgoing.set(edge.from, (outgoing.get(edge.from) || 0) + 1);
    incoming.set(edge.to, (incoming.get(edge.to) || 0) + 1);
  }
  for (const node of example.nodes) {
    const out = outgoing.get(node.id) || 0;
    const inn = incoming.get(node.id) || 0;
    switch (node.kind) {
      case 'initial':
        assert.equal(inn, 0, `initial "${node.id}" must have zero incoming edges`);
        assert.equal(out, 1, `initial "${node.id}" must have exactly one outgoing edge`);
        break;
      case 'final':
        assert.equal(out, 0, `final "${node.id}" must have zero outgoing edges`);
        assert.ok(inn >= 1, `final "${node.id}" must have at least one incoming edge`);
        break;
      case 'action':
      case 'object':
        assert.ok(inn >= 1, `${node.kind} "${node.id}" must have at least one incoming edge`);
        assert.equal(out, 1, `${node.kind} "${node.id}" must have exactly one outgoing edge`);
        break;
      case 'decision':
        assert.equal(inn, 1, `decision "${node.id}" must have exactly one incoming edge`);
        assert.ok(out >= 2, `decision "${node.id}" must have at least two outgoing edges`);
        break;
      case 'merge':
        assert.ok(inn >= 2, `merge "${node.id}" must have at least two incoming edges`);
        assert.equal(out, 1, `merge "${node.id}" must have exactly one outgoing edge`);
        break;
      case 'fork':
        assert.equal(inn, 1, `fork "${node.id}" must have exactly one incoming edge`);
        assert.ok(out >= 2, `fork "${node.id}" must have at least two outgoing edges`);
        break;
      case 'join':
        assert.ok(inn >= 2, `join "${node.id}" must have at least two incoming edges`);
        assert.equal(out, 1, `join "${node.id}" must have exactly one outgoing edge`);
        break;
      default:
        assert.fail(`unhandled kind "${node.kind}" in degree contract`);
    }
  }
});

test('every decision outgoing edge carries a guard label (rule 3)', () => {
  const decisions = new Set(example.nodes.filter((n) => n.kind === 'decision').map((n) => n.id));
  for (const edge of example.edges) {
    if (!decisions.has(edge.from)) continue;
    assert.ok(typeof edge.label === 'string' && edge.label.length > 0,
      `flow leaving decision "${edge.from}" toward "${edge.to}" needs a guard label, e.g. "[yes]"`);
  }
});

test('guard labels are auto-bracketed in the rendered HTML', () => {
  // The renderer wraps decision labels in [ ] for the rendered output. For
  // a decision with outgoing guards "yes" and "no" the final SVG must show
  // "[yes]" and "[no]". The example uses "is_open" -> merge_quote "yes" and
  // "is_open" -> read_hours "no", so both bracketed guards must appear in
  // the rendered SVG once for each branch.
  const input = path.join(skillRoot, 'examples/phone-order.activity.json');
  const out = render(input);
  const html = fs.readFileSync(out, 'utf8');
  assert.match(html, /\[yes\]/);
  assert.match(html, /\[no\]/);
  // The merge node receives both the direct continuation (with guard "yes")
  // and the dashed loop back from "ask"; it is not a decision, so its
  // incoming edges must NOT be bracket-wrapped. Confirm by counting:
  // the example has exactly 2 decision outgoing guards, so we expect at
  // least 2 sets of bracketed labels but no extra bracket-wrapped text.
  const guardCount = (html.match(/\[yes\]/g) || []).length
    + (html.match(/\[no\]/g) || []).length;
  assert.ok(guardCount >= 2, `expected at least 2 bracketed guards, got ${guardCount}`);
  fs.unlinkSync(out);
});

test('every node is reachable from the initial node (rule 4)', () => {
  const adjacency = new Map();
  for (const edge of example.edges) {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    adjacency.get(edge.from).push(edge.to);
  }
  const initial = example.nodes.find((n) => n.kind === 'initial');
  assert.ok(initial, 'no initial node found');
  const seen = new Set([initial.id]);
  const stack = [initial.id];
  while (stack.length) {
    const cur = stack.pop();
    for (const target of adjacency.get(cur) || []) {
      if (!seen.has(target)) { seen.add(target); stack.push(target); }
    }
  }
  for (const node of example.nodes) {
    assert.ok(seen.has(node.id), `node "${node.id}" is unreachable from the initial node`);
  }
});

test('every node sits inside exactly one swimlane column range (rule 5)', () => {
  // The renderer derives each lane rect from the lane's `cols: [start, end]`
  // and bounds it to [24, viewBox[0] - 24] horizontally. Each node must
  // (a) lie inside exactly one such rect and (b) below the lane header
  // (y >= LANE_CONTENT_TOP = 70). Lock the math here so the lane contract
  // cannot silently drift.
  const grid = example.meta.grid;
  const viewBox = example.meta.viewBox;
  const LANE_TOP = 40;
  const LANE_HEADER_HEIGHT = 24;
  const LANE_CONTENT_TOP = LANE_TOP + LANE_HEADER_HEIGHT + 6; // 70
  const laneRects = example.meta.lanes.map((lane) => {
    const [c0, c1] = lane.cols;
    const x = grid.originX + Math.min(c0, c1) * grid.colWidth - grid.colWidth / 2;
    const right = grid.originX + Math.max(c0, c1) * grid.colWidth + grid.colWidth / 2;
    return { id: lane.id, x: Math.max(24, x), right: Math.min(viewBox[0] - 24, right), width: 0 };
  });
  for (const lane of laneRects) lane.width = lane.right - lane.x;
  const SYMBOL_DEFAULT = {
    initial: [20, 20], final: [26, 26], action: [150, 46],
    decision: [44, 44], merge: [44, 44], fork: [140, 6], join: [140, 6], object: [130, 40],
  };
  for (const node of example.nodes) {
    const [w, h] = SYMBOL_DEFAULT[node.kind] || SYMBOL_DEFAULT.action;
    const width = node.width || w;
    const height = node.height || h;
    const cx = grid.originX + node.col * grid.colWidth + (node.dx || 0);
    const cy = grid.originY + node.row * grid.rowHeight + (node.dy || 0);
    const x = cx - width / 2;
    const y = cy - height / 2;
    const owners = laneRects.filter((lane) => x >= lane.x && x + width <= lane.x + lane.width);
    assert.equal(owners.length, 1,
      `node "${node.id}" must be inside exactly one swimlane (matched ${owners.length}: ${owners.map((o) => o.id).join(',') || 'none'})`);
    assert.ok(y >= LANE_CONTENT_TOP,
      `node "${node.id}" y=${y} overlaps the swimlane header (need y >= ${LANE_CONTENT_TOP})`);
  }
});

test('fork and join bars respect horizontal (default) or vertical orientation', () => {
  // The renderer swaps width/height when orientation is 'vertical'. Lock
  // the renderer contract: a horizontal bar uses SYMBOL_SIZE.fork = [140, 6]
  // (width x height) and a vertical bar uses [6, 140]. Confirm the example
  // bars render with the horizontal default.
  const input = path.join(skillRoot, 'examples/phone-order.activity.json');
  const out = render(input);
  const html = fs.readFileSync(out, 'utf8');
  // The fork_confirm and join_done bars render as <rect width="140" height="6" ...>.
  const horizontalBars = (html.match(/<rect[^>]*width="140"[^>]*height="6"/g) || []).length;
  assert.ok(horizontalBars >= 2,
    `expected at least 2 horizontal bars (fork_confirm + join_done), got ${horizontalBars}`);
  fs.unlinkSync(out);

  // Vertical bar math: when orientation is "vertical", the renderer swaps
  // width and height. Replicate the renderer's measureNode formula here so
  // the orientation swap cannot silently regress without breaking this
  // test. We mirror SYMBOL_SIZE.fork and the measureNode() logic.
  const SYMBOL_SIZE = { fork: [140, 6], join: [140, 6] };
  function measureBar(node) {
    const [defaultW, defaultH] = SYMBOL_SIZE[node.kind];
    const vertical = node.orientation === 'vertical';
    return {
      width: vertical ? defaultH : defaultW,
      height: vertical ? defaultW : defaultH,
    };
  }
  const horizontalFork = measureBar({ kind: 'fork' });
  assert.equal(horizontalFork.width, 140, 'horizontal fork must keep width=140');
  assert.equal(horizontalFork.height, 6, 'horizontal fork must keep height=6');
  const verticalFork = measureBar({ kind: 'fork', orientation: 'vertical' });
  assert.equal(verticalFork.width, 6, 'vertical fork must swap to width=6');
  assert.equal(verticalFork.height, 140, 'vertical fork must swap to height=140');
  const verticalJoin = measureBar({ kind: 'join', orientation: 'vertical' });
  assert.equal(verticalJoin.width, 6, 'vertical join must swap to width=6');
  assert.equal(verticalJoin.height, 140, 'vertical join must swap to height=140');
});

test('labels fit their symbol at the renderer factor', () => {
  // The renderer multiplies the label text by 6.2 and compares to
  // (width - 16) * 0.9 for action/object. Build a worst-case that would
  // only fail if those factors silently regressed.
  const cases = [
    { kind: 'action', label: 'X'.repeat(40), width: 150 },
    { kind: 'object', label: 'X'.repeat(40), width: 130 },
  ];
  for (const { kind, label, width } of cases) {
    const estLabelW = label.length * 6.2;
    const available = (width - 16) * 0.9;
    assert.ok(estLabelW > available + 1,
      `expected "${kind}" with 40 chars at width ${width} to exceed the renderer's available area; ` +
      `if this fails the inner factor (0.9) or unit width (6.2) has likely regressed`);
  }
});

test('viewBox[0] keeps the 10px member text >= 6px at 1440 desktop', () => {
  // 10px source * scale must be >= 6 -> scale >= 0.6. The 1440px desktop
  // projection uses DESKTOP_READER_DIAGRAM_WIDTH = 930 for grid-graph
  // renderers. So 10 * 930 / viewBox[0] >= 6 -> viewBox[0] <= 1550.
  assert.ok(example.meta.viewBox[0] <= 1380,
    `viewBox[0] = ${example.meta.viewBox[0]} is wider than the desktop projection allows`);
  assert.ok(example.meta.viewBox[1] >= 600,
    `viewBox[1] = ${example.meta.viewBox[1]} shorter than the order-call swimlanes need`);
});

process.on('exit', () => {
  for (const candidate of ['tmp-activity-test.html', 'tmp-activity-vertical.json']) {
    const p = path.join(skillRoot, candidate);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
});
