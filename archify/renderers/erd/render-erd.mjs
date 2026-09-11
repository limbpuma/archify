import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, renderDefinitions, textUnits } from '../shared/utils.mjs';
import { animateAttr, focusEdgeAttrs, focusNodeAttrs, focusNodeTitle, loadDiagramWithBrandMarks, writeDiagram, svgAccessibleText, svgRootAttrs } from '../shared/cli.mjs';
import { throwDiagnosticProblems } from '../shared/diagnostics.mjs';
import { translateMessage as i18nText } from '../shared/i18n.mjs';
import { asArray } from '../shared/geometry.mjs';
import { createGridGraph } from '../shared/grid-graph.mjs';

// Entity-relationship diagram in the two notations German IT documentation
// uses: Chen (entities, relationship diamonds, attribute ellipses, (min,max)
// or 1/n/m cardinalities written at the entity end) and IE crow's foot
// (entity boxes with attribute lists, cardinality glyphs at both line ends).
// Every node sits on an explicit (col, row) grid; the renderer measures,
// validates and draws — no auto-layout.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { diagram, template, outPath } = await loadDiagramWithBrandMarks({
  rendererDir: __dirname,
  diagramType: 'erd',
  defaultExample: 'order-chen.erd.json'
});

const notation = diagram.meta?.notation || 'chen';
const isChen = notation === 'chen';
const viewBox = diagram.meta?.viewBox || (isChen ? [1380, 420] : [1380, 440]);
const grid = {
  colWidth: diagram.meta?.grid?.colWidth ?? (isChen ? 185 : 320),
  rowHeight: diagram.meta?.grid?.rowHeight ?? (isChen ? 84 : 170),
  originX: diagram.meta?.grid?.originX ?? (isChen ? 132 : 124),
  originY: diagram.meta?.grid?.originY ?? 100,
};

// Chen symbol footprints; crow's-foot entity boxes are measured from their
// attribute list like UML classifiers.
const SYMBOL_SIZE = {
  entity: [150, 46],
  'weak-entity': [150, 46],
  relationship: [150, 62],
  attribute: [100, 28],
};
const BOX_WIDTH = 200;
const HEADER_HEIGHT = 26;
const ATTRIBUTE_LINE_HEIGHT = 12;
const COMPARTMENT_PADDING = 5;
const TEXT_INSET = 8;
const KEY_COLUMN_WIDTH = 30;
const NAME_UNIT_WIDTH = 6.2;
const MEMBER_UNIT_WIDTH = 5.2;
const MEMBER_FONT_SIZE = 9;
// Ellipses and diamonds lose inner text width toward their pointed ends.
const INNER_FACTOR = { entity: 0.9, 'weak-entity': 0.82, relationship: 0.55, attribute: 0.8 };

const KIND_CLASS = {
  entity: 'c-backend',
  'weak-entity': 'c-backend',
  relationship: 'c-security',
  attribute: 'c-cloud',
};
const KIND_TEXT = {
  entity: 't-backend',
  'weak-entity': 't-backend',
  relationship: 't-security',
  attribute: 't-cloud',
};

// IE crow's-foot cardinalities. Symbols are drawn from the entity border inward.
const CROWSFOOT_CARDINALITIES = new Set(['one', 'zero-one', 'one-many', 'zero-many', 'many']);
const GLYPH_LENGTH = 24;

function measureNode(node) {
  const kind = node.kind || 'entity';
  const attributes = asArray(node.attributes);
  const isBox = !isChen && (kind === 'entity' || kind === 'weak-entity');
  const [defaultW, defaultH] = SYMBOL_SIZE[kind] || SYMBOL_SIZE.entity;
  const width = node.width || (isBox ? BOX_WIDTH : defaultW);
  const contentHeight = isBox
    ? HEADER_HEIGHT + (attributes.length ? attributes.length * ATTRIBUTE_LINE_HEIGHT + COMPARTMENT_PADDING * 2 : 0)
    : defaultH;
  const height = node.height || contentHeight;
  const cx = grid.originX + node.col * grid.colWidth + (node.dx || 0);
  const cy = grid.originY + node.row * grid.rowHeight + (node.dy || 0);
  return { ...node, kind, label: node.name, attributes, isBox, contentHeight, width, height, x: cx - width / 2, y: cy - height / 2, cx, cy };
}

const graph = createGridGraph({
  diagram,
  diagramType: 'erd',
  relationCollection: 'relations',
  nodeCollection: 'nodes',
  viewBox,
  grid,
  symbolSize: SYMBOL_SIZE,
  defaultSymbol: 'entity',
  measureNode,
  fromSideFor: attributeLinkSide,
  toSideFor: (from, to, edge) => attributeLinkSide(to, from, edge),
});
const { nodes, edgeSteps, edgeName, relations } = graph;

function isEntity(node) {
  return node.kind === 'entity' || node.kind === 'weak-entity';
}

// Chen attribute ellipses hang above or below their owner, so their link
// leaves vertically even when the ellipse is nudged sideways with dx.
function attributeLinkSide(self, other) {
  if (self.kind !== 'attribute' && other.kind !== 'attribute') return null;
  return other.cy > self.cy ? 'bottom' : 'top';
}

// ---------------------------------------------------------------------------
// Validation: notation rules + text fit + shared geometry checks
// ---------------------------------------------------------------------------

function chenProblems() {
  const problems = [];
  const degree = new Map();
  for (const relation of relations) {
    const from = nodes.get(relation.from);
    const to = nodes.get(relation.to);
    if (!from || !to) continue;
    const name = edgeName(relation);
    degree.set(relation.from, (degree.get(relation.from) || 0) + 1);
    degree.set(relation.to, (degree.get(relation.to) || 0) + 1);
    const kinds = [from.kind, to.kind];
    const entityToRelationship = (isEntity(from) && to.kind === 'relationship') || (from.kind === 'relationship' && isEntity(to));
    const attributeLink = kinds.includes('attribute') && kinds.some((kind) => kind !== 'attribute');
    if (!entityToRelationship && !attributeLink) {
      problems.push(`Relation "${name}" links ${from.kind} "${relation.from}" to ${to.kind} "${relation.to}" — in Chen notation entities connect only through a relationship diamond, and attributes hang off one entity or relationship.`);
    }
    if (attributeLink && (relation.fromCardinality || relation.toCardinality)) {
      problems.push(`Relation "${name}" carries a cardinality on an attribute link — cardinalities belong to entity–relationship lines.`);
    }
    if (entityToRelationship && !relation.fromCardinality && !relation.toCardinality) {
      problems.push(`Relation "${name}" between ${from.kind} "${relation.from}" and ${to.kind} "${relation.to}" needs a cardinality ((min,max), 1, n, m) at the entity end.`);
    }
  }
  for (const node of nodes.values()) {
    const links = degree.get(node.id) || 0;
    if (node.kind === 'relationship' && links < 2) problems.push(`Relationship "${node.id}" connects ${links} entity(ies) — a Chen relationship needs at least two.`);
    if (node.kind === 'attribute' && links !== 1) problems.push(`Attribute "${node.id}" is linked ${links} times — an attribute belongs to exactly one entity or relationship.`);
    if (isEntity(node) && !links) problems.push(`Entity "${node.id}" is isolated — connect it through a relationship.`);
    if (node.attributes.length) problems.push(`Entity "${node.id}" lists inline attributes — Chen notation draws attributes as ellipse nodes (kind "attribute").`);
    if (node.identifying && node.kind !== 'relationship') problems.push(`"identifying" applies to relationship diamonds only ("${node.id}" is ${node.kind}).`);
    if ((node.key || node.derived || node.multivalued) && node.kind !== 'attribute') problems.push(`key/derived/multivalued apply to attribute nodes only ("${node.id}" is ${node.kind}).`);
  }
  return problems;
}

function crowsfootProblems() {
  const problems = [];
  const degree = new Map();
  for (const node of nodes.values()) {
    if (!isEntity(node)) problems.push(`Node "${node.id}" is ${node.kind} — crow's-foot notation draws entities only; relationships are lines, attributes are rows.`);
    if (!node.attributes.length) problems.push(`Entity "${node.id}" has no attributes — list at least its primary key.`);
    if (node.attributes.length && !node.attributes.some((attribute) => attribute.pk)) problems.push(`Entity "${node.id}" has no primary key (pk: true) — every crow's-foot entity names its key.`);
  }
  for (const relation of relations) {
    if (!nodes.has(relation.from) || !nodes.has(relation.to)) continue;
    const name = edgeName(relation);
    degree.set(relation.from, (degree.get(relation.from) || 0) + 1);
    degree.set(relation.to, (degree.get(relation.to) || 0) + 1);
    for (const [field, value] of [['fromCardinality', relation.fromCardinality], ['toCardinality', relation.toCardinality]]) {
      if (!value) problems.push(`Relation "${name}" needs ${field} (one, zero-one, one-many, zero-many, many).`);
      else if (!CROWSFOOT_CARDINALITIES.has(value)) problems.push(`Relation "${name}": ${field} "${value}" is not a crow's-foot cardinality (one, zero-one, one-many, zero-many, many).`);
    }
  }
  for (const node of nodes.values()) {
    if (!degree.get(node.id)) problems.push(`Entity "${node.id}" is isolated — relate it to another entity.`);
  }
  return problems;
}

function textFitProblems(node) {
  const problems = [];
  const factor = node.isBox ? 1 : (INNER_FACTOR[node.kind] || 0.9);
  const available = (node.width - TEXT_INSET * 2) * factor;
  const nameWidth = textUnits(node.name) * NAME_UNIT_WIDTH;
  if (nameWidth > available) {
    problems.push(`Name "${node.name}" (~${Math.round(nameWidth)}px) is wider than the ${Math.round(available)}px text area of ${node.kind} "${node.id}" — shorten it or increase width.`);
  }
  if (node.isBox) {
    const rowWidth = node.width - TEXT_INSET * 2 - KEY_COLUMN_WIDTH;
    for (const attribute of node.attributes) {
      const text = attributeText(attribute);
      const lineWidth = textUnits(text) * MEMBER_UNIT_WIDTH;
      if (lineWidth > rowWidth) problems.push(`Attribute "${text}" (~${Math.round(lineWidth)}px) is wider than the ${Math.round(rowWidth)}px row of "${node.id}" — shorten it or increase width.`);
    }
    if (node.height < node.contentHeight) problems.push(`Entity "${node.id}" declares height ${node.height} but its rows need ${node.contentHeight}px.`);
  }
  return problems;
}

function validateErd() {
  const problems = [];
  const nodeList = asArray(diagram.nodes);
  if (nodes.size !== nodeList.length) problems.push('Node ids must be unique.');
  for (const relation of relations) {
    if (!nodes.has(relation.from)) problems.push(`Relation "${edgeName(relation)}" references unknown source "${relation.from}".`);
    if (!nodes.has(relation.to)) problems.push(`Relation "${edgeName(relation)}" references unknown target "${relation.to}".`);
    if (relation.from === relation.to) problems.push(`Relation "${edgeName(relation)}" is a self-relation — model a recursive relationship through a relationship node or a second entity.`);
  }
  problems.push(...(isChen ? chenProblems() : crowsfootProblems()));
  for (const node of nodes.values()) problems.push(...textFitProblems(node));
  problems.push(...graph.geometryProblems({ minGap: 12, minEdge: isChen ? 24 : GLYPH_LENGTH * 2 + 8, obstacleKind: 'node' }));
  if (problems.length) {
    throwDiagnosticProblems('ER diagram validation failed', problems, { subject: { diagramType: 'erd' } });
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function attributeText(attribute) {
  return attribute.type ? `${attribute.name}: ${attribute.type}` : attribute.name;
}

function keyBadge(attribute) {
  if (attribute.pk && attribute.fk) return 'PK,FK';
  if (attribute.pk) return 'PK';
  if (attribute.fk) return 'FK';
  return '';
}

function chenShape(node, cls, extraAttrs = '') {
  const { x, y, width: w, height: h, cx, cy } = node;
  switch (node.kind) {
    case 'weak-entity':
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" class="${cls}"${extraAttrs}/>`
        + `<rect x="${x + 4}" y="${y + 4}" width="${w - 8}" height="${h - 8}" rx="1" class="${cls}" fill="none"/>`;
    case 'relationship': {
      const outer = `<polygon points="${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}" class="${cls}"${extraAttrs}/>`;
      if (!node.identifying) return outer;
      return outer + `<polygon points="${cx},${y + 5} ${x + w - 9},${cy} ${cx},${y + h - 5} ${x + 9},${cy}" class="${cls}" fill="none"/>`;
    }
    case 'attribute': {
      const dashed = node.derived ? ' stroke-dasharray="4 3"' : '';
      const outer = `<ellipse cx="${cx}" cy="${cy}" rx="${w / 2}" ry="${h / 2}" class="${cls}"${dashed}${extraAttrs}/>`;
      if (!node.multivalued) return outer;
      return outer + `<ellipse cx="${cx}" cy="${cy}" rx="${w / 2 - 4}" ry="${h / 2 - 4}" class="${cls}" fill="none"/>`;
    }
    case 'entity':
    default:
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" class="${cls}"${extraAttrs}/>`;
  }
}

function legendKind(node) {
  if (node.kind !== 'attribute') return node.kind;
  if (node.key) return 'key-attribute';
  if (node.derived) return 'derived-attribute';
  if (node.multivalued) return 'multivalued-attribute';
  return 'attribute';
}

function passportFor(node) {
  const kind = legendKind(node);
  return { kind: node.kind, sublabel: kind === node.kind ? undefined : i18nText(diagram.meta.locale, `legend.erd.${kind}`), context: i18nText(diagram.meta.locale, `legend.erd.${node.kind}`) };
}

function renderChenNode(node) {
  const fill = KIND_CLASS[node.kind] || KIND_CLASS.entity;
  const underline = node.key ? ' text-decoration="underline"' : '';
  const fontSize = node.kind === 'attribute' ? MEMBER_FONT_SIZE : 10;
  const weight = node.kind === 'attribute' ? '500' : '600';
  return `        <g ${focusNodeAttrs(node.id, node.name, passportFor(node), diagram.meta.locale)}>
          ${focusNodeTitle(node.name, passportFor(node))}
          ${chenShape(node, 'c-mask')}
          ${chenShape(node, fill, animateAttr(diagram.meta, 'node', edgeSteps.get(node.id)))}
          <text data-node-label="" x="${node.cx}" y="${node.cy + 3.5}" class="t-primary" font-size="${fontSize}" font-weight="${weight}" text-anchor="middle"${underline}>${esc(node.name)}</text>
        </g>`;
}

function renderBoxNode(node) {
  const fill = KIND_CLASS[node.kind] || KIND_CLASS.entity;
  const accent = KIND_TEXT[node.kind] || KIND_TEXT.entity;
  const { x, y, width, cx } = node;
  const rowsTop = y + HEADER_HEIGHT;
  const weakInner = node.kind === 'weak-entity'
    ? `\n          <rect x="${x + 3}" y="${y + 3}" width="${width - 6}" height="${node.height - 6}" rx="1" class="${fill}" fill="none"/>`
    : '';
  const rows = node.attributes.map((attribute, index) => {
    const rowY = rowsTop + COMPARTMENT_PADDING + (index + 1) * ATTRIBUTE_LINE_HEIGHT - 3;
    const badge = keyBadge(attribute);
    const underline = attribute.pk ? ' text-decoration="underline"' : '';
    const optional = attribute.optional ? ' font-style="italic"' : '';
    const badgeText = badge ? `\n          <text data-detail="context" x="${x + TEXT_INSET}" y="${rowY}" class="${accent}" font-size="${MEMBER_FONT_SIZE}" font-weight="700">${badge}</text>` : '';
    return `${badgeText}\n          <text data-detail="context" x="${x + TEXT_INSET + KEY_COLUMN_WIDTH}" y="${rowY}" class="t-primary" font-size="${MEMBER_FONT_SIZE}"${underline}${optional}>${esc(attributeText(attribute))}</text>`;
  }).join('');
  const separator = node.attributes.length ? `\n          <line x1="${x}" y1="${rowsTop}" x2="${x + width}" y2="${rowsTop}" class="${fill}" fill="none"/>` : '';
  return `        <g ${focusNodeAttrs(node.id, node.name, passportFor(node), diagram.meta.locale)}>
          ${focusNodeTitle(node.name, passportFor(node))}
          <rect x="${x}" y="${y}" width="${width}" height="${node.height}" rx="2" class="c-mask"/>
          <rect x="${x}" y="${y}" width="${width}" height="${node.height}" rx="2" class="${fill}"${animateAttr(diagram.meta, 'node', edgeSteps.get(node.id))}/>${weakInner}${separator}
          <text data-node-label="" x="${cx}" y="${y + HEADER_HEIGHT / 2 + 4}" class="t-primary" font-size="10" font-weight="600" text-anchor="middle">${esc(node.name)}</text>${rows}
        </g>`;
}

function renderNode(node) {
  return node.isBox ? renderBoxNode(node) : renderChenNode(node);
}

function renderRelationPath(relation, index) {
  return graph.renderEdgePath(relation, index, {
    markerFor: () => null,
    extraAttrsFor: (edge) => (!isChen && edge.identifying === false ? ' stroke-dasharray="6 4"' : ''),
  });
}

// Direction helpers for line-end decorations: `base` is the endpoint on the
// node border, `next` the following route point.
function unitToward(base, next) {
  const dx = next[0] - base[0];
  const dy = next[1] - base[1];
  const length = Math.hypot(dx, dy) || 1;
  return [dx / length, dy / length];
}

function crowsfootGlyph(base, next, cardinality) {
  const [ux, uy] = unitToward(base, next);
  const [nx, ny] = [-uy, ux];
  const at = (along, across = 0) => [base[0] + ux * along + nx * across, base[1] + uy * along + ny * across];
  const line = (a, b) => `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" class="a-default" stroke-width="1.2"/>`;
  const bar = (along) => line(at(along, 7), at(along, -7));
  const circle = (along) => { const [cx, cy] = at(along); return `<circle cx="${cx}" cy="${cy}" r="4" class="a-default" stroke-width="1.2" style="fill:var(--mask)"/>`; };
  const foot = () => line(at(14), at(0, 7)) + line(at(14), at(0, -7));
  switch (cardinality) {
    case 'one': return bar(10) + bar(16);
    case 'zero-one': return bar(10) + circle(20);
    case 'one-many': return foot() + bar(18);
    case 'zero-many': return foot() + circle(21);
    case 'many':
    default: return foot();
  }
}

function renderCrowsfootEnds(relation, index) {
  const { points } = graph.pathFor(relation);
  const parts = [
    crowsfootGlyph(points[0], points[1], relation.fromCardinality),
    crowsfootGlyph(points[points.length - 1], points[points.length - 2], relation.toCardinality),
  ];
  return `        <g ${focusEdgeAttrs(relation.from, relation.to, relation.label, index, relation.id)}>
          ${parts.join('\n          ')}
        </g>`;
}

// Chen cardinality text sits beside the line just off the entity border.
function cardinalityText(base, next, text) {
  const [ux, uy] = unitToward(base, next);
  const horizontal = Math.abs(ux) >= Math.abs(uy);
  const along = 14;
  const x = base[0] + ux * along;
  const y = base[1] + uy * along;
  if (horizontal) {
    return `<text data-detail="context" x="${x}" y="${y - 5}" class="t-muted" font-size="${MEMBER_FONT_SIZE}" font-weight="600" text-anchor="${ux > 0 ? 'start' : 'end'}">${esc(text)}</text>`;
  }
  return `<text data-detail="context" x="${x + 5}" y="${y + 3}" class="t-muted" font-size="${MEMBER_FONT_SIZE}" font-weight="600">${esc(text)}</text>`;
}

function renderChenCardinalities(relation, index) {
  if (!relation.fromCardinality && !relation.toCardinality) return '';
  const { points } = graph.pathFor(relation);
  const parts = [];
  if (relation.fromCardinality) parts.push(cardinalityText(points[0], points[1], relation.fromCardinality));
  if (relation.toCardinality) parts.push(cardinalityText(points[points.length - 1], points[points.length - 2], relation.toCardinality));
  return `        <g data-detail="context" ${focusEdgeAttrs(relation.from, relation.to, relation.label, index, relation.id)}>
          ${parts.join('\n          ')}
        </g>`;
}

const LEGEND_KINDS = isChen
  ? ['entity', 'weak-entity', 'relationship', 'attribute', 'key-attribute', 'derived-attribute', 'multivalued-attribute']
  : ['entity', 'weak-entity', 'one', 'zero-one', 'one-many', 'zero-many', 'many'];
const LEGEND_CATALOG = LEGEND_KINDS.map((kind) => ({ kind, label: i18nText(diagram.meta.locale, `legend.erd.${kind}`) }));

function legendSwatch(entry) {
  const x = entry.x;
  const y = entry.baseline - 8;
  const mid = y + 4.5;
  switch (entry.kind) {
    case 'entity': return `<rect x="${x}" y="${y}" width="14" height="9" rx="1" class="c-backend" stroke-width="1"/>`;
    case 'weak-entity': return `<rect x="${x}" y="${y}" width="14" height="9" rx="1" class="c-backend" stroke-width="1"/><rect x="${x + 2}" y="${y + 2}" width="10" height="5" class="c-backend" fill="none" stroke-width="1"/>`;
    case 'relationship': return `<polygon points="${x + 7},${y - 1} ${x + 15},${y + 4.5} ${x + 7},${y + 10} ${x - 1},${y + 4.5}" class="c-security" stroke-width="1"/>`;
    case 'attribute': return `<ellipse cx="${x + 7}" cy="${mid}" rx="7" ry="4.5" class="c-cloud" stroke-width="1"/>`;
    case 'key-attribute': return `<ellipse cx="${x + 7}" cy="${mid}" rx="7" ry="4.5" class="c-cloud" stroke-width="1"/><line x1="${x + 3}" y1="${mid + 2}" x2="${x + 11}" y2="${mid + 2}" class="t-primary" stroke="currentColor" stroke-width="1"/>`;
    case 'derived-attribute': return `<ellipse cx="${x + 7}" cy="${mid}" rx="7" ry="4.5" class="c-cloud" stroke-width="1" stroke-dasharray="2 1.5"/>`;
    case 'multivalued-attribute': return `<ellipse cx="${x + 7}" cy="${mid}" rx="7" ry="4.5" class="c-cloud" stroke-width="1"/><ellipse cx="${x + 7}" cy="${mid}" rx="4.5" ry="2.5" class="c-cloud" fill="none" stroke-width="1"/>`;
    default: {
      const glyph = crowsfootGlyph([x + 14, mid], [x, mid], entry.kind).replaceAll('stroke-width="1.2"', 'stroke-width="1"').replaceAll('r="4"', 'r="2.5"');
      return `<line x1="${x}" y1="${mid}" x2="${x + 14}" y2="${mid}" class="a-default" stroke-width="1"/>${glyph}`;
    }
  }
}

function renderSvg() {
  const presentKinds = new Set([
    ...[...nodes.values()].map(legendKind),
    ...(isChen ? [] : relations.flatMap((relation) => [relation.fromCardinality, relation.toCardinality])),
  ]);
  const decorations = relations.map((relation, index) => (isChen ? renderChenCardinalities(relation, index) : renderCrowsfootEnds(relation, index))).filter(Boolean).join('\n');
  return `      <svg viewBox="0 0 ${viewBox[0]} ${viewBox[1]}" ${svgRootAttrs(diagram.meta)} data-erd-notation="${notation}">
${svgAccessibleText(diagram.meta, 'erd')}
${renderDefinitions()}

        <!-- Background Grid -->
        <rect width="100%" height="100%" fill="url(#grid)" />

        <!-- Groups -->
${graph.renderGroups()}

        <!-- Relations -->
${relations.map(renderRelationPath).join('\n')}

        <!-- Nodes -->
${[...nodes.values()].map(renderNode).join('\n\n')}

        <!-- Line ends and labels -->
${decorations}
${relations.map((relation, index) => graph.renderEdgeLabel(relation, index)).join('\n')}

        <!-- Legend -->
${graph.renderLegend({ catalog: LEGEND_CATALOG, presentKinds, renderSwatch: legendSwatch })}
      </svg>`;
}

validateErd();
writeDiagram({
  outPath,
  template,
  diagramType: 'erd',
  meta: diagram.meta,
  svg: renderSvg(),
  cards: diagram.cards,
});
