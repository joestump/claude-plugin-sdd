<!-- Governing: ADR-0015 (Markdown-Native Configuration), SPEC-0014 REQ "Config Resolution Pattern in shared-patterns.md" -->

# Shared Patterns Reference

Patterns used across multiple design plugin skills. Skills reference specific sections by heading instead of duplicating the content.

## Artifact Path Resolution

<!-- Governing: ADR-0016 (Workspace Mode), SPEC-0014 REQ "Artifact Path Resolution" -->

Canonical algorithm for resolving the paths to ADR and spec directories. All skills that access ADRs or specs MUST use this pattern instead of hardcoding `docs/adrs/` or `docs/openspec/specs/`.

### Step 1: Determine the Module Root

- If a `--module <name>` flag is provided, locate the module root. Read the project-root `CLAUDE.md` for a `### Modules` section listing module names and their root directories. If the module name is not found, error: "Unknown module `{name}`. Available modules: {list of names from CLAUDE.md}."
- If `--module` is NOT provided and the project has a `### Modules` section in the root `CLAUDE.md`, the skill is operating in **aggregate mode** — it should iterate over all modules (and the project root, if it has its own artifacts).
- If no `### Modules` section exists, the project is a **single-module project** — the module root is the project root.

### Step 2: Read Artifact Location Declarations

Read the module's `CLAUDE.md` (or the root `CLAUDE.md` for single-module projects) and look for artifact location declarations in the `## Architecture Context` section:

- `- Architecture Decision Records are in {path}` → use `{path}` as the ADR directory
- `- Specifications are in {path}` → use `{path}` as the spec directory

Paths are relative to the module root (or project root for single-module projects).

### Step 3: Apply Defaults

If the `CLAUDE.md` does not declare a path for ADRs or specs, fall back to these defaults:

- **ADR directory**: `docs/adrs/`
- **Spec directory**: `docs/openspec/specs/`

### Step 4: Resolve Absolute Paths

Resolve the artifact paths relative to the module root:

- Single-module or `--module` provided: `{module-root}/{artifact-path}`
- Aggregate mode (no `--module`, workspace with modules): resolve paths per-module and combine results

### CLAUDE.md Modules Section Format

Projects that use workspace mode declare modules in the root `CLAUDE.md`:

```markdown
### Modules

| Module | Root | Description |
|--------|------|-------------|
| api | services/api | REST API service |
| web | services/web | Web frontend |
| shared | packages/shared | Shared library |
```

Each module MAY have its own `CLAUDE.md` at its root with an `## Architecture Context` section declaring module-specific artifact paths. Module-level paths override root-level defaults.

### Examples

**Single-module project** (no `### Modules` section):
- ADR path: `docs/adrs/` (from CLAUDE.md or default)
- Spec path: `docs/openspec/specs/` (from CLAUDE.md or default)

**Workspace with `--module api`**:
- Module root: `services/api/` (from `### Modules` table)
- Read `services/api/CLAUDE.md` for declarations
- ADR path: `services/api/docs/adrs/` (or module-declared path)
- Spec path: `services/api/docs/openspec/specs/` (or module-declared path)

**Workspace aggregate mode** (no `--module`):
- Iterate each module from `### Modules` table
- Resolve paths per-module
- Combine all ADRs and specs across modules, prefixing output with module name for disambiguation

## Spec Resolution

Resolve a spec identifier to a file path. Use the resolved spec directory from the **Artifact Path Resolution** pattern above (referred to as `{spec-dir}` below).

- If a SPEC number is provided (e.g., `SPEC-0003`), find the matching spec directory by scanning `{spec-dir}/*/spec.md` for the SPEC number in the title.
- If a capability directory name is provided (e.g., `web-dashboard`), look for `{spec-dir}/{name}/spec.md`.
- If no spec identifier is provided (ignoring flags), list available specs by globbing `{spec-dir}/*/spec.md`, read the title from each, and use `AskUserQuestion` to ask which spec to use.
- If the spec doesn't exist, tell the user and suggest `/design:spec` to create one.

## Spec Pairing Validation

Before operating on a spec, verify that both `spec.md` and `design.md` exist in the spec directory. These are a paired unit (ADR-0003, SPEC-0003) and must always coexist.

### Algorithm
1. Given a resolved spec directory path `{spec-dir}/{capability-name}/`
2. Check that both `spec.md` and `design.md` exist
3. If either is missing, report: "Incomplete spec: {capability-name} is missing {missing-file}. Run `/design:spec {capability-name}` to create the paired files."
4. For read-only skills (prime, list, check): emit a WARNING and continue with available file
5. For write skills (plan, work, review, organize, enrich): emit an ERROR and halt — do not operate on incomplete specs

## Config Resolution

Canonical algorithm for reading plugin configuration from CLAUDE.md. All skills that need configuration MUST use this pattern. No skill SHALL read `.claude-plugin-design.json` directly.

### Step 1: Read Root CLAUDE.md

Read the project-root `CLAUDE.md` and look for a `### Design Plugin Configuration` section. If found, parse the subsections (`#### Tracker`, `#### Branch Conventions`, `#### PR Conventions`, `#### Review`, `#### Worktrees`, `#### Projects`) to extract configuration values.

### Step 2: Merge Module Config (if applicable)

If a `--module` flag is provided, also read the module's `CLAUDE.md` and look for a `### Design Plugin Configuration` section. Module-level values override root-level values (deepest wins). Missing keys at the module level inherit from root.

### Step 3: Apply Defaults

For any keys not found in either CLAUDE.md, apply these defaults:

- **Tracker**: (none — fall through to auto-detection)
- **Branch Conventions**: `prefix`=`feature`, `epic_prefix`=`epic`, `slug_max_length`=50, `enabled`=true
- **PR Conventions**: `close_keyword`=(tracker-specific default), `ref_keyword`="Part of", `include_spec_reference`=true, `enabled`=true
- **Review**: `max_pairs`=2, `merge_strategy`="squash", `auto_cleanup`=false
- **Worktrees**: `base_dir`=`.claude/worktrees/`, `max_agents`=3, `auto_cleanup`=false, `pr_mode`="ready"
- **Projects**: `default_mode`="per-epic", `views`=["All Work", "Board", "Roadmap"], `columns`=["Todo", "In Progress", "In Review", "Done"], `iteration_weeks`=2

### Step 4: Fall Through

If no `### Design Plugin Configuration` section exists in any CLAUDE.md, fall through to auto-detection (e.g., Tracker Detection for trackers). Skills SHOULD suggest running `/design:init` to persist configuration.

### CLAUDE.md Configuration Format

The `### Design Plugin Configuration` section in CLAUDE.md uses the following markdown structure. All subsections and keys are optional; missing keys use the defaults above.

```markdown
### Design Plugin Configuration

#### Tracker
- **Type**: github
- **Owner**: myorg
- **Repo**: myproject

#### Branch Conventions
- **Enabled**: true
- **Prefix**: feature
- **Epic Prefix**: epic
- **Slug Max Length**: 50

#### PR Conventions
- **Enabled**: true
- **Close Keyword**: Closes
- **Ref Keyword**: Part of
- **Include Spec Reference**: true

#### Review
- **Max Pairs**: 2
- **Merge Strategy**: squash
- **Auto Cleanup**: false

#### Worktrees
- **Base Dir**: .claude/worktrees/
- **Max Agents**: 3
- **Auto Cleanup**: false
- **PR Mode**: ready

#### Projects
- **Default Mode**: per-epic
- **Views**: All Work, Board, Roadmap
- **Columns**: Todo, In Progress, In Review, Done
- **Iteration Weeks**: 2
```

**Tracker-specific keys** (in the `#### Tracker` subsection):
- **GitHub/Gitea/GitLab**: `Owner`, `Repo`
- **Jira**: `Project Key`
- **Linear**: `Team ID`
- **Beads**: (no extra config needed)

Skills MAY tolerate minor natural-language variations in key names (e.g., "Branch prefix" vs. "Prefix") since Claude interprets these as natural language.

## Config Producers and Consumers

| Skill | Reads Config | Writes Config | Notes |
|-------|-------------|--------------|-------|
| init | Yes | Yes | Primary config producer; migration + workspace setup |
| plan | Yes | Yes | Writes project IDs and tracker config back |
| organize | Yes | No | Consumer only |
| enrich | Yes | No | Consumer only |
| work | Yes | No | Consumer only |
| review | Yes | No | Consumer only |
| prime, check, audit, discover | No | No | Read-only skills; no config needed |
| adr, spec, list, status, docs | No | No | Operate on artifacts, not config |

## Tracker Detection

### Check for Saved Preference

Read the `### Design Plugin Configuration` section in the project-root `CLAUDE.md` (following the Config Resolution pattern above). If it contains a `#### Tracker` subsection with a `- **Type**: {tracker}` entry, use that tracker directly. If it also has tracker-specific keys (Owner, Repo, Project Key, etc.), use those settings. If the saved tracker's tools are no longer available, warn the user and fall through to detection.

### Detect Available Trackers

- **Beads**: Look for a `.beads/` directory in the project root, or run `bd --version`.
- **GitHub**: Use `ToolSearch` to probe for MCP tools matching `github`, or check `gh` CLI via `gh --version`.
- **GitLab**: Use `ToolSearch` to probe for MCP tools matching `gitlab`, or check `glab` CLI via `glab --version`.
- **Gitea**: Use `ToolSearch` to probe for MCP tools matching `gitea`, or check `tea` CLI via `tea --version`.
- **Jira**: Use `ToolSearch` to probe for MCP tools matching `jira`.
- **Linear**: Use `ToolSearch` to probe for MCP tools matching `linear`.

### Choose Tracker

- Multiple trackers found → use `AskUserQuestion` to let the user pick. Include an option to save the choice as default.
- Exactly one found → use it. Ask if they want to save it as default.
- None found → generate `tasks.md` fallback (if applicable) or error.

### Save Preference

When the user agrees to save, write the tracker configuration into the `### Design Plugin Configuration` section in the project-root `CLAUDE.md`. If the section already exists with other subsections, merge — don't overwrite. If it doesn't exist, create it. See the "CLAUDE.md Configuration Format" in the Config Resolution section above for the canonical format.

## Team Handoff Protocol

Used when a skill supports `--review` mode with a drafter/auditor and reviewer agent pair.

1. The drafter writes the output to the target path
2. The drafter sends a message to the reviewer: "Draft ready for review at [path]"
3. The reviewer reads the output, reviews against the skill's checklist, and either:
   a. Sends "APPROVED" to the lead, or
   b. Sends specific revision requests to the drafter
4. Maximum 2 revision rounds. After that, the reviewer approves with noted concerns.
5. The lead agent finalizes only after receiving "APPROVED"

## Worker Communication Protocol

When multiple worker agents operate in parallel (e.g., `/design:work`, `/design:review`), they coordinate via `SendMessage` broadcasts to prevent duplicate code and file conflicts.

### Message Types

| Message | Direction | Purpose |
|---------|-----------|---------|
| `FILE_CLAIM: #{issue} claiming {file-path}` | Worker -> All siblings | Broadcast before modifying a file |
| `TYPE_CREATED: #{issue} created {TypeName} in {file-path}` | Worker -> All siblings | Broadcast after creating new types/structs/interfaces |
| `TYPE_IMPORTED: #{issue} will import {TypeName} from {file-path}` | Worker -> Claimant | Acknowledge reuse of sibling's type |
| `CONFLICT_ALERT: #{issue} also needs {file-path}` | Worker -> Claimant + Lead | Request coordination for overlapping files |
| `BUNDLE_REQUEST: #{issue} implementation is trivially small` | Worker -> Lead | Request additional issues to combine |

### Rules
- Workers MUST broadcast FILE_CLAIM before modifying any file
- Workers MUST broadcast TYPE_CREATED after creating new types
- Workers receiving TYPE_CREATED MUST import rather than recreate
- Workers receiving FILE_CLAIM for a file they also need MUST send CONFLICT_ALERT and wait for lead coordination
- Lead handles BUNDLE_REQUEST by checking queue for bundleable issues

## Multi-Agent Team Protocols

Skills use different team structures depending on the task:

### Simple Drafter-Reviewer (used by: adr, spec)
- 2 agents: drafter + reviewer
- Max 2 revision rounds
- Reviewer approves or requests changes

### Grooming Ceremony (used by: plan --scrum)
- 5 agents: Product Owner, Scrum Master, Engineer A, Engineer B ("Grumpy"), Architect
- Full backlog decomposition with dissent resolution
- Engineer B specifically challenges vague requirements

### Triage Ceremony (used by: audit --scrum)
- 5 agents: Same roles as grooming but different responsibilities
- Engineer B challenges whether findings are genuine drift vs intentional evolution
- Architect makes final call on source-of-truth disputes

### Worker Coordination (used by: work, review)
- 1 lead + N workers
- Workers communicate via Worker Communication Protocol (above)
- Lead manages queue, handles bundle requests, tracks lifecycle labels

### TeamCreate Required

Any skill or session that spawns 2+ parallel agents MUST use `TeamCreate`, not ad-hoc `Agent` calls. `SendMessage` (required for the Worker Communication Protocol) only works within a Team. Ad-hoc background agents are isolated and cannot coordinate — they cannot see sibling agents' file claims, type creations, or conflict alerts. This applies both to skills and to sessions orchestrating multiple skills.

## Try-Then-Create Label Pattern

When applying labels (e.g., `epic`, `story`, `spec`), attempt to apply the label first. If the tracker returns "label not found", create the label with a default color and retry.

Default colors: `epic`=#6E40C9, `story`=#1D76DB, `spec`=#0E8A16, other=#CCCCCC.

## Branch Naming Conventions

- **Stories**: `feature/{issue-number}-{slug}` (or custom prefix from `--branch-prefix` or CLAUDE.md `Branch Conventions > Prefix`)
- **Epics**: `epic/{issue-number}-{slug}` (or custom prefix from CLAUDE.md `Branch Conventions > Epic Prefix`)
- Slug: derived from title, kebab-case, max 50 chars (or CLAUDE.md `Branch Conventions > Slug Max Length`), trailing hyphens removed after truncation.
- Requires two-pass: create the issue first to get the number, then update the body with the branch section.

## PR Close Keywords

Tracker-specific close keywords (or use CLAUDE.md `PR Conventions > Close Keyword`):

- **GitHub/Gitea**: `Closes #{issue-number}`
- **GitLab**: `Closes #{issue-number}` (in MR description)
- **Beads**: `bd resolve`
- **Jira**: `{PROJECT-KEY}-{number}` reference
- **Linear**: `{TEAM}-{number}` reference

## Governing Comment Format

All skills that generate or modify code MUST use file-level governing comment blocks (ADR-0020). The canonical format:

```
// Governing: ADR-XXXX (short description), ADR-YYYY (short description)
// Implements: SPEC-XXXX REQ "Requirement Name", SPEC-YYYY REQ "Requirement Name"
```

For markdown files: `<!-- Governing: ... -->`

### Rules
- MUST use file-level blocks at the top of each file (not per-line annotations)
- Inline governing comments SHOULD only be used when the connection is non-obvious from the file-level block
- MUST NOT create separate PRs for retroactive governing comment addition
- Governing comments MUST be added in the same PR that implements the feature

## Foundation Story Detection

<!-- Governing: ADR-0017 (Parallel Agent Coordination), SPEC-0015 REQ "Foundation Story Detection" -->

Algorithm for identifying shared code across stories during `/design:plan` requirement grouping. This pattern prevents duplicate implementations by extracting shared types, packages, and helpers into dedicated foundation stories that merge before feature work begins.

### When to Apply

Run this analysis after grouping requirements into stories (step 5.2 of `/design:plan`) and before creating issue bodies. It applies to any sprint with 2+ stories.

### Algorithm

1. **Extract planned artifacts per story.** For each story, list the types, structs, interfaces, helper functions, config fields, and packages it will need to create or modify. Derive these from:
   - The spec requirements assigned to the story
   - The existing codebase (use `Grep` to find current definitions)
   - The design.md architecture description (file paths, component references)

2. **Build a cross-reference matrix.** Create a mapping of `artifact → [stories that need it]`. Any artifact needed by 2+ stories is a **shared dependency**.

3. **Cluster shared dependencies into foundation stories.** Group related shared artifacts into coherent foundation stories:
   - **Type cluster**: Shared structs, interfaces, and their associated methods → one foundation story (e.g., "Extract PublicLink type and store interface")
   - **Helper cluster**: Shared utility functions and HTTP clients → one foundation story (e.g., "Extract shared LLM client package")
   - **Config/wiring cluster**: When multiple features need new config fields in the same struct or new route registrations in the same file → one "wiring story" that stubs all fields and routes (e.g., "Stub config fields and route registration for sprint N")

4. **Label and order.** Each foundation story gets:
   - The `foundation` label (color: `#D4A017`, using try-then-create pattern)
   - Dependency declarations: `blocks: #X, #Y, #Z` for each feature story that depends on it
   - Schedule position: foundation stories are placed first in the sprint backlog

5. **Output the dependency graph.** Show the user which feature stories depend on which foundation stories, using a visual format:
   ```
   Foundation → Feature dependencies:
     #281 [foundation] Extract shared types → blocks #283, #284, #285
     #282 [foundation] Stub config + routes → blocks #283, #286
   ```

### Edge Cases

- **Single-story sprints**: Skip foundation detection (no cross-story sharing possible).
- **No shared artifacts detected**: Report "No shared dependencies found — all stories are independent." and proceed without foundation stories.
- **Circular dependencies among shared artifacts**: Merge related artifacts into a single foundation story rather than creating circular foundation dependencies.

## Hotspot Analysis

<!-- Governing: ADR-0017 (Parallel Agent Coordination), SPEC-0015 REQ "Hotspot Analysis" -->

Algorithm for analyzing recent git history to identify files that are frequent sources of merge conflicts. Files modified by a high percentage of recent PRs are classified as "hotspots," and stories touching them are serialized to prevent parallel modification.

### When to Apply

Run this analysis during `/design:plan` after requirement grouping and foundation story detection, before making parallelization decisions. It is most valuable for projects with active parallel development.

### Algorithm

1. **Gather recent merge history.** Use two windows and take the larger result set:
   ```bash
   # Last 50 merge commits
   git log --name-only --pretty=format:"---COMMIT---" --merges -50
   # Last 30 days of merge commits
   git log --name-only --pretty=format:"---COMMIT---" --merges --since="30 days ago"
   ```

2. **Parse PR file modifications.** Split the output by `---COMMIT---` delimiter. For each merge commit, collect the list of modified files. Ignore empty entries and the delimiter line itself.

3. **Calculate per-file frequency.** For each file that appears in any merge commit:
   - Count the number of distinct merge commits (PRs) that modified it
   - Calculate: `frequency = count / total_merge_commits * 100`

4. **Apply hotspot threshold.** The default threshold is **50%**. Check for an override:
   - Read CLAUDE.md `## Design Plugin Configuration` section for `hotspot-threshold: N%`
   - If present, use that value instead of 50%

   Files with `frequency > threshold` are classified as **hotspot files**.

5. **Report hotspots.** Display findings to the user:
   ```
   ### Hotspot Analysis (threshold: 50%)
   - `cmd/server/main.go` — 7/10 PRs (70%) — HOTSPOT
   - `internal/config/config.go` — 6/10 PRs (60%) — HOTSPOT
   - `internal/store/store.go` — 3/10 PRs (30%) — below threshold
   ```

6. **Apply serialization constraints.** For each story that modifies a hotspot file:
   - Mark the story with a serialization constraint
   - Add a `### Serialization Constraint` section to the issue body:
     ```markdown
     ### Serialization Constraint
     This story modifies hotspot file(s) and MUST NOT run in parallel with other stories touching the same file(s):
     - `cmd/server/main.go` (70% of recent PRs)
     ```
   - In the dependency graph, chain hotspot-touching stories sequentially rather than scheduling them for parallel execution

7. **Handle no-hotspot case.** If no files exceed the threshold, report: "No hotspots detected — stories will be parallelized based on dependency analysis alone." and apply no serialization constraints.

### Configuration

The following settings can be placed in CLAUDE.md under `## Design Plugin Configuration`:

```markdown
## Design Plugin Configuration

- **Hotspot threshold**: 40%
- **Max parallel agents**: 4
```

The hotspot threshold accepts integer values from 1-100 representing the percentage of recent PRs that must touch a file for it to be classified as a hotspot. Lower values are more conservative (more files flagged); higher values are more permissive.

## Severity Assignment Rules

- MUST, SHALL, or MUST NOT violation → `[CRITICAL]`
- SHOULD or RECOMMENDED violation → `[WARNING]`
- Coverage gap (no governing artifact) → `[INFO]`
- Stale artifact (status doesn't match reality) → `[WARNING]`
- ADR vs. Spec inconsistency → `[CRITICAL]`
- Contradictory requirement within same spec → `[CRITICAL]`
- Inconsistent RFC 2119 keyword usage → `[INFO]`
- Untestable or ambiguous requirement → `[INFO]`

## Epic vs Story Classification

- **Epics**: Issues with titles starting with "Implement " or that have an `epic` label
- **Stories**: All other issues referencing the spec

## Issue Search by Spec

To find existing issues referencing a spec:

- **GitHub**: `gh issue list --search "SPEC-XXXX" --json number,title,body,labels --limit 100`
- **Gitea**: Use MCP tools (discovered via `ToolSearch`)
- **GitLab**: Use MCP tools or `glab issue list --search "SPEC-XXXX"`
- **Jira**: Use MCP tools with JQL containing the spec number
- **Linear**: Use MCP tools to search issues containing the spec number
- **Beads**: Use `bd list` or similar

## PR Search by Spec

To find open PRs referencing a spec:

- **GitHub**: `gh pr list --search "SPEC-XXXX" --json number,title,headRefName,body,url --limit 50` or `gh pr view {number} --json ...` for specific PRs
- **Gitea**: Use MCP tools (discovered via `ToolSearch`) to list pull requests
- **GitLab**: Use MCP tools or `glab mr list --search "SPEC-XXXX"`
