import { esc, textUnits } from './utils.mjs';
import { animateAttr, focusEdgeAttrs } from './cli.mjs';
import { resolveLegend, renderLegend as renderResolvedLegend } from './legend.mjs';
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
} from './geometry.mjs';

// Shared core for "nodes on an explicit grid + orthogonal edges" diagram types (flowchart, uml-class, erd, usecase,
// activity, epk). The author owns col/row placement; this module owns measurement, routing, the shared composition
// checks and the edge/group/legend markup so every type behaves and looks the same. Type-specific shapes, structural
// rules and text-fit factors stay in the renderer that calls it.

export function createGridGraph({
  diagram,
  diagramType,
  relationCollection = 'edges',
  nodeCollection = 'nodes',
  viewBox,
  grid,
  symbolSize,
  defaultSymbol = 'process',
  measureNode = null,
  fromSideFor = null,
  toSideFor = null,
  cornerRadius = 8,
  legendBand = 96,
}) {
  const relations = asArray(diagram[relationCollection]);
  const nodeList = asArray(diagram[nodeCollection]);
  const groups = asArray(diagram.groups);

  function defaultMeasure(node) {
    const [defaultW, defaultH] = symbolSize[node.symbol] || symbolSize[defaultSymbol];
    const width = node.width || defaultW;
    const height = node.height || defaultH;
    const cx = grid.originX + node.col * grid.colWidth + (node.dx || 0);
    const cy = grid.originY + node.row * grid.rowHeight + (node.dy || 0);
    return { ...node, width, height, x: cx - width / 2, y: cy - height / 2, cx, cy };
  }

  const nodes = new Map(nodeList.map((node) => [node.id, (measureNode || defaultMeasure)(node, grid)]));

  const edgeSteps = new Map();
  for (const [index, edge] of relations.entries()) {
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

  function legendY() {
    return viewBox[1] - 36;
  }
  function diagramAreaBottom() {
    return viewBox[1] - legendBand;
  }

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

  function edgeSides(edge) {
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    const hookedFrom = fromSideFor ? fromSideFor(from, to, edge) : null;
    const hookedTo = toSideFor ? toSideFor(from, to, edge) : null;
    return {
      fromSide: chosenSide(edge.fromSide, hookedFrom || defaultFromSide(from, to)),
      toSide: chosenSide(edge.toSide, hookedTo || defaultToSide(from, to)),
    };
  }

  const automaticPorts = automaticPortSpread(relations, nodes, {
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
    const routed = { d: roundedPath(points, edge.cornerRadius ?? cornerRadius), points };
    pathCache.set(edge, routed);
    return routed;
  }

  function edgeName(edge) {
    return edge.label || `${edge.from}->${edge.to}`;
  }

  function labelRectFor(edge, edgeIndex) {
    const [lx, ly] = labelPoint(edge, pathFor(edge).points);
    const longestLine = Math.max(textUnits(edge.label), textUnits(edge.note || ''));
    const width = Math.max(28, longestLine * 4.9 + 12);
    const height = edge.note ? 27 : 16;
    return { relation: edge, relationIndex: edgeIndex, label: edge.label, x: lx - width / 2, y: ly - 11, width, height, lx, ly };
  }

  // Geometry checks shared by every grid type: bounds, spacing, edge length, the composition checks and labels.
  function geometryProblems({ minGap = 12, minEdge = 24, obstacleKind = 'node', moveHint = 'col/row/dx/dy' } = {}) {
    const problems = [];
    for (const node of nodes.values()) {
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
    }
    const all = [...nodes.values()];
    for (let i = 0; i < all.length; i += 1) {
      for (let j = i + 1; j < all.length; j += 1) {
        if (rectsOverlap(all[i], all[j], minGap)) {
          problems.push(`Nodes "${all[i].id}" and "${all[j].id}" are less than ${minGap}px apart — give them different col/row or adjust dx/dy.`);
        }
      }
    }
    for (const group of groups) {
      for (const id of group.nodes) {
        if (!nodes.has(id)) problems.push(`Group "${group.id}" references unknown node "${id}".`);
      }
    }
    for (const edge of relations) {
      if (!nodes.has(edge.from) || !nodes.has(edge.to)) continue;
      const routed = pathFor(edge);
      const [start, end] = [routed.points[0], routed.points[routed.points.length - 1]];
      const distance = Math.hypot(end[0] - start[0], end[1] - start[1]);
      if (distance < minEdge) problems.push(`Edge "${edgeName(edge)}" is too short (${Math.round(distance)}px; minimum ${minEdge}px) — move a node or choose other sides.`);
    }
    const endpointIds = new Set(nodes.keys());
    const common = { relations, endpointIds, pathFor, diagramType, relationCollection, profile: diagram.meta?.quality_profile };
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
      obstacleKind,
      routeHint: `adjust fromSide/toSide, set route/via or channelX/channelY, or move the ${obstacleKind} with ${moveHint}`
    }));
    problems.push(...cleanCrossingProblems({ ...common, routeHint: 'adjust route/via or channelX/channelY so the edges use separate corridors' }));
    problems.push(...cleanAmbiguousCorridorProblems({ ...common, routeHint: 'adjust route/via or channelX/channelY so unrelated edges do not visually merge' }));
    problems.push(...cleanBorderRunProblems({ ...common, frames }));
    problems.push(...cleanRouteRhythmProblems({ ...common, routeHint: 'move route/via or channel coordinates so each turn has a readable run-up' }));

    const labelRects = [];
    for (const [edgeIndex, edge] of relations.entries()) {
      if (!edge.label || !nodes.has(edge.from) || !nodes.has(edge.to)) continue;
      labelRects.push(labelRectFor(edge, edgeIndex));
    }
    for (const rect of labelRects) {
      for (const node of nodes.values()) {
        if (rectsOverlap(rect, node, -2)) {
          problems.push(`Label "${rect.label}" overlaps ${obstacleKind} "${node.id}" — adjust labelDx/labelDy/labelSegment or set labelAt.\n${suggestLabelObstacleFix(rect, rect.lx, rect.ly, node, obstacleKind)}`);
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
    return problems;
  }

  // markerFor may return null (a plain UML association has no arrowhead); extraAttrsFor adds
  // per-relation presentation attributes such as a dash pattern.
  function renderEdgePath(edge, index, { markerFor = null, classFor = null, strokeWidthFor = null, extraAttrsFor = null } = {}) {
    const [cls, marker] = arrowClassMap[edge.variant || 'default'] || arrowClassMap.default;
    const routed = pathFor(edge);
    const strokeWidth = edge.width || (strokeWidthFor ? strokeWidthFor(edge) : (edge.variant === 'emphasis' ? 2 : 1.2));
    const markerId = markerFor ? markerFor(edge, marker) : marker;
    const className = classFor ? classFor(edge, cls) : cls;
    const markerAttr = markerId ? ` marker-end="url(#${markerId})"` : '';
    const extraAttrs = extraAttrsFor ? extraAttrsFor(edge) : '';
    return `        <path ${focusEdgeAttrs(edge.from, edge.to, edge.label, index, edge.id)} data-composition-points="${routePointsValue(routed.points)}" d="${routed.d}" class="${className}" fill="none" stroke-width="${strokeWidth}"${markerAttr}${extraAttrs}${animateAttr(diagram.meta, 'edge', index)}/>`;
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

  function renderLegend({ catalog, presentKinds, renderSwatch }) {
    const entries = resolveLegend(diagram.meta?.legend, catalog, presentKinds);
    return renderResolvedLegend({
      entries,
      locale: diagram.meta.locale,
      layout: {
        x: 40,
        baselineY: legendY(),
        width: viewBox[0] - 80,
        minTitleY: diagramAreaBottom() + 8,
        unfit: diagram.meta?.legend === undefined ? 'hide' : 'error',
        diagramType,
      },
      renderSwatch,
    });
  }

  return {
    grid, nodes, groups, frames, relations, edgeSteps,
    legendY, diagramAreaBottom,
    edgeSides, pathFor, edgeName, labelRectFor, automaticPorts,
    geometryProblems, renderEdgePath, renderEdgeLabel, renderGroups, renderLegend,
  };
}
