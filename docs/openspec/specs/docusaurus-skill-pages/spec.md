---
status: draft
date: 2026-05-10
implements: [ADR-0029]
extends: [SPEC-0004]
related: [SPEC-0014, SPEC-0018]
---

# SPEC-0021: Docusaurus Skill Page Generation

## Overview

Formalizes ADR-0029 by defining how the docs-site build pipeline auto-generates a per-skill Docusaurus page and a hero-tile index from each `skills/{name}/SKILL.md` (the same file Claude Code loads at runtime), with an opt-in editorial override hatch protected by a build-time SHA-256 pin. This spec extends SPEC-0004 (Documentation Site Generation): it adds a third transform (`transform-skills.js`) alongside the existing ADR and OpenSpec transforms, a `skillsSidebar` and "Skills" navbar entry, and a `/skills/` route group. It also requires installation and configuration of `@docusaurus/plugin-client-redirects` so the staged migration of `docs-site/content/guides/commands.mdx` can preserve every external inbound link.

The spec defines: (1) the SKILL.md → MDX schema and section-ordering algorithm (canonical sections in fixed positions, non-canonical H2 sections appended verbatim in source order); (2) the `skills/_index.json` manifest schema and bidirectional consistency check; (3) the override file format and the `Governing-SKILL: <path>@<sha256>` pin; (4) silent vs. fail-build behavior for every edge case enumerated in ADR-0029; (5) governing-comment aggregation, dedup, and pill rendering; (6) the staged `commands.mdx` migration and per-anchor redirect requirements; (7) integration into the existing `build-docs.js` orchestrator without any change to `.github/workflows/deploy-docs.yml`.

This is a docs-site spec: there is no auth surface, no user input, and no JavaScript executed beyond what the existing Docusaurus pipeline already mitigates. The security-by-default injection from SPEC-0016 does not apply; see `design.md` § Security Posture for the rationale.

## Requirements

### Requirement: Per-Skill Page Generation

The docs-site build pipeline MUST emit exactly one MDX file per directory under `skills/` containing a `SKILL.md`. The output path MUST be `docs-generated/skills/{name}.mdx` and MUST resolve at the route `/skills/{name}` after Docusaurus build. The transform script `docs-site/scripts/transform-skills.js` MUST own this generation and MUST NOT be inlined into other transforms.

#### Scenario: every skill produces one page

- **WHEN** `npm run build` runs in `docs-site/` and `skills/` contains directories `adr/`, `work/`, `graph/`, and `prime/`, each with a `SKILL.md`
- **THEN** `docs-generated/skills/` MUST contain `adr.mdx`, `work.mdx`, `graph.mdx`, `prime.mdx`, and `index.mdx`
- **AND** the deployed routes `/skills/adr`, `/skills/work`, `/skills/graph`, `/skills/prime`, and `/skills/` MUST all resolve

#### Scenario: editing one SKILL.md regenerates only that page

- **WHEN** the contents of `skills/work/SKILL.md` change and `npm run build` runs
- **THEN** `docs-generated/skills/work.mdx` MUST reflect the change
- **AND** the other skill MDX files MUST be byte-identical to the prior build (modulo any unrelated transforms)

### Requirement: Source-File Schema Mapping

`transform-skills.js` MUST extract the following inputs from each skill and place them at the documented output positions:

- Frontmatter `name` → page H1, sidebar label, URL slug.
- Frontmatter `description` → page subtitle, hero-tile description, `<meta>` description.
- Frontmatter `argument-hint` → "Usage" code block.
- Frontmatter `allowed-tools` → collapsed "Required Tools" detail block.
- Frontmatter `disable-model-invocation` (when present and truthy) → a "Manual-Invocation Only" badge near the page title.
- Any other frontmatter key → ignored for rendering, preserved in the source file.
- Body intro paragraph (text after H1, before the first H2) → "Overview" section.
- Body `## Process` section → "Process" section, with header levels demoted by one so the page has a single H1.
- Body `## Rules` section → "Rules" section, header levels demoted by one.
- Any other H2 section in the SKILL.md body → appended verbatim (modulo `mdx-escape.js`) in source order between Rules and Reference, header levels demoted by one.
- Sibling `references/*.md` files in the skill directory → "Reference" appendix, one collapsible `<details>` per file.
- `evals/triggers/{name}.json` entries with `should_trigger: true` → "Example Invocations" code block, capped at 5 entries (the first 5 in file order).
- All `<!-- Governing: ... -->` and `<!-- Implements: ... -->` comments anywhere in the file (excluding YAML frontmatter) → "Governing Artifacts" pill list rendered above the Overview.

#### Scenario: frontmatter fields populate the canonical positions

- **WHEN** `skills/adr/SKILL.md` has frontmatter `name: adr`, `description: "Create a new Architecture Decision Record (ADR)..."`, `argument-hint: "[topic]"`, and `allowed-tools: [Read, Write, AskUserQuestion]`
- **THEN** `docs-generated/skills/adr.mdx` MUST render an H1 derived from `name`, a subtitle line containing the description, a "Usage" code block containing `/sdd:adr [topic]`, and a collapsed details element listing `Read, Write, AskUserQuestion`

#### Scenario: a skill with `disable-model-invocation: true`

- **WHEN** `skills/{name}/SKILL.md` frontmatter contains `disable-model-invocation: true`
- **THEN** the generated page MUST display a "Manual-Invocation Only" badge near the title
- **AND** the absence of the field (or a falsey value) MUST omit the badge

### Requirement: Section Ordering

The generated page MUST emit sections in this fixed order: (1) H1 Title, (2) Subtitle, (3) "Governing Artifacts" pill list (if any), (4) Usage, (5) Required Tools, (6) Overview, (7) Process, (8) Rules, (9) every non-canonical H2 from the source file in source order, (10) Reference, (11) Example Invocations. Canonical sections (Title, Subtitle, Usage, Required Tools, Overview, Process, Rules, Reference, Example Invocations, Governing Artifacts) MUST appear at fixed positions; non-canonical H2 sections MUST be appended verbatim in source order between Rules and Reference; no other position is allowed for them.

#### Scenario: a skill with non-canonical H2 sections renders them in source order

- **WHEN** `skills/adr/SKILL.md` body contains `## Process`, `## MADR Template`, `## Architecture Diagram`, `## Graph Edge Frontmatter`, and `## Rules` in that source order
- **THEN** the generated `adr.mdx` MUST emit Title → Subtitle → Governing Artifacts → Usage → Required Tools → Overview → Process → Rules → MADR Template → Architecture Diagram → Graph Edge Frontmatter → Reference → Example Invocations
- **AND** the non-canonical H2s MUST appear in their original source order (MADR Template before Architecture Diagram before Graph Edge Frontmatter)

#### Scenario: missing canonical Process or Rules section

- **WHEN** `skills/{name}/SKILL.md` does not contain a `## Process` or `## Rules` H2
- **THEN** the generated page MUST omit the corresponding section
- **AND** the build MUST succeed
- **AND** non-canonical H2s and the Reference / Example Invocations sections MUST still render

### Requirement: Hero-Tile Index Page

`transform-skills.js` MUST also emit `docs-generated/skills/index.mdx` rendering a `<SkillTile>` per registered skill. Each tile MUST carry the skill's name, `description` (truncated to ~140 chars at a word boundary), and `argument-hint`, linking to `/skills/{name}`. Tiles MUST be grouped and ordered exclusively by `skills/_index.json`; per-skill frontmatter MUST NOT influence grouping or order.

#### Scenario: hero tiles render in manifest order

- **WHEN** `skills/_index.json` declares a group `Creating Artifacts` with skills `[adr, spec]` and a group `Implementation` with skills `[work, review]`
- **THEN** `docs-generated/skills/index.mdx` MUST render the Creating Artifacts group before the Implementation group
- **AND** within each group the tiles MUST appear in the order listed in the manifest

#### Scenario: tile description truncation

- **WHEN** a skill's `description` exceeds 140 characters
- **THEN** the tile MUST display the truncated description ending at a word boundary, suffixed with an ellipsis
- **AND** the per-skill page subtitle MUST display the full untruncated description

### Requirement: Manifest Schema and Validation

`skills/_index.json` MUST conform to the JSON Schema at `docs-site/scripts/schemas/skills-index.schema.json`. The manifest MUST be an object whose keys are group display names (strings) and whose values are ordered arrays of skill name strings. `transform-skills.js` MUST validate the manifest with Ajv at the start of the build. Schema violations MUST fail the build with the specific Ajv error message. The schema MUST forbid duplicate skill names across or within groups.

#### Scenario: manifest fails Ajv validation

- **WHEN** `skills/_index.json` contains a group whose value is a string instead of an array
- **THEN** the build MUST fail with the Ajv error identifying the offending key and the expected array type

#### Scenario: duplicate skill across groups

- **WHEN** `skills/_index.json` lists `adr` in both `Creating Artifacts` and `Implementation`
- **THEN** the build MUST fail with an error naming `adr` and both group keys

### Requirement: Bidirectional Manifest Consistency

The set of skill names in `skills/_index.json` MUST equal the set of subdirectories of `skills/` containing a `SKILL.md`. A skill present on disk but absent from the manifest MUST fail the build with an error naming the unregistered skill. A manifest entry referencing a non-existent `skills/{name}/SKILL.md` MUST fail the build with an error naming the stale entry.

#### Scenario: a skill directory exists but is not registered

- **WHEN** `skills/foo/SKILL.md` exists but `foo` does not appear in any group of `skills/_index.json`
- **THEN** the build MUST fail with the error: `skills/foo: not registered in skills/_index.json — add it to a group or remove the directory`

#### Scenario: a manifest entry has no corresponding SKILL.md

- **WHEN** `skills/_index.json` lists `bar` in a group but `skills/bar/SKILL.md` does not exist
- **THEN** the build MUST fail with the error: `skills/_index.json references "bar" but skills/bar/SKILL.md does not exist`

### Requirement: Governing-Comment Aggregation and Cross-Linking

`transform-skills.js` MUST scan the entire SKILL.md body (frontmatter excluded) for `<!-- Governing: ... -->` and `<!-- Implements: ... -->` comments, parse each into ADR-XXXX and SPEC-YYYY references, deduplicate by reference, and sort the deduped set with ADRs ascending followed by SPECs ascending. The result MUST render as a single "Governing Artifacts" pill list at the top of the page (above Overview, below Subtitle). ADR pills MUST link to `/decisions/{adr-slug}` via `transformAdrReferences` from `transform-utils.js`; SPEC pills MUST link to `/specs/{spec-slug}/spec#{req-anchor}` via `transformSpecReferences`. `<!-- Implements: ... -->` comments MUST be folded into the same pill list as `<!-- Governing: ... -->` comments — no separate section.

#### Scenario: multiple comments collapse to a single pill list

- **WHEN** `skills/work/SKILL.md` contains five `<!-- Governing: -->` comments (file-scope and inline within `## Process`) referencing ADR-0017 twice, ADR-0020 once, ADR-0015 once, SPEC-0015 four times, and SPEC-0014 once
- **THEN** the rendered page MUST display one "Governing Artifacts" section above Overview
- **AND** the section MUST contain pills in this order: ADR-0015, ADR-0017, ADR-0020, SPEC-0014, SPEC-0015
- **AND** each ADR pill MUST link to the ADR's `/decisions/...` page via `transformAdrReferences`
- **AND** each SPEC pill MUST link to `/specs/{slug}/spec` via `transformSpecReferences`

#### Scenario: `<!-- Implements: -->` comments fold into the same list

- **WHEN** a SKILL.md contains both `<!-- Governing: ADR-0023 -->` and `<!-- Implements: SPEC-0018 REQ "Validate" -->`
- **THEN** the pill list MUST contain both references
- **AND** there MUST NOT be a separate "Implements" section

#### Scenario: skill with no governing or implements comments

- **WHEN** `skills/{name}/SKILL.md` contains zero `<!-- Governing: -->` and zero `<!-- Implements: -->` comments
- **THEN** the generated page MUST omit the Governing Artifacts section entirely
- **AND** the build MUST succeed without warning

### Requirement: Example Invocations from Eval Triggers

When `evals/triggers/{name}.json` exists, `transform-skills.js` MUST read the file, select up to the first 5 entries with `should_trigger: true`, and render them as an "Example Invocations" code block on the per-skill page. When the file is missing or contains zero entries with `should_trigger: true`, the section MUST be omitted silently.

#### Scenario: skill with curated triggers renders up to 5

- **WHEN** `evals/triggers/work.json` contains 9 entries with `should_trigger: true`
- **THEN** the generated `work.mdx` MUST render an "Example Invocations" section containing the first 5 of those entries
- **AND** the build MUST succeed

#### Scenario: skill with no eval triggers renders no section

- **WHEN** `evals/triggers/foo.json` does not exist for a registered skill `foo`
- **THEN** the generated `foo.mdx` MUST omit the "Example Invocations" section entirely
- **AND** the build MUST succeed without warning

### Requirement: Override File Format and Pin

If `skills/{name}/page.override.mdx` exists, `transform-skills.js` MUST copy it verbatim to `docs-generated/skills/{name}.mdx` and skip auto-generation for that skill. The override MUST contain a header pin of the form `{/* Governing-SKILL: skills/{name}/SKILL.md@<sha256-of-SKILL.md-bytes> */}` as the first non-blank line. The hash MUST be the SHA-256 hex digest of the raw byte content of `skills/{name}/SKILL.md`. `transform-skills.js` MUST recompute that hash at build time and compare it to the pinned value.

#### Scenario: matching pin uses the override

- **WHEN** `skills/work/page.override.mdx` exists with a `Governing-SKILL` pin whose hash matches the current `skills/work/SKILL.md` byte content
- **THEN** the generated `work.mdx` MUST be the verbatim contents of `page.override.mdx`
- **AND** none of the auto-generated sections (Process, Rules, etc.) MUST be merged into the output

### Requirement: Override Pin Mismatch and Helper

A mismatch between the pinned hash and the recomputed hash MUST fail the build with an error naming the override file path, the expected (pinned) hash, the current hash, and the remediation: re-review the override against the new SKILL.md and either run `npm run docs:refresh-overrides` to update the pin or delete the override to fall back to auto-generation. An override file that exists without a `Governing-SKILL` pin header MUST fail the build with an error pointing at the same helper. An override file whose corresponding `skills/{name}/SKILL.md` does not exist MUST fail the build with an "orphan override" error.

The helper script `npm run docs:refresh-overrides` MUST rewrite the pin in place to the current SKILL.md hash. The helper MUST be invoked manually by the author after they have re-reviewed the override.

#### Scenario: stale pin fails the build

- **WHEN** `skills/work/page.override.mdx` carries a `Governing-SKILL` pin whose hash no longer matches the current `skills/work/SKILL.md`
- **THEN** the build MUST fail with an error naming the override file, the expected hash, and the current hash
- **AND** the error MUST instruct the author to run `npm run docs:refresh-overrides` or delete the override

#### Scenario: override missing pin header

- **WHEN** `skills/foo/page.override.mdx` exists but does not contain a `Governing-SKILL: ...@<sha>` header
- **THEN** the build MUST fail with an error naming the override and pointing at `npm run docs:refresh-overrides`

#### Scenario: orphan override

- **WHEN** `skills/foo/page.override.mdx` exists but `skills/foo/SKILL.md` does not
- **THEN** the build MUST fail with an "orphan override" error naming `skills/foo/page.override.mdx`

#### Scenario: refresh helper updates the pin

- **WHEN** the author runs `npm run docs:refresh-overrides` after re-reviewing `skills/work/page.override.mdx`
- **THEN** the helper MUST rewrite the `Governing-SKILL` header in place with the SHA-256 of the current `skills/work/SKILL.md`
- **AND** the helper MUST NOT modify any other line of the override

### Requirement: Pipeline Integration

`docs-site/scripts/build-docs.js` MUST invoke `transform-skills.js` after `transform-openspecs.js` (so spec mappings are available to governing-comment cross-links) and before `generate-graph.js` (so generated skill pages can later participate in the artifact graph). `transform-skills.js` MUST NOT introduce new external runtime dependencies beyond Ajv (already permitted for manifest validation). `.github/workflows/deploy-docs.yml` MUST NOT require modification by this spec; the existing `npm run build` step MUST pick up the new transform automatically on the next push to `main`.

#### Scenario: orchestrator order

- **WHEN** `npm run build` runs
- **THEN** `transform-skills.js` MUST run after `transform-openspecs.js` completes
- **AND** MUST run before `generate-graph.js` begins

#### Scenario: deploy workflow unchanged

- **WHEN** this spec's implementation lands on `main`
- **THEN** `.github/workflows/deploy-docs.yml` MUST NOT be modified by the implementation PR
- **AND** the workflow's existing `npm run build` step MUST produce a deployable site that includes `/skills/` and `/skills/{name}` routes

### Requirement: Routing, Sidebar, and Navbar

The implementation MUST add a `skillsSidebar` to `docs-site/sidebars.ts` listing the hero-tile index at `/skills/` and one entry per skill at `/skills/{name}` in the order defined by `skills/_index.json`. `docs-site/docusaurus.config.ts` MUST register a "Skills" navbar entry positioned between "Guides" and "ADRs". The route prefix `/skills/` MUST resolve to the hero-tile index page; the route `/skills/{name}` MUST resolve to the per-skill page.

#### Scenario: navbar order

- **WHEN** the deployed site renders the navbar
- **THEN** the entries MUST appear in the order: Guides, Skills, ADRs (with any other entries unchanged in their existing positions)

#### Scenario: sidebar reflects manifest order

- **WHEN** `skills/_index.json` is reordered (a skill moves between groups, or its position within a group changes)
- **THEN** the next build MUST produce a `skillsSidebar` matching the new order
- **AND** the rendered sidebar MUST display skills in the new order

### Requirement: MDX Safety

`transform-skills.js` MUST run all generated content through `mdx-escape.js` before writing the output file, including the verbatim non-canonical H2 sections and the verbatim Reference appendix bodies. Override files copied verbatim MUST NOT be re-escaped (the author owns the override and is responsible for valid MDX).

#### Scenario: non-canonical body with curly braces

- **WHEN** a skill body contains a literal `${HOME}` token outside any code fence
- **THEN** the generated MDX MUST escape the curly braces so MDX v3 does not interpret them as a JSX expression
- **AND** the rendered page MUST display `${HOME}` literally

### Requirement: Migration of `commands.mdx` (Step 1 — Coexist)

The implementing PR for this spec MUST install `@docusaurus/plugin-client-redirects` as a dev dependency of `docs-site/`, register it in `docusaurus.config.ts` with an empty redirects array (or a stub configured for the eventual Step 3 anchor mapping), and leave `docs-site/content/guides/commands.mdx` in place. After this PR ships, both `/guides/commands` and `/skills/{name}` MUST resolve.

#### Scenario: coexisting routes

- **WHEN** the implementing PR for this spec is merged
- **THEN** `/guides/commands` MUST continue to resolve
- **AND** `/skills/` and `/skills/{name}` MUST also resolve
- **AND** `package.json` of `docs-site/` MUST list `@docusaurus/plugin-client-redirects` as a dependency

### Requirement: Migration of `commands.mdx` (Step 2 — Audit and Redirect)

A follow-up PR MUST replace the body of `docs-site/content/guides/commands.mdx` with a single redirect-style page pointing at `/skills/`, audit and update every inbound reference (`docusaurus.config.ts` navbar/footer entries, project-root `README.md`, project-root `CLAUDE.md`, the marketplace listing in `.claude-plugin/plugin.json` and any external marketplace metadata, prior posts in `docs-site/blog/`, and any links discovered by Docusaurus's broken-link checker), and configure `@docusaurus/plugin-client-redirects` with one entry per fragment anchor present in the deleted-in-Step-3 `commands.mdx`, mapping `/guides/commands#{anchor}` → `/skills/{anchor}`.

#### Scenario: per-anchor redirects exist

- **WHEN** the Step 2 PR is merged and a user navigates to `/guides/commands#work`
- **THEN** the browser MUST land on `/skills/work` via `@docusaurus/plugin-client-redirects`
- **AND** the same redirect MUST exist for every fragment anchor present in `commands.mdx` at HEAD when Step 3 deletes the file

#### Scenario: inbound reference audit completeness

- **WHEN** the Step 2 PR is merged
- **THEN** `docusaurus.config.ts`, `README.md`, `CLAUDE.md`, `.claude-plugin/plugin.json`, and posts under `docs-site/blog/` MUST contain no references to `/guides/commands` (only `/skills/...` links)
- **AND** `npm run build` MUST emit no broken-link warnings for the rewritten references

### Requirement: Migration of `commands.mdx` (Step 3 — Delete)

A later PR (after at least one release cycle) MUST delete `docs-site/content/guides/commands.mdx`. The implementing PR MUST first enumerate the actual fragment-anchor set from HEAD of `commands.mdx` at the time of removal and confirm that `@docusaurus/plugin-client-redirects` already contains a redirect entry for each anchor. The PR MUST NOT rely on Docusaurus's built-in 404 fallback as a substitute for explicit per-anchor redirects.

#### Scenario: deletion preserves external inbound links

- **WHEN** the Step 3 PR is merged and a user follows an external link to `/guides/commands#audit` (e.g., from an old PR description)
- **THEN** the browser MUST land on `/skills/audit` via the configured redirects
- **AND** the user MUST NOT see a 404

#### Scenario: missing redirect blocks deletion

- **WHEN** the Step 3 PR omits a redirect entry for an anchor that exists in `commands.mdx`
- **THEN** the PR review MUST block the merge until the redirect entry is added

## Out of Scope

- The actual implementation of `transform-skills.js` (separate work, planned by `/sdd:plan SPEC-0021`).
- Adding skills as first-class nodes in the artifact graph (`/sdd:graph`); skills participate today only via the governing-comment pills surfaced on their pages.
- Internationalization of generated skill pages.
- Versioned skill docs.
- Embedding live screenshots, GIFs, or video assets in generated pages — overrides remain the escape hatch for any such authored prose.
- Search-index tuning beyond what Docusaurus provides out of the box.
