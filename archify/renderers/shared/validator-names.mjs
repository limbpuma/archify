// AJV standalone exports one function per schema and the export must be a JS
// identifier, so hyphenated diagram types (uml-class) map to camelCase names.
export function validatorExportName(diagramType) {
  return String(diagramType).replace(/-([a-z0-9])/g, (_, character) => character.toUpperCase());
}
