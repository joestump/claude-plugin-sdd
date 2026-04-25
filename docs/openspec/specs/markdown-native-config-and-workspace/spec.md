# SPEC-0014: Markdown-Native Configuration and Workspace Mode

## Overview

This specification formalizes the requirements for eliminating `.claude-plugin-design.json` in favor of structured markdown sections in `CLAUDE.md`, and for enabling multi-module workspace support through auto-discovery and path resolution. These two capabilities are tightly coupled: workspace mode depends on configuration living in `CLAUDE.md` so that Claude Code's recursive `CLAUDE.md` loading provides per-module configuration for free.

See ADR-0015 (Markdown-Native Configuration) and ADR-0016 (Workspace Mode for Multi-Module Projects).

## Requirements

### Requirement: CLAUDE.md Configuration Sections

Skills MUST read configuration from a `### SDD Configuration` section in `CLAUDE.md` instead of from `.claude-plugin-design.json`. The configuration section MUST support the following subsections, each using markdown lists with bold keys:

- **`#### Tracker`**: Type, URL, owner, repo (or project key / team ID depending on tracker)
- **`#### Branch Conventions`**: Prefix, epic prefix, slug length
- **`#### PR Conventions`**: Close keyword, spec reference inclusion
- **`#### Review`**: Max pairs, merge strategy, auto cleanup
- **`#### Worktrees`**: Base directory, max agents, auto cleanup, PR mode

Skills MUST NOT read from `.claude-plugin-design.json` for any configuration value. Configuration values expressed in markdown SHOULD use the same key names as the current JSON schema to minimize cognitive migration cost. Skills MAY tolerate minor natural-language variations in key names (e.g., "Branch prefix" vs. "Prefix") since Claude interprets these as natural language.

#### Scenario: Skill reads tracker config from CLAUDE.md

- **WHEN** a skill needs the tracker type and CLAUDE.md contains a `### SDD Configuration` section with a `#### Tracker` subsection listing `- **Type**: gitea`
- **THEN** the skill uses `gitea` as the tracker type without reading any JSON file

#### Scenario: Missing configuration section

- **WHEN** a skill needs configuration and CLAUDE.md does not contain a `### SDD Configuration` section
- **THEN** the skill falls through to tracker detection (the existing auto-detection flow) and SHOULD suggest running `/sdd:init` to persist configuration

#### Scenario: Partial configuration

- **WHEN** CLAUDE.md contains a `### SDD Configuration` section but the `#### Branch Conventions` subsection is absent
- **THEN** the skill MUST use default values for branch conventions (same defaults as the current JSON schema) and MUST NOT error

### Requirement: Config Resolution Pattern in shared-patterns.md

`references/shared-patterns.md` MUST include a "Config Resolution" pattern that defines a single, canonical algorithm for reading configuration from CLAUDE.md. All skills that need configuration MUST use this pattern. No skill SHALL read `.claude-plugin-design.json` directly.

The Config Resolution pattern MUST specify:

1. Read the `### SDD Configuration` section from the project-root CLAUDE.md
2. If a `--module` flag is provided, also read the module's CLAUDE.md and merge (module-level values override root-level values)
3. For any missing keys, apply documented defaults
4. If no configuration section exists at all, fall through to auto-detection

The pattern MUST replace the existing "Config Schema (`.claude-plugin-design.json`)" and "Tracker Detection > Check for Saved Preference" sections in `shared-patterns.md`. The Tracker Detection flow MUST be updated to check CLAUDE.md first instead of JSON.

#### Scenario: Config Resolution pattern used by plan skill

- **WHEN** `/sdd:plan` needs the tracker type and branch conventions
- **THEN** it follows the Config Resolution pattern from `shared-patterns.md`, reading CLAUDE.md sections, not `.claude-plugin-design.json`

#### Scenario: Module-level config overrides root config

- **WHEN** the root CLAUDE.md sets `- **Type**: github` and the module's CLAUDE.md sets `- **Type**: gitea`
- **THEN** the Config Resolution pattern returns `gitea` for that module

#### Scenario: Config Resolution replaces JSON references in shared-patterns.md

- **WHEN** `shared-patterns.md` is updated per this spec
- **THEN** all references to `.claude-plugin-design.json` in the Tracker Detection and Config Schema sections MUST be replaced with CLAUDE.md-based equivalents

### Requirement: Migration from JSON to CLAUDE.md

`/sdd:init` MUST detect an existing `.claude-plugin-design.json` file in the project root. When detected, `/sdd:init` MUST read the JSON contents, translate each key-value pair into the equivalent CLAUDE.md markdown section format, and offer to write the configuration into CLAUDE.md using `AskUserQuestion`.

After successful migration, `/sdd:init` SHOULD offer to remove the `.claude-plugin-design.json` file. The user MUST confirm deletion; the skill MUST NOT delete the file without explicit consent.

The migration MUST preserve all configuration values exactly. If CLAUDE.md already contains a `### SDD Configuration` section, the migration MUST merge new values into existing sections rather than duplicating or overwriting.

#### Scenario: Fresh migration from JSON

- **WHEN** the user runs `/sdd:init` and `.claude-plugin-design.json` exists with tracker, branch, and PR settings, and CLAUDE.md has no configuration section
- **THEN** `/sdd:init` writes a `### SDD Configuration` section to CLAUDE.md with all settings from the JSON file and offers to delete the JSON file

#### Scenario: Migration with existing CLAUDE.md config

- **WHEN** `.claude-plugin-design.json` exists and CLAUDE.md already has a `### SDD Configuration` section with partial settings
- **THEN** `/sdd:init` merges the JSON values into the existing CLAUDE.md section, preserving values already present in CLAUDE.md (CLAUDE.md takes precedence on conflicts)

#### Scenario: User declines JSON deletion

- **WHEN** `/sdd:init` offers to delete `.claude-plugin-design.json` after migration and the user declines
- **THEN** the JSON file is preserved and the skill emits a warning that dual config sources exist

### Requirement: Workspace Detection from .gitmodules

Skills MUST auto-discover submodules by parsing `.gitmodules` when the file is present in the project root. The parser MUST extract the module name and path for each submodule entry. Skills MAY fall back to explicit module declarations in the root CLAUDE.md's `### Workspace Modules` section when `.gitmodules` is absent.

The `### Workspace Modules` section in CLAUDE.md uses a markdown table with columns: Module, Path, Description. This section is OPTIONAL; when `.gitmodules` exists, it is the primary source and the CLAUDE.md table is informational.

When neither `.gitmodules` nor a `### Workspace Modules` section exists, skills MUST treat the project as a single-module project and operate on the project root only.

#### Scenario: Auto-discovery from .gitmodules

- **WHEN** a skill starts and `.gitmodules` exists with entries for `service-a` at `service-a/` and `service-b` at `service-b/`
- **THEN** the skill discovers two modules (`service-a`, `service-b`) and their paths without any CLAUDE.md configuration

#### Scenario: Fallback to CLAUDE.md workspace table

- **WHEN** `.gitmodules` does not exist but CLAUDE.md contains a `### Workspace Modules` section with a table listing `frontend` at `packages/frontend/` and `backend` at `packages/backend/`
- **THEN** the skill uses the CLAUDE.md table as the module list

#### Scenario: Single-module project

- **WHEN** neither `.gitmodules` nor a `### Workspace Modules` section exists
- **THEN** the skill operates on the project root as a single module with no workspace behavior

### Requirement: Artifact Path Resolution Pattern in shared-patterns.md

`references/shared-patterns.md` MUST include an "Artifact Path Resolution" pattern that defines how skills locate ADR and spec directories. Skills MUST use this pattern instead of hardcoding `docs/adrs/` and `docs/openspec/specs/`.

The Artifact Path Resolution pattern MUST:

1. Read the module's CLAUDE.md (or root CLAUDE.md for single-module projects) to find artifact location declarations (e.g., `- Architecture Decision Records are in docs/adrs/` or `- Specifications are in docs/openspec/specs/`)
2. If CLAUDE.md declares artifact paths, use those paths
3. If CLAUDE.md does not declare paths, fall back to the defaults: `docs/adrs/` for ADRs, `docs/openspec/specs/` for specs
4. Resolve paths relative to the module root (not the project root) in workspace mode

The pattern MUST support per-module artifact locations. Each module's CLAUDE.md MAY declare different paths for its ADRs and specs.

#### Scenario: Custom artifact paths

- **WHEN** a module's CLAUDE.md states `- Architecture Decision Records are in architecture/decisions/`
- **THEN** the Artifact Path Resolution pattern returns `architecture/decisions/` as the ADR path for that module

#### Scenario: Default artifact paths

- **WHEN** a module's CLAUDE.md does not declare ADR or spec paths
- **THEN** the Artifact Path Resolution pattern returns `docs/adrs/` and `docs/openspec/specs/` as defaults

#### Scenario: Per-module resolution in workspace

- **WHEN** module `service-a` declares `- Specifications are in specs/` and module `service-b` has no path declaration
- **THEN** `service-a` specs resolve to `service-a/specs/` and `service-b` specs resolve to `service-b/docs/openspec/specs/`

### Requirement: Module-Scoped Operations

All skills MUST accept a `--module <name>` flag to scope operations to a single discovered module. The `<name>` argument MUST match a module name from workspace detection (either `.gitmodules` or the `### Workspace Modules` table).

When `--module` is provided, the skill MUST:

- Resolve artifact paths relative to the specified module's root
- Read configuration from the module's CLAUDE.md (merged with root per the Config Resolution pattern)
- Restrict all file scanning, reading, and writing to the module's directory tree

When `--module` is NOT provided and the project is a workspace, skills MUST aggregate across all discovered modules. When the project is single-module, the `--module` flag MUST be silently ignored if provided.

If the provided module name does not match any discovered module, the skill MUST error with a message listing the available modules.

#### Scenario: Scoped ADR creation

- **WHEN** the user runs `/sdd:adr --module service-a` in a workspace with modules `service-a` and `service-b`
- **THEN** the ADR is created in `service-a/docs/adrs/` (or the module's custom ADR path) and only `service-a`'s CLAUDE.md configuration is used

#### Scenario: Unknown module name

- **WHEN** the user runs `/sdd:check --module nonexistent` and the workspace has modules `frontend` and `backend`
- **THEN** the skill errors with: "Module 'nonexistent' not found. Available modules: frontend, backend"

#### Scenario: Module flag on single-module project

- **WHEN** the user runs `/sdd:list --module anything` on a project without `.gitmodules` or workspace table
- **THEN** the flag is silently ignored and the skill operates on the project root

### Requirement: Cross-Module Aggregation

`/sdd:prime`, `/sdd:audit`, and `/sdd:docs` MUST present unified views that aggregate artifacts across all discovered modules. Aggregated output MUST include a module label for each artifact so users can identify which module an artifact belongs to.

`/sdd:check` MUST support per-module targeting via the `--module` flag. When no `--module` flag is provided, `/sdd:check` MUST check all modules and group findings by module.

`/sdd:list` MUST aggregate ADRs and specs across all modules with module labels when operating in a workspace.

#### Scenario: Prime loads all modules

- **WHEN** the user runs `/sdd:prime` in a workspace with modules `api` and `worker`
- **THEN** the output includes ADRs and specs from both modules, each prefixed with its module name (e.g., "[api] ADR-0001: ...", "[worker] ADR-0003: ...")

#### Scenario: Audit aggregates cross-module

- **WHEN** the user runs `/sdd:audit` in a workspace
- **THEN** the audit report includes findings from all modules, with each finding labeled by its source module

#### Scenario: Check scoped to one module

- **WHEN** the user runs `/sdd:check --module api` in a workspace
- **THEN** only the `api` module's code and artifacts are checked; other modules are excluded

#### Scenario: Docs generates unified site

- **WHEN** the user runs `/sdd:docs` in a workspace
- **THEN** the documentation site includes all modules' ADRs and specs, organized by module in the navigation

### Requirement: Init Workspace Setup

`/sdd:init` MUST detect `.gitmodules` in the project root. When detected, `/sdd:init` MUST offer workspace setup via `AskUserQuestion`, which includes:

1. Listing discovered submodules and their paths
2. For each submodule, offering to create or update its `CLAUDE.md` with an `## Architecture Context` section declaring ADR and spec paths
3. Writing a `### Workspace Modules` table in the root `CLAUDE.md` listing all discovered modules
4. Writing a `### SDD Configuration` section in the root `CLAUDE.md` with shared configuration (tracker, branch conventions, etc.)

`/sdd:init` SHOULD detect whether each submodule already has a `CLAUDE.md` and skip those that are already configured, offering to update them only if the user confirms.

Per-module `CLAUDE.md` files MAY contain module-specific configuration overrides (e.g., a different tracker repo for a specific submodule). These overrides are OPTIONAL and default to inheriting from the root.

#### Scenario: First-time workspace init

- **WHEN** the user runs `/sdd:init` in a project with `.gitmodules` listing `service-a` and `service-b`, and neither submodule has a `CLAUDE.md`
- **THEN** `/sdd:init` creates `CLAUDE.md` in both `service-a/` and `service-b/` with architecture context sections, and writes a `### Workspace Modules` table and `### SDD Configuration` section in the root `CLAUDE.md`

#### Scenario: Partial workspace init

- **WHEN** `/sdd:init` detects `.gitmodules` and `service-a/CLAUDE.md` already exists with architecture context
- **THEN** `/sdd:init` skips `service-a` (unless the user requests an update) and creates `CLAUDE.md` for the remaining modules

#### Scenario: Workspace init with existing JSON config

- **WHEN** `/sdd:init` detects both `.gitmodules` and `.claude-plugin-design.json`
- **THEN** `/sdd:init` performs JSON migration first (per the Migration requirement), then proceeds with workspace setup using the migrated configuration
