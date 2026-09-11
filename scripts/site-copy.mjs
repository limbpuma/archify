export const DIAGRAM_TYPES = Object.freeze([
  'architecture',
  'workflow',
  'sequence',
  'dataflow',
  'lifecycle',
  'flowchart',
  'struktogramm',
  'uml-class',
  'flowchart',
  'struktogramm',
  'erd',
  'epk',
]);

export const DIAGRAM_TYPE_LABELS = Object.freeze({
  en: Object.freeze({
    architecture: 'Architecture',
    workflow: 'Workflow',
    sequence: 'Sequence',
    dataflow: 'Data flow',
    lifecycle: 'Lifecycle',
    flowchart: 'Flowchart',
    struktogramm: 'Struktogramm',
    'uml-class': 'Class diagram',
    flowchart: 'Flowchart',
    struktogramm: 'Struktogramm',
    erd: 'ER diagram',
    epk: 'Event-driven process chain',
  }),
  zh: Object.freeze({
    architecture: '架构图',
    workflow: '工作流',
    sequence: '时序图',
    dataflow: '数据流',
    lifecycle: '生命周期',
    flowchart: '流程图',
    struktogramm: '结构图',
    'uml-class': '类图',
    flowchart: '流程图',
    struktogramm: '结构图',
    erd: '实体关系图',
    epk: '事件驱动过程链',
  }),
});

export function diagramTypeCopyReplacements() {
  const replacements = {
    '[[DIAGRAM_TYPES_JSON]]': JSON.stringify(DIAGRAM_TYPES),
    '[[DIAGRAM_TYPE_LABELS_JSON]]': JSON.stringify(DIAGRAM_TYPE_LABELS),
  };

  for (const type of DIAGRAM_TYPES) {
    const placeholder = type.toUpperCase();
    replacements[`[[DIAGRAM_TYPE_${placeholder}_EN]]`] = DIAGRAM_TYPE_LABELS.en[type];
    replacements[`[[DIAGRAM_TYPE_${placeholder}_ZH]]`] = DIAGRAM_TYPE_LABELS.zh[type];
  }

  return replacements;
}
