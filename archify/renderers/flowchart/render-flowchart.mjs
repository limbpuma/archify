import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, renderDefinitions, textUnits } from '../shared/utils.mjs';
import { animateAttr, focusEdgeAttrs, focusNodeAttrs, focusNodeTitle, loadDiagramWithBrandMarks, writeDiagram, svgAccessibleText, svgRootAttrs } from '../shared/cli.mjs';
import { throwDiagnosticProblems } from '../shared/diagnostics.mjs';
import { resolveLegend, renderLegend as renderResolvedLegend } from '../shared/legend.mjs';
import { availableNodeTextWidth, fittedNodeFontSize, minimumNodeTextWidth } from '../shared/text-fit.mjs';
import { brandMarkFor, brandMetadataFor, renderBrandMark } from '../shared/brand-marks.mjs';
import { translateMessage as i18nText } from '../shared/i18n.mjs';
import {
  asArray,
  isFinitePoint,
  rectsOverlap,
  cleanEndpointSideProblems,
  cleanFlowProblems,
  cleanCrossingProblems,
  cleanAmbiguousCorridorProblems,
  cleanBorderRunProblems,
  cleanRouteRhythmProblems,
  cleanLabelRouteClearanceProblems,
  suggestLabelObstacleFix,
  suggestLabelPairFix,
  anchor,
  automaticPortSpread,
  defaultFromSide,
  defaultToSide,
  chosenSide,
  roundedPath,
  routePointsValue,
  labelPoint,
  arrowClassMap,
  variantAccent
} from '../shared/geometry.mjs';

// DIN 66001 / ISO 5807 program flowchart. Nodes sit on an explicit (col, row)
// grid chosen by the author — no auto-layout, in line with the archify thesis
// that placement judgment is the product. The renderer measures, validates and
// draws; it never moves a symbol.

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

const nodeTextFit = { sublabelPreferred: 9, sublabelMinimum: 7, tagPreferred: 9, tagMinimum: 7 };

function legendY() {
  return viewBox[1] - 36;
}

function diagramAreaBottom() {
  return viewBox[1] - 96;
}

function measureNode(node) {
  const [defaultW, defaultH] = SYMBOL_SIZE[node.symbol] || SYMBOL_SIZE.process;
  const width = node.width || defaultW;
  const height = node.height || defaultH;
  const cx = grid.originX + node.col * grid.colWidth + (node.dx || 0);
  const cy = grid.originY + node.row * grid.rowHeight + (node.dy || 0);
  return { ...node, width, height, x: cx - width / 2, y: cy - height / 2, cx, cy };
}

const nodes = new Map(asArray(flowchart.nodes).map((node) => [node.id, measureNode(node)]));
const groups = asArray(flowchart.groups);
const edgeSteps = new Map();
for (const [index, edge] of asArray(flowchart.edges).entries()) {
  if (!edgeSteps.has(edge.from)) edgeSteps.set(edge.from, index);
  if (!edgeSteps.has(edge.to)) edgeSteps.set(edge.to, index + 1);
}

function groupFrame(group) {
  const members = group.nodes.map((id) => nodes.get(id)).filter(Boolean);
  if (!members.length) return null;
  const pad = group.padding ?? 22;
  const x = Math.min(...members.map((m) => m.x)) - pad;
  const y = Math.min(...members.map((m) => m.y)) - pad - 14;
  const right = Math.max(...members.map((m) => m.x + m.width)) + pad;
  const bottom = Math.max(...members.map((m) => m.y + m.height)) + pad;
  return { id: group.id, label: group.label, x, y, width: right - x, height: bottom - y };
}

const frames = groups.map(groupFrame).filter(Boolean);

// ---------------------------------------------------------------------------
// Routing (shared contract with lifecycle: auto / straight / drop / channels / via)
// ---------------------------------------------------------------------------

function routeVia(edge, from, to, start, end, fromSide, toSide) {
  if (edge.via) return edge.via;
  switch (edge.route || 'auto') {
    case 'straight':
      return [];
    case 'drop': {
      const y = edge.channelY ?? (start[1] + end[1]) / 2;
      return [[start[0], y], [end[0], y]];
    }
    case 'bottom-channel': {
      const y = edge.channelY ?? Math.max(from.y + from.height, to.y + to.height) + 30;
      return [[start[0], y], [end[0], y]];
    }
    case 'top-channel': {
      const y = edge.channelY ?? Math.min(from.y, to.y) - 26;
      return [[start[0], y], [end[0], y]];
    }
    case 'right-channel': {
      const x = edge.channelX ?? Math.max(from.x + from.width, to.x + to.width) + 34;
      return [[x, start[1]], [x, end[1]]];
    }
    case 'left-channel': {
      const x = edge.channelX ?? Math.min(from.x, to.x) - 34;
      return [[x, start[1]], [x, end[1]]];
    }
    case 'auto':
    default: {
      if (start[0] === end[0] || start[1] === end[1]) return [];
      const fromVertical = fromSide === 'top' || fromSide === 'bottom';
      const toVertical = toSide === 'top' || toSide === 'bottom';
      if (fromVertical !== toVertical) {
        return [fromVertical ? [start[0], end[1]] : [end[0], start[1]]];
      }
      if (fromVertical) {
        const y = edge.channelY ?? (start[1] + end[1]) / 2;
        return [[start[0], y], [end[0], y]];
      }
      const x = edge.channelX ?? (start[0] + end[0]) / 2;
      return [[x, start[1]], [x, end[1]]];
    }
  }
}

// Decision convention (DIN 66001 practice): the main "yes" continuation leaves
// the bottom vertex; a "no" branch leaves a side vertex toward its target.
function decisionDefaultSide(from, to) {
  if (to.cy > from.cy + from.height / 2 && Math.abs(to.cx - from.cx) < grid.colWidth / 2) return 'bottom';
  if (to.cx > from.cx) return 'right';
  if (to.cx < from.cx) return 'left';
  return 'bottom';
}

function edgeSides(edge) {
  const from = nodes.get(edge.from);
  const to = nodes.get(edge.to);
  const fromDefault = from.symbol === 'decision' ? decisionDefaultSide(from, to) : defaultFromSide(from, to);
  return {
    fromSide: chosenSide(edge.fromSide, fromDefault),
    toSide: chosenSide(edge.toSide, defaultToSide(from, to)),
  };
}

const automaticPorts = automaticPortSpread(flowchart.edges, nodes, {
  sideFor: (edge, endpoint) => edgeSides(edge)[endpoint === 'source' ? 'fromSide' : 'toSide'],
});

const pathCache = new Map();

function pathFor(edge) {
  if (pathCache.has(edge)) return pathCache.get(edge);
  const from = nodes.get(edge.from);
  const to = nodes.get(edge.to);
  const ports = automaticPorts.get(edge);
  const { fromSide, toSide } = edgeSides(edge);
  const start = ports?.from || anchor(from, fromSide);
  const end = ports?.to || anchor(to, toSide);
  let via = routeVia(edge, from, to, start, end, fromSide, toSide);
  if (ports && !via.length && Math.abs(start[0] - end[0]) >= 4 && Math.abs(start[1] - end[1]) >= 4) {
    const midX = (start[0] + end[0]) / 2;
    via = [[midX, start[1]], [midX, end[1]]];
  }
  const points = [start, ...via, end];
  const routed = { d: roundedPath(points, edge.cornerRadius ?? 8), points };
  pathCache.set(edge, routed);
  return routed;
}

function edgeName(edge) {
  return edge.label || `${edge.from}->${edge.to}`;
}

// ---------------------------------------------------------------------------
// Validation: structure (DIN semantics) + geometry (shared composition checks)
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
    if (!isFinitePoint(node.x, node.y, node.cx, node.cy)) {
      problems.push(`Node "${node.id}" produced non-finite coordinates — check col, row, dx, dy, width and height are numbers.`);
      continue;
    }
    if (node.x < 24 || node.x + node.width > viewBox[0] - 24) {
      problems.push(`Node "${node.id}" exceeds the horizontal bounds — reduce col/width, or increase meta.viewBox[0] (grid.colWidth ${grid.colWidth}).`);
    }
    if (node.y < 40 || node.y + node.height > diagramAreaBottom()) {
      problems.push(`Node "${node.id}" exceeds the vertical diagram area — keep y between 40 and ${diagramAreaBottom()} (reduce row or increase meta.viewBox[1]).`);
    }
    // Symbols with sloped or pointed sides lose inner text width: diamonds keep
    // roughly half, parallelograms lose the skew on both sides.
    const innerFactor = node.symbol === 'decision' ? 0.52 : node.symbol === 'io' ? 0.78 : node.symbol === 'subroutine' ? 0.82 : 0.9;
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

  const all = [...nodes.values()];
  for (let i = 0; i < all.length; i += 1) {
    for (let j = i + 1; j < all.length; j += 1) {
      if (rectsOverlap(all[i], all[j], 12)) {
        problems.push(`Nodes "${all[i].id}" and "${all[j].id}" are less than 12px apart — give them different col/row or adjust dx/dy.`);
      }
    }
  }

  for (const group of groups) {
    for (const id of group.nodes) {
      if (!nodes.has(id)) problems.push(`Group "${group.id}" references unknown node "${id}".`);
    }
  }

  for (const edge of asArray(flowchart.edges)) {
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) continue;
    const routed = pathFor(edge);
    const [start, end] = [routed.points[0], routed.points[routed.points.length - 1]];
    const distance = Math.hypot(end[0] - start[0], end[1] - start[1]);
    if (distance < 24) problems.push(`Edge "${edgeName(edge)}" is too short (${Math.round(distance)}px; minimum 24px) — move a node or choose other sides.`);
  }

  const endpointIds = new Set(nodes.keys());
  const common = { relations: flowchart.edges, endpointIds, pathFor, diagramType: 'flowchart', relationCollection: 'edges', profile: flowchart.meta?.quality_profile };
  problems.push(...cleanEndpointSideProblems({
    ...common,
    fromSideFor: (edge) => edgeSides(edge).fromSide,
    toSideFor: (edge) => edgeSides(edge).toSide,
    shouldCheckRelation: (edge) => !Array.isArray(edge.via),
    routeHint: 'keep automatic routing, or choose fromSide/toSide and via points whose first and final segments cross symbol borders perpendicularly',
  }));
  problems.push(...cleanFlowProblems({
    ...common,
    obstacles: nodes.values(),
    obstacleKind: 'node',
    routeHint: 'adjust fromSide/toSide, set route/via or channelX/channelY, or move the node with col/row/dx/dy'
  }));
  problems.push(...cleanCrossingProblems({ ...common, routeHint: 'adjust route/via or channelX/channelY so the edges use separate corridors' }));
  problems.push(...cleanAmbiguousCorridorProblems({ ...common, routeHint: 'adjust route/via or channelX/channelY so unrelated edges do not visually merge' }));
  problems.push(...cleanBorderRunProblems({ ...common, frames }));
  problems.push(...cleanRouteRhythmProblems({ ...common, routeHint: 'move route/via or channel coordinates so each turn has a readable run-up' }));

  const labelRects = [];
  for (const [edgeIndex, edge] of asArray(flowchart.edges).entries()) {
    if (!edge.label || !nodes.has(edge.from) || !nodes.has(edge.to)) continue;
    const [lx, ly] = labelPoint(edge, pathFor(edge).points);
    const longestLine = Math.max(textUnits(edge.label), textUnits(edge.note || ''));
    const width = Math.max(28, longestLine * 4.9 + 12);
    const height = edge.note ? 27 : 16;
    labelRects.push({ relation: edge, relationIndex: edgeIndex, label: edge.label, x: lx - width / 2, y: ly - 11, width, height, lx, ly });
  }
  for (const rect of labelRects) {
    for (const node of nodes.values()) {
      if (rectsOverlap(rect, node, -2)) {
        problems.push(`Label "${rect.label}" overlaps node "${node.id}" — adjust labelDx/labelDy/labelSegment or set labelAt.\n${suggestLabelObstacleFix(rect, rect.lx, rect.ly, node, 'node')}`);
      }
    }
  }
  for (let i = 0; i < labelRects.length; i += 1) {
    for (let j = i + 1; j < labelRects.length; j += 1) {
      if (rectsOverlap(labelRects[i], labelRects[j], -2)) {
        problems.push(`Labels "${labelRects[i].label}" and "${labelRects[j].label}" overlap — adjust labelDx/labelDy.\n${suggestLabelPairFix(labelRects[i], labelRects[j])}`);
      }
    }
  }
  problems.push(...cleanLabelRouteClearanceProblems({ ...common, labels: labelRects }));

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
  const labelFontSize = node.symbol === 'connector' ? 9 : fittedNodeFontSize(node.label, textWidth, 10, 8);
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

function renderEdgePath(edge, index) {
  const [cls, marker] = arrowClassMap[edge.variant || 'default'] || arrowClassMap.default;
  const routed = pathFor(edge);
  const strokeWidth = edge.width || (edge.variant === 'emphasis' ? 2 : 1.2);
  return `        <path ${focusEdgeAttrs(edge.from, edge.to, edge.label, index, edge.id)} data-composition-points="${routePointsValue(routed.points)}" d="${routed.d}" class="${cls}" fill="none" stroke-width="${strokeWidth}" marker-end="url(#${marker})"${animateAttr(flowchart.meta, 'edge', index)}/>`;
}

function renderEdgeLabel(edge, index) {
  if (!edge.label) return '';
  const routed = pathFor(edge);
  const [lx, ly] = labelPoint(edge, routed.points);
  const longestLine = Math.max(textUnits(edge.label), textUnits(edge.note || ''));
  const labelW = Math.max(28, longestLine * 4.9 + 12);
  const labelH = edge.note ? 27 : 16;
  const note = edge.note
    ? `\n          <text data-detail="fine" x="${lx}" y="${ly + 11}" class="t-dim" font-size="7" text-anchor="middle">${esc(edge.note)}</text>`
    : '';
  return `        <g data-detail="context" ${focusEdgeAttrs(edge.from, edge.to, edge.label, index, edge.id)}>
          <rect x="${lx - labelW / 2}" y="${ly - 11}" width="${labelW}" height="${labelH}" rx="4" class="c-mask"/>
          <text x="${lx}" y="${ly}" class="${variantAccent(edge.variant)}" font-size="8" font-weight="600" text-anchor="middle">${esc(edge.label)}</text>${note}
        </g>`;
}

function renderGroups() {
  return frames.map((frame) => `        <g data-detail="context">
          <rect x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" rx="10" class="c-region" stroke-dasharray="5 4" fill="none"/>
          <text x="${frame.x + 12}" y="${frame.y + 15}" class="t-muted" font-size="8" font-weight="700" letter-spacing="0.6">${esc(frame.label)}</text>
        </g>`).join('\n');
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

function renderLegend() {
  const presentKinds = new Set([...nodes.values()].map((node) => node.symbol));
  const entries = resolveLegend(flowchart.meta?.legend, LEGEND_CATALOG, presentKinds);
  return renderResolvedLegend({
    entries,
    locale: flowchart.meta.locale,
    layout: {
      x: 40,
      baselineY: legendY(),
      width: viewBox[0] - 80,
      minTitleY: diagramAreaBottom() + 8,
      unfit: flowchart.meta?.legend === undefined ? 'hide' : 'error',
      diagramType: 'flowchart',
    },
    renderSwatch: legendSwatch,
  });
}

function renderSvg() {
  return `      <svg viewBox="0 0 ${viewBox[0]} ${viewBox[1]}" ${svgRootAttrs(flowchart.meta)}>
${svgAccessibleText(flowchart.meta, 'flowchart')}
${renderDefinitions()}

        <!-- Background Grid -->
        <rect width="100%" height="100%" fill="url(#grid)" />

        <!-- Groups (phases) -->
${renderGroups()}

        <!-- Edges -->
${asArray(flowchart.edges).map(renderEdgePath).join('\n')}

        <!-- Symbols -->
${[...nodes.values()].map(renderNode).join('\n\n')}

        <!-- Edge labels -->
${asArray(flowchart.edges).map(renderEdgeLabel).join('\n')}

        <!-- Legend -->
${renderLegend()}
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
