---
name: list
description: List all architecture decisions and specs with their status. Use when the user asks "what decisions have we made", "list ADRs", "show specs", or wants an overview.
allowed-tools: Read, Glob, Grep
argument-hint: [filter: adr|spec|all] [--module <name>]
disable-model-invocation: true
---

# List Architecture Decisions and Specs

List all ADRs and specs in the project with their status, date, and title.

## Process

<!-- Governing: ADR-0016 (Workspace Mode), SPEC-0014 REQ "Artifact Path Resolution" -->

0. **Resolve artifact paths**: Follow the **Artifact Path Resolution** pattern from `references/shared-patterns.md` to determine the ADR and spec directories. If `$ARGUMENTS` contains `--module <name>`, resolve paths relative to that module; otherwise, in a workspace, aggregate across all modules. The resolved ADR directory is `{adr-dir}` and spec directory is `{spec-dir}`.

   <!-- Governing: ADR-0016 (Workspace Mode), SPEC-0014 REQ "Cross-Module Aggregation" -->

   **Cross-module aggregation**: When in aggregate mode (no `--module`, workspace detected), list artifacts from all modules. Add a `Module` column to the output tables with module names in square brackets (e.g., `[api]`). Sort by module name first, then by artifact number. When `--module` is provided, scope to that single module — no module column needed. When in single-module mode (no workspace), operate normally.

1. **Parse filter**: Check `$ARGUMENTS` for a filter keyword:
   - `adr` -- only show ADRs
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

## Rules

- MUST use the **Status Field Extraction** algorithm in Step 3a to support both YAML-frontmatter and inline-bullet formats — leaving Status blank for legacy repos that use `- **Status:** {value}` is misleading and was reported as a real-world bug
- MUST drop the Status column entirely when zero artifacts in the rendered corpus have a parseable status; render `—` for missing entries when the column is partially populated. **Workspace aggregate mode**: the rendered corpus is the union across all modules — drop the column only when ZERO artifacts across ALL modules have status. If even one module has status, keep the column
- MUST strip parenthetical refinement notes from extracted status values (preserved in source files; not rendered in tables)
