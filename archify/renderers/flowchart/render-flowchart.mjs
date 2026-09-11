import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, renderDefinitions, textUnits } from '../shared/utils.mjs';
import { animateAttr, focusNodeAttrs, focusNodeTitle, loadDiagramWithBrandMarks, writeDiagram, svgAccessibleText, svgRootAttrs } from '../shared/cli.mjs';
import { throwDiagnosticProblems } from '../shared/diagnostics.mjs';
import { availableNodeTextWidth, fittedNodeFontSize, minimumNodeTextWidth } from '../shared/text-fit.mjs';
import { brandMarkFor, brandMetadataFor, renderBrandMark } from '../shared/brand-marks.mjs';
import { translateMessage as i18nText } from '../shared/i18n.mjs';
import { asArray } from '../shared/geometry.mjs';
import { createGridGraph } from '../shared/grid-graph.mjs';

// DIN 66001 / ISO 5807 program flowchart. Nodes sit on an explicit (col, row)
// grid chosen by the author — no auto-layout, in line with the archify thesis
// that placement judgment is the product. The renderer measures, validates and
// draws; it never moves a symbol. Grid measurement, routing, the shared
// composition checks and the edge/group/legend markup come from grid-graph.mjs.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { diagram: flowchart, template, outPath } = await loadDiagramWithBrandMarks({
  rendererDir: __dirname,
  diagramType: 'flowchart',
  defaultExample: 'order-call.flowchart.json'
});

const viewBox = flowchart.meta?.viewBox || [1120, 1200];
const grid = {
  colWidth: flowchart.meta?.grid?.colWidth ?? 176,
  rowHeight: flowchart.meta?.grid?.rowHeight ?? 88,
  originX: flowchart.meta?.grid?.originX ?? 96,
  originY: flowchart.meta?.grid?.originY ?? 84,
};

// Default symbol footprints (width, height). Decisions are square-ish so the
// diamond keeps its DIN proportions; connectors are small circles.
const SYMBOL_SIZE = {
  terminator: [128, 38],
  process: [148, 52],
  decision: [132, 64],
  io: [156, 52],
  subroutine: [156, 46],
  connector: [30, 30],
};

// Reuse the shared palette classes so every visual preset (classic, signal-flow,
// blueprint, editorial) styles flowchart symbols without template changes.
const symbolClass = {
  terminator: 'c-database',
  process: 'c-backend',
  decision: 'c-security',
  io: 'c-cloud',
  subroutine: 'c-frontend',
  connector: 'c-external',
};
const symbolText = {
  terminator: 't-database',
  process: 't-backend',
  decision: 't-security',
  io: 't-cloud',
  subroutine: 't-frontend',
  connector: 't-muted',
};

const nodeTextFit = { sublabelPreferred: 10, sublabelMinimum: 10, tagPreferred: 10, tagMinimum: 10 };
const primaryMinimumFontSize = 10;

// Decision convention (DIN 66001 practice): the main "yes" continuation leaves
// the bottom vertex; a "no" branch leaves a side vertex toward its target.
function decisionDefaultSide(from, to) {
  if (from.symbol !== 'decision') return null;
  if (to.cy > from.cy + from.height / 2 && Math.abs(to.cx - from.cx) < grid.colWidth / 2) return 'bottom';
  if (to.cx > from.cx) return 'right';
  if (to.cx < from.cx) return 'left';
  return 'bottom';
}

const graph = createGridGraph({
  diagram: flowchart,
  diagramType: 'flowchart',
  viewBox,
  grid,
  symbolSize: SYMBOL_SIZE,
  defaultSymbol: 'process',
  fromSideFor: decisionDefaultSide,
});
const { nodes, edgeSteps, edgeName } = graph;

// Symbols with sloped or pointed sides lose inner text width: diamonds keep
// roughly half, parallelograms lose the skew on both sides.
function validationInnerFactor(node) {
  return node.symbol === 'decision' ? 0.52 : node.symbol === 'io' ? 0.78 : node.symbol === 'subroutine' ? 0.82 : 0.9;
}

// ---------------------------------------------------------------------------
// Validation: structure (DIN semantics) + text fit + shared geometry checks
// ---------------------------------------------------------------------------

function validateFlowchart() {
  const problems = [];
  const nodeList = asArray(flowchart.nodes);
  if (nodes.size !== nodeList.length) problems.push('Node ids must be unique.');

  const outgoing = new Map();
  const incoming = new Map();
  for (const edge of asArray(flowchart.edges)) {
    outgoing.set(edge.from, (outgoing.get(edge.from) || 0) + 1);
    incoming.set(edge.to, (incoming.get(edge.to) || 0) + 1);
    if (!nodes.has(edge.from)) problems.push(`Edge "${edgeName(edge)}" references unknown source "${edge.from}".`);
    if (!nodes.has(edge.to)) problems.push(`Edge "${edgeName(edge)}" references unknown target "${edge.to}".`);
    if (edge.from === edge.to) problems.push(`Edge "${edgeName(edge)}" loops onto itself — route the loop through a process or connector node.`);
  }

  const terminators = nodeList.filter((node) => node.symbol === 'terminator');
  const starts = terminators.filter((node) => !incoming.has(node.id));
  const ends = terminators.filter((node) => !outgoing.has(node.id));
  if (!starts.length) problems.push('A flowchart needs at least one terminator with no incoming edge (the start).');
  if (!ends.length) problems.push('A flowchart needs at least one terminator with no outgoing edge (an end).');

  for (const node of nodes.values()) {
    const out = outgoing.get(node.id) || 0;
    const inn = incoming.get(node.id) || 0;
    if (node.symbol === 'decision') {
      if (out < 2) problems.push(`Decision "${node.id}" needs at least two outgoing edges (one per answer) — it has ${out}.`);
      for (const edge of asArray(flowchart.edges)) {
        if (edge.from === node.id && !edge.label) problems.push(`Edge leaving decision "${node.id}" toward "${edge.to}" needs a label (the answer, e.g. "Yes" / "No").`);
      }
    } else if (node.symbol === 'terminator') {
      if (out > 1) problems.push(`Terminator "${node.id}" has ${out} outgoing edges — a start has exactly one, an end has none.`);
      if (inn && out) problems.push(`Terminator "${node.id}" has both incoming and outgoing edges — use a process node for intermediate steps.`);
    } else if (node.symbol !== 'connector' && out > 1) {
      problems.push(`"${node.symbol}" node "${node.id}" has ${out} outgoing edges — only decisions branch; insert a decision or a connector.`);
    }
    if (node.symbol !== 'terminator' && !inn && !(node.symbol === 'connector' && out)) {
      problems.push(`Node "${node.id}" is unreachable — every non-start symbol needs an incoming edge.`);
    }
    const innerFactor = validationInnerFactor(node);
    const estLabelW = textUnits(node.label) * 6.2;
    if (node.symbol !== 'connector' && estLabelW > node.width * innerFactor + 6) {
      problems.push(`Label "${node.label}" (~${Math.round(estLabelW)}px) is wider than the text area of ${node.symbol} "${node.id}" (${Math.round(node.width * innerFactor)}px) — shorten the label or increase node.width.`);
    }
    const availableTextW = availableNodeTextWidth(node.width) * innerFactor;
    for (const [field, value, minimum] of [
      ['Sublabel', node.sublabel, nodeTextFit.sublabelMinimum],
      ['Tag', node.tag, nodeTextFit.tagMinimum],
    ]) {
      if (!value) continue;
      const minimumW = minimumNodeTextWidth(value, minimum);
      if (minimumW > availableTextW) {
        problems.push(`${field} "${value}" needs ~${Math.ceil(minimumW)}px at the ${minimum}px legible minimum, but node "${node.id}" provides ${Math.round(availableTextW)}px — shorten it or widen the node.`);
      }
    }
  }

  problems.push(...graph.geometryProblems({ minGap: 12, minEdge: 24, obstacleKind: 'node' }));

  if (problems.length) {
    throwDiagnosticProblems('Flowchart layout validation failed', problems, {
      subject: { diagramType: 'flowchart' },
    });
  }
}

// ---------------------------------------------------------------------------
// Rendering: DIN 66001 symbol shapes on the shared palette classes
// ---------------------------------------------------------------------------

function symbolShape(node, cls, extraAttrs = '') {
  const { x, y, width: w, height: h, cx, cy } = node;
  switch (node.symbol) {
    case 'terminator':
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" class="${cls}"${extraAttrs}/>`;
    case 'decision':
      return `<polygon points="${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}" class="${cls}"${extraAttrs}/>`;
    case 'io': {
      const skew = Math.min(18, h * 0.32);
      return `<polygon points="${x + skew},${y} ${x + w},${y} ${x + w - skew},${y + h} ${x},${y + h}" class="${cls}"${extraAttrs}/>`;
    }
    case 'subroutine':
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" class="${cls}"${extraAttrs}/>`
        + `<line x1="${x + 9}" y1="${y}" x2="${x + 9}" y2="${y + h}" class="${cls}" fill="none"/>`
        + `<line x1="${x + w - 9}" y1="${y}" x2="${x + w - 9}" y2="${y + h}" class="${cls}" fill="none"/>`;
    case 'connector':
      return `<circle cx="${cx}" cy="${cy}" r="${Math.min(w, h) / 2}" class="${cls}"${extraAttrs}/>`;
    case 'process':
    default:
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" class="${cls}"${extraAttrs}/>`;
  }
}

function renderNode(node) {
  const fill = symbolClass[node.symbol] || symbolClass.process;
  const accent = symbolText[node.symbol] || 't-muted';
  const innerFactor = node.symbol === 'decision' ? 0.52 : node.symbol === 'io' ? 0.78 : 0.9;
  const textWidth = node.width * innerFactor;
  const hasSub = node.sublabel != null && node.sublabel !== '' && node.symbol !== 'connector';
  const labelY = hasSub ? node.cy - 3 : node.cy + 3.5;
  const labelFontSize = node.symbol === 'connector' ? 9 : fittedNodeFontSize(node.label, textWidth, 10, primaryMinimumFontSize);
  const sub = hasSub
    ? `\n          <text data-detail="context" x="${node.cx}" y="${node.cy + 11}" class="t-muted" font-size="${fittedNodeFontSize(node.sublabel, textWidth, nodeTextFit.sublabelPreferred, nodeTextFit.sublabelMinimum)}" text-anchor="middle">${esc(node.sublabel)}</text>`
    : '';
  const tag = node.tag && node.symbol !== 'connector'
    ? `\n          <text data-detail="fine" x="${node.cx}" y="${node.y + node.height - 6}" class="${accent}" font-size="${fittedNodeFontSize(node.tag, textWidth, nodeTextFit.tagPreferred, nodeTextFit.tagMinimum)}" text-anchor="middle">${esc(node.tag)}</text>`
    : '';
  const hasBrand = Boolean(brandMarkFor(node));
  const step = node.step
    ? `\n          <text data-detail="fine" x="${node.x + (hasBrand ? 23 : 10)}" y="${node.y + 12}" class="${accent}" font-size="7" font-weight="700">${esc(node.step)}</text>`
    : '';
  const brand = renderBrandMark(node, { x: node.x + node.width - 22, y: node.y + 6 });
  const passport = {
    kind: node.symbol,
    sublabel: node.sublabel,
    tag: node.tag,
    context: i18nText(flowchart.meta.locale, `legend.flowchart.${node.symbol}`),
    ...brandMetadataFor(node),
  };
  return `        <g ${focusNodeAttrs(node.id, node.label, passport, flowchart.meta.locale)}>
          ${focusNodeTitle(node.label, passport)}
          ${symbolShape(node, 'c-mask')}
          ${symbolShape(node, fill, animateAttr(flowchart.meta, 'node', edgeSteps.get(node.id)))}${brand ? `\n          ${brand}` : ''}${step}
          <text data-node-label=""${hasSub ? ' data-detail-anchor=""' : ''} x="${node.cx}" y="${labelY}" class="t-primary" font-size="${labelFontSize}" font-weight="600" text-anchor="middle">${esc(node.label)}</text>${sub}${tag}
        </g>`;
}

const LEGEND_CATALOG = ['terminator', 'process', 'decision', 'io', 'subroutine', 'connector']
  .map((kind) => ({ kind, label: i18nText(flowchart.meta.locale, `legend.flowchart.${kind}`) }));

function legendSwatch(entry) {
  const cls = symbolClass[entry.kind] || 'c-external';
  const x = entry.x;
  const y = entry.baseline - 8;
  switch (entry.kind) {
    case 'terminator': return `<rect x="${x}" y="${y}" width="14" height="9" rx="4.5" class="${cls}" stroke-width="1"/>`;
    case 'decision': return `<polygon points="${x + 7},${y - 1} ${x + 15},${y + 4.5} ${x + 7},${y + 10} ${x - 1},${y + 4.5}" class="${cls}" stroke-width="1"/>`;
    case 'io': return `<polygon points="${x + 3},${y} ${x + 15},${y} ${x + 12},${y + 9} ${x},${y + 9}" class="${cls}" stroke-width="1"/>`;
    case 'subroutine': return `<rect x="${x}" y="${y}" width="14" height="9" rx="1" class="${cls}" stroke-width="1"/><line x1="${x + 2.5}" y1="${y}" x2="${x + 2.5}" y2="${y + 9}" class="${cls}" fill="none" stroke-width="1"/><line x1="${x + 11.5}" y1="${y}" x2="${x + 11.5}" y2="${y + 9}" class="${cls}" fill="none" stroke-width="1"/>`;
    case 'connector': return `<circle cx="${x + 7}" cy="${y + 4.5}" r="4.5" class="${cls}" stroke-width="1"/>`;
    default: return `<rect x="${x}" y="${y}" width="14" height="9" rx="1.5" class="${cls}" stroke-width="1"/>`;
  }
}

function renderSvg() {
  const presentKinds = new Set([...nodes.values()].map((node) => node.symbol));
  return `      <svg viewBox="0 0 ${viewBox[0]} ${viewBox[1]}" ${svgRootAttrs(flowchart.meta)}>
${svgAccessibleText(flowchart.meta, 'flowchart')}
${renderDefinitions()}

        <!-- Background Grid -->
        <rect width="100%" height="100%" fill="url(#grid)" />

        <!-- Groups (phases) -->
${graph.renderGroups()}

        <!-- Edges -->
${asArray(flowchart.edges).map((edge, index) => graph.renderEdgePath(edge, index)).join('\n')}

        <!-- Symbols -->
${[...nodes.values()].map(renderNode).join('\n\n')}

        <!-- Edge labels -->
${asArray(flowchart.edges).map((edge, index) => graph.renderEdgeLabel(edge, index)).join('\n')}

        <!-- Legend -->
${graph.renderLegend({ catalog: LEGEND_CATALOG, presentKinds, renderSwatch: legendSwatch })}
      </svg>`;
}

validateFlowchart();
writeDiagram({
  outPath,
  template,
  diagramType: 'flowchart',
  meta: flowchart.meta,
  svg: renderSvg(),
  cards: flowchart.cards,
});
