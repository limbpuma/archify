import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, renderDefinitions, textUnits } from '../shared/utils.mjs';
import { animateAttr, focusNodeAttrs, focusNodeTitle, loadDiagramWithBrandMarks, writeDiagram, svgAccessibleText, svgRootAttrs } from '../shared/cli.mjs';
import { throwDiagnosticProblems } from '../shared/diagnostics.mjs';
import { availableNodeTextWidth, fittedNodeFontSize, minimumNodeTextWidth } from '../shared/text-fit.mjs';
import { translateMessage as i18nText } from '../shared/i18n.mjs';
import { asArray } from '../shared/geometry.mjs';
import { createGridGraph } from '../shared/grid-graph.mjs';

// UML 2.5 activity diagram (Aktivitätsdiagramm): initial/final nodes, actions,
// decision/merge diamonds with guards on the outgoing flows, fork/join bars,
// object nodes and vertical swimlanes (partitions) defined by column ranges.
// Every node sits on an explicit (col, row) grid; the renderer measures,
// validates and draws — no auto-layout.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { diagram: authored, template, outPath } = await loadDiagramWithBrandMarks({
  rendererDir: __dirname,
  diagramType: 'activity',
  defaultExample: 'phone-order.activity.json'
});

// Guards are written as [condition]; authors may omit the brackets.
function guardLabel(label) {
  const text = String(label).trim();
  return text.startsWith('[') ? text : `[${text}]`;
}
const decisionIds = new Set(asArray(authored.nodes).filter((node) => node.kind === 'decision').map((node) => node.id));
const diagram = {
  ...authored,
  edges: asArray(authored.edges).map((edge) => (
    edge.label && decisionIds.has(edge.from) ? { ...edge, label: guardLabel(edge.label) } : edge
  )),
};

const viewBox = diagram.meta?.viewBox || [1380, 790];
const grid = {
  colWidth: diagram.meta?.grid?.colWidth ?? 230,
  rowHeight: diagram.meta?.grid?.rowHeight ?? 72,
  originX: diagram.meta?.grid?.originX ?? 140,
  originY: diagram.meta?.grid?.originY ?? 100,
};
const lanes = asArray(diagram.meta?.lanes);

const SYMBOL_SIZE = {
  initial: [20, 20],
  final: [26, 26],
  action: [150, 46],
  decision: [44, 44],
  merge: [44, 44],
  fork: [140, 6],
  join: [140, 6],
  object: [130, 40],
};
const LANE_TOP = 40;
const LANE_HEADER_HEIGHT = 24;
const LANE_CONTENT_TOP = LANE_TOP + LANE_HEADER_HEIGHT + 6;
const TEXT_INSET = 8;
const NAME_UNIT_WIDTH = 6.2;
const nodeTextFit = { sublabelPreferred: 9, sublabelMinimum: 9 };

const KIND_CLASS = {
  initial: 'c-external',
  final: 'c-external',
  action: 'c-backend',
  decision: 'c-security',
  merge: 'c-security',
  fork: 'c-external',
  join: 'c-external',
  object: 'c-cloud',
};
const BAR_KINDS = new Set(['fork', 'join']);
const CONTROL_KINDS = new Set(['initial', 'final', 'decision', 'merge', 'fork', 'join']);

function measureNode(node) {
  const [defaultW, defaultH] = SYMBOL_SIZE[node.kind] || SYMBOL_SIZE.action;
  const vertical = BAR_KINDS.has(node.kind) && node.orientation === 'vertical';
  const width = node.width || (vertical ? defaultH : defaultW);
  const height = node.height || (vertical ? defaultW : defaultH);
  const cx = grid.originX + node.col * grid.colWidth + (node.dx || 0);
  const cy = grid.originY + node.row * grid.rowHeight + (node.dy || 0);
  return { ...node, symbol: node.kind, label: node.label || '', width, height, x: cx - width / 2, y: cy - height / 2, cx, cy };
}

// Decision convention: the main continuation leaves the bottom vertex, a
// branch leaves the side vertex facing its target (same rule as flowchart).
function decisionDefaultSide(from, to) {
  if (from.kind !== 'decision') return null;
  if (to.cy > from.cy + from.height / 2 && Math.abs(to.cx - from.cx) < grid.colWidth / 2) return 'bottom';
  if (to.cx > from.cx) return 'right';
  if (to.cx < from.cx) return 'left';
  return 'bottom';
}

const graph = createGridGraph({
  diagram,
  diagramType: 'activity',
  relationCollection: 'edges',
  nodeCollection: 'nodes',
  viewBox,
  grid,
  symbolSize: SYMBOL_SIZE,
  defaultSymbol: 'action',
  measureNode,
  fromSideFor: decisionDefaultSide,
});
const { nodes, edgeSteps, edgeName, relations: edges } = graph;

function laneRect(lane) {
  const [c0, c1] = lane.cols;
  const x = grid.originX + Math.min(c0, c1) * grid.colWidth - grid.colWidth / 2;
  const right = grid.originX + Math.max(c0, c1) * grid.colWidth + grid.colWidth / 2;
  return { ...lane, x: Math.max(24, x), width: Math.min(viewBox[0] - 24, right) - Math.max(24, x), y: LANE_TOP, height: graph.diagramAreaBottom() - LANE_TOP };
}
const laneRects = lanes.map(laneRect);

// ---------------------------------------------------------------------------
// Validation: UML activity rules + lanes + text fit + shared geometry checks
// ---------------------------------------------------------------------------

function reachableFrom(startId) {
  const seen = new Set([startId]);
  const queue = [startId];
  while (queue.length) {
    const current = queue.shift();
    for (const edge of edges) {
      if (edge.from === current && nodes.has(edge.to) && !seen.has(edge.to)) {
        seen.add(edge.to);
        queue.push(edge.to);
      }
    }
  }
  return seen;
}

function validateActivity() {
  const problems = [];
  const nodeList = asArray(diagram.nodes);
  if (nodes.size !== nodeList.length) problems.push('Node ids must be unique.');

  const outgoing = new Map();
  const incoming = new Map();
  for (const edge of edges) {
    outgoing.set(edge.from, [...(outgoing.get(edge.from) || []), edge]);
    incoming.set(edge.to, [...(incoming.get(edge.to) || []), edge]);
    if (!nodes.has(edge.from)) problems.push(`Edge "${edgeName(edge)}" references unknown source "${edge.from}".`);
    if (!nodes.has(edge.to)) problems.push(`Edge "${edgeName(edge)}" references unknown target "${edge.to}".`);
    if (edge.from === edge.to) problems.push(`Edge "${edgeName(edge)}" loops onto itself — route loops through a merge node.`);
  }

  const initials = nodeList.filter((node) => node.kind === 'initial');
  const finals = nodeList.filter((node) => node.kind === 'final');
  if (initials.length !== 1) problems.push(`An activity has exactly one initial node — found ${initials.length}.`);
  if (!finals.length) problems.push('An activity needs at least one final node.');

  for (const node of nodes.values()) {
    const out = (outgoing.get(node.id) || []).length;
    const inn = (incoming.get(node.id) || []).length;
    switch (node.kind) {
      case 'initial':
        if (inn) problems.push(`Initial node "${node.id}" has incoming flows.`);
        if (out !== 1) problems.push(`Initial node "${node.id}" needs exactly one outgoing flow (has ${out}).`);
        break;
      case 'final':
        if (out) problems.push(`Final node "${node.id}" has outgoing flows.`);
        if (!inn) problems.push(`Final node "${node.id}" is never reached.`);
        break;
      case 'decision':
        if (inn !== 1) problems.push(`Decision "${node.id}" needs exactly one incoming flow (has ${inn}); merge flows first.`);
        if (out < 2) problems.push(`Decision "${node.id}" needs at least two outgoing flows (has ${out}).`);
        for (const edge of outgoing.get(node.id) || []) {
          if (!edge.label) problems.push(`Flow leaving decision "${node.id}" toward "${edge.to}" needs a guard label, e.g. "[yes]".`);
        }
        break;
      case 'merge':
        if (inn < 2) problems.push(`Merge "${node.id}" needs at least two incoming flows (has ${inn}).`);
        if (out !== 1) problems.push(`Merge "${node.id}" needs exactly one outgoing flow (has ${out}).`);
        break;
      case 'fork':
        if (inn !== 1) problems.push(`Fork "${node.id}" needs exactly one incoming flow (has ${inn}).`);
        if (out < 2) problems.push(`Fork "${node.id}" needs at least two outgoing flows (has ${out}).`);
        break;
      case 'join':
        if (inn < 2) problems.push(`Join "${node.id}" needs at least two incoming flows (has ${inn}).`);
        if (out !== 1) problems.push(`Join "${node.id}" needs exactly one outgoing flow (has ${out}).`);
        break;
      case 'action':
      case 'object':
      default:
        if (!inn) problems.push(`${node.kind === 'object' ? 'Object' : 'Action'} "${node.id}" has no incoming flow.`);
        if (out !== 1) problems.push(`${node.kind === 'object' ? 'Object' : 'Action'} "${node.id}" needs exactly one outgoing flow (has ${out}) — branch with a decision, split with a fork.`);
        if (!node.label) problems.push(`${node.kind} "${node.id}" needs a label.`);
        break;
    }
    if (node.label && !CONTROL_KINDS.has(node.kind)) {
      const factor = node.kind === 'object' ? 0.9 : 0.9;
      const available = (node.width - TEXT_INSET * 2) * factor;
      const labelWidth = textUnits(node.label) * NAME_UNIT_WIDTH;
      if (labelWidth > available + 1) problems.push(`Label "${node.label}" (~${Math.round(labelWidth)}px) is wider than the ${Math.round(available)}px text area of ${node.kind} "${node.id}" — shorten it or increase width.`);
      if (node.sublabel && minimumNodeTextWidth(node.sublabel, nodeTextFit.sublabelMinimum) > availableNodeTextWidth(node.width) * factor) {
        problems.push(`Sublabel "${node.sublabel}" does not fit ${node.kind} "${node.id}" at ${nodeTextFit.sublabelMinimum}px.`);
      }
    }
    if (laneRects.length) {
      const owners = laneRects.filter((lane) => node.x >= lane.x && node.x + node.width <= lane.x + lane.width);
      if (owners.length !== 1) problems.push(`Node "${node.id}" is not inside exactly one swimlane (${owners.length} match) — keep each node within one lane's columns.`);
      if (node.y < LANE_CONTENT_TOP) problems.push(`Node "${node.id}" overlaps the swimlane header — keep y ≥ ${LANE_CONTENT_TOP}.`);
    }
  }

  if (initials.length === 1) {
    const reachable = reachableFrom(initials[0].id);
    for (const node of nodes.values()) {
      if (!reachable.has(node.id)) problems.push(`Node "${node.id}" is unreachable from the initial node.`);
    }
  }

  problems.push(...graph.geometryProblems({ minGap: 12, minEdge: 20, obstacleKind: 'node' }));
  if (problems.length) {
    throwDiagnosticProblems('Activity diagram validation failed', problems, { subject: { diagramType: 'activity' } });
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function nodeShape(node, cls, extraAttrs = '') {
  const { x, y, width: w, height: h, cx, cy } = node;
  switch (node.kind) {
    case 'initial':
      return `<circle cx="${cx}" cy="${cy}" r="${w / 2}" class="${cls}" style="fill:var(--arrow)"${extraAttrs}/>`;
    case 'final':
      return `<circle cx="${cx}" cy="${cy}" r="${w / 2}" class="${cls}"${extraAttrs}/>`
        + `<circle cx="${cx}" cy="${cy}" r="${w / 2 - 5}" class="${cls}" style="fill:var(--arrow)"/>`;
    case 'decision':
    case 'merge':
      return `<polygon points="${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}" class="${cls}"${extraAttrs}/>`;
    case 'fork':
    case 'join':
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" class="${cls}" style="fill:var(--arrow)"${extraAttrs}/>`;
    case 'object':
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" class="${cls}"${extraAttrs}/>`;
    case 'action':
    default:
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.min(14, h / 2)}" class="${cls}"${extraAttrs}/>`;
  }
}

function passportFor(node) {
  return { kind: node.kind, sublabel: node.sublabel, context: i18nText(diagram.meta.locale, `legend.activity.${node.kind}`) };
}

function renderNode(node) {
  const fill = KIND_CLASS[node.kind] || KIND_CLASS.action;
  const title = node.label || i18nText(diagram.meta.locale, `legend.activity.${node.kind}`);
  const hasSub = Boolean(node.sublabel) && !CONTROL_KINDS.has(node.kind);
  let text = '';
  if (node.label && !CONTROL_KINDS.has(node.kind)) {
    const textWidth = (node.width - TEXT_INSET * 2) * 0.9;
    const labelY = hasSub ? node.cy - 2 : node.cy + 3.5;
    const sub = hasSub
      ? `\n          <text data-detail="context" x="${node.cx}" y="${node.cy + 11}" class="t-muted" font-size="${fittedNodeFontSize(node.sublabel, textWidth, nodeTextFit.sublabelPreferred, nodeTextFit.sublabelMinimum)}" text-anchor="middle">${esc(node.sublabel)}</text>`
      : '';
    text = `\n          <text data-node-label=""${hasSub ? ' data-detail-anchor=""' : ''} x="${node.cx}" y="${labelY}" class="t-primary" font-size="10" font-weight="600" text-anchor="middle">${esc(node.label)}</text>${sub}`;
  } else if (node.label && (node.kind === 'decision' || node.kind === 'merge')) {
    // A decision question sits beside the diamond, out of the way of its flows.
    text = `\n          <text data-node-label="" data-detail="context" x="${node.x - 6}" y="${node.cy + 3.5}" class="t-muted" font-size="9" font-weight="600" text-anchor="end">${esc(node.label)}</text>`;
  }
  return `        <g ${focusNodeAttrs(node.id, title, passportFor(node), diagram.meta.locale)}>
          ${focusNodeTitle(title, passportFor(node))}
          ${nodeShape(node, 'c-mask')}
          ${nodeShape(node, fill, animateAttr(diagram.meta, 'node', edgeSteps.get(node.id)))}${text}
        </g>`;
}

function renderLanes() {
  if (!laneRects.length) return '';
  return laneRects.map((lane) => `        <g data-detail="context" data-lane="${esc(lane.id)}">
          <rect x="${lane.x}" y="${lane.y}" width="${lane.width}" height="${lane.height}" class="c-region" style="stroke-dasharray:none" fill="none"/>
          <rect x="${lane.x}" y="${lane.y}" width="${lane.width}" height="${LANE_HEADER_HEIGHT}" class="c-region" style="stroke-dasharray:none"/>
          <text x="${lane.x + lane.width / 2}" y="${lane.y + 16}" class="t-muted" font-size="9" font-weight="700" letter-spacing="0.6" text-anchor="middle">${esc(lane.label)}</text>
        </g>`).join('\n');
}

const LEGEND_KINDS = ['initial', 'final', 'action', 'decision', 'merge', 'fork', 'join', 'object', 'lane'];
const LEGEND_CATALOG = LEGEND_KINDS.map((kind) => ({ kind, label: i18nText(diagram.meta.locale, `legend.activity.${kind}`) }));

function legendSwatch(entry) {
  const x = entry.x;
  const y = entry.baseline - 8;
  const mid = y + 4.5;
  switch (entry.kind) {
    case 'initial': return `<circle cx="${x + 7}" cy="${mid}" r="4" class="c-external" style="fill:var(--arrow)" stroke-width="1"/>`;
    case 'final': return `<circle cx="${x + 7}" cy="${mid}" r="4.5" class="c-external" stroke-width="1"/><circle cx="${x + 7}" cy="${mid}" r="2.5" class="c-external" style="fill:var(--arrow)" stroke-width="1"/>`;
    case 'decision':
    case 'merge': return `<polygon points="${x + 7},${y - 1} ${x + 15},${mid} ${x + 7},${y + 10} ${x - 1},${mid}" class="c-security" stroke-width="1"/>`;
    case 'fork':
    case 'join': return `<rect x="${x}" y="${mid - 1.5}" width="14" height="3" class="c-external" style="fill:var(--arrow)" stroke-width="1"/>`;
    case 'object': return `<rect x="${x}" y="${y}" width="14" height="9" class="c-cloud" stroke-width="1"/>`;
    case 'lane': return `<rect x="${x}" y="${y}" width="14" height="9" class="c-region" style="stroke-dasharray:none" fill="none" stroke-width="1"/><rect x="${x}" y="${y}" width="14" height="3" class="c-region" style="stroke-dasharray:none" stroke-width="1"/>`;
    default: return `<rect x="${x}" y="${y}" width="14" height="9" rx="3" class="c-backend" stroke-width="1"/>`;
  }
}

function renderSvg() {
  const presentKinds = new Set([...[...nodes.values()].map((node) => node.kind), ...(laneRects.length ? ['lane'] : [])]);
  return `      <svg viewBox="0 0 ${viewBox[0]} ${viewBox[1]}" ${svgRootAttrs(diagram.meta)}>
${svgAccessibleText(diagram.meta, 'activity')}
${renderDefinitions()}

        <!-- Background Grid -->
        <rect width="100%" height="100%" fill="url(#grid)" />

        <!-- Swimlanes -->
${renderLanes()}

        <!-- Groups -->
${graph.renderGroups()}

        <!-- Control flows -->
${edges.map((edge, index) => graph.renderEdgePath(edge, index)).join('\n')}

        <!-- Nodes -->
${[...nodes.values()].map(renderNode).join('\n\n')}

        <!-- Guards and flow labels -->
${edges.map((edge, index) => graph.renderEdgeLabel(edge, index)).join('\n')}

        <!-- Legend -->
${graph.renderLegend({ catalog: LEGEND_CATALOG, presentKinds, renderSwatch: legendSwatch })}
      </svg>`;
}

validateActivity();
writeDiagram({
  outPath,
  template,
  diagramType: 'activity',
  meta: diagram.meta,
  svg: renderSvg(),
  cards: diagram.cards,
});
