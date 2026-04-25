# SPEC-0004: Documentation Site Generation

## Overview

A `/sdd:docs` skill that generates Docusaurus documentation from ADRs and OpenSpec specifications, with custom React components for RFC 2119 keyword highlighting, status badges, requirement boxes, cross-reference linking, and dark mode support. Supports two modes: scaffold (standalone site) and integration (plugin into existing Docusaurus site), with manifest-based upgrades and separate spec/design pages. See ADR-0004 and ADR-0006.

## Requirements

### Requirement: Template-Based Scaffolding

The `/sdd:docs` skill SHALL scaffold a Docusaurus site by copying production-ready templates from the plugin's `templates/docusaurus/` directory to `docs-site/` in the project root using `cp -r`. It MUST only customize `package.json` (project name) and `docusaurus.config.ts` (title, URLs).

#### Scenario: First-time docs generation

- **WHEN** a user runs `/sdd:docs` and no `docs-site/` directory exists
- **THEN** the skill SHALL copy templates, customize config files for the project, run `npm install`, and report what was created

#### Scenario: Existing docs-site

- **WHEN** a user runs `/sdd:docs` and `docs-site/` already exists
- **THEN** the skill SHALL ask the user before overwriting

#### Scenario: No Node.js installed

- **WHEN** a user runs `/sdd:docs` and Node.js is not available
- **THEN** the skill SHALL report that Node.js is required and stop without creating any files

### Requirement: Pre-flight Validation

The skill MUST check for existing design artifacts before scaffolding. It MUST verify that at least one of `docs/adrs/` or `docs/openspec/specs/` contains content.

#### Scenario: No artifacts exist

- **WHEN** a user runs `/sdd:docs` with no ADRs and no specs
- **THEN** the skill SHALL report that no artifacts were found and suggest using `/sdd:adr` or `/sdd:spec` first

#### Scenario: Only ADRs exist

- **WHEN** a user runs `/sdd:docs` with ADRs but no specs
- **THEN** the skill SHALL proceed but note that the docs site will only include ADRs

### Requirement: ADR Transform Pipeline

The transform pipeline MUST convert ADR markdown files into MDX with status badges (StatusBadge), date badges (DateBadge), RFC 2119 keyword highlighting, ADR cross-reference linking (ADR-XXXX becomes a clickable link), and consequence keyword highlighting (Good/Bad/Neutral).

#### Scenario: ADR transformation

- **WHEN** the build-content script processes ADR files
- **THEN** each ADR SHALL be transformed into an MDX file in `docs-generated/decisions/` with all badge components and highlighting applied

#### Scenario: ADR cross-references

- **WHEN** an ADR references another ADR (e.g., "See ADR-0001")
- **THEN** the text "ADR-0001" SHALL become a clickable link to the referenced ADR's page

### Requirement: Spec Transform Pipeline

The transform pipeline MUST convert OpenSpec spec.md and design.md files into MDX with requirement boxes (RequirementBox), domain badges (DomainBadge), RFC 2119 keyword highlighting, and spec cross-reference linking.

#### Scenario: Spec transformation

- **WHEN** the build-content script processes spec files
- **THEN** each spec SHALL be transformed into MDX files in `docs-generated/specs/{capability-name}/` with all components applied

#### Scenario: Requirement box rendering

- **WHEN** a spec.md contains requirement sections
- **THEN** each requirement SHALL be wrapped in a RequirementBox component with an ID anchor for deep linking

### Requirement: MDX Safety

The transform pipeline MUST escape MDX v3 unsafe patterns (curly braces, angle brackets) in content while preserving JSX component tags. The `mdx-escape.js` utility SHALL centralize all escaping logic.

#### Scenario: Curly brace escaping

- **WHEN** source markdown contains literal curly braces (e.g., in code examples)
- **THEN** the escaping utility SHALL convert them to safe equivalents without breaking JSX components

### Requirement: Dev Server and File Watching

The scaffolded site MUST support `npm run dev` for a development server with hot reload and file watching via chokidar. Changes to source ADRs and specs MUST be automatically re-transformed and reflected in the browser.

#### Scenario: Live editing

- **WHEN** a user edits an ADR markdown file while `npm run dev` is running
- **THEN** the file watcher SHALL re-run the transform and the browser SHALL reflect the update

### Requirement: Spec Mapping

The `build-spec-mapping.js` script SHALL scan specs for SPEC ID prefixes and generate `spec-emojis.json` and `spec-mapping.json` files used by the transform pipeline for cross-reference linking.

#### Scenario: Spec mapping build

- **WHEN** the spec mapping script runs
- **THEN** it SHALL produce mapping files that enable SPEC-XXXX references to become clickable links to the correct spec page and requirement anchor

### Requirement: Static Site Output

The site MUST support `npm run build` to produce a deployable static site (HTML/CSS/JS) suitable for hosting on GitHub Pages, Netlify, or any CDN.

#### Scenario: Production build

- **WHEN** a user runs `npm run build` in the docs-site directory
- **THEN** the output SHALL be a complete static site with all pages, assets, and search index

### Requirement: Existing Site Detection

The skill MUST scan for existing Docusaurus sites before choosing a generation mode. It SHALL search for `docusaurus.config.ts` or `docusaurus.config.js` in the project root, `website/`, `docs/`, and any directory at depth 1 or 2, excluding `docs-site/` and `node_modules/`. See ADR-0006.

#### Scenario: Existing Docusaurus site found

- **WHEN** a user runs `/sdd:docs` and a `docusaurus.config.ts` or `docusaurus.config.js` is found outside `docs-site/`
- **THEN** the skill SHALL ask the user whether to integrate into the existing site or scaffold a new standalone site

#### Scenario: Multiple Docusaurus sites found

- **WHEN** a user runs `/sdd:docs` and multiple Docusaurus configurations are found
- **THEN** the skill SHALL present all found sites and ask the user which one to integrate with, or offer to scaffold a new site

#### Scenario: No existing Docusaurus site

- **WHEN** a user runs `/sdd:docs` and no existing Docusaurus configuration is found
- **THEN** the skill SHALL proceed directly with scaffold mode

### Requirement: Integration Mode

When the user selects integration mode, the skill SHALL install a self-contained Docusaurus build-time plugin into the existing site. The plugin MUST run the same transforms as scaffold mode during the `loadContent()` phase and watch source files via `getPathsToWatch()`. See ADR-0006.

#### Scenario: Plugin installation

- **WHEN** integration mode is selected for a site at `{site}/`
- **THEN** the skill SHALL copy the `sync-spec-docs` plugin to `{site}/plugins/sync-spec-docs/`, copy React components to `{site}/src/components/design-docs/`, create `{site}/src/css/design-docs.css` with design-specific styles (excluding theme color variables), and register the plugin in `{site}/docusaurus.config.ts`

#### Scenario: Component namespacing

- **WHEN** React components are copied to the existing site
- **THEN** they MUST be placed under `{site}/src/components/design-docs/` to avoid collisions with existing components

#### Scenario: MDX component registration

- **WHEN** the site already has `{site}/src/theme/MDXComponents.tsx`
- **THEN** the skill SHALL merge design-docs component imports into the existing file, preserving all existing registrations
- **WHEN** no `MDXComponents.tsx` exists
- **THEN** the skill SHALL create one with all design-docs component registrations

#### Scenario: CSS style isolation

- **WHEN** design-specific CSS is added to the existing site
- **THEN** the skill MUST exclude the `:root` and `[data-theme='dark']` CSS variable blocks that set `--ifm-color-primary-*` values, including only design-component-specific styles

#### Scenario: Generated output location

- **WHEN** integration mode generates transformed documents
- **THEN** the output SHALL be written to `{site}/docs/architecture/` and this directory MUST be added to `.gitignore`

#### Scenario: Existing plugin directory

- **WHEN** `{site}/plugins/sync-spec-docs/` already exists
- **THEN** the skill SHALL ask the user before overwriting

### Requirement: Upgrade Manifest

The skill MUST create a `.sdd-docs.json` manifest at the project root on first run in either mode. The manifest SHALL record the plugin version, mode (`scaffold` or `integration`), site directory path, creation timestamp, and SHA-256 checksums of all managed files. See ADR-0006.

#### Scenario: Manifest creation

- **WHEN** `/sdd:docs` runs for the first time (no `.sdd-docs.json` exists)
- **THEN** the skill SHALL create `.sdd-docs.json` with the current plugin version, mode, site directory, timestamps, and checksums of all installed files

#### Scenario: Manifest schema

- **WHEN** a manifest is created or updated
- **THEN** each managed file entry SHALL include a `checksum` field (SHA-256 hash) and a `managed` field (boolean, default `true`)

### Requirement: Upgrade Flow

When `.sdd-docs.json` exists and `/sdd:docs` is re-run, the skill MUST perform an upgrade instead of a fresh installation. It SHALL compare current file checksums against manifest checksums to determine upgrade actions. See ADR-0006.

#### Scenario: Unchanged file upgrade

- **WHEN** a managed file's current checksum matches the manifest checksum
- **THEN** the skill SHALL replace the file with the new template version without prompting the user

#### Scenario: Modified file upgrade

- **WHEN** a managed file's current checksum does not match the manifest checksum
- **THEN** the skill SHALL show a diff between the user's version and the new template version and ask the user whether to accept the new version, keep their version, or opt out of future upgrades for that file

#### Scenario: Missing file recovery

- **WHEN** a file listed in the manifest does not exist on disk
- **THEN** the skill SHALL re-create the file from the current template

#### Scenario: Managed opt-out

- **WHEN** a user chooses to permanently opt a file out of upgrades
- **THEN** the skill SHALL set `managed: false` for that file in the manifest, and future upgrades SHALL skip it

#### Scenario: Deleted manifest

- **WHEN** `/sdd:docs` is run and a docs site exists but `.sdd-docs.json` is missing
- **THEN** the skill SHALL warn the user that upgrade tracking is unavailable and offer to re-create the manifest by checksumming existing files

### Requirement: Spec/Design Page Separation

The spec transform pipeline MUST generate separate pages for `spec.md` and `design.md` within a directory-per-spec structure. Each spec directory SHALL contain a `_category_.json` for Docusaurus sidebar configuration. See ADR-0006.

#### Scenario: Spec with both documents

- **WHEN** a spec directory contains both `spec.md` and `design.md`
- **THEN** the transform SHALL produce a directory with `_category_.json`, `spec.mdx`, and `design.mdx`, rendering as an expandable sidebar category with "Specification" and "Design" sub-items

#### Scenario: Spec without design document

- **WHEN** a spec directory contains `spec.md` but no `design.md`
- **THEN** the transform SHALL produce a single `spec.mdx` page without a category wrapper, rendering as a leaf item in the sidebar

#### Scenario: Design document only

- **WHEN** a spec directory contains `design.md` but no `spec.md`
- **THEN** the transform SHALL produce a single `design.mdx` page without a category wrapper

### Requirement: Spec Overview Index

The transform pipeline MUST generate an overview index page listing all specs in a table with linked columns for Specification and Design documents. See ADR-0006.

#### Scenario: Overview page generation

- **WHEN** the transform pipeline processes specs
- **THEN** it SHALL generate an `index.mdx` in the specs output directory with a table containing Component name and linked Document columns

#### Scenario: Partial document links

- **WHEN** a spec has only `spec.md` (no `design.md`)
- **THEN** the overview table row SHALL include a Specification link but omit the Design link
