import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, renderDefinitions, textUnits } from '../shared/utils.mjs';
import { animateAttr, focusNodeAttrs, focusNodeTitle, loadDiagramWithBrandMarks, writeDiagram, svgAccessibleText, svgRootAttrs } from '../shared/cli.mjs';
import { throwDiagnosticProblems } from '../shared/diagnostics.mjs';
import { resolveLegend, renderLegend as renderResolvedLegend } from '../shared/legend.mjs';
import { translateMessage as i18nText } from '../shared/i18n.mjs';
import { asArray } from '../shared/geometry.mjs';

// Nassi-Shneiderman diagram (DIN 66261). The author owns the block tree and
// its proportions; the renderer owns the box arithmetic. There are no edges,
// so the composition checks that matter are text fit and canvas fit.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { diagram: struktogramm, template, outPath } = await loadDiagramWithBrandMarks({
  rendererDir: __dirname,
  diagramType: 'struktogramm',
  defaultExample: 'order-call.struktogramm.json'
});

const viewBox = struktogramm.meta?.viewBox || [980, 640];
const layout = {
  rowHeight: struktogramm.meta?.layout?.rowHeight ?? 34,
  indent: struktogramm.meta?.layout?.indent ?? 26,
  margin: struktogramm.meta?.layout?.margin ?? 40,
  top: 56,
};
const HEADER_FACTOR = 1.35;
const TEXT_PX_PER_UNIT = 6.2;
const PRIMARY_FONT = 10;
const MAX_DEPTH = 6;
const MAX_ROWS = 40;

const CHILD_KINDS = new Set(['if', 'case', 'while', 'until', 'for']);
const kindClass = {
  statement: 'c-backend',
  io: 'c-cloud',
  call: 'c-frontend',
  if: 'c-security',
  case: 'c-security',
  while: 'c-database',
  until: 'c-database',
  for: 'c-database',
  exit: 'c-external',
};
const toneClass = { accent: 'c-security', success: 'c-database', failure: 'c-external' };
const legendKindFor = (kind) => (kind === 'if' || kind === 'case' ? 'branch' : ['while', 'until', 'for'].includes(kind) ? 'loop' : kind);

function legendY() {
  return viewBox[1] - 36;
}

function diagramAreaBottom() {
  return viewBox[1] - 96;
}

// ---------------------------------------------------------------------------
// Measurement: every block gets {x, y, width, height} plus child geometry.
// ---------------------------------------------------------------------------

let rowCount = 0;

function measureList(blocks, x, y, width, depth, problems, pathLabel) {
  let cursor = y;
  const measured = [];
  for (const [index, block] of asArray(blocks).entries()) {
    const m = measureBlock(block, x, cursor, width, depth, problems, `${pathLabel}[${index}]`);
    measured.push(m);
    cursor += m.height;
  }
  return { items: measured, height: cursor - y };
}

function measureBlock(block, x, y, width, depth, problems, pathLabel) {
  if (depth > MAX_DEPTH) problems.push(`Block "${block.text}" (${pathLabel}) is nested deeper than ${MAX_DEPTH} levels — flatten the structure or split the diagram.`);
  rowCount += 1;
  const row = layout.rowHeight;
  const base = { ...block, x, y, width, pathLabel, depth };
  switch (block.kind) {
    case 'if': {
      const split = block.split ?? 0.5;
      const header = row * HEADER_FACTOR;
      const leftW = Math.round(width * split);
      const rightW = width - leftW;
      const thenList = measureList(block.then, x, y + header, leftW, depth + 1, problems, `${pathLabel}.then`);
      const elseList = measureList(block.else, x + leftW, y + header, rightW, depth + 1, problems, `${pathLabel}.else`);
      const bodyH = Math.max(thenList.height, elseList.height);
      return { ...base, header, leftW, rightW, thenList, elseList, bodyH, height: header + bodyH };
    }
    case 'case': {
      const header = row * HEADER_FACTOR;
      const labelRow = row * 0.75;
      const weights = asArray(block.cases).map((c) => c.weight ?? 1);
      const total = weights.reduce((a, b) => a + b, 0);
      let cx = x;
      const columns = asArray(block.cases).map((c, i) => {
        const w = i === block.cases.length - 1 ? x + width - cx : Math.round(width * weights[i] / total);
        const list = measureList(c.body, cx, y + header + labelRow, w, depth + 1, problems, `${pathLabel}.cases[${i}]`);
        const col = { label: c.label, x: cx, width: w, list };
        cx += w;
        return col;
      });
      const bodyH = Math.max(...columns.map((c) => c.list.height));
      return { ...base, header, labelRow, columns, bodyH, height: header + labelRow + bodyH };
    }
    case 'while':
    case 'for': {
      const body = measureList(block.body, x + layout.indent, y + row, width - layout.indent, depth + 1, problems, `${pathLabel}.body`);
      return { ...base, header: row, body, height: row + body.height };
    }
    case 'until': {
      const body = measureList(block.body, x + layout.indent, y, width - layout.indent, depth + 1, problems, `${pathLabel}.body`);
      return { ...base, footer: row, body, height: body.height + row };
    }
    default:
      return { ...base, height: row };
  }
}

const problems = [];
const rootX = layout.margin;
const rootWidth = viewBox[0] - 2 * layout.margin;
const root = measureList(struktogramm.blocks, rootX, layout.top, rootWidth, 1, problems, 'blocks');

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function textNeeds(text) {
  return textUnits(text) * TEXT_PX_PER_UNIT;
}

function checkText(block, availableWidth, what = 'Text') {
  const need = textNeeds(block.text);
  if (need > availableWidth - 12) {
    problems.push(`${what} "${block.text}" (~${Math.round(need)}px) does not fit its ${Math.round(availableWidth)}px box (${block.pathLabel}) — shorten it, change split/weight, or widen meta.viewBox[0].`);
  }
}

function walk(list, visit) {
  for (const block of list.items) {
    visit(block);
    if (block.kind === 'if') { walk(block.thenList, visit); walk(block.elseList, visit); }
    if (block.kind === 'case') for (const col of block.columns) walk(col.list, visit);
    if (block.body) walk(block.body, visit);
  }
}

function validateStruktogramm() {
  const ids = new Set();
  walk(root, (block) => {
    if (block.id) {
      if (ids.has(block.id)) problems.push(`Block id "${block.id}" is used twice.`);
      ids.add(block.id);
    }
    const hasChildren = Boolean(block.then || block.else || block.cases || block.body);
    if (!CHILD_KINDS.has(block.kind) && hasChildren) problems.push(`"${block.kind}" block "${block.text}" (${block.pathLabel}) cannot have children — use if/case/while/until/for.`);
    if (block.kind === 'if' && (!block.then || !block.else)) problems.push(`if "${block.text}" (${block.pathLabel}) needs both then and else (use a single statement such as "—" for an empty branch).`);
    if (block.kind === 'case' && (!block.cases || block.cases.length < 2)) problems.push(`case "${block.text}" (${block.pathLabel}) needs at least two cases.`);
    if (['while', 'until', 'for'].includes(block.kind) && !block.body) problems.push(`${block.kind} "${block.text}" (${block.pathLabel}) needs a body.`);
    if (block.kind === 'if') {
      // The condition sits in the triangle apex: only the middle ~60% of the header is usable.
      checkText(block, block.width * 0.6, 'Condition');
      const labelW = Math.min(block.leftW, block.rightW) * 0.5;
      for (const [label, w] of [[block.thenLabel || 'yes', block.leftW], [block.elseLabel || 'no', block.rightW]]) {
        if (textNeeds(label) > w - 12) problems.push(`Branch label "${label}" does not fit the ${Math.round(w)}px column of if "${block.text}" (${block.pathLabel}).`);
      }
      void labelW;
    } else if (block.kind === 'case') {
      checkText(block, block.width * 0.6, 'Selector');
      for (const col of block.columns) {
        if (textNeeds(col.label) > col.width - 12) problems.push(`Case label "${col.label}" does not fit its ${Math.round(col.width)}px column in case "${block.text}" (${block.pathLabel}).`);
      }
    } else if (block.kind === 'until') {
      checkText(block, block.width);
    } else if (block.kind === 'call') {
      checkText(block, block.width - 20);
    } else {
      checkText(block, block.width);
    }
    if (block.note && textNeeds(block.note) * 0.8 > block.width - 12) problems.push(`Note "${block.note}" does not fit block "${block.text}" (${block.pathLabel}).`);
  });
  if (rowCount > MAX_ROWS) problems.push(`The diagram has ${rowCount} rows; the maximum is ${MAX_ROWS} — split it into two diagrams.`);
  const bottom = layout.top + root.height;
  if (bottom > diagramAreaBottom()) {
    problems.push(`The block tree ends at y=${Math.round(bottom)} but the diagram area ends at ${diagramAreaBottom()} — set meta.viewBox[1] to at least ${Math.ceil(bottom + 96)} or reduce layout.rowHeight.`);
  }
  if (rootWidth < 320) problems.push(`Root width ${rootWidth}px is too narrow — increase meta.viewBox[0] or reduce layout.margin.`);
  if (problems.length) {
    throwDiagnosticProblems('Struktogramm layout validation failed', problems, { subject: { diagramType: 'struktogramm' } });
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

let stepCounter = 0;

function fillFor(block) {
  return (block.tone && toneClass[block.tone]) || kindClass[block.kind] || 'c-backend';
}

function focusAttrs(block) {
  if (!block.id) return 'data-detail="context"';
  const passport = { kind: block.kind, sublabel: block.note, context: i18nText(struktogramm.meta.locale, `legend.struktogramm.${legendKindFor(block.kind)}`) };
  return focusNodeAttrs(block.id, block.text, passport, struktogramm.meta.locale);
}

function rowText(block, x, y, width, height, opts = {}) {
  const cx = opts.anchor === 'start' ? x + 10 : x + width / 2;
  const anchor = opts.anchor || 'middle';
  const note = block.note
    ? `\n          <text data-detail="fine" x="${cx}" y="${y + height / 2 + 11}" class="t-dim" font-size="7" text-anchor="${anchor}">${esc(block.note)}</text>`
    : '';
  const dy = block.note ? -1 : 3.5;
  return `<text data-node-label="" x="${cx}" y="${y + height / 2 + dy}" class="t-primary" font-size="${PRIMARY_FONT}" font-weight="${opts.bold ? 600 : 500}" text-anchor="${anchor}">${esc(block.text)}</text>${note}`;
}

function frame(x, y, w, h, cls, step) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" class="${cls}" stroke-width="1.1"${animateAttr(struktogramm.meta, 'node', step)}/>`;
}

function renderBlock(block) {
  const step = stepCounter++;
  const { x, y, width: w, height: h } = block;
  const cls = fillFor(block);
  switch (block.kind) {
    case 'if': {
      const hd = block.header;
      const apexX = x + block.leftW;
      return `        <g ${focusAttrs(block)}>
          ${block.id ? focusNodeTitle(block.text, { kind: 'if' }) : ''}
          ${frame(x, y, w, hd, cls, step)}
          <line x1="${x}" y1="${y}" x2="${apexX}" y2="${y + hd}" class="${cls}" fill="none" stroke-width="1.1"/>
          <line x1="${x + w}" y1="${y}" x2="${apexX}" y2="${y + hd}" class="${cls}" fill="none" stroke-width="1.1"/>
          <text data-node-label="" x="${x + w / 2}" y="${y + hd * 0.42}" class="t-primary" font-size="${PRIMARY_FONT}" font-weight="600" text-anchor="middle">${esc(block.text)}</text>
          <text data-detail="context" x="${x + 8}" y="${y + hd - 6}" class="t-muted" font-size="8" font-weight="600">${esc(block.thenLabel || 'yes')}</text>
          <text data-detail="context" x="${x + w - 8}" y="${y + hd - 6}" class="t-muted" font-size="8" font-weight="600" text-anchor="end">${esc(block.elseLabel || 'no')}</text>
        </g>
${renderList(block.thenList)}
${renderList(block.elseList)}
${fillGaps(block)}`;
    }
    case 'case': {
      const hd = block.header;
      const lr = block.labelRow;
      const cols = block.columns.map((col, i) => `          <rect x="${col.x}" y="${y + hd}" width="${col.width}" height="${lr}" class="c-mask" stroke-width="1.1"/>
          <text data-detail="context" x="${col.x + col.width / 2}" y="${y + hd + lr / 2 + 3}" class="t-muted" font-size="8" font-weight="600" text-anchor="middle">${esc(col.label)}</text>${i > 0 ? `\n          <line x1="${col.x}" y1="${y}" x2="${col.x}" y2="${y + hd}" class="${cls}" fill="none" stroke-width="1.1" stroke-dasharray="2 3"/>` : ''}`).join('\n');
      return `        <g ${focusAttrs(block)}>
          ${block.id ? focusNodeTitle(block.text, { kind: 'case' }) : ''}
          ${frame(x, y, w, hd, cls, step)}
          <line x1="${x}" y1="${y}" x2="${x + w - Math.round(w / block.columns.length)}" y2="${y + hd}" class="${cls}" fill="none" stroke-width="1.1"/>
          <text data-node-label="" x="${x + w / 2}" y="${y + hd * 0.42}" class="t-primary" font-size="${PRIMARY_FONT}" font-weight="600" text-anchor="middle">${esc(block.text)}</text>
${cols}
        </g>
${block.columns.map((col) => renderList(col.list)).join('\n')}
${fillGaps(block)}`;
    }
    case 'while':
    case 'for': {
      const hd = block.header;
      return `        <g ${focusAttrs(block)}>
          ${block.id ? focusNodeTitle(block.text, { kind: block.kind }) : ''}
          ${frame(x, y, w, h, cls, step)}
          <rect x="${x}" y="${y}" width="${w}" height="${hd}" class="${cls}" stroke-width="1.1"/>
          ${rowText(block, x, y, w, hd, { anchor: 'start', bold: true })}
        </g>
${renderList(block.body)}`;
    }
    case 'until': {
      const ft = block.footer;
      return `        <g ${focusAttrs(block)}>
          ${block.id ? focusNodeTitle(block.text, { kind: 'until' }) : ''}
          ${frame(x, y, w, h, cls, step)}
          <rect x="${x}" y="${y + h - ft}" width="${w}" height="${ft}" class="${cls}" stroke-width="1.1"/>
          ${rowText(block, x, y + h - ft, w, ft, { anchor: 'start', bold: true })}
        </g>
${renderList(block.body)}`;
    }
    case 'call':
      return `        <g ${focusAttrs(block)}>
          ${block.id ? focusNodeTitle(block.text, { kind: 'call' }) : ''}
          ${frame(x, y, w, h, cls, step)}
          <line x1="${x + 8}" y1="${y}" x2="${x + 8}" y2="${y + h}" class="${cls}" fill="none" stroke-width="1.1"/>
          <line x1="${x + w - 8}" y1="${y}" x2="${x + w - 8}" y2="${y + h}" class="${cls}" fill="none" stroke-width="1.1"/>
          ${rowText(block, x, y, w, h)}
        </g>`;
    case 'io':
      return `        <g ${focusAttrs(block)}>
          ${block.id ? focusNodeTitle(block.text, { kind: 'io' }) : ''}
          ${frame(x, y, w, h, cls, step)}
          <rect x="${x}" y="${y}" width="5" height="${h}" class="${cls}" stroke-width="0"/>
          ${rowText(block, x + 5, y, w - 5, h)}
        </g>`;
    case 'exit':
      return `        <g ${focusAttrs(block)}>
          ${block.id ? focusNodeTitle(block.text, { kind: 'exit' }) : ''}
          ${frame(x, y, w, h, cls, step)}
          <polygon points="${x},${y} ${x + 14},${y + h / 2} ${x},${y + h}" class="c-mask" stroke-width="1.1"/>
          ${rowText(block, x + 14, y, w - 14, h)}
        </g>`;
    case 'statement':
    default:
      return `        <g ${focusAttrs(block)}>
          ${block.id ? focusNodeTitle(block.text, { kind: block.kind }) : ''}
          ${frame(x, y, w, h, cls, step)}
          ${rowText(block, x, y, w, h)}
        </g>`;
  }
}

// Columns of unequal height: the shorter branch gets a hatched filler so the
// outer frame stays a closed rectangle (DIN 66261 draws every branch to the
// same baseline).
function fillGaps(block) {
  const bottom = block.y + block.height;
  const fills = [];
  const cols = block.kind === 'if'
    ? [{ x: block.x, width: block.leftW, top: block.y + block.header + block.thenList.height }, { x: block.x + block.leftW, width: block.rightW, top: block.y + block.header + block.elseList.height }]
    : block.columns.map((c) => ({ x: c.x, width: c.width, top: block.y + block.header + block.labelRow + c.list.height }));
  for (const col of cols) {
    if (bottom - col.top > 0.5) fills.push(`        <rect data-detail="fine" x="${col.x}" y="${col.top}" width="${col.width}" height="${bottom - col.top}" class="c-grid" fill="url(#grid)" stroke-width="1.1"/>`);
  }
  return fills.join('\n');
}

function renderList(list) {
  return list.items.map(renderBlock).join('\n');
}

const LEGEND_CATALOG = ['statement', 'io', 'call', 'branch', 'loop', 'exit']
  .map((kind) => ({ kind, label: i18nText(struktogramm.meta.locale, `legend.struktogramm.${kind}`) }));
const legendSwatchClass = { statement: 'c-backend', io: 'c-cloud', call: 'c-frontend', branch: 'c-security', loop: 'c-database', exit: 'c-external' };

function renderLegend() {
  const present = new Set();
  walk(root, (block) => present.add(legendKindFor(block.kind)));
  const entries = resolveLegend(struktogramm.meta?.legend, LEGEND_CATALOG, present);
  return renderResolvedLegend({
    entries,
    locale: struktogramm.meta.locale,
    layout: { x: 40, baselineY: legendY(), width: viewBox[0] - 80, minTitleY: diagramAreaBottom() + 8, unfit: struktogramm.meta?.legend === undefined ? 'hide' : 'error', diagramType: 'struktogramm' },
    renderSwatch: (entry) => `<rect x="${entry.x}" y="${entry.baseline - 8}" width="14" height="9" rx="1.5" class="${legendSwatchClass[entry.kind] || 'c-external'}" stroke-width="1"/>`,
  });
}

function renderSvg() {
  return `      <svg viewBox="0 0 ${viewBox[0]} ${viewBox[1]}" ${svgRootAttrs(struktogramm.meta)}>
${svgAccessibleText(struktogramm.meta, 'struktogramm')}
${renderDefinitions()}

        <!-- Background Grid -->
        <rect width="100%" height="100%" fill="url(#grid)" />

        <!-- Outer frame -->
        <rect x="${rootX}" y="${layout.top}" width="${rootWidth}" height="${root.height}" class="c-mask" stroke-width="1.4"/>

        <!-- Blocks -->
${renderList(root)}

        <!-- Legend -->
${renderLegend()}
      </svg>`;
}

validateStruktogramm();
writeDiagram({
  outPath,
  template,
  diagramType: 'struktogramm',
  meta: struktogramm.meta,
  svg: renderSvg(),
  cards: struktogramm.cards,
});
