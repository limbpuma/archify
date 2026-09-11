import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, renderDefinitions, textUnits } from '../shared/utils.mjs';
import { animateAttr, focusNodeAttrs, focusNodeTitle, loadDiagramWithBrandMarks, writeDiagram, svgAccessibleText, svgRootAttrs } from '../shared/cli.mjs';
import { throwDiagnosticProblems } from '../shared/diagnostics.mjs';
import { translateMessage as i18nText } from '../shared/i18n.mjs';
import { asArray } from '../shared/geometry.mjs';
import { createGridGraph } from '../shared/grid-graph.mjs';

// Extended event-driven process chain (eEPK): events as hexagons, functions
// as rounded rectangles, XOR / ∧ / ∨ connectors as circles, organisational
// units and information objects attached to functions. The control flow
// alternates event → function → event; an event never decides (no XOR / OR
// split after an event). Every node sits on an explicit (col, row) grid; the
// renderer measures, validates and draws — no auto-layout.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { diagram, template, outPath } = await loadDiagramWithBrandMarks({
  rendererDir: __dirname,
  diagramType: 'epk',
  defaultExample: 'phone-order.epk.json'
});

const viewBox = diagram.meta?.viewBox || [1380, 820];
const grid = {
  colWidth: diagram.meta?.grid?.colWidth ?? 250,
  rowHeight: diagram.meta?.grid?.rowHeight ?? 60,
  originX: diagram.meta?.grid?.originX ?? 120,
  originY: diagram.meta?.grid?.originY ?? 100,
};

const SYMBOL_SIZE = {
  event: [150, 40],
  function: [150, 42],
  connector: [32, 32],
  org: [130, 36],
  info: [130, 34],
};
const HEXAGON_TIP = 12;
const TEXT_INSET = 8;
const NAME_UNIT_WIDTH = 6.2;
const SMALL_UNIT_WIDTH = 5.2;
const INNER_FACTOR = { event: 0.84, function: 0.9, org: 0.72, info: 0.86 };
const OPERATOR_TEXT = { xor: 'XOR', and: '∧', or: '∨' };

const KIND_CLASS = {
  event: 'c-security',
  function: 'c-backend',
  connector: 'c-external',
  org: 'c-frontend',
  info: 'c-cloud',
};
const KIND_TEXT = {
  event: 't-security',
  function: 't-backend',
  connector: 't-muted',
  org: 't-frontend',
  info: 't-cloud',
};
const FLOW_KINDS = new Set(['event', 'function', 'connector']);

function measureNode(node) {
  const [defaultW, defaultH] = SYMBOL_SIZE[node.kind] || SYMBOL_SIZE.function;
  const width = node.width || defaultW;
  const height = node.height || defaultH;
  const cx = grid.originX + node.col * grid.colWidth + (node.dx || 0);
  const cy = grid.originY + node.row * grid.rowHeight + (node.dy || 0);
  return { ...node, symbol: node.kind, label: node.label || OPERATOR_TEXT[node.operator] || '', width, height, x: cx - width / 2, y: cy - height / 2, cx, cy };
}

const graph = createGridGraph({
  diagram,
  diagramType: 'epk',
  relationCollection: 'edges',
  nodeCollection: 'nodes',
  viewBox,
  grid,
  symbolSize: SYMBOL_SIZE,
  defaultSymbol: 'function',
  measureNode,
});
const { nodes, edgeSteps, edgeName, relations: edges } = graph;

// Edge semantics follow the node kinds: control flow between flow nodes,
// assignment when an organisational unit is involved, information flow when
// an information object is involved.
function edgeKind(edge) {
  const from = nodes.get(edge.from);
  const to = nodes.get(edge.to);
  if (!from || !to) return 'control';
  if (from.kind === 'org' || to.kind === 'org') return 'assignment';
  if (from.kind === 'info' || to.kind === 'info') return 'information';
  return 'control';
}

// ---------------------------------------------------------------------------
// Validation: EPK grammar + text fit + shared geometry checks
// ---------------------------------------------------------------------------

function flowNeighbours(id, direction, outgoing, incoming) {
  // Flow nodes reached through connectors, so alternation is checked across joins and splits.
  const result = [];
  const seen = new Set();
  const stack = [...((direction === 'out' ? outgoing : incoming).get(id) || [])];
  while (stack.length) {
    const next = stack.pop();
    if (seen.has(next)) continue;
    seen.add(next);
    const node = nodes.get(next);
    if (!node) continue;
    if (node.kind === 'connector') stack.push(...((direction === 'out' ? outgoing : incoming).get(next) || []));
    else result.push(node);
  }
  return result;
}

function validateEpk() {
  const problems = [];
  const nodeList = asArray(diagram.nodes);
  if (nodes.size !== nodeList.length) problems.push('Node ids must be unique.');

  const outgoing = new Map();
  const incoming = new Map();
  for (const edge of edges) {
    const name = edgeName(edge);
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    if (!from) problems.push(`Edge "${name}" references unknown source "${edge.from}".`);
    if (!to) problems.push(`Edge "${name}" references unknown target "${edge.to}".`);
    if (edge.from === edge.to) problems.push(`Edge "${name}" loops onto itself.`);
    if (!from || !to) continue;
    const kind = edgeKind(edge);
    if (kind === 'control') {
      outgoing.set(edge.from, [...(outgoing.get(edge.from) || []), edge.to]);
      incoming.set(edge.to, [...(incoming.get(edge.to) || []), edge.from]);
    } else {
      const attached = from.kind === 'org' || from.kind === 'info' ? to : from;
      const satellite = attached === to ? from : to;
      if (attached.kind !== 'function') problems.push(`${satellite.kind === 'org' ? 'Organisational unit' : 'Information object'} "${satellite.id}" is attached to ${attached.kind} "${attached.id}" — attach it to a function.`);
      if (from.kind === 'org' && to.kind === 'org') problems.push(`Edge "${name}" links two organisational units.`);
    }
  }

  for (const node of nodes.values()) {
    const out = (outgoing.get(node.id) || []).length;
    const inn = (incoming.get(node.id) || []).length;
    switch (node.kind) {
      case 'event':
        if (inn > 1) problems.push(`Event "${node.id}" has ${inn} incoming control flows — join them with a connector first.`);
        if (out > 1) problems.push(`Event "${node.id}" has ${out} outgoing control flows — split with a connector.`);
        if (!inn && !out) problems.push(`Event "${node.id}" is isolated.`);
        if (!node.label) problems.push(`Event "${node.id}" needs a label.`);
        for (const next of flowNeighbours(node.id, 'out', outgoing, incoming)) {
          if (next.kind === 'event') problems.push(`Event "${node.id}" is followed by event "${next.id}" — a function must sit between two events.`);
        }
        break;
      case 'function':
        if (inn !== 1) problems.push(`Function "${node.id}" needs exactly one incoming control flow (has ${inn}).`);
        if (out !== 1) problems.push(`Function "${node.id}" needs exactly one outgoing control flow (has ${out}).`);
        if (!node.label) problems.push(`Function "${node.id}" needs a label.`);
        for (const next of flowNeighbours(node.id, 'out', outgoing, incoming)) {
          if (next.kind === 'function') problems.push(`Function "${node.id}" is followed by function "${next.id}" — an event must sit between two functions.`);
        }
        break;
      case 'connector': {
        if (!node.operator) problems.push(`Connector "${node.id}" needs an operator (xor, and, or).`);
        const isSplit = inn === 1 && out >= 2;
        const isJoin = inn >= 2 && out === 1;
        if (!isSplit && !isJoin) problems.push(`Connector "${node.id}" must be a split (1 in, ≥ 2 out) or a join (≥ 2 in, 1 out) — has ${inn} in, ${out} out.`);
        if (isSplit && node.operator !== 'and') {
          const sources = flowNeighbours(node.id, 'in', outgoing, incoming);
          if (sources.some((source) => source.kind === 'event')) problems.push(`${node.operator.toUpperCase()} split "${node.id}" follows an event — events cannot decide; put the split after a function.`);
        }
        break;
      }
      case 'org':
      case 'info':
        if (inn || out) problems.push(`${node.kind === 'org' ? 'Organisational unit' : 'Information object'} "${node.id}" takes part in the control flow — it may only be attached to a function.`);
        if (!edges.some((edge) => edge.from === node.id || edge.to === node.id)) problems.push(`${node.kind === 'org' ? 'Organisational unit' : 'Information object'} "${node.id}" is not attached to any function.`);
        if (!node.label) problems.push(`${node.kind} "${node.id}" needs a label.`);
        break;
      default:
        break;
    }
    if (node.kind !== 'connector' && node.label) {
      const available = (node.width - TEXT_INSET * 2) * (INNER_FACTOR[node.kind] || 0.9);
      const unitWidth = node.kind === 'org' || node.kind === 'info' ? SMALL_UNIT_WIDTH : NAME_UNIT_WIDTH;
      const labelWidth = textUnits(node.label) * unitWidth;
      if (labelWidth > available + 1) problems.push(`Label "${node.label}" (~${Math.round(labelWidth)}px) is wider than the ${Math.round(available)}px text area of ${node.kind} "${node.id}" — shorten it or increase width.`);
    }
  }

  const starts = [...nodes.values()].filter((node) => node.kind === 'event' && !(incoming.get(node.id) || []).length);
  const ends = [...nodes.values()].filter((node) => node.kind === 'event' && !(outgoing.get(node.id) || []).length);
  if (!starts.length) problems.push('An EPK starts with at least one event that has no incoming control flow.');
  if (!ends.length) problems.push('An EPK ends with at least one event that has no outgoing control flow.');
  for (const node of nodes.values()) {
    if (FLOW_KINDS.has(node.kind) && node.kind !== 'event' && !(incoming.get(node.id) || []).length) problems.push(`${node.kind} "${node.id}" has no incoming control flow.`);
  }

  problems.push(...graph.geometryProblems({ minGap: 10, minEdge: 12, obstacleKind: 'node' }));
  if (problems.length) {
    throwDiagnosticProblems('EPK validation failed', problems, { subject: { diagramType: 'epk' } });
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function nodeShape(node, cls, extraAttrs = '') {
  const { x, y, width: w, height: h, cx, cy } = node;
  switch (node.kind) {
    case 'event':
      return `<polygon points="${x + HEXAGON_TIP},${y} ${x + w - HEXAGON_TIP},${y} ${x + w},${cy} ${x + w - HEXAGON_TIP},${y + h} ${x + HEXAGON_TIP},${y + h} ${x},${cy}" class="${cls}"${extraAttrs}/>`;
    case 'connector':
      return `<circle cx="${cx}" cy="${cy}" r="${Math.min(w, h) / 2}" class="${cls}"${extraAttrs}/>`;
    case 'org':
      return `<ellipse cx="${cx}" cy="${cy}" rx="${w / 2}" ry="${h / 2}" class="${cls}"${extraAttrs}/>`
        + `<line x1="${x + 16}" y1="${cy - h / 2 + 6}" x2="${x + 16}" y2="${cy + h / 2 - 6}" class="${cls}" fill="none"/>`;
    case 'info':
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" class="${cls}"${extraAttrs}/>`;
    case 'function':
    default:
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="9" class="${cls}"${extraAttrs}/>`;
  }
}

function passportFor(node) {
  // Connectors report their operator as kind so the legend counts XOR / AND / OR separately.
  const legendKind = node.kind === 'connector' ? node.operator : node.kind;
  return { kind: legendKind, sublabel: node.sublabel, context: i18nText(diagram.meta.locale, `legend.epk.${legendKind}`) };
}

function renderNode(node) {
  const fill = KIND_CLASS[node.kind] || KIND_CLASS.function;
  const accent = KIND_TEXT[node.kind] || 't-muted';
  const isConnector = node.kind === 'connector';
  const small = node.kind === 'org' || node.kind === 'info';
  const fontSize = isConnector ? (node.operator === 'xor' ? 9 : 13) : small ? 9 : 10;
  const weight = small ? '500' : '700';
  const cls = isConnector ? accent : 't-primary';
  const labelX = node.kind === 'org' ? node.cx + 8 : node.cx;
  const hasSub = Boolean(node.sublabel) && !isConnector;
  const labelY = hasSub ? node.cy - 2 : node.cy + (isConnector && node.operator !== 'xor' ? 4.5 : 3.5);
  const sub = hasSub
    ? `\n          <text data-detail="context" x="${labelX}" y="${node.cy + 11}" class="${accent}" font-size="9" text-anchor="middle">${esc(node.sublabel)}</text>`
    : '';
  const title = node.label || OPERATOR_TEXT[node.operator] || node.kind;
  return `        <g ${focusNodeAttrs(node.id, title, passportFor(node), diagram.meta.locale)}>
          ${focusNodeTitle(title, passportFor(node))}
          ${nodeShape(node, 'c-mask')}
          ${nodeShape(node, fill, animateAttr(diagram.meta, 'node', edgeSteps.get(node.id)))}
          <text data-node-label=""${hasSub ? ' data-detail-anchor=""' : ''} x="${labelX}" y="${labelY}" class="${cls}" font-size="${fontSize}" font-weight="${weight}" text-anchor="middle">${esc(node.label)}</text>${sub}
        </g>`;
}

function renderEdge(edge, index) {
  const kind = edgeKind(edge);
  return graph.renderEdgePath(edge, index, {
    markerFor: (_, marker) => (kind === 'assignment' ? null : marker),
    extraAttrsFor: () => (kind === 'information' ? ' stroke-dasharray="5 4"' : ''),
  });
}

const LEGEND_KINDS = ['event', 'function', 'xor', 'and', 'or', 'org', 'info'];
const LEGEND_CATALOG = LEGEND_KINDS.map((kind) => ({ kind, label: i18nText(diagram.meta.locale, `legend.epk.${kind}`) }));

function legendSwatch(entry) {
  const x = entry.x;
  const y = entry.baseline - 8;
  const mid = y + 4.5;
  switch (entry.kind) {
    case 'event': return `<polygon points="${x + 3},${y} ${x + 11},${y} ${x + 14},${mid} ${x + 11},${y + 9} ${x + 3},${y + 9} ${x},${mid}" class="c-security" stroke-width="1"/>`;
    case 'function': return `<rect x="${x}" y="${y}" width="14" height="9" rx="3" class="c-backend" stroke-width="1"/>`;
    case 'xor':
    case 'and':
    case 'or': return `<circle cx="${x + 7}" cy="${mid}" r="4.5" class="c-external" stroke-width="1"/><text x="${x + 7}" y="${mid + 2.5}" class="t-muted" font-size="${entry.kind === 'xor' ? 4 : 6}" font-weight="700" text-anchor="middle">${OPERATOR_TEXT[entry.kind]}</text>`;
    case 'org': return `<ellipse cx="${x + 7}" cy="${mid}" rx="7" ry="4.5" class="c-frontend" stroke-width="1"/><line x1="${x + 2.5}" y1="${mid - 2.5}" x2="${x + 2.5}" y2="${mid + 2.5}" class="c-frontend" fill="none" stroke-width="1"/>`;
    case 'info': return `<rect x="${x}" y="${y}" width="14" height="9" class="c-cloud" stroke-width="1"/>`;
    default: return '';
  }
}

function renderSvg() {
  const presentKinds = new Set([...nodes.values()].map((node) => (node.kind === 'connector' ? node.operator : node.kind)));
  return `      <svg viewBox="0 0 ${viewBox[0]} ${viewBox[1]}" ${svgRootAttrs(diagram.meta)}>
${svgAccessibleText(diagram.meta, 'epk')}
${renderDefinitions()}

        <!-- Background Grid -->
        <rect width="100%" height="100%" fill="url(#grid)" />

        <!-- Groups -->
${graph.renderGroups()}

        <!-- Control, assignment and information flows -->
${edges.map(renderEdge).join('\n')}

        <!-- Events, functions, connectors, organisational units, information objects -->
${[...nodes.values()].map(renderNode).join('\n\n')}

        <!-- Flow labels -->
${edges.map((edge, index) => graph.renderEdgeLabel(edge, index)).join('\n')}

        <!-- Legend -->
${graph.renderLegend({ catalog: LEGEND_CATALOG, presentKinds, renderSwatch: legendSwatch })}
      </svg>`;
}

validateEpk();
writeDiagram({
  outPath,
  template,
  diagramType: 'epk',
  meta: diagram.meta,
  svg: renderSvg(),
  cards: diagram.cards,
});
