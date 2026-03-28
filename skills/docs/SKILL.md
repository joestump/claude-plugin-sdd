---
name: docs
description: Generate a documentation site from your ADRs and specs. Use when the user says "generate docs", "create a docs site", or wants to publish their architecture decisions.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Task, AskUserQuestion
argument-hint: [project name or options] [--module <name>]
context: fork  # Runs in a forked context to avoid polluting the main session with docs-site npm operations
---

# Generate Docusaurus Documentation Site

Transform ADRs and OpenSpec specs (located via the **Artifact Path Resolution** pattern from `references/shared-patterns.md`) into a polished documentation website with:

- RFC 2119 keyword highlighting (MUST, SHALL, MAY, etc.)
- ADR cross-reference linking (ADR-0001 becomes a clickable link)
- SPEC cross-reference linking (PREFIX-NNN links to spec requirement anchors)
- Status/Date/Domain badge components
- Requirement box components for spec tables
- Consequence keyword highlighting (Good/Bad/Neutral) in ADRs
- Dark mode support
- Auto-generated sidebars

Supports two modes:
- **Scaffold mode**: Creates a standalone `docs-site/` with its own Docusaurus installation
- **Integration mode**: Generates a build-time plugin into an existing Docusaurus site

## Process

### Step 0: Resolve Artifact Paths

<!-- Governing: ADR-0016 (Workspace Mode), SPEC-0014 REQ "Artifact Path Resolution" -->

Follow the **Artifact Path Resolution** pattern from `references/shared-patterns.md` to determine the ADR and spec directories. If `$ARGUMENTS` contains `--module <name>`, resolve paths relative to that module; otherwise, in a workspace, aggregate across all modules. The resolved ADR directory is `{adr-dir}` and spec directory is `{spec-dir}`.

<!-- Governing: ADR-0016 (Workspace Mode), SPEC-0014 REQ "Cross-Module Aggregation" -->

**Cross-module aggregation**: When in aggregate mode (no `--module`, workspace detected), include all modules' artifacts in the docs site. Organize the sidebar navigation by module:

```
Architecture/
├── api/
│   ├── ADRs/
│   │   ├── ADR-0001: Choose REST over GraphQL
│   │   └── ADR-0002: Choose PostgreSQL
│   └── Specs/
│       └── SPEC-0001: Web Dashboard
├── worker/
│   ├── ADRs/
│   │   └── ADR-0001: Choose Redis for queues
│   └── Specs/
│       └── SPEC-0001: Job Processing
└── Overview (cross-module index page)
```

Each module's artifacts are transformed independently and placed under a module-named directory in the docs output. The index page lists all modules with artifact counts. When `--module` is provided, generate docs for that single module only (flat structure, no module subdirectory). When in single-module mode (no workspace), operate normally with the existing flat structure.

### Step 1: Pre-flight Checks

- Check if Node.js is installed. If not, tell the user: "Node.js is required to run the docs site. Please install it from https://nodejs.org/ and re-run this command." and stop.
- Check if `{adr-dir}` has any ADR `.md` files
- Check if `{spec-dir}` has any spec directories (containing `spec.md`). Validate spec pairing per `references/shared-patterns.md` § "Spec Pairing Validation".
- If NEITHER has content, tell the user: "No ADRs or specs found. Create some first with `/design:adr` or `/design:spec`, then re-run `/design:docs`." and stop.
- If only one has content, proceed but note which is empty (e.g., "No specs found yet -- the docs site will only include ADRs for now.")

### Step 2: Detect Existing Docusaurus Site and Upgrade State

#### 2.1: Check for upgrade manifest

Check if `.design-docs.json` exists at the project root.

**If `.design-docs.json` exists:**
- Read and parse the manifest
- Check if the `siteDir` referenced in the manifest still exists on disk
  - **If siteDir exists** → enter **Upgrade Mode** (Step 3C). Skip Steps 2.2 and 2.3.
  - **If siteDir is missing** → warn the user: "Found `.design-docs.json` but the site directory `{siteDir}` no longer exists." Use `AskUserQuestion` to offer:
    - "Re-scaffold a new docs site" → proceed with **Scaffold Mode** (Step 3A)
    - "Cancel" → stop

**If `.design-docs.json` does NOT exist**, continue to Step 2.2.

#### 2.2: Scan for existing Docusaurus sites

Scan the project root for directories containing `docusaurus.config.ts` or `docusaurus.config.js`:

```bash
find . -maxdepth 2 -name 'docusaurus.config.*' -not -path './docs-site/*' -not -path './node_modules/*' 2>/dev/null
```

#### 2.3: Choose mode

**If an existing docs site directory is detected** (`docs-site/` exists or an integration site was found in 2.2) **but no `.design-docs.json`**:
- Warn: "Upgrade tracking unavailable — `.design-docs.json` not found."
- Use `AskUserQuestion` to offer:
  - "Create manifest from current state" → compute SHA-256 checksums of all managed files in the existing site, write `.design-docs.json` using the current state as baseline, then enter **Upgrade Mode** (Step 3C)
  - "Continue without upgrade tracking" → proceed to mode selection below
  - "Cancel" → stop

**If an existing non-scaffold Docusaurus site is found** (from Step 2.2), use `AskUserQuestion` to let the user choose:
- Option A: "Integrate into {directory}" -- proceed with **Integration Mode** (Step 3B)
- Option B: "Scaffold a new docs site" -- proceed with **Scaffold Mode** (Step 3A)

**If no existing site is found**, proceed directly with **Scaffold Mode** (Step 3A).

---

### Step 3A: Scaffold Mode

Read and follow the plugin's `skills/docs/references/scaffold-mode.md` for the full scaffold workflow. After completion, proceed to Step 4 below.

---

### Step 3B: Integration Mode

Read and follow the plugin's `skills/docs/references/integration-mode.md` for the full integration workflow. After completion, proceed to Step 4 below.

---

### Step 3C: Upgrade Mode

Read and follow the plugin's `skills/docs/references/upgrade-mode.md` for the full upgrade workflow. This handles manifest-based file management, conflict resolution, and new template detection.

---

### Step 4: Create Manifest

Runs after Step 3A or 3B to establish upgrade tracking.

**Determine managed files** based on mode:
- **Scaffold**: files in `docs-site/scripts/`, `docs-site/src/components/`, `docs-site/src/css/`, `docs-site/src/theme/`
- **Integration**: files in `{site}/plugins/sync-design-docs/`, `{site}/src/components/design-docs/`, `{site}/src/css/design-docs.css`, `{site}/src/theme/MDXComponents.tsx` (if created/modified)

Compute SHA-256 checksum for each file (`shasum -a 256 {file-path}`), then write `.design-docs.json`:

```json
{
  "version": "<plugin version from .claude-plugin/plugin.json>",
  "mode": "scaffold" | "integration",
  "siteDir": "<relative path to site dir>",
  "createdAt": "<ISO 8601>",
  "updatedAt": "<ISO 8601>",
  "files": {
    "<relative-path>": { "checksum": "sha256:<hex-digest>", "managed": true }
  }
}
```

Tell the user: "Created `.design-docs.json` with {N} tracked files. Future runs of `/design:docs` will detect changes and offer upgrades."

---

## Key Template Files Reference

### Scaffold Mode Templates (`templates/docusaurus/`)

The templates directory contains production-ready versions of all files. The `cp -r` approach copies everything; you only need to customize `docusaurus.config.ts` and `package.json`.

#### Transform Scripts (scripts/)
- `build-docs.js` -- Orchestrator that runs all transforms
- `transform-adrs.js` -- Transforms ADR markdown to .mdx with badges, RFC 2119 keyword highlighting, cross-references
- `transform-openspecs.js` -- Transforms OpenSpec markdown to .mdx with requirement boxes, domain badges, RFC 2119 highlighting. Generates separate pages for `spec.md` and `design.md` within a directory-per-spec structure, with a `_category_.json` file per spec directory for Docusaurus sidebar configuration (Governing: ADR-0006, SPEC-0004)
- `mdx-escape.js` -- Escapes MDX v3 unsafe patterns (curly braces, angle brackets) while preserving JSX components
- `build-spec-mapping.js` -- Scans specs for SPEC ID prefixes and generates mapping JSON
- `generate-index.js` -- Creates the landing page (index.mdx) with links to ADRs and specs sections with counts

### Integration Mode Templates (`templates/integration/sync-design-docs/`)

A self-contained Docusaurus plugin with adapted transform scripts.

#### Plugin Entry
- `index.js` -- Docusaurus plugin that runs transforms during `loadContent()` and watches source files via `getPathsToWatch()`

#### Transform Scripts (lib/)
- `transform-adrs.js` -- ADR transforms with parameterized paths
- `transform-openspecs.js` -- OpenSpec transforms with parameterized paths
- `transform-utils.js` -- Shared utilities (RFC 2119 keywords, cross-references, link fixing)
- `mdx-escape.js` -- MDX v3 safety escaping
- `build-spec-mapping.js` -- Spec ID mapping (returns data instead of writing files)
- `generate-index.js` -- Index page generation with parameterized paths

### Shared: React Components (templates/docusaurus/src/components/)

Used by both modes. In scaffold mode, they live at `docs-site/src/components/`. In integration mode, they're copied to `{site}/src/components/design-docs/`.

- `StatusBadge.tsx` -- Status with emoji (accepted, proposed, draft, etc.)
- `DateBadge.tsx` -- Date display with calendar emoji
- `DomainBadge.tsx` -- Domain/category badge
- `PriorityBadge.tsx` -- P0-P4 priority levels
- `SeverityBadge.tsx` -- Critical/High/Medium/Low/Info
- `RFCLevelBadge.tsx` -- Maps RFC 2119 keywords to severity colors
- `RequirementBox.tsx` -- Bordered container for spec requirements with ID anchors
- `Field.tsx` / `FieldGroup.tsx` -- Metadata label-value pairs

### Shared: Theme and CSS (templates/docusaurus/src/)
- `src/theme/MDXComponents.tsx` -- Registers all custom components for use in MDX
- `src/css/custom.css` -- All badge, keyword, component, and dark mode styles

## Rules

- Always read templates from the plugin directory, don't recreate from memory
- Configure the Docusaurus site for the current project (title, URLs, etc.)
- The transform scripts must work with the project's actual directory structure
- Don't include OpenAPI plugin config unless the project has an OpenAPI spec
- Keep `spec-emojis.json` and `spec-mapping.json` as generated files (populated by build-spec-mapping.js)
- In integration mode, NEVER overwrite the existing site's `docusaurus.config.ts` wholesale -- only add the plugin entry and CSS import
- In integration mode, ALWAYS namespace components under `design-docs/` to avoid collisions with existing components
- In integration mode, generated files go to `{site}/docs/architecture/` -- this directory is gitignored and regenerated on every build
- Always create `.design-docs.json` after a fresh scaffold or integration install (Step 4)
- Never delete or skip manifest creation -- it is required for upgrade tracking
- During upgrades (Step 3C), always ask before overwriting user-modified files
- The manifest `files` object uses project-root-relative paths as keys
- Checksum format is always `sha256:<hex-digest>` (lowercase hex)
- When creating a manifest from an existing site (Step 2.3 "Create manifest from current state"), set all files to `managed: true` and use their current checksums as the baseline
- In workspace aggregate mode, MUST organize docs navigation by module with per-module subdirectories (Governing: ADR-0016, SPEC-0014 REQ "Cross-Module Aggregation")
- In workspace aggregate mode, MUST generate a cross-module index page listing all modules with artifact counts
- In workspace aggregate mode, transform scripts run per-module with output directed to module-named subdirectories
- When `--module` is provided, generate docs for that single module only using flat structure
