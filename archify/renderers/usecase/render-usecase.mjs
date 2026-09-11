import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, renderDefinitions, textUnits } from '../shared/utils.mjs';
import { animateAttr, focusNodeAttrs, focusNodeTitle, loadDiagramWithBrandMarks, writeDiagram, svgAccessibleText, svgRootAttrs } from '../shared/cli.mjs';
import { throwDiagnosticProblems } from '../shared/diagnostics.mjs';
import { translateMessage as i18nText } from '../shared/i18n.mjs';
import { asArray } from '../shared/geometry.mjs';
import { createGridGraph } from '../shared/grid-graph.mjs';
import { renderUmlMarkers } from '../shared/uml-markers.mjs';

// UML 2.5 use case diagram (Anwendungsfalldiagramm): stick-figure actors
// outside a system boundary, use-case ellipses inside it, associations as
// plain lines, «include»/«extend» as dashed open arrows, generalization as a
// hollow triangle. Every node sits on an explicit (col, row) grid; groups
// draw the system boundaries. The renderer measures, validates and draws.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { diagram: authored, template, outPath } = await loadDiagramWithBrandMarks({
  rendererDir: __dirname,
  diagramType: 'usecase',
  defaultExample: 'phone-ordering.usecase.json'
});

const STEREOTYPE_LABEL = { include: '«include»', extend: '«extend»' };
// Include/extend arrows carry their stereotype as the edge label unless the
// author wrote one; a plain association stays unlabeled.
const diagram = {
  ...authored,
  relations: asArray(authored.relations).map((relation) => (
    relation.label || !STEREOTYPE_LABEL[relation.kind] ? relation : { ...relation, label: STEREOTYPE_LABEL[relation.kind] }
  )),
};

const viewBox = diagram.meta?.viewBox || [1380, 620];
const grid = {
  colWidth: diagram.meta?.grid?.colWidth ?? 200,
  rowHeight: diagram.meta?.grid?.rowHeight ?? 96,
  originX: diagram.meta?.grid?.originX ?? 100,
  originY: diagram.meta?.grid?.originY ?? 96,
};

const SYMBOL_SIZE = {
  actor: [60, 72],
  usecase: [150, 50],
};
const ACTOR_FIGURE_HEIGHT = 54;
const ACTOR_LABEL_FONT = 10;
const USECASE_INNER_FACTOR = 0.8;
const NAME_UNIT_WIDTH = 6.2;
const SUBLABEL_UNIT_WIDTH = 5.2;
const TEXT_INSET = 8;

const KIND_CLASS = { actor: 'c-frontend', usecase: 'c-backend' };
const KIND_TEXT = { actor: 't-frontend', usecase: 't-backend' };

const RELATION_STYLE = {
  association: { marker: null, dashed: false },
  include: { marker: 'uml-open-arrow', dashed: true },
  extend: { marker: 'uml-open-arrow', dashed: true },
  generalization: { marker: 'uml-triangle', dashed: false },
};

function measureNode(node) {
  const [defaultW, defaultH] = SYMBOL_SIZE[node.kind] || SYMBOL_SIZE.usecase;
  const labelWidth = textUnits(node.label) * NAME_UNIT_WIDTH;
  // Actor labels sit under the figure and may be wider than the figure itself.
  const width = node.width || (node.kind === 'actor' ? Math.max(defaultW, Math.ceil(labelWidth) + TEXT_INSET) : defaultW);
  const height = node.height || defaultH;
  const cx = grid.originX + node.col * grid.colWidth + (node.dx || 0);
  const cy = grid.originY + node.row * grid.rowHeight + (node.dy || 0);
  return { ...node, symbol: node.kind, width, height, x: cx - width / 2, y: cy - height / 2, cx, cy };
}

const graph = createGridGraph({
  diagram,
  diagramType: 'usecase',
  relationCollection: 'relations',
  nodeCollection: 'nodes',
  viewBox,
  grid,
  symbolSize: SYMBOL_SIZE,
  defaultSymbol: 'usecase',
  measureNode,
});
const { nodes, edgeSteps, edgeName, relations, groups, frames } = graph;

// ---------------------------------------------------------------------------
// Validation: UML use-case rules + text fit + shared geometry checks
// ---------------------------------------------------------------------------

function validateUseCase() {
  const problems = [];
  const nodeList = asArray(diagram.nodes);
  if (nodes.size !== nodeList.length) problems.push('Node ids must be unique.');

  const boundaryOf = new Map();
  for (const group of groups) {
    for (const id of group.nodes) {
      if (boundaryOf.has(id)) problems.push(`Node "${id}" is inside two system boundaries ("${boundaryOf.get(id)}" and "${group.id}").`);
      boundaryOf.set(id, group.id);
    }
  }

  const associated = new Set();
  const linked = new Set();
  for (const relation of relations) {
    const name = edgeName(relation);
    const from = nodes.get(relation.from);
    const to = nodes.get(relation.to);
    if (!from) problems.push(`Relation "${name}" references unknown source "${relation.from}".`);
    if (!to) problems.push(`Relation "${name}" references unknown target "${relation.to}".`);
    if (relation.from === relation.to) problems.push(`Relation "${name}" is a self-relation.`);
    if (!from || !to) continue;
    linked.add(relation.from);
    linked.add(relation.to);
    switch (relation.kind) {
      case 'association':
        if (from.kind === to.kind) problems.push(`Association "${name}" links two ${from.kind}s — an association joins an actor and a use case.`);
        associated.add(relation.from);
        associated.add(relation.to);
        break;
      case 'include':
      case 'extend':
        if (from.kind !== 'usecase' || to.kind !== 'usecase') problems.push(`«${relation.kind}» "${name}" must link two use cases (${from.kind} → ${to.kind}).`);
        break;
      case 'generalization':
        if (from.kind !== to.kind) problems.push(`Generalization "${name}" must link two nodes of the same kind (${from.kind} → ${to.kind}).`);
        break;
      default:
        break;
    }
  }

  for (const node of nodes.values()) {
    if (!linked.has(node.id)) problems.push(`${node.kind === 'actor' ? 'Actor' : 'Use case'} "${node.id}" is isolated — connect it.`);
    if (node.kind === 'actor' && boundaryOf.has(node.id)) problems.push(`Actor "${node.id}" is inside system boundary "${boundaryOf.get(node.id)}" — actors stand outside the system.`);
    if (node.kind === 'usecase' && groups.length && !boundaryOf.has(node.id)) problems.push(`Use case "${node.id}" is outside every system boundary — add it to a group.`);
    if (node.kind === 'actor' && !associated.has(node.id)) problems.push(`Actor "${node.id}" has no association — an actor must take part in at least one use case.`);
    const labelWidth = textUnits(node.label) * NAME_UNIT_WIDTH;
    const available = node.kind === 'usecase' ? (node.width - TEXT_INSET * 2) * USECASE_INNER_FACTOR : node.width;
    if (labelWidth > available + 1) problems.push(`Label "${node.label}" (~${Math.round(labelWidth)}px) is wider than the ${Math.round(available)}px text area of ${node.kind} "${node.id}" — shorten it or increase width.`);
    if (node.sublabel && node.kind === 'usecase' && textUnits(node.sublabel) * SUBLABEL_UNIT_WIDTH > available) problems.push(`Sublabel "${node.sublabel}" does not fit use case "${node.id}".`);
  }

  problems.push(...graph.geometryProblems({ minGap: 12, minEdge: 24, obstacleKind: 'node' }));
  if (problems.length) {
    throwDiagnosticProblems('Use case diagram validation failed', problems, { subject: { diagramType: 'usecase' } });
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function actorFigure(node, cls, extraAttrs = '') {
  const { cx, y } = node;
  const head = `<circle cx="${cx}" cy="${y + 9}" r="8" class="${cls}"${extraAttrs}/>`;
  const stroke = `class="${cls}" fill="none" stroke-width="1.6" stroke-linecap="round"`;
  return head
    + `<line x1="${cx}" y1="${y + 17}" x2="${cx}" y2="${y + 36}" ${stroke}/>`
    + `<line x1="${cx - 13}" y1="${y + 24}" x2="${cx + 13}" y2="${y + 24}" ${stroke}/>`
    + `<line x1="${cx}" y1="${y + 36}" x2="${cx - 11}" y2="${y + ACTOR_FIGURE_HEIGHT}" ${stroke}/>`
    + `<line x1="${cx}" y1="${y + 36}" x2="${cx + 11}" y2="${y + ACTOR_FIGURE_HEIGHT}" ${stroke}/>`;
}

function passportFor(node) {
  return {
    kind: node.kind,
    sublabel: node.sublabel || (node.secondary ? i18nText(diagram.meta.locale, 'usecase.secondary') : undefined),
    context: i18nText(diagram.meta.locale, `legend.usecase.${node.kind}`),
  };
}

function renderActor(node) {
  const fill = KIND_CLASS.actor;
  const secondary = node.secondary ? ' stroke-dasharray="3 2"' : '';
  return `        <g ${focusNodeAttrs(node.id, node.label, passportFor(node), diagram.meta.locale)}>
          ${focusNodeTitle(node.label, passportFor(node))}
          <rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" class="c-mask" opacity="0"/>
          ${actorFigure(node, fill, animateAttr(diagram.meta, 'node', edgeSteps.get(node.id)) + secondary)}
          <text data-node-label="" x="${node.cx}" y="${node.y + node.height - 4}" class="t-primary" font-size="${ACTOR_LABEL_FONT}" font-weight="600" text-anchor="middle">${esc(node.label)}</text>
        </g>`;
}

function renderUseCase(node) {
  const fill = KIND_CLASS.usecase;
  const hasSub = Boolean(node.sublabel);
  const labelY = hasSub ? node.cy - 2 : node.cy + 3.5;
  const sub = hasSub
    ? `\n          <text data-detail="context" x="${node.cx}" y="${node.cy + 11}" class="${KIND_TEXT.usecase}" font-size="9" text-anchor="middle">${esc(node.sublabel)}</text>`
    : '';
  return `        <g ${focusNodeAttrs(node.id, node.label, passportFor(node), diagram.meta.locale)}>
          ${focusNodeTitle(node.label, passportFor(node))}
          <ellipse cx="${node.cx}" cy="${node.cy}" rx="${node.width / 2}" ry="${node.height / 2}" class="c-mask"/>
          <ellipse cx="${node.cx}" cy="${node.cy}" rx="${node.width / 2}" ry="${node.height / 2}" class="${fill}"${animateAttr(diagram.meta, 'node', edgeSteps.get(node.id))}/>
          <text data-node-label=""${hasSub ? ' data-detail-anchor=""' : ''} x="${node.cx}" y="${labelY}" class="t-primary" font-size="10" font-weight="600" text-anchor="middle">${esc(node.label)}</text>${sub}
        </g>`;
}

function renderNode(node) {
  return node.kind === 'actor' ? renderActor(node) : renderUseCase(node);
}

// System boundaries are solid rectangles with the system name in the top-left
// corner (UML), not the dashed reading-guide frames other types use.
function renderBoundaries() {
  return frames.map((frame) => `        <g data-detail="context">
          <rect x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" rx="4" class="c-region" style="stroke-dasharray:none" fill="none"/>
          <text x="${frame.x + 12}" y="${frame.y + 15}" class="t-muted" font-size="9" font-weight="700" letter-spacing="0.6">${esc(frame.label)}</text>
        </g>`).join('\n');
}

function renderRelationPath(relation, index) {
  const style = RELATION_STYLE[relation.kind];
  return graph.renderEdgePath(relation, index, {
    markerFor: () => style.marker,
    extraAttrsFor: () => (style.dashed ? ' stroke-dasharray="6 4"' : ''),
  });
}

const LEGEND_KINDS = ['actor', 'usecase', 'system', 'association', 'include', 'extend', 'generalization'];
const LEGEND_CATALOG = LEGEND_KINDS.map((kind) => ({ kind, label: i18nText(diagram.meta.locale, `legend.usecase.${kind}`) }));

function legendSwatch(entry) {
  const x = entry.x;
  const y = entry.baseline - 8;
  const mid = y + 4.5;
  const line = (dashed) => `<line x1="${x}" y1="${mid}" x2="${x + 14}" y2="${mid}" class="a-default" stroke-width="1"${dashed ? ' stroke-dasharray="3 2"' : ''}/>`;
  const hollow = 'style="fill:var(--mask);stroke:var(--arrow);stroke-width:1"';
  const open = 'style="fill:none;stroke:var(--arrow);stroke-width:1"';
  switch (entry.kind) {
    case 'actor': return `<circle cx="${x + 7}" cy="${y + 1.5}" r="2" class="c-frontend" stroke-width="1"/><line x1="${x + 7}" y1="${y + 3.5}" x2="${x + 7}" y2="${y + 7}" class="c-frontend" fill="none" stroke-width="1"/><line x1="${x + 3.5}" y1="${y + 5}" x2="${x + 10.5}" y2="${y + 5}" class="c-frontend" fill="none" stroke-width="1"/><line x1="${x + 7}" y1="${y + 7}" x2="${x + 4}" y2="${y + 10.5}" class="c-frontend" fill="none" stroke-width="1"/><line x1="${x + 7}" y1="${y + 7}" x2="${x + 10}" y2="${y + 10.5}" class="c-frontend" fill="none" stroke-width="1"/>`;
    case 'usecase': return `<ellipse cx="${x + 7}" cy="${mid}" rx="7" ry="4.5" class="c-backend" stroke-width="1"/>`;
    case 'system': return `<rect x="${x}" y="${y}" width="14" height="9" rx="1" class="c-region" fill="none" stroke-width="1"/>`;
    case 'association': return line(false);
    case 'include':
    case 'extend': return `${line(true)}<path d="M${x + 9} ${mid - 3.5} L${x + 14} ${mid} L${x + 9} ${mid + 3.5}" ${open}/>`;
    case 'generalization': return `${line(false)}<path d="M${x + 8} ${mid - 4} L${x + 14} ${mid} L${x + 8} ${mid + 4} Z" ${hollow}/>`;
    default: return line(false);
  }
}

function renderSvg() {
  const presentKinds = new Set([
    ...[...nodes.values()].map((node) => node.kind),
    ...(frames.length ? ['system'] : []),
    ...relations.map((relation) => relation.kind),
  ]);
  return `      <svg viewBox="0 0 ${viewBox[0]} ${viewBox[1]}" ${svgRootAttrs(diagram.meta)}>
${svgAccessibleText(diagram.meta, 'usecase')}
${renderDefinitions()}
${renderUmlMarkers()}

        <!-- Background Grid -->
        <rect width="100%" height="100%" fill="url(#grid)" />

        <!-- System boundaries -->
${renderBoundaries()}

        <!-- Relations -->
${relations.map(renderRelationPath).join('\n')}

        <!-- Actors and use cases -->
${[...nodes.values()].map(renderNode).join('\n\n')}

        <!-- Relation labels -->
${relations.map((relation, index) => graph.renderEdgeLabel(relation, index)).join('\n')}

        <!-- Legend -->
${graph.renderLegend({ catalog: LEGEND_CATALOG, presentKinds, renderSwatch: legendSwatch })}
      </svg>`;
}

validateUseCase();
writeDiagram({
  outPath,
  template,
  diagramType: 'usecase',
  meta: diagram.meta,
  svg: renderSvg(),
  cards: diagram.cards,
});
