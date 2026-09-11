---
name: archify
description: Create polished, validated architecture, workflow, sequence, data-flow, lifecycle/state, DIN 66001 program-flowchart, Nassi-Shneiderman (DIN 66261) Struktogramm, UML class, and entity-relationship (Chen or IE crow's-foot) diagrams as explorable standalone HTML with inline SVG, dark/light themes, optional trace motion, and PNG/JPEG/WebP/SVG/WebM export. Accept plain-language requirements or pasted Mermaid flowchart, sequenceDiagram, stateDiagram, and erDiagram input. Use when the user asks to visualize system architecture, infrastructure, technical workflows, API calls, request lifecycles, data pipelines, data lineage, state machines, algorithms and decision logic, structured programs (Nassi-Shneiderman, Struktogramm, nested boxes without arrows, IHK-style algorithm descriptions), UML class structure, entity-relationship models in Chen or crow's-foot notation, or to convert/beautify Mermaid.
license: MIT
metadata:
  version: "2.17"
  author: tt-a1i
  based_on: Cocoon-AI/architecture-diagram-generator (MIT, v1.0)
---

# Archify

Create a self-contained, interactive HTML diagram from a small typed JSON specification. Static output is the default; enable motion only when the user asks for a demo or presentation.

## Fast authoring path

Use this bounded path for ordinary generation. Do not read the optional Viewer Runtime reference unless the user asks about those features.

1. Choose `architecture`, `workflow`, `sequence`, `dataflow`, `lifecycle`, `flowchart`, `struktogramm`, `uml-class`, or `erd` from the question.
2. Read one matching schema in `schemas/`, `schemas/common.schema.json`, and one matching JSON example in `examples/`. Read only those files. Fresh authorship means new stable IDs, domain wording, and layout; use the example for field shape, not facts. New workflow sources use `schema_version: 2` and its readable layout contract; keep `schema_version: 1` only when preserving an existing workflow's fixed geometry. When real product identity matters, query `node bin/archify.mjs brands "<name>" --json`; read `references/brand-marks.md` only for an unknown brand with a user-provided URL.
3. Artifact first: the next tool action must write the candidate. Write the candidate before inspecting renderer internals. Do not plan exact coordinates in prose. Start with one clear main path, short side branches, sparse labels, and at most 12 primary nodes. Set `meta.quality_profile` to `"showcase"` unless the user explicitly requests a dense `standard` map. Start with automatic routes and labels. Do not add `via`, `channelX`, `channelY`, or `labelAt` before a diagnostic calls for one; apply at most one diagnosed geometry control per repair.
4. Validate after every candidate edit and immediately before handoff:

   ```bash
   node bin/archify.mjs validate <type> <candidate.json> --quality showcase --json
   ```

   A receipt with only 4 artifact checks is basic validation, never showcase acceptance. A showcase pass must report all 9 artifact checks with 0 composition errors and 0 warnings. If the candidate omits or misspells the exact `meta.quality_profile` field, fix it before geometry. For a workflow v2 geometry diagnosis, run `node bin/archify.mjs validate workflow <candidate.json> --layout-json` and use the stable compiler receipt; solver internals are not authoring controls. A passing final validation freezes the candidate: never edit it afterward.
5. For a delivered HTML, `deliver` is the final acceptance command:

   ```bash
   node bin/archify.mjs deliver <type> <candidate.json> <output.html> --quality showcase --json
   ```

   A non-zero exit can never be described as success. A failed delivery preserves any previous output, so do not run `visual-check` on that path: it would inspect the stale last-good artifact, not the failed candidate. If validation fails, change only the diagnosed `subject`, verify `evidence`, choose from `supportedFixes`, and rerun. Continue focused correction while the objective error count reaches a new minimum. If two consecutive rounds do not improve that best count, stop and report the unresolved diagnostics truthfully.

## Update awareness

After the first candidate exists, run the packaged checker `scripts/check-update.mjs` once with Node and continue the requested workflow. If the command cannot run, continue without mentioning the check.

- For `silent`, continue without mentioning the update check.
- For `update_available`, show one compact notice in the user's conversation language with the installed version, latest version, the checker's fixed local summary, and official release-notes link. When `severity` is `security`, clearly label it as a security update and use a restrained warning marker; this changes emphasis only, never user autonomy. Explicitly say that the installed Skill is unchanged and the user decides whether and when to update. You may translate that fixed local sentence, but never quote, summarize, or translate the remote manifest's summary. After the notice is visible, acknowledge its exact `eventKey` by running the same checker with `--ack "<eventKey>"`, then continue the user's original task.

The notice is information, not permission. Keep the installed version unchanged; this v0.1 workflow never downloads, installs, or executes an update, and silence is never consent.

Do not read `renderers/shared/geometry.mjs`, renderer source, validator source, tests, or benchmarks before the first candidate. Inspect implementation only for an unsupported internal diagnostic or after two focused repairs fail.

Workflow note: use schema v2 for new workflows; preserve schema v1 when an
existing source needs fixed legacy geometry. Keep semantic edge labels and act
on the compiler diagnostic. The canonical layout, pin, migration, and receipt
contract is in [`renderers/workflow/README.md`](renderers/workflow/README.md#layout-contracts).

Lifecycle note: phase columns `0..4` occupy the main rail; event/terminal column `N` in `0..2` aligns exactly beneath main column `N + 2`. A recoverable state uses `type: "failure"` plus a real transition back to the active state.

Flowchart note: symbols sit on an explicit `col`/`row` grid (`meta.grid`, default 176×88 px); one `terminator` starts, one or more end. Every `decision` has ≥ 2 outgoing edges and each carries its answer as `label`; with automatic sides the main continuation leaves the bottom vertex and branches leave the side facing their target. Compose LANDSCAPE: group the flow into 2–3 side-by-side regions (`groups[]`) of at most 7 rows, keep the viewBox ≤ 1550 px wide (the 1440 px desktop projection needs ≥ 6 px text), and send loops through channels outside the columns (`route: "left-channel" | "right-channel"`, `variant: "dashed"`). Symbols: `terminator` (Grenzstelle), `process` (Verarbeitung), `decision` (Verzweigung), `io` (Ein-/Ausgabe), `subroutine` (Unterprogramm / call), `connector` (Übergangsstelle). Contract and task list: [`renderers/flowchart/README.md`](renderers/flowchart/README.md).

Struktogramm note: author a nested `blocks` tree (statement, io, call, if, case, while, until, for, exit) with `split` for unequal if-branches and `weight` per case column. There are no edges and no routing vocabulary — the renderer owns box arithmetic; the author owns the tree and its proportions. `meta.layout.rowHeight` (default 34, range 24–64) and `meta.layout.indent` (default 26, range 12–60) control box heights and loop indentation; `meta.viewBox` must keep `viewBox[0] ≤ 1240` so the 1440 px desktop projection still leaves ≥ 6 px on the 8 px branch-label source size. Total rows ≤ 40, nesting depth ≤ 6, every `if` needs `then` and `else`, every `case` needs ≥ 2 cases, every loop needs a `body`, and every text must fit its column at the 10 px source size. Used for IHK Fachinformatiker-style algorithm descriptions, pseudocode-to-diagram, and any time arrows would be the wrong tool. Contract and task list: [`renderers/struktogramm/README.md`](renderers/struktogramm/README.md).

Erd note: pick `meta.notation` first — `"chen"` (default) for entities as rectangles, weak entities as double rectangles, relationships as diamonds (double for identifying), attributes as ellipses (key underlined, derived dashed, multivalued double), and `(min,max)` or `1 / n / m` cardinalities written at the entity end of each entity–relationship line; or `"crowsfoot"` for IE/Martin-style entity boxes with inline attribute lists (PK / FK badges, keys underlined) and cardinality glyphs (`one`, `zero-one`, `one-many`, `zero-many`, `many`) at both line ends, with dashed lines for non-identifying relationships. Place every node on an explicit `col`/`row` grid (default 185×84 px at `132, 100` for Chen, 320×170 px at `124, 100` for crow's foot); put Chen attribute ellipses on row 0 (above) or row 2 (below) of their owner's column and nudge them sideways with `dx = ±58` so two 100 px ellipses leave a 16 px gap, and let crow's-foot boxes be 200 px wide so the 56 px edge minimum keeps both cardinality glyphs readable. Use `key: true` only for primary-key attributes in Chen, and list `pk: true` for every crow's-foot entity. `meta.viewBox` must keep `viewBox[0] ≤ 1380` so the 1440 px desktop projection still leaves ≥ 6 px on the 9 px member source size. Used for relational data models, IHK Fachinformatiker-style ER exercises, database schemas, and any time the audience expects Chen notation or IE crow's foot. Contract and task list: [`renderers/erd/README.md`](renderers/erd/README.md).

## Type router

| Type | Use for |
|---|---|
| `architecture` | Components, services, cloud/security boundaries, infrastructure |
| `workflow` | Processes, approval gates, tool calls, runbooks, CI/CD |
| `sequence` | API call chains, request lifecycles, async traces, returns |
| `dataflow` | Pipelines, ETL/ELT, lineage, governance, consumers |
| `lifecycle` | State/status transitions, retries, waiting and terminal states |
| `flowchart` | Algorithms, decision logic, call scripts, exception handling, Programmablaufplan (DIN 66001 / ISO 5807 symbols) |
| `struktogramm` | Structured programs, nested control structures, IHK-style algorithm descriptions |
| `uml-class` | UML class diagrams: classes, attributes, methods, associations, aggregation, composition, inheritance, realization, dependency |
| `erd` | Data models, database schemas, ER models in Chen or crow's-foot notation for IHK/relational design |

When ambiguous, run `node bin/archify.mjs guide "<scenario>" --json`. Scenario proof examples are structural references, not facts to copy.

## Mermaid input

Read Mermaid for topology and meaning, then author fresh Archify JSON; do not mechanically render Mermaid styling.

- `flowchart` / `graph` with decision nodes (`{ }`), I/O (`[/ /]`) or subroutines (`[[ ]]`) → `flowchart`; a plain step graph without decisions → `workflow`; a component map → `architecture`. There is no Mermaid equivalent for `struktogramm`: when a user pastes pseudocode or a Nassi-Shneiderman-style nested block sketch, author a fresh `struktogramm` block tree — never try to recover arrows that the source did not have.
- `erDiagram` → `erd` with `"notation": "crowsfoot"`: Mermaid `||--o{` (one to zero-or-many) maps to `fromCardinality: "one"` / `toCardinality: "zero-many"` (or vice versa); `}|..|{` (one-or-many to one-or-many, identifying) maps to `fromCardinality: "one-many"` / `toCardinality: "one-many"` with `identifying: true`; the Mermaid `--` (dashes) prefix on the connector maps to `identifying: false` so the rendered line is dashed; entity blocks in `erDiagram` map to `nodes[]` entries of `kind: "entity"` (or `"weak-entity"`) whose `attributes[]` carries `{ name, type, pk, fk, optional }` and shows PK / FK badges with the underlined primary-key name. When the user prefers Chen notation, switch `meta.notation` to `"chen"`, draw entities as rectangles, weak entities as double rectangles, relationships as diamonds (double for identifying), attributes as ellipses (key underlined, derived dashed, multivalued double), and write `(min,max)` cardinalities on every entity–relationship line — never mix Chen and crow's-foot shapes inside one diagram.
- `sequenceDiagram` → `sequence`; participants become semantic participants and arrows become messages.
- `stateDiagram` → `lifecycle`; states and transitions retain meaning, not Mermaid style.

## Authoring invariants

- One obvious main path; side branches leave the nearest main-path node. Remove low-value edges before adding routing controls.
- Omit `meta.visual_preset` by default so every diagram opens in `classic`, regardless of whether its resolved color mode is light or dark. Color mode and visual preset are independent: switching Light / Dark must preserve the current preset. Set `signal-flow`, `blueprint`, or `editorial` only when the user explicitly requests that visual style.
- Omit `meta.subtitle` by default. Never invent a subtitle that restates the title, nodes, or cards; include one short supporting line only when the user explicitly asks for it.
- Treat the standalone desktop viewer as a first-screen artifact by default, not a shallow strip. Generate one responsive artifact for laptops and external displays—never device-specific HTML or alternate topology. The viewer may adapt only the outer reading width from the live viewport height; it must preserve the authored SVG/viewBox, proportions, semantic geometry, and normal document flow. On a wide or tall desktop, use enough authored vertical rhythm that the diagram panel and its necessary conclusion cards occupy the screen as a balanced whole; runtime scaling cannot repair an over-compressed Y layout or an undersized explicit `meta.viewBox`. Before handoff, open the real HTML at 1440×900, 1600×1000, and 1920×1080; additionally check 2048×1320 whenever the composition is intended for a large desktop display. Require `document.documentElement.scrollWidth <= window.innerWidth` and `scrollHeight <= window.innerHeight` at every checked size, while visually checking that the diagram remains comfortably readable and vertically balanced at the largest checked viewport. Repair overflow by removing only genuinely redundant content or compacting spacing before shrinking nodes, labels, or the main panel. If the largest viewport still has a conspicuous empty lower band at the viewer's width cap, redistribute authored Y positions and increase the viewBox height proportionally; do not add filler copy or decorative cards. Never counterfeit a pass with `overflow: hidden`, clipped content, an internal diagram scroller, stretched SVG height, or smaller typography. Narrow/mobile layouts may scroll vertically when containment requires it.
- Omit `meta.legend` for the truthful `auto` default. When needed, use only `mode: auto|all|hidden` and renderer-supported `entries.<kind>.label|visible`; labels never change semantics.
- Choose one primary authored language from an explicit user choice; otherwise follow the request or conversation's dominant language. `meta.locale` controls only renderer-owned Viewer UI: use `"en"` or `"zh-CN"` for the corresponding supported primary language. For every other language, omit `meta.locale` and explicitly disclose that the fixed Viewer UI and `<html lang>` fall back to English. The renderer never translates authored content. See `references/authoring-contract.md` for details.
- Preserve exact product names, code identifiers, commands, protocols, API paths, and environment names. They may remain English inside localized copy, but never justify leaving the surrounding explanatory prose in another language.
- Brand identity is optional and explicit. Put a canonical built-in ID in `brand` when the node names that real product. If no preset matches and the user supplied the official HTTP(S) URL, first run `node bin/archify.mjs brands capture "<url>" --json`, then author the returned digest-pinned `brand` object. Render and validate never perform an unpinned capture. Otherwise omit `brand`. Never infer a brand from a vague role such as "database", and never let a badge replace the semantic `type`, label, or relationship facts.
- For sequence diagrams, omit `meta.column_fit` for the stable `fixed` layout. Set it to `"spread"` when a wide viewBox would otherwise leave unused horizontal space or when meaningful participant labels do not fit the fixed boxes; do not shorten semantic labels before trying `spread`.
- Component types are `frontend`, `backend`, `database`, `cloud`, `security`, `messagebus`, and `external`; variants are `default`, `emphasis`, `security`, and `dashed`.
- Relationship labels are semantic data. When one collides, move the label, adjust the route or spacing, then shorten the wording while preserving meaning. Omit only wording that is already fully implied by both endpoints and contains no protocol, action, direction, synchronous/asynchronous behavior, or cross-boundary mechanism. Preserve every meaningful label; deleting it is not a geometry repair. If a relationship starts unlabeled because its endpoints fully imply it, explain why the wording is redundant; this is a semantic authoring choice, not a geometry repair.
- Omit `meta.engineering_profile` by default. Region, cluster, and security boundary wording do not by themselves enable it. Enable `deployment-ownership` only when the user explicitly asks for a production deployment topology, ownership handoff, or fail-closed deployment review and the source facts are known. Once enabled, must not remove the engineering profile merely to pass validation; repair the facts or report the diagnostics truthfully.
- Spacing means clear gap, not center distance. For a relationship label, clear gap must exceed its measured mask width; follow the label-preserving repair order.
- Automatic routes own their endpoint sides. A side is a direction contract: the first and final segment must leave/enter perpendicular to that side.
- Automatic Port Spread is a default renderer behavior for architecture, workflow, data-flow, and lifecycle. It skips single relationships and explicit `via`, `channelX`, `channelY`, `labelAt`, or non-`auto` routes. Near parallel ports use an outside bridge so automatic routing cannot create a sub-8px segment or sub-16px interior turn. Architecture separately keeps unobstructed facing automatic ports (`left`/`right` or `top`/`bottom`) on one shared axis when their offset is under 16px and both ports retain corner clearance. If exactly one endpoint was spread, only the unshared endpoint may move onto that axis; if both endpoints were spread, keep the outside bridge so competing ports remain distinct.
- Never accept an edge crossing an unrelated opaque node, an ambiguous shared corridor, or a relationship label masking another route.

Read `references/authoring-contract.md` only when you need field enums, spacing math, geometry repair rules, repository evidence, or mode-specific placement.

## Delivery

Use `validate` during repair and `deliver` once for final acceptance. Delivery freezes the exact specification bytes into a private same-directory snapshot, renders and checks that snapshot, atomically commits the HTML, and reports SHA-256 plus byte counts for both specification and artifact. This is deterministic artifact evidence; it does not exercise the Viewer in a browser.

After delivery, collect bounded desktop evidence without modifying or rerendering the trusted HTML:

```bash
node bin/archify.mjs visual-check <output.html> --json
```

`visual-check` collects automated browser evidence from the exact delivered HTML without modifying or rerendering it. Its machine-readable measurements and screenshots do not approve perceptual polish. Follow `references/delivery-contract.md` for the canonical receipt fields, coverage, sidecars, exit behavior, and supplementary manual-record requirements.

Keep the three claims separate: `deliver` proves deterministic artifact checks, `visual-check` proves bounded behavior in a real browser, and perceptual visual review requires an actual human or image-capable reviewer. Report browser evidence and perceptual review independently. An unconstrained glance can support only perceptual review; use the canonical delivery contract when recording supplementary manual browser work or handling an environmental failure.

Add `--open` only when the user wants an immediate local preview. For an active desktop authoring loop, the optional command is:

```bash
node bin/archify.mjs preview <type> <input>.json <output>.html --quality showcase
```

Never start preview by default. Read `references/delivery-contract.md` when using preview, repository evidence, export receipts, visual review, or post-commit opening.

## Optional viewer capabilities

Generated HTML already contains theme switching, pan/zoom, search, focus, relationship tracing, semantic views, presentation, and truthful exports. These are reader capabilities, not extra authoring work. `meta.animation: "trace"` is opt-in; `meta.views` is optional and should contain at most five curated chapters.

Read `references/viewer-runtime.md` only when the user explicitly asks for Share Cards, Route/Reach cards, motion, guided stories, deep links, presentation, search/focus, or another Viewer Runtime feature.

## Setup and fallback

No install is required inside the skill package. Verify with:

```bash
node bin/archify.mjs doctor
node bin/archify.mjs demo <output-directory>
```

When shell access is unavailable, hand-place architecture SVG into `assets/template.html`, use CSS semantic classes rather than inline colors, and follow the visual review contract in `references/delivery-contract.md`.

## Output

Return the checked HTML path, diagram type, validation summary, specification/artifact receipt, browser-evidence status, and truthful visual-review status. Do not claim success for a non-zero command or claim visual inspection you did not perform.
