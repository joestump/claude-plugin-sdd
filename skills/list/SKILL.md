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

1. **Parse filter**: Check `$ARGUMENTS` for a filter keyword:
   - `adr` -- only show ADRs
   - `spec` -- only show specs
   - `all` or empty -- show both (default)

2. **Scan for ADRs** (unless filter is `spec`):
   - Glob for `{adr-dir}/ADR-*.md` files (in aggregate mode, glob per-module and prefix results with module name)
   - For each file, read the YAML frontmatter to extract `status` and `date`
   - Extract the title from the first `# ` heading
   - Sort by ADR number

3. **Scan for specs** (unless filter is `adr`):
   - Glob for `{spec-dir}/*/spec.md` files (in aggregate mode, glob per-module and prefix results with module name)
   - For each file, read the YAML frontmatter to extract `status` and `date`
   - Extract the title from the first `# ` heading (e.g., `SPEC-0001: Web Dashboard`)
   - Sort by SPEC number

4. **Present results** as a formatted table:

   ```
   ## Architecture Decisions

   | ID | Title | Status | Date |
   |----|-------|--------|------|
   | ADR-0001 | Use React for frontend | accepted | 2025-01-15 |
   | ADR-0002 | Choose PostgreSQL | proposed | 2025-02-01 |

   ## Specifications

   | ID | Title | Status | Date |
   |----|-------|--------|------|
   | SPEC-0001 | Web Dashboard | approved | 2025-01-20 |
   ```

5. **Handle empty results**: If no ADRs or specs exist, tell the user:
   - "No ADRs found. Create one with `/design:adr [description]`."
   - "No specs found. Create one with `/design:spec [capability]`."
