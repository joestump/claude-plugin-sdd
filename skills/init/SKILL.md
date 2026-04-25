---
name: init
description: Set up CLAUDE.md with SDD plugin references for architecture-aware sessions. Use when the user installs the plugin, says "initialize sdd", or wants to configure CLAUDE.md for the SDD plugin.
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, AskUserQuestion
argument-hint: [--module <name>]
---

<!-- Governing: ADR-0015 (Markdown-Native Configuration), SPEC-0014 REQ "Migration from JSON to CLAUDE.md" -->

# Initialize SDD Plugin

Set up the project's `CLAUDE.md` with architecture context so Claude sessions are design-aware. This skill uses **componentized convergence** — each component independently checks its own state and converges. No single gate blocks other components. Running init N times produces the same result as running it once.

## Process

<!-- Governing: ADR-0016 (Workspace Mode), SPEC-0014 REQ "Artifact Path Resolution" -->

**Module support**: If `$ARGUMENTS` contains `--module <name>`, resolve the module root using the Workspace Detection pattern from `references/shared-patterns.md`. All CLAUDE.md reads and writes in the steps below target the module's `CLAUDE.md` at the module root instead of the project root. If workspace detection finds no modules and `--module` is provided, error: "No modules detected. Run `/sdd:init` without `--module` first to set up workspace."

### Step 0: Component Status Scan

Before making any changes, read the current state and build a component checklist. This step is purely diagnostic — no mutations.

**Checks to perform:**

| Component | Check | Status Values |
|-----------|-------|---------------|
| JSON Config | Does `.claude-plugin-design.json` exist in the project root? | `needs-migration` / `absent` |
| Legacy Headings | Does CLAUDE.md contain `### Design Plugin Configuration` or `### Design Plugin Skills`? (v3 headings) | `needs-migration` / `absent` |
| CLAUDE.md | Does `CLAUDE.md` exist at the project root? | `exists` / `missing` |
| Architecture Context | Does CLAUDE.md contain `## Architecture Context`? | `present` / `missing` |
| Path References | Does CLAUDE.md contain both `docs/adrs/` and `docs/openspec/specs/`? | `both-present` / `partial` / `missing` |
| Skills Table | Does the skills table contain ALL skills from the canonical template (`references/claude-md-template.md`)? Compare skill names (the `/sdd:*` values in the first column). | `up-to-date` / `outdated` / `missing` |
| Workflow Section | Does the Workflow section contain the same steps as the canonical template? | `up-to-date` / `outdated` / `missing` |
| Session Coordination | Does CLAUDE.md contain `### Session Coordination`? | `present` / `missing` |
| SDD Plugin Config | Does CLAUDE.md contain `### SDD Configuration`? | `present` / `missing` |
| Permissions | Does `.claude/settings.local.json` contain broad wildcard patterns for `git` and the detected tracker? (e.g., `Bash(git *)`, `Bash(gh *)`, `mcp__gitea__*`) | `configured` / `needs-update` |
| Workspace Modules | Does `### Workspace Modules` exist? (only check if `.gitmodules` exists) | `present` / `missing` / `n/a` |

Display the scan results before proceeding so the user can see what will change.

### Step 1: Legacy v3 Migration

This step handles two v3 → v4 migrations: the `### Design Plugin Configuration` / `### Design Plugin Skills` headings (renamed in v4) and the legacy `.claude-plugin-design.json` file (deprecated by ADR-0015, removed in v4).

#### 1a: Legacy Heading Rewrite

**Precondition**: Legacy Headings status is `needs-migration`.

If CLAUDE.md does not contain either legacy heading, skip this sub-step.

If CLAUDE.md contains a `### Design Plugin Configuration` heading, rewrite it in place to `### SDD Configuration`. The body content (subsections like `#### Tracker`, `#### Branch Conventions`, etc.) is preserved as-is — only the h3 heading line changes.

If CLAUDE.md contains a `### Design Plugin Skills` heading, rewrite it in place to `### SDD Skills`. The skills table below the heading is left untouched (Step 2 will refresh stale `/design:*` rows to `/sdd:*` if needed).

**No AskUserQuestion** — heading rewrite is deterministic and lossless.

#### 1b: JSON Config Migration

**Precondition**: JSON Config status is `needs-migration`.

If `.claude-plugin-design.json` does not exist, skip this sub-step entirely.

If `.claude-plugin-design.json` exists:

1. Read the JSON file and parse its contents.

2. Translate each JSON key-value pair into the equivalent CLAUDE.md markdown format. The translation maps the JSON structure to the `### SDD Configuration` section:

   - `"tracker"` and `"tracker_config"` → `#### Tracker` subsection with bold-key list items (e.g., `- **Type**: github`, `- **Owner**: myorg`, `- **Repo**: myproject`)
   - `"branches"` → `#### Branch Conventions` subsection (e.g., `- **Enabled**: true`, `- **Prefix**: feature`, `- **Epic Prefix**: epic`, `- **Slug Max Length**: 50`)
   - `"pr_conventions"` → `#### PR Conventions` subsection (e.g., `- **Enabled**: true`, `- **Close Keyword**: Closes`, `- **Ref Keyword**: Part of`, `- **Include Spec Reference**: true`)
   - `"review"` → `#### Review` subsection (e.g., `- **Max Pairs**: 2`, `- **Merge Strategy**: squash`, `- **Auto Cleanup**: false`)
   - `"worktrees"` → `#### Worktrees` subsection (e.g., `- **Base Dir**: .claude/worktrees/`, `- **Max Agents**: 3`, `- **Auto Cleanup**: false`, `- **PR Mode**: ready`)
   - `"projects"` → `#### Projects` subsection (e.g., `- **Default Mode**: per-epic`, `- **Views**: All Work, Board, Roadmap`, `- **Columns**: Todo, In Progress, In Review, Done`, `- **Iteration Weeks**: 2`)
   - Omit keys with `null` values (they will use defaults).
   - Only generate subsections for JSON keys that are actually present.

3. If CLAUDE.md already has a `### SDD Configuration` section, merge the new values into existing subsections (CLAUDE.md values take precedence on conflicts — do not overwrite existing keys). Otherwise, hold the generated markdown to be appended during Step 2.

4. Write the `### SDD Configuration` section to CLAUDE.md (append at end of `## Architecture Context` section).

5. Delete `.claude-plugin-design.json` using `Bash` (`rm`).

**No AskUserQuestion** — migration is deterministic and lossless. The JSON values are preserved exactly in the markdown format.

### Step 2: CLAUDE.md Template Convergence

**Precondition**: Always runs. Each sub-check acts independently.

**If CLAUDE.md does not exist**: Read the canonical template from `references/claude-md-template.md` and create CLAUDE.md with its contents plus any config section generated in Step 1. Done — skip to Step 3.

**If CLAUDE.md exists**, perform section-level convergence. Each sub-check below runs independently:

a. **Path references**: If `docs/adrs/` or `docs/openspec/specs/` are missing from the `## Architecture Context` section, add them. If a DIFFERENT path exists (e.g., `docs/decisions/`), use `AskUserQuestion` to resolve — this is a genuine ambiguity that requires user input.

b. **Skills table**: Read the canonical template's skills table from `references/claude-md-template.md`. For each skill row in the template that is NOT present in the current CLAUDE.md's skills table (match by skill name in the first column, e.g., `/sdd:review`), insert it at the end of the table. Do NOT remove existing rows — the user may have added custom entries.

c. **Workflow section**: Compare the current Workflow steps against the canonical template. If steps are missing (e.g., a "Review" step), insert them at the correct position and renumber subsequent steps. Preserve existing step content.

d. **Session Coordination section**: If `### Session Coordination` heading is missing, append the section from the canonical template after the Workflow section.

e. **SDD Configuration section**: If Step 1 produced config markdown and no `### SDD Configuration` section exists yet, append it at the end of the `## Architecture Context` section. If the section already exists, Step 1 already handled the merge.

**Duplicate prevention**: Before inserting any section, check for the section heading. Before inserting a skills table row, check for the skill name. This makes the step idempotent.

### Step 3: Permission Auto-Configuration

**Precondition**: Permissions status is `needs-update`.

If `.claude/settings.local.json` already contains broad wildcard patterns for git and the detected tracker, skip this step.

1. **Determine the tracker type** from the `### SDD Configuration` section in CLAUDE.md (or from the JSON config parsed in Step 1 before migration). If no tracker was detected, only include the base `git` permissions.

2. **Detect available MCP tools** using `ToolSearch` to probe for tools matching `gitea`, `github`, `gitlab`.

3. **Build the canonical permission allowlist**:

   | Condition | Permission to Add |
   |-----------|-------------------|
   | All projects | `Bash(git *)` |
   | GitHub tracker or `gh` CLI available | `Bash(gh *)` |
   | Gitea MCP tools detected | `mcp__gitea__*` |
   | GitLab MCP tools detected | `mcp__gitlab__*` |
   | GitLab `glab` CLI available | `Bash(glab *)` |
   | GitHub MCP tools detected | `mcp__github__*` |

4. **Read** existing `.claude/settings.local.json` if it exists. If it doesn't exist, start with `{"permissions": {"allow": []}}`.

5. **Merge** the canonical permissions into the existing `permissions.allow` array. Add any patterns from the canonical list that are not already present. Do NOT remove existing entries — the user may have added project-specific permissions.

6. **Write** the updated `.claude/settings.local.json`.

**No AskUserQuestion** — these are standard tool permissions for the detected tracker.

### Step 4: Workspace Detection and Setup

<!-- Governing: ADR-0016 (Workspace Mode), SPEC-0014 REQ "Workspace Detection", SPEC-0014 REQ "Init Workspace Setup" -->

**Precondition**: `.gitmodules` exists in the project root.

If `.gitmodules` does not exist, skip this step silently (single-module project is the default).

If `.gitmodules` exists:

a. Parse it to extract submodule names and paths (using the algorithm in `references/shared-patterns.md` § "Workspace Detection > Step 1").

b. Display the discovered submodules to the user.

c. For each submodule, check if a `CLAUDE.md` exists at the submodule root:
   - **If `CLAUDE.md` exists**: Report "Already configured" and skip.
   - **If `CLAUDE.md` does not exist**: Offer to create it with a minimal `## Architecture Context` section via `AskUserQuestion`.

d. **Write `### Workspace Modules` table** in the root `CLAUDE.md` (inside the `## Architecture Context` section). If the table already exists, update it with any newly discovered modules (preserve existing entries).

### Step 5: Report

Output a component-level status table showing what was done.

**When changes were made:**

```
## SDD Plugin Init Report

| Component | Status | Action Taken |
|-----------|--------|-------------|
| JSON Config Migration | Migrated | Moved tracker, projects, branches, pr_conventions to CLAUDE.md; deleted .claude-plugin-design.json |
| Architecture Context | Up to date | No changes |
| Skills Table | Updated | Added /sdd:review |
| Workflow | Updated | Added Review step (step 6), renumbered Validate to step 7 |
| Session Coordination | Added | New section appended |
| SDD Configuration | Added | Migrated from .claude-plugin-design.json |
| Permissions | Updated | Added Bash(git *), Bash(gh *), mcp__gitea__* to .claude/settings.local.json |
| Workspace | Skipped | No .gitmodules found |

### Next steps:
- Prime a session with context: `/sdd:prime [topic]`
- Review your architecture: `/sdd:check`
```

**When everything is already up-to-date:**

```
## SDD Plugin Already Up to Date

All components are current. No changes made.

| Component | Status |
|-----------|--------|
| Architecture Context | Up to date |
| Skills Table | Up to date ({N} skills) |
| Workflow | Up to date ({N} steps) |
| Session Coordination | Present |
| SDD Configuration | Present |
| Permissions | Configured |
```

**When CLAUDE.md is created (first run):**

```
## SDD Plugin Initialized

Created CLAUDE.md with architecture context.

### What was created:
- New CLAUDE.md at project root
- Reference to `docs/adrs/` (Architecture Decision Records)
- Reference to `docs/openspec/specs/` (OpenSpec Specifications)
- SDD plugin skills table and workflow guide

### Next steps:
- Create your first ADR: `/sdd:adr [description]`
- Create your first spec: `/sdd:spec [capability]`
- Prime a session with context: `/sdd:prime [topic]`
```

## Content Reference

When creating a new CLAUDE.md or checking for template drift, read the canonical template from the plugin's `references/claude-md-template.md` file. This is the single source of truth for what the `## Architecture Context` section should contain.

## Idempotency Rules

Each component is independently idempotent:

- **JSON Migration**: Skip if `.claude-plugin-design.json` is absent. If present, migrate and delete. Re-running after migration: file is gone, skip.
- **Legacy Heading Rewrite**: Skip if neither `### Design Plugin Configuration` nor `### Design Plugin Skills` is present. If present, rewrite to the v4 names and continue. Re-running after rewrite: legacy heading is gone, skip.
- **Skills table**: Skip rows already present (match by skill name in first column). Never remove existing rows.
- **Workflow**: Skip steps already present (match by step name). Never remove existing steps.
- **Named sections**: Skip if heading already exists (`### Session Coordination`, `### SDD Configuration`).
- **Permissions**: Skip patterns already in the allow array. Never remove existing entries.
- **Workspace**: Skip submodules that already have CLAUDE.md. Skip if `### Workspace Modules` already exists and is current.
- Running init N times produces the same result as running it once.
- Init NEVER removes content from CLAUDE.md (additive only, except merging during migration where CLAUDE.md values take precedence on conflicts).
- NEVER append a duplicate `## Architecture Context` section.
- NEVER generate ad-hoc warnings or suggestions about path mismatches — use `AskUserQuestion` to let the user decide.

## Rules

- MUST use componentized convergence — each component checks its own precondition, no single gate blocks other components
- MUST be idempotent — running twice produces no duplicate content
- MUST NOT remove or modify any existing content in CLAUDE.md (except merging config during migration)
- MUST append the Architecture Context section after existing content, not prepend
- If CLAUDE.md does not exist, create it — this is the normal first-run case, not an error
- Do NOT create `docs/adrs/` or `docs/openspec/specs/` directories — those are created by `/sdd:adr` and `/sdd:spec` when needed
- MUST detect `.claude-plugin-design.json` before the main flow and migrate automatically (Governing: SPEC-0014 REQ "Migration from JSON to CLAUDE.md")
- MUST preserve all configuration values exactly during migration — no lossy translation
- MUST delete `.claude-plugin-design.json` after successful migration — no AskUserQuestion needed
- When merging migrated config into an existing `### SDD Configuration` section, CLAUDE.md values take precedence on conflicts
- MUST auto-configure `.claude/settings.local.json` with tracker-appropriate permission allowlists — no AskUserQuestion needed
- MUST detect `.gitmodules` and offer workspace setup when submodules are found (Governing: ADR-0016, SPEC-0014 REQ "Init Workspace Setup")
- MUST NOT create submodule CLAUDE.md files without user consent via `AskUserQuestion`
- MUST write `### Workspace Modules` table in root CLAUDE.md when workspace is detected
- MUST skip submodules that already have CLAUDE.md (unless user explicitly requests update)
- When `.gitmodules` and `.claude-plugin-design.json` both exist, migration (Step 1) runs before workspace setup (Step 4)
- MUST read canonical template from `references/claude-md-template.md` for section-level diffing — never hardcode template content in this skill
- MUST display component status scan before making changes
- MUST report all changes in the final component status table
