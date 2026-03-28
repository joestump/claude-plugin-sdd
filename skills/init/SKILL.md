---
name: init
description: Set up CLAUDE.md with design plugin references for architecture-aware sessions. Use when the user installs the plugin, says "initialize design", or wants to configure CLAUDE.md for the design plugin.
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, AskUserQuestion
argument-hint: [--module <name>]
---

<!-- Governing: ADR-0015 (Markdown-Native Configuration), SPEC-0014 REQ "Migration from JSON to CLAUDE.md" -->

# Initialize Design Plugin

Set up the project's `CLAUDE.md` with architecture context so Claude sessions are design-aware.

## Process

<!-- Governing: ADR-0016 (Workspace Mode), SPEC-0014 REQ "Artifact Path Resolution" -->

**Module support**: If `$ARGUMENTS` contains `--module <name>`, resolve the module root using the Workspace Detection pattern from `references/shared-patterns.md`. All CLAUDE.md reads and writes in the steps below target the module's `CLAUDE.md` at the module root instead of the project root. If workspace detection finds no modules and `--module` is provided, error: "No modules detected. Run `/design:init` without `--module` first to set up workspace."

0. **Check for `.claude-plugin-design.json` migration** (Governing: SPEC-0014 REQ "Migration from JSON to CLAUDE.md"):

   Before the main init flow, check for a `.claude-plugin-design.json` file in the project root.

   **If `.claude-plugin-design.json` exists:**

   a. Read the JSON file and parse its contents.

   b. Translate each JSON key-value pair into the equivalent CLAUDE.md markdown format. The translation maps the JSON structure to the `### Design Plugin Configuration` section format defined in `references/shared-patterns.md` § "Config Resolution > CLAUDE.md Configuration Format":

      - `"tracker"` and `"tracker_config"` → `#### Tracker` subsection with bold-key list items (e.g., `- **Type**: github`, `- **Owner**: myorg`, `- **Repo**: myproject`)
      - `"branches"` → `#### Branch Conventions` subsection (e.g., `- **Enabled**: true`, `- **Prefix**: feature`, `- **Epic Prefix**: epic`, `- **Slug Max Length**: 50`)
      - `"pr_conventions"` → `#### PR Conventions` subsection (e.g., `- **Enabled**: true`, `- **Close Keyword**: Closes`, `- **Ref Keyword**: Part of`, `- **Include Spec Reference**: true`)
      - `"review"` → `#### Review` subsection (e.g., `- **Max Pairs**: 2`, `- **Merge Strategy**: squash`, `- **Auto Cleanup**: false`)
      - `"worktrees"` → `#### Worktrees` subsection (e.g., `- **Base Dir**: .claude/worktrees/`, `- **Max Agents**: 3`, `- **Auto Cleanup**: false`, `- **PR Mode**: ready`)
      - `"projects"` → `#### Projects` subsection (e.g., `- **Default Mode**: per-epic`, `- **Views**: All Work, Board, Roadmap`, `- **Columns**: Todo, In Progress, In Review, Done`, `- **Iteration Weeks**: 2`)
      - Omit keys with `null` values (they will use defaults).
      - Only generate subsections for JSON keys that are actually present.

   c. Show the user the generated markdown and ask via `AskUserQuestion`:
      - "Found existing configuration in `.claude-plugin-design.json`. I've translated it to CLAUDE.md format. Write this configuration to CLAUDE.md?"
      - Options: "Yes, migrate to CLAUDE.md" / "No, skip migration"

   d. If the user approves:
      - If CLAUDE.md already has a `### Design Plugin Configuration` section, merge the new values into existing subsections (CLAUDE.md values take precedence on conflicts — do not overwrite existing keys).
      - If CLAUDE.md does not have the section, it will be added during the main init flow (step 3 below) or appended after existing content.
      - Write the `### Design Plugin Configuration` section to CLAUDE.md.

   e. After successful migration, ask via `AskUserQuestion`:
      - "Migration complete. Delete `.claude-plugin-design.json`? (The configuration now lives in CLAUDE.md.)"
      - Options: "Yes, delete the JSON file" / "No, keep it"
      - If the user approves deletion, delete `.claude-plugin-design.json` using `Bash` (`rm`).
      - If the user declines, emit a warning: "Warning: Dual config sources exist (`.claude-plugin-design.json` and CLAUDE.md). Skills will read from CLAUDE.md only. Consider removing the JSON file to avoid confusion."

   **If `.claude-plugin-design.json` does not exist**, skip this step and proceed to step 1.

1. **Check for existing CLAUDE.md**: Look for `CLAUDE.md` in the project root.

2. **If CLAUDE.md exists**:
   - Read it and check whether it already contains references to `docs/adrs/` AND `docs/openspec/specs/`
   - If BOTH references are present, report that the plugin is already configured and stop (see Output: Already Configured)
   - **Check for path mismatches**: If the file contains an `## Architecture Context` section (or similar like `## Architecture`, `## Design Context`) but references different paths than `docs/adrs/` or `docs/openspec/specs/`, use `AskUserQuestion` to ask:
     - "Your CLAUDE.md has architecture references with different paths. Should I update them to the design plugin's standard paths (`docs/adrs/` for ADRs, `docs/openspec/specs/` for specs)?"
     - Options: "Yes, update paths" / "No, keep existing paths and add plugin section separately"
     - If the user says yes, update the existing paths in-place to match the plugin conventions
     - If the user says no, append the plugin's Architecture Context section below the existing one
   - If no architecture section exists at all, add the `## Architecture Context` section (see Content section below)
   - Do NOT duplicate content -- if the section exists but is incomplete, update it rather than appending a second copy

3. **If CLAUDE.md does not exist**:
   - Create a new `CLAUDE.md` at the project root with the `## Architecture Context` section
   - This is the expected first-run case -- do not treat it as an error

4. **Permission Auto-Configuration** (Governing: ADR-0015, SPEC-0014):

   After writing the CLAUDE.md configuration section (including tracker detection), offer to configure `.claude/settings.json` with permission allowlists.

   a. **Determine the tracker type** from the CLAUDE.md config section just written (or from the tracker detection that happened during init). If no tracker was detected, only include the base `git` permissions.

   b. **Build the permission allowlist** based on detected tracker:

      | Tracker | Permissions to Add |
      |---------|-------------------|
      | All projects | `Bash(git *)` |
      | GitHub (gh CLI) | `Bash(gh *)` |
      | Gitea (MCP) | `mcp__gitea__*` |
      | GitLab (MCP) | `mcp__gitlab__*` |
      | GitLab (glab CLI) | `Bash(glab *)` |
      | GitHub (MCP) | `mcp__github__*` |

   c. **Show the user** the exact permissions being added via `AskUserQuestion`:
      > "Configure `.claude/settings.json` with these permission allowlists so that git, tracker, and PR operations don't require manual approval?"

      Display the permissions as a table. Options: "Yes, configure permissions" / "No, skip"

   d. **If approved**: Read existing `.claude/settings.json` if it exists. Merge the new permissions into the existing `permissions.allow` array (don't overwrite existing entries). Write the updated file.

   e. **If declined**: Skip and note in the output that permissions were not configured.

5. **Workspace Detection and Setup** (Governing: ADR-0016, SPEC-0014 REQ "Init Workspace Setup"):

   <!-- Governing: ADR-0016 (Workspace Mode), SPEC-0014 REQ "Workspace Detection", SPEC-0014 REQ "Init Workspace Setup" -->

   After permissions configuration, detect and set up workspace modules.

   a. **Check for `.gitmodules`** in the project root.

   b. **If `.gitmodules` exists:**

      - Parse it to extract submodule names and paths (using the algorithm in `references/shared-patterns.md` § "Workspace Detection > Step 1").
      - Display the discovered submodules to the user:
        ```
        Discovered workspace modules from .gitmodules:
        - service-api (services/api)
        - service-web (services/web)
        - shared-lib (packages/shared)
        ```

      - For each submodule, check if a `CLAUDE.md` exists at the submodule root:
        - **If `CLAUDE.md` exists**: Report "Already configured" and skip (unless the user explicitly requests update).
        - **If `CLAUDE.md` does not exist**: Offer to create it with a minimal `## Architecture Context` section:
          ```markdown
          ## Architecture Context

          This module uses the [design plugin](https://github.com/joestump/claude-plugin-design) for architecture governance.

          - Architecture Decision Records are in `docs/adrs/`
          - Specifications are in `docs/openspec/specs/`
          ```

      - Ask via `AskUserQuestion`:
        - "Create CLAUDE.md for {N} unconfigured submodule(s)? ({list of names})"
        - Options: "Yes, create for all" / "Let me pick" / "No, skip workspace setup"
        - If "Let me pick": present each submodule individually for yes/no

      - **Write `### Workspace Modules` table** in the root `CLAUDE.md` (inside the `## Architecture Context` section, after the existing content). List all discovered submodules:
        ```markdown
        ### Workspace Modules

        | Module | Root | Description |
        |--------|------|-------------|
        | service-api | services/api | |
        | service-web | services/web | |
        | shared-lib | packages/shared | |
        ```
        If a `### Workspace Modules` table already exists, update it with any newly discovered modules (preserve existing entries and their descriptions, add missing modules).

   c. **If `.gitmodules` does not exist:**

      - Check if the root `CLAUDE.md` already has a `### Workspace Modules` section.
      - If it does: report "Workspace modules already configured (manual)" and skip.
      - If it does not: skip workspace setup silently (single-module project is the default).

   d. **Order of operations when both `.gitmodules` and `.claude-plugin-design.json` exist**: Migration (step 0) runs first, then workspace setup (this step). This ensures the migrated configuration is in CLAUDE.md before workspace modules are appended.

6. **Report what happened** using the appropriate output format below.

## Content to Add

Read the plugin's `references/claude-md-template.md` and add its contents to CLAUDE.md. If CLAUDE.md already has other content, append the template at the end.

## Idempotency Rules

- Before adding content, ALWAYS check if `CLAUDE.md` already contains the string `docs/adrs/` AND `docs/openspec/specs/`
- If both strings are present, do NOT modify the file -- report "already configured"
- If the `## Architecture Context` heading exists but is missing one of the references, add the missing reference to the existing section rather than creating a new section
- If the file contains architecture references with DIFFERENT paths (e.g., `docs/decisions/` instead of `docs/adrs/`, or `openspec/specs/` instead of `docs/openspec/specs/`), ask the user before modifying -- do NOT silently add conflicting paths
- NEVER append a duplicate `## Architecture Context` section
- NEVER generate ad-hoc warnings or suggestions about path mismatches -- use `AskUserQuestion` to let the user decide

## Output

### When CLAUDE.md is created (first run):

```
## Design Plugin Initialized

Created CLAUDE.md with architecture context.

### What was created:
- New CLAUDE.md at project root
- Reference to `docs/adrs/` (Architecture Decision Records)
- Reference to `docs/openspec/specs/` (OpenSpec Specifications)
- Design plugin usage hints

### Next steps:
- Create your first ADR: `/design:adr [description]`
- Create your first spec: `/design:spec [capability]`
- Prime a session with context: `/design:prime [topic]`
```

### When CLAUDE.md is updated (exists but missing references):

```
## Design Plugin Initialized

CLAUDE.md updated with architecture context.

### What was added:
- Reference to `docs/adrs/` (Architecture Decision Records)
- Reference to `docs/openspec/specs/` (OpenSpec Specifications)
- Design plugin usage hints

### Next steps:
- Create your first ADR: `/design:adr [description]`
- Create your first spec: `/design:spec [capability]`
- Prime a session with context: `/design:prime [topic]`
```

### When already configured (idempotent re-run):

```
## Design Plugin Already Configured

CLAUDE.md already contains architecture context references. No changes made.

- ADR path: docs/adrs/
- Spec path: docs/openspec/specs/
```

## Rules

- MUST be idempotent -- running twice produces no duplicate content
- MUST NOT remove or modify any existing content in CLAUDE.md (except merging config during migration)
- MUST append the Architecture Context section after existing content, not prepend
- If CLAUDE.md does not exist, create it -- this is the normal first-run case, not an error
- Do NOT create `docs/adrs/` or `docs/openspec/specs/` directories -- those are created by `/design:adr` and `/design:spec` when needed
- MUST detect `.claude-plugin-design.json` before the main init flow and offer migration (Governing: SPEC-0014 REQ "Migration from JSON to CLAUDE.md")
- MUST preserve all configuration values exactly during migration -- no lossy translation
- MUST NOT delete `.claude-plugin-design.json` without explicit user consent via `AskUserQuestion`
- When merging migrated config into an existing `### Design Plugin Configuration` section, CLAUDE.md values take precedence on conflicts
- Migration MUST translate JSON key names to the canonical CLAUDE.md format defined in `references/shared-patterns.md` § "Config Resolution > CLAUDE.md Configuration Format"
- MUST offer to configure `.claude/settings.json` with tracker-appropriate permission allowlists during init (Governing: ADR-0015, SPEC-0014)
- MUST detect `.gitmodules` and offer workspace setup when submodules are found (Governing: ADR-0016, SPEC-0014 REQ "Init Workspace Setup")
- MUST NOT create submodule CLAUDE.md files without user consent via `AskUserQuestion`
- MUST write `### Workspace Modules` table in root CLAUDE.md when workspace is detected
- MUST skip submodules that already have CLAUDE.md (unless user explicitly requests update)
- When `.gitmodules` and `.claude-plugin-design.json` both exist, migration (step 0) runs before workspace setup (step 5)
