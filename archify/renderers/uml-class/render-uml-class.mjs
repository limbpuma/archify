import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, renderDefinitions, textUnits } from '../shared/utils.mjs';
import { animateAttr, focusEdgeAttrs, focusNodeAttrs, focusNodeTitle, loadDiagramWithBrandMarks, writeDiagram, svgAccessibleText, svgRootAttrs } from '../shared/cli.mjs';
import { throwDiagnosticProblems } from '../shared/diagnostics.mjs';
import { translateMessage as i18nText } from '../shared/i18n.mjs';
import { asArray } from '../shared/geometry.mjs';
import { createGridGraph } from '../shared/grid-graph.mjs';

// UML 2.5 class diagram (Klassendiagramm). Classifiers are three-compartment
// boxes (name, attributes, operations) placed by the author on an explicit
// (col, row) grid; relations carry the normed UML line ends: hollow triangle
// for inheritance/realization, hollow/filled diamond for aggregation/
// composition at the whole, open arrow for navigable associations and
// dependencies. The renderer measures, validates and draws — no auto-layout.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { diagram, template, outPath } = await loadDiagramWithBrandMarks({
  rendererDir: __dirname,
  diagramType: 'uml-class',
  defaultExample: 'order-domain.uml-class.json'
});

const viewBox = diagram.meta?.viewBox || [1380, 740];
const grid = {
  colWidth: diagram.meta?.grid?.colWidth ?? 228,
  rowHeight: diagram.meta?.grid?.rowHeight ?? 160,
  originX: diagram.meta?.grid?.originX ?? 116,
  originY: diagram.meta?.grid?.originY ?? 100,
};

// Box arithmetic. A classifier is header + attribute compartment + operation
// compartment; enumerations list their literals in the attribute compartment
// and drop the operation compartment unless operations are given.
const DEFAULT_WIDTH = 180;
const HEADER_HEIGHT = 26;
const STEREOTYPE_HEIGHT = 11;
const MEMBER_LINE_HEIGHT = 12;
const COMPARTMENT_PADDING = 5;
const EMPTY_COMPARTMENT_HEIGHT = 12;
const TEXT_INSET = 8;
// Members render at 9px: the smallest size that still projects to the 6px
// desktop-readability floor on a 1380px-wide viewBox at a 1440px viewport.
// Width estimates per text unit: 10px semibold for names, 9px regular for members.
const NAME_UNIT_WIDTH = 6.2;
const MEMBER_UNIT_WIDTH = 5.2;
const MEMBER_FONT_SIZE = 9;

const KIND_CLASS = {
  class: 'c-backend',
  abstract: 'c-frontend',
  interface: 'c-cloud',
  enum: 'c-database',
};
const KIND_TEXT = {
  class: 't-backend',
  abstract: 't-frontend',
  interface: 't-cloud',
  enum: 't-database',
};
const DEFAULT_STEREOTYPE = {
  interface: 'interface',
  enum: 'enumeration',
};

// Line ends sit at the `to` end: the parent/supplier/whole. Association is a
// plain line unless `navigable` asks for an open arrow toward `to`.
const RELATION_STYLE = {
  association: { marker: (relation) => (relation.navigable ? 'uml-open-arrow' : null), dashed: false },
  aggregation: { marker: () => 'uml-diamond-hollow', dashed: false },
  composition: { marker: () => 'uml-diamond-filled', dashed: false },
  inheritance: { marker: () => 'uml-triangle', dashed: false },
  realization: { marker: () => 'uml-triangle', dashed: true },
  dependency: { marker: () => 'uml-open-arrow', dashed: true },
};
const END_LABEL_KINDS = new Set(['association', 'aggregation', 'composition']);
const GENERALIZATION_KINDS = new Set(['inheritance', 'realization']);

function compartmentHeight(members) {
  return members.length ? members.length * MEMBER_LINE_HEIGHT + COMPARTMENT_PADDING * 2 : EMPTY_COMPARTMENT_HEIGHT;
}

function stereotypeOf(node) {
  const text = node.stereotype || DEFAULT_STEREOTYPE[node.kind];
  return text ? `«${text}»` : '';
}

function measureClass(node) {
  const kind = node.kind || 'class';
  const attributes = asArray(node.attributes);
  const methods = asArray(node.methods);
  const stereotype = stereotypeOf(node);
  const headerHeight = HEADER_HEIGHT + (stereotype ? STEREOTYPE_HEIGHT : 0);
  const attributesHeight = compartmentHeight(attributes);
  const methodsHeight = kind === 'enum' && !methods.length ? 0 : compartmentHeight(methods);
  const contentHeight = headerHeight + attributesHeight + methodsHeight;
  const width = node.width || DEFAULT_WIDTH;
  const height = node.height || contentHeight;
  const cx = grid.originX + node.col * grid.colWidth + (node.dx || 0);
  const cy = grid.originY + node.row * grid.rowHeight + (node.dy || 0);
  return {
    ...node,
    kind,
    label: node.name,
    attributes,
    methods,
    stereotype,
    headerHeight,
    attributesHeight,
    methodsHeight,
    contentHeight,
    width,
    height,
    x: cx - width / 2,
    y: cy - height / 2,
    cx,
    cy,
  };
}

const graph = createGridGraph({
  diagram,
  diagramType: 'uml-class',
  relationCollection: 'relations',
  nodeCollection: 'classes',
  viewBox,
  grid,
  symbolSize: {},
  measureNode: measureClass,
});
const { nodes, edgeSteps, edgeName, relations } = graph;

// ---------------------------------------------------------------------------
// Validation: UML semantics + text fit + shared geometry checks
// ---------------------------------------------------------------------------

function generalizationCycle() {
  const parents = new Map();
  for (const relation of relations) {
    if (!GENERALIZATION_KINDS.has(relation.kind)) continue;
    parents.set(relation.from, [...(parents.get(relation.from) || []), relation.to]);
  }
  const visiting = new Set();
  const done = new Set();
  const walk = (id, trail) => {
    if (done.has(id)) return null;
    if (visiting.has(id)) return [...trail, id];
    visiting.add(id);
    for (const parent of parents.get(id) || []) {
      const cycle = walk(parent, [...trail, id]);
      if (cycle) return cycle;
    }
    visiting.delete(id);
    done.add(id);
    return null;
  };
  for (const id of parents.keys()) {
    const cycle = walk(id, []);
    if (cycle) return cycle;
  }
  return null;
}

function textFitProblems(node) {
  const problems = [];
  const available = node.width - TEXT_INSET * 2;
  const nameWidth = textUnits(node.name) * NAME_UNIT_WIDTH;
  if (nameWidth > available) {
    problems.push(`Class name "${node.name}" (~${Math.round(nameWidth)}px) is wider than the ${Math.round(available)}px text area of "${node.id}" — shorten it or increase width.`);
  }
  const lines = [node.stereotype, ...node.attributes, ...node.methods].filter(Boolean);
  for (const line of lines) {
    const lineWidth = textUnits(line) * MEMBER_UNIT_WIDTH;
    if (lineWidth > available) {
      problems.push(`Member "${line}" (~${Math.round(lineWidth)}px) is wider than the ${Math.round(available)}px text area of "${node.id}" — shorten it or increase width.`);
    }
  }
  if (node.height < node.contentHeight) {
    problems.push(`Class "${node.id}" declares height ${node.height} but its compartments need ${node.contentHeight}px — raise height or drop members.`);
  }
  return problems;
}

function validateClassDiagram() {
  const problems = [];
  const classList = asArray(diagram.classes);
  if (nodes.size !== classList.length) problems.push('Class ids must be unique.');

  for (const relation of relations) {
    const name = edgeName(relation);
    const from = nodes.get(relation.from);
    const to = nodes.get(relation.to);
    if (!from) problems.push(`Relation "${name}" references unknown source "${relation.from}".`);
    if (!to) problems.push(`Relation "${name}" references unknown target "${relation.to}".`);
    if (relation.from === relation.to) problems.push(`Relation "${name}" is a self-relation — model it as an attribute or split the class.`);
    if (!from || !to) continue;

    const endLabelFields = ['fromMultiplicity', 'toMultiplicity', 'fromRole', 'toRole'].filter((field) => relation[field]);
    if (!END_LABEL_KINDS.has(relation.kind) && endLabelFields.length) {
      problems.push(`Relation "${name}" is a ${relation.kind} but carries ${endLabelFields.join('/')} — multiplicities and roles belong to association, aggregation and composition only.`);
    }
    if (relation.navigable !== undefined && relation.kind !== 'association') {
      problems.push(`Relation "${name}": navigable only applies to association (the ${relation.kind} line end is fixed by UML).`);
    }
    if (relation.kind === 'realization' && to.kind !== 'interface') {
      problems.push(`Realization "${name}" must point at an interface — "${relation.to}" is ${to.kind}. Use inheritance for a class parent.`);
    }
    if (relation.kind === 'inheritance') {
      if (to.kind === 'interface') problems.push(`Inheritance "${name}" points at interface "${relation.to}" — use realization (dashed line, hollow triangle).`);
      if (from.kind === 'enum' || to.kind === 'enum') problems.push(`Inheritance "${name}" involves an enumeration — enumerations do not take part in generalization.`);
      if (from.kind === 'interface' && to.kind !== 'interface') problems.push(`Inheritance "${name}": interface "${relation.from}" can only extend another interface.`);
    }
    if (relation.kind === 'realization' && from.kind === 'interface') {
      problems.push(`Realization "${name}": an interface cannot implement — use inheritance between interfaces.`);
    }
  }

  const cycle = generalizationCycle();
  if (cycle) problems.push(`Generalization cycle: ${cycle.join(' -> ')} — a class cannot inherit from itself.`);

  for (const node of nodes.values()) {
    if (node.kind === 'interface' && !node.methods.length && !node.attributes.length) {
      problems.push(`Interface "${node.id}" declares no operations — an empty interface says nothing to the reader.`);
    }
    problems.push(...textFitProblems(node));
  }

  problems.push(...graph.geometryProblems({ minGap: 24, minEdge: 24, obstacleKind: 'class' }));

  if (problems.length) {
    throwDiagnosticProblems('UML class diagram validation failed', problems, {
      subject: { diagramType: 'uml-class' },
    });
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

// UML line ends use userSpaceOnUse so they keep their size on every stroke
// width; hollow shapes are filled with the mask colour to hide the line under them.
function renderUmlMarkers() {
  const hollow = 'style="fill:var(--mask);stroke:var(--arrow);stroke-width:1.2"';
  const filled = 'style="fill:var(--arrow);stroke:var(--arrow);stroke-width:1.2"';
  const open = 'style="fill:none;stroke:var(--arrow);stroke-width:1.2"';
  return `        <defs>
          <marker id="uml-triangle" markerUnits="userSpaceOnUse" markerWidth="16" markerHeight="14" refX="15" refY="7" orient="auto">
            <path d="M1 1 L15 7 L1 13 Z" ${hollow}/>
          </marker>
          <marker id="uml-diamond-hollow" markerUnits="userSpaceOnUse" markerWidth="20" markerHeight="12" refX="19" refY="6" orient="auto">
            <path d="M1 6 L10 1 L19 6 L10 11 Z" ${hollow}/>
          </marker>
          <marker id="uml-diamond-filled" markerUnits="userSpaceOnUse" markerWidth="20" markerHeight="12" refX="19" refY="6" orient="auto">
            <path d="M1 6 L10 1 L19 6 L10 11 Z" ${filled}/>
          </marker>
          <marker id="uml-open-arrow" markerUnits="userSpaceOnUse" markerWidth="12" markerHeight="12" refX="11" refY="6" orient="auto">
            <path d="M1 1 L11 6 L1 11" ${open}/>
          </marker>
        </defs>`;
}

function memberLines(lines, x, startY, detail) {
  return lines.map((line, index) => `\n          <text data-detail="${detail}" x="${x}" y="${startY + COMPARTMENT_PADDING + (index + 1) * MEMBER_LINE_HEIGHT - 3}" class="t-primary" font-size="${MEMBER_FONT_SIZE}">${esc(line)}</text>`).join('');
}

function renderClass(node) {
  const fill = KIND_CLASS[node.kind] || KIND_CLASS.class;
  const accent = KIND_TEXT[node.kind] || KIND_TEXT.class;
  const { x, y, width, cx } = node;
  const attributesTop = y + node.headerHeight;
  const methodsTop = attributesTop + node.attributesHeight;
  const nameY = node.stereotype ? y + node.headerHeight - 8 : y + node.headerHeight / 2 + 4;
  const nameStyle = node.kind === 'abstract' ? ' font-style="italic"' : '';
  const stereotype = node.stereotype
    ? `\n          <text data-detail="context" x="${cx}" y="${y + 11}" class="${accent}" font-size="${MEMBER_FONT_SIZE}" text-anchor="middle">${esc(node.stereotype)}</text>`
    : '';
  const methodsSeparator = node.methodsHeight
    ? `\n          <line x1="${x}" y1="${methodsTop}" x2="${x + width}" y2="${methodsTop}" class="${fill}" fill="none"/>`
    : '';
  const passport = {
    kind: node.kind,
    sublabel: node.stereotype || undefined,
    context: i18nText(diagram.meta.locale, `legend.uml-class.${node.kind}`),
  };
  return `        <g ${focusNodeAttrs(node.id, node.name, passport, diagram.meta.locale)}>
          ${focusNodeTitle(node.name, passport)}
          <rect x="${x}" y="${y}" width="${width}" height="${node.height}" rx="2" class="c-mask"/>
          <rect x="${x}" y="${y}" width="${width}" height="${node.height}" rx="2" class="${fill}"${animateAttr(diagram.meta, 'node', edgeSteps.get(node.id))}/>
          <line x1="${x}" y1="${attributesTop}" x2="${x + width}" y2="${attributesTop}" class="${fill}" fill="none"/>${methodsSeparator}${stereotype}
          <text data-node-label="" x="${cx}" y="${nameY}" class="t-primary" font-size="10" font-weight="600" text-anchor="middle"${nameStyle}>${esc(node.name)}</text>${memberLines(node.attributes, x + TEXT_INSET, attributesTop, 'context')}${memberLines(node.methods, x + TEXT_INSET, methodsTop, 'context')}
        </g>`;
}

function renderRelationPath(relation, index) {
  const style = RELATION_STYLE[relation.kind];
  return graph.renderEdgePath(relation, index, {
    markerFor: (edge) => style.marker(edge),
    extraAttrsFor: () => (style.dashed ? ' stroke-dasharray="6 4"' : ''),
  });
}

// Multiplicity and role sit beside the line near its end: past the marker at
// the `to` end, just off the border at the `from` end; the multiplicity takes
// the side that reads first (above / right), the role the opposite side.
function endLabelPlacement(base, next, hasMarker) {
  const dx = next[0] - base[0];
  const dy = next[1] - base[1];
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const along = hasMarker ? 24 : 12;
  const sign = horizontal ? Math.sign(dx) || 1 : Math.sign(dy) || 1;
  if (horizontal) {
    const x = base[0] + sign * along;
    return {
      anchor: sign > 0 ? 'start' : 'end',
      multiplicity: [x, base[1] - 5],
      role: [x, base[1] + 11],
    };
  }
  const y = base[1] + sign * along + 3;
  return {
    anchor: null,
    multiplicity: [base[0] + 5, y],
    role: [base[0] - 5, y],
  };
}

function endLabelText([x, y], text, anchor, fallbackAnchor) {
  return `\n          <text data-detail="context" x="${x}" y="${y}" class="t-muted" font-size="${MEMBER_FONT_SIZE}" text-anchor="${anchor || fallbackAnchor}">${esc(text)}</text>`;
}

function renderEndLabels(relation, index) {
  const fields = [relation.fromMultiplicity, relation.toMultiplicity, relation.fromRole, relation.toRole];
  if (!fields.some(Boolean)) return '';
  const { points } = graph.pathFor(relation);
  const first = endLabelPlacement(points[0], points[1], false);
  const last = endLabelPlacement(points[points.length - 1], points[points.length - 2], Boolean(RELATION_STYLE[relation.kind].marker(relation)));
  const parts = [];
  if (relation.fromMultiplicity) parts.push(endLabelText(first.multiplicity, relation.fromMultiplicity, first.anchor, 'start'));
  if (relation.fromRole) parts.push(endLabelText(first.role, relation.fromRole, first.anchor, 'end'));
  if (relation.toMultiplicity) parts.push(endLabelText(last.multiplicity, relation.toMultiplicity, last.anchor, 'start'));
  if (relation.toRole) parts.push(endLabelText(last.role, relation.toRole, last.anchor, 'end'));
  return `        <g data-detail="context" ${focusEdgeAttrs(relation.from, relation.to, relation.label, index, relation.id)}>${parts.join('')}
        </g>`;
}

const LEGEND_KINDS = ['class', 'abstract', 'interface', 'enum', 'association', 'aggregation', 'composition', 'inheritance', 'realization', 'dependency'];
const LEGEND_CATALOG = LEGEND_KINDS.map((kind) => ({ kind, label: i18nText(diagram.meta.locale, `legend.uml-class.${kind}`) }));

function legendSwatch(entry) {
  const x = entry.x;
  const y = entry.baseline - 8;
  const mid = y + 4.5;
  const line = (dashed) => `<line x1="${x}" y1="${mid}" x2="${x + 14}" y2="${mid}" class="a-default" stroke-width="1"${dashed ? ' stroke-dasharray="3 2"' : ''}/>`;
  const hollow = 'style="fill:var(--mask);stroke:var(--arrow);stroke-width:1"';
  const filled = 'style="fill:var(--arrow);stroke:var(--arrow);stroke-width:1"';
  const open = 'style="fill:none;stroke:var(--arrow);stroke-width:1"';
  switch (entry.kind) {
    case 'association': return `${line(false)}<path d="M${x + 9} ${mid - 3.5} L${x + 14} ${mid} L${x + 9} ${mid + 3.5}" ${open}/>`;
    case 'aggregation': return `${line(false)}<path d="M${x + 6} ${mid} L${x + 10} ${mid - 3.5} L${x + 14} ${mid} L${x + 10} ${mid + 3.5} Z" ${hollow}/>`;
    case 'composition': return `${line(false)}<path d="M${x + 6} ${mid} L${x + 10} ${mid - 3.5} L${x + 14} ${mid} L${x + 10} ${mid + 3.5} Z" ${filled}/>`;
    case 'inheritance': return `${line(false)}<path d="M${x + 8} ${mid - 4} L${x + 14} ${mid} L${x + 8} ${mid + 4} Z" ${hollow}/>`;
    case 'realization': return `${line(true)}<path d="M${x + 8} ${mid - 4} L${x + 14} ${mid} L${x + 8} ${mid + 4} Z" ${hollow}/>`;
    case 'dependency': return `${line(true)}<path d="M${x + 9} ${mid - 3.5} L${x + 14} ${mid} L${x + 9} ${mid + 3.5}" ${open}/>`;
    default: {
      const cls = KIND_CLASS[entry.kind] || KIND_CLASS.class;
      return `<rect x="${x}" y="${y}" width="14" height="9" rx="1" class="${cls}" stroke-width="1"/><line x1="${x}" y1="${y + 3.5}" x2="${x + 14}" y2="${y + 3.5}" class="${cls}" fill="none" stroke-width="1"/>`;
    }
  }
}

function renderSvg() {
  const presentKinds = new Set([
    ...[...nodes.values()].map((node) => node.kind),
    ...relations.map((relation) => relation.kind),
  ]);
  return `      <svg viewBox="0 0 ${viewBox[0]} ${viewBox[1]}" ${svgRootAttrs(diagram.meta)}>
${svgAccessibleText(diagram.meta, 'uml-class')}
${renderDefinitions()}
${renderUmlMarkers()}

        <!-- Background Grid -->
        <rect width="100%" height="100%" fill="url(#grid)" />

        <!-- Packages -->
${graph.renderGroups()}

        <!-- Relations -->
${relations.map(renderRelationPath).join('\n')}

        <!-- Classifiers -->
${[...nodes.values()].map(renderClass).join('\n\n')}

        <!-- Relation labels -->
${relations.map((relation, index) => graph.renderEdgeLabel(relation, index)).join('\n')}
${relations.map(renderEndLabels).filter(Boolean).join('\n')}

        <!-- Legend -->
${graph.renderLegend({ catalog: LEGEND_CATALOG, presentKinds, renderSwatch: legendSwatch })}
      </svg>`;
}

validateClassDiagram();
writeDiagram({
  outPath,
  template,
  diagramType: 'uml-class',
  meta: diagram.meta,
  svg: renderSvg(),
  cards: diagram.cards,
});
