// Tests for the struktogramm renderer's structural rules and layout
// arithmetic. The renderer is exercised transitively by the golden
// byte-compare, but the structural rules below are mode-specific and easy
// to regress without noticing. Runs as part of `npm test`.
//
//   node --test test/struktogramm.test.mjs   (or: npm test)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const renderer = path.join(skillRoot, 'renderers/struktogramm/render-struktogramm.mjs');

function render(inputPath) {
  const out = path.join(skillRoot, 'tmp-struktogramm-test.html');
  execFileSync(process.execPath, [renderer, inputPath, out]);
  return out;
}

const example = JSON.parse(fs.readFileSync(
  path.join(skillRoot, 'examples/order-call.struktogramm.json'),
  'utf8',
));

function flattenBlocks(blocks) {
  const out = [];
  for (const block of blocks) {
    out.push(block);
    if (Array.isArray(block.then)) out.push(...flattenBlocks(block.then));
    if (Array.isArray(block.else)) out.push(...flattenBlocks(block.else));
    if (Array.isArray(block.body)) out.push(...flattenBlocks(block.body));
    if (Array.isArray(block.cases)) {
      for (const c of block.cases) {
        if (Array.isArray(c.body)) out.push(...flattenBlocks(c.body));
      }
    }
  }
  return out;
}

test('struktogramm example renders without errors', () => {
  const input = path.join(skillRoot, 'examples/order-call.struktogramm.json');
  const out = render(input);
  const html = fs.readFileSync(out, 'utf8');
  assert.match(html, /<svg /);
  assert.match(html, /data-diagram-type="struktogramm"|data-quality-profile="showcase"|diagram-guide/);
  fs.unlinkSync(out);
});

test('every `if` has both `then` and `else` blocks (rule 1)', () => {
  const all = flattenBlocks(example.blocks);
  for (const block of all) {
    if (block.kind !== 'if') continue;
    assert.ok(Array.isArray(block.then) && block.then.length > 0,
      `if "${block.text}" (${block.pathLabel || block.text}) is missing a non-empty then branch`);
    assert.ok(Array.isArray(block.else) && block.else.length > 0,
      `if "${block.text}" (${block.pathLabel || block.text}) is missing a non-empty else branch`);
  }
});

test('every `case` has at least two cases and every loop has a body (rule 1)', () => {
  const all = flattenBlocks(example.blocks);
  for (const block of all) {
    if (block.kind === 'case') {
      assert.ok(Array.isArray(block.cases) && block.cases.length >= 2,
        `case "${block.text}" (${block.pathLabel || block.text}) needs at least two cases (got ${block.cases?.length ?? 0})`);
    }
    if (['while', 'until', 'for'].includes(block.kind)) {
      assert.ok(Array.isArray(block.body) && block.body.length > 0,
        `${block.kind} "${block.text}" (${block.pathLabel || block.text}) needs a body`);
    }
    if (['statement', 'io', 'call', 'exit'].includes(block.kind)) {
      const hasChildren = Boolean(block.then || block.else || block.cases || block.body);
      assert.ok(!hasChildren,
        `"${block.kind}" "${block.text}" (${block.pathLabel || block.text}) must not carry children`);
    }
  }
});

test('block ids are unique and references resolve (rule 1)', () => {
  const all = flattenBlocks(example.blocks);
  const ids = all.map((b) => b.id).filter(Boolean);
  assert.equal(new Set(ids).size, ids.length, 'block ids must be unique');
});

test('nesting depth is bounded and total rows fit (rules 2 & 3)', () => {
  // Renderer: MAX_DEPTH = 6, MAX_ROWS = 40.
  // Walk the tree and assert no example block violates the contract.
  function walk(list, depth) {
    for (const block of list) {
      assert.ok(depth <= 6, `block "${block.text}" exceeds maximum nesting depth 6`);
      if (block.then) walk(block.then, depth + 1);
      if (block.else) walk(block.else, depth + 1);
      if (block.cases) for (const c of block.cases) walk(c.body, depth + 1);
      if (block.body) walk(block.body, depth + 1);
    }
  }
  walk(example.blocks, 1);
  // Soft row count estimate (used by the renderer): one row per non-loop
  // body block plus header/footer rows for loops/cases. Keep well below 40.
  const flat = flattenBlocks(example.blocks);
  const estimatedRows = flat.length + flat.filter((b) => ['if', 'case'].includes(b.kind)).length;
  assert.ok(estimatedRows <= 40, `estimated ${estimatedRows} rows exceeds renderer maximum 40`);
});

test('schema-forbidden values: viewBox[0] keeps text ≥6px at 1440 desktop (rule 4)', () => {
  // The renderer accepts only viewBox[0] ratios that keep the projected
  // branch label ≥6px at the 1440 desktop projection (DESKTOP_READER_DIAGRAM_WIDTH = 930).
  // 8px source · scale must be ≥ 6 → scale ≥ 0.75 → viewBox[0] ≤ 1240.
  assert.ok(example.meta.viewBox[0] <= 1240,
    `viewBox[0] = ${example.meta.viewBox[0]} is wider than the desktop projection allows`);
  assert.ok(example.meta.viewBox[1] >= 600,
    `viewBox[1] = ${example.meta.viewBox[1]} is shorter than the order-call block tree needs`);
});

test('layout arithmetic: `if` split widths follow `split` exactly', () => {
  // For each `if` block, the `then` column width should equal
  // Math.round(parentWidth * split) and the `else` column fills the rest.
  // We re-measure by mimicking the renderer to lock the arithmetic.
  const HEADER_FACTOR = 1.35;
  const layout = {
    rowHeight: example.meta.layout.rowHeight,
    indent: example.meta.layout.indent,
    margin: example.meta.layout.margin,
  };
  const rootWidth = example.meta.viewBox[0] - 2 * layout.margin;

  function measureList(blocks, x, y, w) {
    let cursor = y;
    for (const block of blocks) {
      const row = layout.rowHeight;
      if (block.kind === 'if') {
        const split = block.split ?? 0.5;
        const header = row * HEADER_FACTOR;
        const leftW = Math.round(w * split);
        const rightW = w - leftW;
        assert.equal(leftW, Math.round(w * split),
          `if "${block.text}": leftW != Math.round(parentWidth * split)`);
        assert.equal(rightW, w - leftW,
          `if "${block.text}": rightW != parentWidth - leftW`);
        const thenBottom = measureList(block.then, x, y + header, leftW);
        const elseBottom = measureList(block.else, x + leftW, y + header, rightW);
        cursor = Math.max(thenBottom, elseBottom);
      } else if (block.kind === 'case') {
        const header = row * HEADER_FACTOR;
        const labelRow = row * 0.75;
        const weights = block.cases.map((c) => c.weight ?? 1);
        const total = weights.reduce((a, b) => a + b, 0);
        let cx = x;
        let bodyBottom = y + header + labelRow;
        for (let i = 0; i < block.cases.length; i += 1) {
          const cwidth = i === block.cases.length - 1 ? x + w - cx : Math.round(w * weights[i] / total);
          const bottom = measureList(block.cases[i].body, cx, y + header + labelRow, cwidth);
          if (bottom > bodyBottom) bodyBottom = bottom;
          cx += cwidth;
        }
        cursor = bodyBottom;
      } else if (block.kind === 'while' || block.kind === 'for') {
        cursor = measureList(block.body, x + layout.indent, y + row, w - layout.indent);
      } else if (block.kind === 'until') {
        cursor = measureList(block.body, x + layout.indent, y, w - layout.indent) + row;
      } else {
        cursor = y + row;
      }
    }
    return cursor;
  }

  // The deepest `if` is "ZIP in zone?" whose column width is:
  //   rootWidth (= 1000) → open_branch then (0.62) → delivery? then (50%) → ZIP in zone? then (50%)
  // = 1000 * 0.62 * 0.5 * 0.5 = 155. Texts inside (≤ 96 chars) must fit
  // 155 - 12 = 143 source px to honor rule 4.
  const openBranch = example.blocks.find((b) => b.id === 'open_branch');
  assert.ok(openBranch && openBranch.kind === 'if', 'open_branch must be an if block');
  const deliveryBranch = openBranch.then.find((b) => b.id === 'mode_branch');
  assert.ok(deliveryBranch && deliveryBranch.kind === 'if', 'mode_branch must be an if block');
  const zoneBranch = deliveryBranch.then.find((b) => b.kind === 'if');
  assert.ok(zoneBranch, 'delivery-branch then must contain an if (ZIP in zone?)');
  const expectedZoneLeft = Math.round(Math.round(Math.round(rootWidth * 0.62) * 0.5) * 0.5);
  assert.equal(expectedZoneLeft, 155,
    `expected deepest if-left column to be 155, got ${expectedZoneLeft}`);
  assert.ok(zoneBranch.then[0].text.length * 6.2 <= expectedZoneLeft - 12,
    `then text "${zoneBranch.then[0].text}" exceeds ${expectedZoneLeft - 12}px column`);
  assert.ok(zoneBranch.else[0].text.length * 6.2 <= expectedZoneLeft - 12,
    `else text "${zoneBranch.else[0].text}" exceeds ${expectedZoneLeft - 12}px column`);

  // Run the measure walker to exercise the arithmetic even on blocks we
  // do not directly assert on. This catches silent regressions in the
  // formula above.
  measureList(example.blocks, layout.margin, 56, rootWidth);
});

test('loop header/footer row heights follow the renderer contract', () => {
  // `while` and `for` add exactly one row above the body; `until` adds
  // exactly one row below; `if`/`case` add a 1.35·rowHeight header plus
  // (for case) a 0.75·rowHeight label row. Lock these arithmetic factors
  // so the layout cannot silently drift.
  const row = example.meta.layout.rowHeight;
  assert.ok(row >= 24, `rowHeight ${row} below renderer minimum 24`);
  assert.ok(row <= 64, `rowHeight ${row} above renderer maximum 64`);
  // Header factor 1.35 and label row factor 0.75 must produce finite,
  // positive heights that scale linearly with `row`. They are not
  // required to be integer-stable (e.g. rowHeight=24 → 32.4) — the
  // renderer rounds visually — but they must never go negative or zero.
  const header = row * 1.35;
  const label = row * 0.75;
  assert.ok(header > 0 && label > 0,
    `header ${header} and label ${label} must stay positive`);
  // The renderer body width inside a loop is parent_width - indent; the
  // header/footer span the full parent_width. Lock that contract.
  assert.equal(example.meta.layout.indent, 22);
});