// UML line ends shared by the UML-family renderers (class, use case, activity).
// userSpaceOnUse keeps each glyph the same size on every stroke width; hollow
// shapes are filled with the mask colour so the line underneath disappears.
export function renderUmlMarkers() {
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
          <marker id="uml-filled-arrow" markerUnits="userSpaceOnUse" markerWidth="12" markerHeight="10" refX="11" refY="5" orient="auto">
            <path d="M1 1 L11 5 L1 9 Z" ${filled}/>
          </marker>
        </defs>`;
}
