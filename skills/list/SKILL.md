---
name: list
description: List all PRDs, architecture decisions, and specs with their status. Use when the user asks "what decisions have we made", "list ADRs", "show specs", "list PRDs", or wants an overview.
allowed-tools: Read, Glob, Grep
argument-hint: "[filter: adr|spec|all] [--module <name>]"
disable-model-invocation: true
---

# List Architecture Decisions and Specs

> **Harness portability.** This skill runs on any agent harness that loads Agent Skills — Claude Code, Codex CLI, OpenCode, Crush. Tool names used below (`AskUserQuestion`, `Task`, `TeamCreate`, `SendMessage`, `TaskCreate`, `ToolSearch`, `mcp__*`, `${CLAUDE_PLUGIN_ROOT}`) denote *capabilities*, not hard requirements: map each to your harness's equivalent or use the documented fallback per `${CLAUDE_PLUGIN_ROOT}/references/harness-compat.md`. References to `CLAUDE.md` mean the project memory file (`CLAUDE.md`, `AGENTS.md`, or `CRUSH.md`) per harness-compat § "Project Memory File". A citation of the form `shared-patterns.md § "Section"` names one `##` heading in that file — load only that section (see its "How to Read This File" note), never the whole file.

List all PRDs, ADRs, and specs in the project with their status, date, and title.

## Process

<!-- Governing: ADR-0016 (Workspace Mode), SPEC-0014 REQ "Artifact Path Resolution" -->

0. **Resolve artifact paths**: Follow the **Artifact Path Resolution** pattern from `${CLAUDE_PLUGIN_ROOT}/references/shared-patterns.md` § "Artifact Path Resolution" to determine the ADR, spec, and PRD directories. If `$ARGUMENTS` contains `--module <name>`, resolve paths relative to that module; otherwise, in a workspace, aggregate across all modules. The resolved ADR directory is `{adr-dir}`, spec directory is `{spec-dir}`, and PRD directory is `{prd-dir}` (default `docs/prds/`, per ADR-0036).

   <!-- Governing: ADR-0016 (Workspace Mode), SPEC-0014 REQ "Cross-Module Aggregation" -->

   **Cross-module aggregation**: When in aggregate mode (no `--module`, workspace detected), list artifacts from all modules. Add a `Module` column to the output tables with module names in square brackets (e.g., `[api]`). Sort by module name first, then by artifact number. When `--module` is provided, scope to that single module — no module column needed. When in single-module mode (no workspace), operate normally.

1. **Parse filter**: Check `$ARGUMENTS` for a filter keyword:
   - `adr` -- only show ADRs
   - `prd` -- only show PRDs
   - `spec` -- only show specs
   - `all` or empty -- show both (default)

2. **Scan for ADRs** (unless filter is `spec`):
   - Glob for `{adr-dir}/ADR-*.md` files (in aggregate mode, glob per-module and prefix results with module name)
   - For each file, extract `status` and `date` per the **Status Field Extraction** algorithm in Step 3a (`/sdd:prime` defines this canonically; `/sdd:list` reuses it for the same legacy-format reasons)
   - Extract the title from the first `# ` heading
   - Sort by ADR number

3. **Scan for specs** (unless filter is `adr`):
   - Glob for `{spec-dir}/*/spec.md` files (in aggregate mode, glob per-module and prefix results with module name)
   - For each file, extract `status` and `date` per the **Status Field Extraction** algorithm referenced above
   - Extract the title from the first `# ` heading (e.g., `SPEC-0001: Web Dashboard`)
   - Sort by SPEC number

3b. **Scan for PRDs** (unless filter is `adr` or `spec`; skip silently when `{prd-dir}` does not exist):
   - Glob for `{prd-dir}/PRD-*.md` files (in aggregate mode, glob per-module and prefix results with module name)
   - For each file, extract `status` and `date` per the **Status Field Extraction** algorithm referenced above
   - Extract the title from the first `# ` heading (e.g., `PRD-0001: Faster Checkout`)
   - Sort by PRD number
   - Render as their own section, ahead of ADRs and specs, matching the `PRD → ADR → spec` lineage. PRDs are optional (ADR-0036): a project with none shows no PRD section at all — never an empty one, and never a prompt to create one.

3a. **Status Field Extraction**: same algorithm as `/sdd:prime` Step 3a. Briefly: try YAML frontmatter `status:` first; if absent, scan the first 30 lines for a `- **Status:** {value}` bullet (case-insensitive on "Status"); strip any parenthetical refinement notes (split on `(`, trim); if neither form yields a value, render as `—` when *some* artifacts have status, or drop the Status column entirely when *zero* do.

4. **Present results** as a formatted table:

   **Single-module or `--module` mode:**

   ```
   ## Architecture Decisions

   | ID | Title | Status | Date |
   |----|-------|--------|------|
   | ADR-0001 | Choose frontend framework | accepted | 2025-01-15 |
   | ADR-0002 | Choose PostgreSQL | proposed | 2025-02-01 |

   ## Specifications

   | ID | Title | Status | Date |
   |----|-------|--------|------|
   | SPEC-0001 | Web Dashboard | approved | 2025-01-20 |
   ```

   **Workspace aggregate mode:**

   ```
   ## Architecture Decisions ({N} across {K} modules)

   | Module | ID | Title | Status | Date |
   |--------|----|-------|--------|------|
   | [api] | ADR-0001 | Choose REST over GraphQL | accepted | 2025-01-15 |
   | [api] | ADR-0002 | Choose PostgreSQL | proposed | 2025-02-01 |
   | [worker] | ADR-0001 | Choose Redis for queues | accepted | 2025-01-20 |

   ## Specifications ({M} across {K} modules)

   | Module | ID | Title | Status | Date |
   |--------|----|-------|--------|------|
   | [api] | SPEC-0001 | Web Dashboard | approved | 2025-01-20 |
   | [worker] | SPEC-0001 | Job Processing | draft | 2025-02-01 |
   ```

5. **Handle empty results**: If no ADRs or specs exist, tell the user:
   - "No ADRs found. Create one with `/sdd:adr [description]`."
   - "No specs found. Create one with `/sdd:spec [capability]`."
   - Say nothing about PRDs. They are optional and client-facing-only (ADR-0036), so "no PRDs found" reads as a gap where there is none — omit the section instead. Mention `/sdd:prd` only when the user explicitly filtered on `prd`.

## Rules

- MUST use the **Status Field Extraction** algorithm in Step 3a to support both YAML-frontmatter and inline-bullet formats — leaving Status blank for legacy repos that use `- **Status:** {value}` is misleading and was reported as a real-world bug
- MUST drop the Status column entirely when zero artifacts in the rendered corpus have a parseable status; render `—` for missing entries when the column is partially populated. **Workspace aggregate mode**: the rendered corpus is the union across all modules — drop the column only when ZERO artifacts across ALL modules have status. If even one module has status, keep the column
- MUST strip parenthetical refinement notes from extracted status values (preserved in source files; not rendered in tables)
