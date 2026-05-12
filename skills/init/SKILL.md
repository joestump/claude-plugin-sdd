---
name: init
description: Set up CLAUDE.md with SDD plugin references for architecture-aware sessions. Use when the user installs the plugin, says "initialize sdd", or wants to configure CLAUDE.md for the SDD plugin.
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, AskUserQuestion
argument-hint: [--module <name>]
---

<!-- Governing: ADR-0015 (Markdown-Native Configuration), ADR-0020 (Governing Comment Reform), ADR-0024 (qmd as hard dependency), ADR-0025 (.sdd/ directory rationale), SPEC-0002 REQ "Project Initialization", SPEC-0014 REQ "Migration from JSON to CLAUDE.md", SPEC-0019 REQ "qmd Preflight Enforcement", SPEC-0019 REQ "qmd Assumption in Consumer Skills", SPEC-0019 REQ ".sdd Gitignore Enforcement" -->

# Initialize SDD Plugin

Set up the project's `CLAUDE.md` with architecture context so Claude sessions are design-aware. This skill uses **componentized convergence** — each component independently checks its own state and converges. No single gate blocks other components. Running init N times produces the same result as running it once.

Starting v5.0.0, init also enforces a hardware/install precondition: the `qmd` CLI MUST be available on PATH (per ADR-0024). If qmd is missing, init refuses to operate so users discover the dependency at setup, not three skills deep into a workflow.

## Process

<!-- Governing: ADR-0016 (Workspace Mode), SPEC-0014 REQ "Artifact Path Resolution" -->

**Module support**: If `$ARGUMENTS` contains `--module <name>`, resolve the module root using the Workspace Detection pattern from `references/shared-patterns.md`. All CLAUDE.md reads and writes in the steps below target the module's `CLAUDE.md` at the module root instead of the project root. If workspace detection finds no modules and `--module` is provided, error: "No modules detected. Run `/sdd:init` without `--module` first to set up workspace."

### Step -1: qmd Preflight (v5.0.0+)

<!-- Governing: ADR-0024, SPEC-0019 REQ "qmd Preflight Enforcement" -->

Before any other check or mutation, verify that the `qmd` CLI is available on PATH. Starting with v5.0.0, qmd is a hard dependency — every qmd-aware consumer skill (per SPEC-0019) assumes qmd is present, so init MUST refuse to operate without it.

1. Run `command -v qmd >/dev/null 2>&1`. If exit is non-zero, output the canonical error message and stop:

   ```
   The `qmd` CLI is required by the SDD plugin starting with v5.0.0 but was not found on PATH.

   Install with one of:
     npm install -g @tobilu/qmd
     bun install -g @tobilu/qmd

   See https://github.com/tobi/qmd for details. Re-run `/sdd:init` after installing.
   ```

   The exit signal MUST be visible enough that downstream tooling (CI, install scripts) can detect the missing dependency. Do NOT modify CLAUDE.md, `.gitignore`, or any other file when this preflight fails.

2. If qmd is present, optionally run `qmd status` to detect whether the GGUF models are downloaded. Model download is qmd's responsibility on first embed, NOT an init prerequisite — proceed even if models are absent. Note the upcoming ~2GB download in the Step 5 final report so users on bandwidth-constrained networks can plan.

3. Re-running `/sdd:init` after a successful install is idempotent — qmd is present, the preflight passes silently, and no spurious changes are introduced to CLAUDE.md or `.gitignore`.

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
| Skills Table | Does the skills table contain ALL plugin-owned skills discovered by enumerating `skills/*/SKILL.md` in the plugin directory (see Step 2b)? Compare skill names (the `/sdd:*` values in the first column). | `up-to-date` / `outdated` / `missing` |
| Workflow Section | Does the Workflow section contain the same steps as the canonical template? | `up-to-date` / `outdated` / `missing` |
| Session Coordination | Does CLAUDE.md contain `### Session Coordination`? | `present` / `missing` |
| SDD Plugin Config | Does CLAUDE.md contain `### SDD Configuration`? | `present` / `missing` |
| Permissions | Does `.claude/settings.local.json` contain broad wildcard patterns for `git` and the detected tracker? (e.g., `Bash(git *)`, `Bash(gh *)`, `mcp__gitea__*`) | `configured` / `needs-update` |
| qmd Assumption Note | Does CLAUDE.md (or canonical template) include the v5 note "qmd-aware consumer skills MAY assume qmd is present"? | `present` / `missing` |
| `.sdd/` Gitignore | Does `.gitignore` contain a `.sdd/` entry? (Required for v5.0.0+ — see ADR-0025 / SPEC-0019 REQ ".sdd Gitignore Enforcement") | `present` / `missing` |
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

**If CLAUDE.md does not exist**: Read the canonical template from `references/claude-md-template.md` and create CLAUDE.md with its contents plus any config section generated in Step 1. The template's `### SDD Skills` section contains a placeholder marker (`<!-- SDD-SKILLS-TABLE -->`) where the skills table belongs — generate the table via **Skills Table Generation** (Step 2b below) and replace the marker with the generated GFM table. Then skip to Step 3.

**If CLAUDE.md exists**, perform section-level convergence. Each sub-check below runs independently:

a. **Path references**: If `docs/adrs/` or `docs/openspec/specs/` are missing from the `## Architecture Context` section, add them. If a DIFFERENT path exists (e.g., `docs/decisions/`), use `AskUserQuestion` to resolve — this is a genuine ambiguity that requires user input.

b. **Skills table**: Generate the canonical skills table dynamically by enumerating `skills/*/SKILL.md` in the plugin directory (the directory containing this `init/` skill — typically `${CLAUDE_PLUGIN_ROOT}/skills/` when the plugin is installed). Follow the procedure in **Skills Table Generation** below. For each plugin-owned skill row that is NOT present in the current CLAUDE.md's skills table (match by skill name in the first column, e.g., `/sdd:review`), insert it. Do NOT remove existing rows — the user may have added custom entries for third-party plugins or local skills, and those MUST be preserved (additive-only, per the Idempotency Rules below).

   **Why dynamic, not template-driven**: The plugin's set of skills changes every release. A static template at `references/claude-md-template.md` would have to be hand-edited every time a new skill ships, and existing CLAUDE.md files would only pick up the addition if that hand-edit happened. Enumerating `skills/*/SKILL.md` at runtime makes adding a new skill a single drop-in operation — its row appears in the next `/sdd:init` run automatically.

#### Skills Table Generation

<!-- Governing: SPEC-0002 REQ "Project Initialization" -->

This is the canonical algorithm for building the plugin-owned portion of the `### SDD Skills` table. It runs whenever Step 2b executes (skills table convergence) and whenever Step 0 needs to know the canonical row set (skills-table status check).

1. **Locate the plugin's `skills/` directory**. From the running skill's perspective, this is one level up from `skills/init/` — i.e., the directory that contains all `skills/<name>/SKILL.md` files. When invoked as a Claude Code plugin skill, the working directory is typically the user's project root; resolve the plugin directory via `${CLAUDE_PLUGIN_ROOT}/skills/` if that env var is set, otherwise fall back to the path the running `init/SKILL.md` was loaded from. (If neither resolves, abort the dynamic generation and emit a clear error — do NOT silently fall back to a stale template.)

2. **Enumerate `skills/*/SKILL.md`**. Use `Glob` with pattern `skills/*/SKILL.md` rooted at the plugin directory. Skip any path that does not exist or has empty frontmatter.

3. **Extract frontmatter** from each `SKILL.md`. The frontmatter is a YAML block between two `---` lines at the top of the file (or directly after a leading HTML comment, which a few skills use for governing-comment hoisting). Required keys:
   - `name` — the skill's slash-command suffix (e.g., `adr` → `/sdd:adr`)
   - `description` — the full sentence-trigger description shown to the model

   `disable-model-invocation: true` skills (currently `list`, `status`) are INCLUDED in the table — they remain user-invokable as slash commands even though the model cannot trigger them autonomously. No special markup.

4. **Derive the Purpose column** for each skill by taking the **first sentence** of `description` (split on `. ` — the period-space boundary that separates the human-readable purpose from the `Use when ...` trigger guidance). Drop any trailing period. If the resulting string exceeds 80 characters, truncate at the last word boundary before the 80-character mark and append `…`. Examples:
   - `description: "Create a new Architecture Decision Record (ADR) using MADR format. Use when the user wants ..."` → Purpose: `Create a new Architecture Decision Record (ADR) using MADR format`
   - `description: "Quick-check code against ADRs and specs for drift. Use when ..."` → Purpose: `Quick-check code against ADRs and specs for drift`

5. **Order the rows** using the canonical lifecycle ordering below. Skills not in this list are appended at the end, sorted alphabetically by name — this guarantees that **a newly added skill always shows up in the next init run with zero edits to this file**, while still letting maintainers nudge it into the lifecycle position by adding its name to the list during release prep.

   Canonical lifecycle order (decide → specify → list/status → docs → init/prime → check/audit/discover → plan/organize/enrich → build/review → introspect → other):

   ```
   adr, spec, list, status, docs, init, prime, check, audit, discover,
   plan, organize, enrich, work, review, graph, index, report-friction
   ```

   When adding a brand-new skill that fits the lifecycle, append it to this list in the appropriate position during the same PR that introduces the skill; if the maintainer forgets, the skill still appears (alphabetically at the end), so existing users still pick it up.

6. **Build the table** as standard GFM markdown:

   ```markdown
   | Skill | Purpose |
   |-------|---------|
   | `/sdd:<name>` | <Purpose> |
   ...
   ```

7. **Merge with the user's existing CLAUDE.md skills table**:
   - Parse the existing `### SDD Skills` table (if any). Treat each row's first column (the skill name in backticks, e.g., `` `/sdd:plan` ``) as the merge key.
   - For each generated plugin-owned row whose skill name is NOT already in the existing table, **insert** it at the position implied by the canonical order: walk the generated list in order; insert each missing row immediately after the previous canonical row that IS present, or at the end of the plugin-owned block if no prior anchor exists.
   - Plugin-owned rows that ARE already present are left untouched (do not rewrite their Purpose column — the user may have edited the wording, and the additive-only rule applies).
   - User-added rows (skill names that don't match any name in the enumerated plugin skills — e.g., a row for a third-party plugin like `` `/myplugin:foo` ``) are preserved in their original positions.

   Idempotency invariant: running `/sdd:init` twice in a row MUST produce zero changes on the second run.

c. **Workflow section**: Compare the current Workflow steps against the canonical template. If steps are missing (e.g., a "Review" step), insert them at the correct position and renumber subsequent steps. Preserve existing step content.

d. **Session Coordination section**: If `### Session Coordination` heading is missing, append the section from the canonical template after the Workflow section.

e. **SDD Configuration section**: If Step 1 produced config markdown and no `### SDD Configuration` section exists yet, append it at the end of the `## Architecture Context` section. If the section already exists, Step 1 already handled the merge.

f. **qmd Assumption Note** (v5.0.0+, per SPEC-0019 REQ "qmd Assumption in Consumer Skills"): Read the canonical template's `### qmd Dependency` paragraph from `references/claude-md-template.md`. If the current CLAUDE.md's `## Architecture Context` section does not include this paragraph (match by the heading text "qmd Dependency"), append it after the existing intro paragraph and before the `### SDD Skills` heading. The paragraph documents that qmd-aware consumer skills MAY assume qmd is installed (because /sdd:init enforced it) and MUST NOT include conditional fallback paths — this gives future readers and contributors the v5 invariant in plain language.

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

### Step 3.5: `.sdd/` Gitignore Enforcement

<!-- Governing: ADR-0025 (Tracker Issues as Fourth qmd Collection), SPEC-0019 REQ ".sdd Gitignore Enforcement" -->

**Precondition**: `.sdd/` Gitignore status is `missing`.

The `.sdd/` directory is the local cache for synced tracker issues (per ADR-0025). It is replaceable from the tracker on demand, contains issue bodies that may carry sensitive content, and MUST NOT be committed to the repository.

1. **If `.gitignore` does not exist**: create it with a single line `.sdd/` (followed by a trailing newline). Done.

2. **If `.gitignore` exists and contains `.sdd/`** (anywhere in the file, on its own line): leave the file unchanged. Idempotent — running init repeatedly MUST NOT produce duplicate `.sdd/` lines.

3. **If `.gitignore` exists but does not contain `.sdd/`**: append `.sdd/` to the end of the file, preceded by a single newline if the file does not already end with one. All existing entries MUST remain in their original positions — this step is purely additive.

**No AskUserQuestion** — `.sdd/` belongs in `.gitignore` for every v5+ project. The decision is universal, not user-preference.

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

When creating a new CLAUDE.md or checking for drift in any **non-skills-table** section (intro paragraph, qmd Dependency, Workflow, Session Coordination, Governing Comments), read the canonical content from the plugin's `references/claude-md-template.md` file. That file is the source of truth for everything except the `### SDD Skills` table.

The `### SDD Skills` table is generated dynamically from `skills/*/SKILL.md` frontmatter — see **Skills Table Generation** under Step 2b. The template file contains a `<!-- SDD-SKILLS-TABLE -->` placeholder marker in the skills section; the running skill replaces that marker with the generated table when materializing a fresh CLAUDE.md, and uses the same generation procedure to drive convergence against an existing CLAUDE.md. The static template MUST NOT be hand-edited to add a new skill row — adding a new directory under `skills/` with a valid `SKILL.md` is sufficient for `/sdd:init` to start emitting that row on its next run.

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
- MUST read canonical template from `references/claude-md-template.md` for section-level diffing of non-skills-table content — never hardcode template content in this skill
- MUST generate the `### SDD Skills` table dynamically by enumerating `skills/*/SKILL.md` frontmatter at runtime (see **Skills Table Generation** under Step 2b) — adding a new skill MUST NOT require editing `references/claude-md-template.md`
- MUST preserve user-added rows in the `### SDD Skills` table during convergence — rows whose skill name does not match any enumerated plugin skill MUST remain in their original position (additive-only, per Idempotency Rules)
- MUST display component status scan before making changes
- MUST report all changes in the final component status table
- **v5.0.0+**: MUST run the qmd preflight (Step -1) before any other check or mutation. If `qmd` is not on PATH, MUST refuse to operate and emit the canonical install message — silent fall-through to the rest of init MUST NOT happen (Governing: ADR-0024, SPEC-0019 REQ "qmd Preflight Enforcement")
- **v5.0.0+**: MUST add `.sdd/` to `.gitignore` (creating the file if absent) per Step 3.5. Idempotent — duplicate `.sdd/` lines MUST NOT be appended; existing `.gitignore` entries MUST remain in their original positions (Governing: ADR-0025, SPEC-0019 REQ ".sdd Gitignore Enforcement")
- **v5.0.0+**: MUST converge the `### qmd Dependency` paragraph in CLAUDE.md per Step 2 sub-check (f). The paragraph documents the v5 invariant that qmd-aware consumer skills MAY assume qmd is installed (Governing: SPEC-0019 REQ "qmd Assumption in Consumer Skills")
