# archify (fork of tt-a1i/archify) — agent notes

Fork purpose: add diagram types that German IT documentation needs (first: `flowchart`, DIN 66001 program
flowchart). Upstream stays the source of truth for everything else; keep changes upstream-shaped so they can
become a PR.

## Stack and layout
- Node ≥ 18, ES modules, no runtime dependencies. Dev deps (ajv, parse5, saxes) live in `archify/package.json`.
- The Skill package is `archify/`: `bin/archify.mjs` (CLI), `renderers/<type>/render-<type>.mjs` (one standalone
  script per type), `renderers/shared/*` (geometry, validators, legend, i18n, cli helpers), `schemas/*.schema.json`
  (JSON IR, validators generated into `renderers/shared/generated-validators.mjs`), `examples/`, `test/`, `SKILL.md`.
- Repository root holds docs, site build scripts and `CONTRIBUTING.md` / `REVIEWING.md` — read them before changing
  shared behavior.

## Commands (run from `archify/`)
- Install: `npm ci`
- Regenerate validators after a schema change: `npm run generate:validators`
- Full test suite (must be green before any task is reported done): `npm test`
- Validate / deliver one diagram: `node bin/archify.mjs validate <type> <input.json> --quality showcase --json`,
  `node bin/archify.mjs deliver <type> <input.json> <output.html> --quality showcase --json`

## Rules
- English identifiers, comments, docs and commits. Conventional commits (`feat:`, `fix:`, `test:`, `docs:`).
- Never edit shared validation thresholds, `generated-validators.mjs` by hand, `skill-release.json`, version numbers
  or checked-in golden HTML of other types to make a check pass.
- Explicit geometry is the product: no auto-layout libraries, no dagre/elk.
- Never push. Commit on the feature branch only.
- Active feature contract: `archify/renderers/flowchart/README.md`.
