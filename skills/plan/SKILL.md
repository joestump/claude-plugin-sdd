<!-- Governing: ADR-0017 (Parallel Agent Coordination), SPEC-0015 REQ "Foundation Story Detection", SPEC-0015 REQ "Hotspot Analysis" -->

---
name: plan
description: Break an existing spec into trackable issues in your issue tracker. Use when the user says "plan a sprint", "create issues from spec", "break down the spec", or wants to turn requirements into tasks.
allowed-tools: Read, Glob, Grep, Bash, Write, Edit, Task, AskUserQuestion, TeamCreate, TeamDelete, TaskCreate, TaskUpdate, TaskList, TaskGet, SendMessage, ToolSearch
argument-hint: [spec-name or SPEC-XXXX] [--review] [--scrum] [--project <name>] [--no-projects] [--branch-prefix <prefix>] [--no-branches] [--module <name>]
---

<!-- Governing: ADR-0015 (Markdown-Native Configuration), SPEC-0014 REQ "Config Resolution Pattern" -->

# Plan Sprint from Specification

You are breaking down an existing specification into trackable work items (epics and story-sized issues) in the user's issue tracker. Instead of creating one issue per requirement, you group related requirements into 3-4 story-sized issues by functional area, with task checklists in the issue body for requirement traceability. See ADR-0011 and SPEC-0010.

## Process

<!-- Governing: ADR-0016 (Workspace Mode), SPEC-0014 REQ "Artifact Path Resolution" -->

0. **Resolve artifact paths**: Follow the **Artifact Path Resolution** pattern from `references/shared-patterns.md` to determine the ADR and spec directories. If `$ARGUMENTS` contains `--module <name>`, resolve paths relative to that module. The resolved ADR directory is `{adr-dir}` and spec directory is `{spec-dir}`.

1. **Identify the target spec and parse flags**: Parse `$ARGUMENTS`.

   **Spec resolution:** Follow the standard flow in the plugin's `references/shared-patterns.md` § "Spec Resolution" (which uses `{spec-dir}` from the Artifact Path Resolution pattern).

   **Flag parsing:**
   - `--scrum`: Enable scrum ceremony mode (see Scrum Mode section below). Default: off. Mutually exclusive with: `--review`.
   - `--review`: Enable team review mode (see step 3). Default: off. Mutually exclusive with: `--scrum`.
   - `--project <name>`: Use a single combined project for all issues. Default: per-epic. Mutually exclusive with: `--no-projects`.
   - `--no-projects`: Skip project creation entirely. Default: off. Mutually exclusive with: `--project`.
   - `--branch-prefix <prefix>`: Custom branch prefix instead of the default `feature`/`epic` prefixes. Default: `feature`.
   - `--no-branches`: Omit `### Branch` and `### PR Convention` sections from issue bodies. Default: off.
   - `--module <name>`: Resolve artifact paths relative to the named module (see step 0). Default: none.

   `--scrum` and `--review` are mutually exclusive. When both are provided, `--scrum` takes precedence and `--review` is silently ignored. The scrum ceremony includes its own review process.

   If both `--project` and `--no-projects` are provided, warn the user and use `--no-projects`.

   **If `--scrum` is set, skip to the Scrum Mode section after completing step 1. Do not proceed through steps 2–8 in sequence — scrum mode orchestrates them internally.**

2. **Read the spec**: Read both `{spec-dir}/{capability-name}/spec.md` and `{spec-dir}/{capability-name}/design.md` to understand the full scope of requirements, scenarios, and architecture. Validate spec pairing per `references/shared-patterns.md` § "Spec Pairing Validation". If either spec.md or design.md is missing, error and suggest `/sdd:spec`.

3. **Choose drafting mode**: Check if `$ARGUMENTS` contains `--review`.

   **Default (no `--review`)**: Single-agent mode. Analyze the spec, detect the tracker, and create all issues directly.

   **With `--review`**: Team review mode.
   - Tell the user: "Creating a planning team to break down the spec and review the issue plan. This takes a minute or two."
   - Create a Claude Team with `TeamCreate`:
     - Spawn a **planner** agent (`general-purpose`) to analyze the spec and create the issue breakdown
     - Spawn a **reviewer** agent (`general-purpose`) to review the breakdown for completeness, proper acceptance criteria, and correct dependency ordering
     - The reviewer MUST verify that every spec requirement has at least one corresponding issue
     - If `TeamCreate` fails, fall back to single-agent mode
   - Maximum 2 revision rounds. After that, the reviewer approves with noted concerns.

---

## Scrum Mode Ceremony (`--scrum`)

When `--scrum` is set, execute the full ceremony below instead of the standard steps 2–8. Steps 2–8 are still used internally within the ceremony phases as described. Governing: SPEC-0012, ADR-0013.

Tell the user: "Starting scrum ceremony. This will audit spec completeness, decompose requirements into stories, run a grooming team review, organize projects, and enrich issue bodies. Give me a few minutes."

### Phase 1: Target Resolution

- If a spec was provided in `$ARGUMENTS`: use steps 2 and the spec identification from step 1 to resolve the target spec.
- If no spec was provided: scan all issues currently open in the tracker (detected per step 4) and collect them as the grooming scope. All issues in scope that reference a spec will be cross-checked; issues with no spec reference are flagged for spec proposal.

### Phase 2: Spec Completeness Audit

Before spawning the grooming team, audit every spec referenced by any in-scope issue:

1. For each referenced spec, check if `{spec-dir}/{name}/design.md` exists alongside `spec.md`.
2. If `design.md` is **missing**, generate a draft `design.md` co-located with `spec.md`. Use the design.md template from `/sdd:spec`. Set frontmatter `status: draft`. Log: "Generated draft design.md for {spec-name}."
3. If a tracker issue has **no backing spec**, generate both `{spec-dir}/{issue-slug}/spec.md` and `design.md` as drafts (status: draft), deriving the capability name from the issue title. Log: "Generated draft spec proposal for issue #{n}: {title}."
4. After all drafts are generated, report the audit results: pass count, missing design.md count, unspec'd issue count, and file paths of generated drafts.

### Phase 3: Issue Decomposition

Follow the standard story-sizing logic (steps 2, 4–5.5) to produce 3-4 story-sized issues per spec. If running in full-backlog mode (no spec arg), decompose each spec independently and collect all stories into a single grooming list. After decomposition, proceed to the grooming ceremony without yet running organize or enrich steps (those run after grooming).

### Phase 4: Backlog Grooming Ceremony

Spawn the five specialist agents and distribute all stories for parallel review. Each agent MUST review every story and submit feedback to the lead via task messages.

**Spawn the following agents with these exact personas:**

**Product Owner (PO)**
> Review each story for user value, priority order, and scope. Assign verdict: APPROVED, REVISE (with specific change), or DEFER (with reason). If deferring a MUST/SHALL violation, provide written justification.

**Scrum Master (SM)**
> Ensure stories are sprint-ready. Assign t-shirt size (XS/S/M/L/XL). Flag ambiguity, incorrect dependencies, or blockers. Tiebreaker when PO and Engineer B disagree.

**Engineer A**
> Assess technical risk, scope correctness, and whether WHEN/THEN scenarios are verifiable. Verdict: APPROVED, REVISE, or DEFER.

**Engineer B (Grumpy)**
> High-bar reviewer. Find problems: vague requirements, hidden scope, incorrect spec/ADR references. APPROVE only with explicit one-sentence justification. Do not soften feedback.

**Architect**
> Verify governing comments (per `references/shared-patterns.md` § "Governing Comment Format"), ADR references in acceptance criteria, design.md existence, and WHEN/THEN alignment with design.md. Verdict: APPROVED, REVISE, or DEFER.

**Collecting feedback:**

The lead collects all five verdicts per story before proceeding. Stories with all five APPROVED verdicts are finalized immediately. Stories with any REVISE or DEFER verdict enter dissent resolution.

### Phase 5: Dissent Resolution

For each story with dissent:

1. **Identify the dissenting agent(s)** and extract their specific objection.
2. **One negotiation round**: The lead presents the dissent to the PO and the dissenting agent. Each states their position once. The lead synthesizes a proposed resolution.
3. **Outcome**:
   - If the PO accepts the dissenting agent's revision → apply the revision, finalize the story.
   - If the dissenting agent accepts the PO's justification → finalize the story as-is.
   - If no agreement → the **Scrum Master makes the final call**: ACCEPT as-is, ACCEPT with revision, or DEFER to a future sprint.
4. **DEFER**: A deferred story is removed from the current sprint backlog. The lead updates the tracker issue with a `### Grooming Note` section explaining the deferral reason.
5. **Document all resolutions** in the sprint report, noting which agent objected, what the objection was, and how it was resolved.

### Phase 6: Automatic Organize

After grooming, automatically run the organize step (equivalent to step 5.6 and 5.7 in standard mode) for all finalized stories. Respect `--no-projects` and `--project` flags. Do not prompt the user — this runs automatically. Log each organize action as it happens.

### Phase 7: Automatic Enrich

After organize, automatically run the enrich step (equivalent to the branch + PR convention logic in step 5.3) for all finalized story issue bodies. Respect `--no-branches` flag. Do not prompt the user — this runs automatically.

### Phase 8: Sprint Report

Output the sprint report to the conversation:

```markdown
## Sprint Report — {Capability Title or "Full Backlog"} — {date}

### Spec Completeness
- {N} specs audited
- {N} design.md files generated: {paths}
- {N} spec proposals generated for unspec'd issues: {paths}

### Grooming Results
**Accepted ({N} stories)**
- #{issue} {title} — {size} — {branch}

**Revised ({N} stories)**
- #{issue} {title} — Revised: {what changed} — Raised by: {Engineer B / Architect / ...}

**Deferred ({N} stories)**
- #{issue} {title} — Reason: {SM tiebreak / dissent reason}

### Final Sprint Backlog
Ordered for implementation (dependencies respected):
1. #{issue} {title} — {branch} — Sprint {N}
2. #{issue} {title} — {branch} — Sprint {N}
...

### Next Steps
- Run `/sdd:work` to begin parallel implementation
- Run `/sdd:prime` before implementation sessions to load architecture context
```

---

4. **Detect the issue tracker**: Follow the "Config Resolution" and "Tracker Detection" flows in the plugin's `references/shared-patterns.md`. Read the `### SDD Configuration` section from CLAUDE.md for tracker type, tracker-specific config (GitHub/Gitea/GitLab: Owner/Repo, Jira: Project Key, Linear: Team ID, Beads: no extra config), plus Branch Conventions, PR Conventions, and Projects settings used in steps 5–7. When the user selects a tracker for the first time, offer to save the configuration to the `### SDD Configuration` section in CLAUDE.md.

4a. **Tier 4 issues sync** (v5.0.0+):

   <!-- Governing: ADR-0026 (Tiered Index Freshness), SPEC-0019 REQ "Tier 4 Always-Sync Issues for Sprint Skills" -->

   Before grouping requirements into stories (Step 5.2), sync the `{repo}-issues` qmd collection from the tracker so the planner sees current issue state. Subject to the 5-minute deduplication window in `.sdd/issues/_meta.json` (per `references/tracker-sync.md` § "Cursor Management").

   1. Read `.sdd/issues/_meta.json`. If `last_sync` is within the last 5 minutes, skip the sync silently.
   2. Otherwise, invoke per-tracker fetch+normalize per `references/tracker-sync.md`. Print: "Syncing N issues from {tracker}…".
   3. On sync failure, surface a one-line warning per `tracker-sync.md` § "Failure Modes and Degradation" and proceed with live tracker queries (the pre-v5 path) for this run. Do NOT block; planning is the user's primary intent.

5. **Create issues in the detected tracker**:

   **5.1: Create an epic.** Create an epic (or equivalent) for the specification itself, titled "Implement {Capability Title}" with a body referencing the spec number and linking to the spec/design files. Apply the `epic` label using the try-then-create pattern (see `references/shared-patterns.md`). (Governing: SPEC-0011 REQ "Auto-Create Labels")

   **5.1a: qmd-aware issue duplicate check** (v5.0.0+):

   <!-- Governing: ADR-0024, SPEC-0019 REQ "qmd-Smart Sprint Skills" -->

   Before creating story issues, qmd-search `{repo}-issues` for existing issues that overlap with the spec's scope. This catches the case where a sprint is being re-planned or where ad-hoc issues already cover part of the spec.

   1. Construct a hybrid query per `references/qmd-helpers.md` § "Hybrid Retrieval":
      - `lex`: spec capability name + key requirement names from the spec
      - `vec`: a one-sentence framing of what the spec covers
      - `intent: "/sdd:plan — find existing open issues that already cover part of this spec"`
      - `collections: ["{repo}-issues"]`
      - `limit: 10`, `minScore: 0.4`

   2. For each result above the threshold, surface to the user via AskUserQuestion: "Issue #{N} ({title}) appears to already cover part of SPEC-{XXXX}. Skip planning the requirements it covers, link the existing issue into the new epic, or proceed and create a new story anyway?" Three options: skip / link / proceed.

   3. If qmd returns zero matches, proceed silently — the sprint is greenfield from the issue tracker's perspective.

   **5.2: Group requirements into stories.** Instead of creating one issue per requirement, group all `### Requirement:` sections into 3-4 story-sized issues by functional area. This is governed by SPEC-0010 and ADR-0011.

   **5.2.0: qmd-aware code awareness** (v5.0.0+):

   <!-- Governing: ADR-0024, SPEC-0019 REQ "qmd-Smart Sprint Skills" -->

   For each functional area identified during grouping, qmd-search `{repo}-code` to find existing files that already implement related capability. Stories that touch existing code MUST be framed as "extend X in path/to/file" rather than "implement from scratch", and sized accordingly (smaller than greenfield).

   1. Construct a hybrid query per `references/qmd-helpers.md`:
      - `lex`: keywords from the requirement names + functional area name
      - `vec`: a one-sentence framing of what the requirement does
      - `intent: "/sdd:plan — find existing code that implements related capability"`
      - `collections: ["{repo}-code"]`
      - `limit: 8`, `minScore: 0.3`

   2. For each result above the threshold, fold the file path and a brief note into the story's body description: "Extend `{path/to/file}` (currently does {one-line summary})".

   3. Story sizing: stories that extend existing code SHOULD target ~150-300 line PRs (smaller than the greenfield 200-500 target). Stories with no qmd-detected related code use the greenfield target.

   **Grouping process:**
   1. Scan all `### Requirement:` sections in the spec and identify the functional areas they affect (e.g., data model, API endpoints, validation, configuration, setup).
   2. Cluster requirements by functional area cohesion — requirements that affect the same part of the system belong in the same story.
   3. Apply coupling analysis — requirements that modify the same files or share data structures MUST be placed in the same story.
   4. Apply dependency ordering — prerequisites go in earlier stories, dependents in later stories.
   5. Target 3-4 stories for a spec with 10-15 requirements (3-5 requirements per story). For specs with 4 or fewer requirements, create 1-2 stories. For a single-requirement spec, create 1 story.
   6. Each story SHOULD target a PR in the 200-500 line range. This is a heuristic — functional cohesion takes priority over line-count targets. Do NOT split functionally cohesive requirements across stories solely to meet the line-count target.

   **5.2a: Foundation Story Detection.** After grouping requirements into stories, analyze the grouped stories to identify shared types, packages, and helper functions needed by two or more stories. Follow the "Foundation Story Detection" pattern in `references/shared-patterns.md`. (Governing: ADR-0017 Layer 1, SPEC-0015 REQ "Foundation Story Detection")

   **5.2b: Hotspot Analysis.** Before making parallelization decisions, analyze recent git history to identify files that are frequent sources of merge conflicts. Follow the "Hotspot Analysis" pattern in `references/shared-patterns.md`. Stories that modify hotspot files MUST be serialized rather than parallelized. (Governing: ADR-0017 Layer 1, SPEC-0015 REQ "Hotspot Analysis")

   **Creating story issues:**
   - Title: a descriptive name reflecting the story's functional area (e.g., "Setup & Configuration", "Core Auth Flow", "Validation & Error Handling")
   - Body MUST include:
     - A short description of what this story implements and its governing spec/ADR references
     - A `## Requirements` section containing a task checklist (see step 5.3)
     - Acceptance criteria summarized at the end
   - **After creating the issue** (to obtain the issue number), unless `--no-branches` is set, update the issue body to append a `### Branch` section:
     - Stories: `` `feature/{issue-number}-{slug}` `` (or custom prefix from `--branch-prefix` or CLAUDE.md `Branch Conventions > Prefix`)
     - Epics: `` `epic/{issue-number}-{slug}` `` (or custom prefix from `--branch-prefix` or CLAUDE.md `Branch Conventions > Epic Prefix`)
     - The slug MUST be derived from the story title using kebab-case, max 50 chars (or CLAUDE.md `Branch Conventions > Slug Max Length`)
     - This requires a two-pass approach: create the issue first to get the number, then update the body

   **5.2.1: Detect HTTP endpoint stories for security checklist injection.**

   <!-- Governing: ADR-0018 (Security-by-Default), SPEC-0016 REQ "Security Checklist in Issues" -->

   After grouping requirements into stories, determine which stories involve HTTP endpoints. A story involves HTTP endpoints if ANY of the following are true:

   - The story implements, modifies, or tests HTTP endpoint handlers or route registrations
   - The grouped requirements reference endpoints, routes, middleware, request/response handling, or API paths
   - The spec's Security Requirements section (if present) applies to the story's functional area
   - The story title or description references: API, endpoint, route, handler, middleware, controller, HTTP, REST, webhook

   A story does NOT involve HTTP endpoints if it exclusively involves: database migrations, background jobs, CLI commands, library refactoring, configuration setup, CI/CD pipelines, or documentation.

   For each story that involves HTTP endpoints, you MUST append a **## Security Checklist** section to the issue body, placed after the `## Acceptance Criteria` section and before any `### Branch` or `### PR Convention` sections. Use the canonical Security Checklist template from `references/issue-authoring.md` § "Security Checklist Template" — five required checkboxes covering auth middleware, input validation, output encoding, rate limiting, and body size limits. Do NOT add the security checklist to stories that do not involve HTTP endpoints.

   **5.2.2: Detect UI stories and create companion test stories.**

   <!-- Governing: ADR-0019 (Frontend Quality Standards), SPEC-0016 REQ "Frontend Test Scaffolding" -->

   After grouping requirements into stories, determine which stories touch UI components. A story touches UI if ANY of the following are true:

   - The story implements, modifies, or tests HTML templates or server-rendered pages
   - The grouped requirements reference templates, browser UI, frontend components, forms, modals, dashboards, or interactive elements
   - The story involves JavaScript (inline or external), CSS, or HTMX interactions
   - The story title or description references: UI, template, page, form, modal, dialog, dashboard, frontend, component, widget

   A story does NOT touch UI if it exclusively involves: database migrations, background jobs, CLI commands, API-only endpoints with no HTML rendering, library refactoring, configuration setup, CI/CD pipelines, or documentation.

   For each story that touches UI, you MUST create a **companion test story** alongside the feature story. Companion test stories cover:

   - **Template render tests**: Verify that templates produce correct HTML structure for given input data
   - **JavaScript unit tests**: Test inline or external JS functions for correctness
   - **HTMX integration tests**: Verify that HTMX swap targets, triggers, and server responses produce the expected DOM state

   **Companion test story format:**
   - Title: "Tests: {Feature Story Title}" (e.g., "Tests: Dashboard Layout and Navigation")
   - Body MUST include:
     - A reference to the feature story it covers (e.g., "Covers #{feature-issue-number}")
     - A `## Test Requirements` section listing the specific test types needed:
       - `- [ ] Template render tests: {what to verify}`
       - `- [ ] JS unit tests: {what to verify}` (only if the feature story involves JavaScript)
       - `- [ ] HTMX integration tests: {what to verify}` (only if the feature story involves HTMX)
     - Acceptance criteria for test coverage
   - Apply the `test` label using the try-then-create pattern (see `references/shared-patterns.md`)
   - The companion test story SHOULD be estimated at no more than half the effort of the feature story
   - The companion test story MUST depend on (be blocked by) its corresponding feature story

   Do NOT create companion frontend test stories for backend-only stories (API-only, database, CLI, background jobs, library code).

   **5.2.3: Detect backend projects and create CI story.**

   <!-- Governing: ADR-0020, SPEC-0016 REQ "Go Code Quality Guidelines" -->

   After grouping requirements into stories, determine if the spec targets a backend project. A spec targets a backend project if ANY of the following are true:

   - The project root (or module root) contains a backend manifest (`go.mod`, `requirements.txt`, `Cargo.toml`, `pom.xml`, `build.gradle`, `Gemfile`, `mix.exs`, `Package.swift`, `composer.json`, `pyproject.toml`)
   - The spec requirements reference server-side concerns: API endpoints, database operations, background workers, message queues, service boundaries
   - The grouped stories involve concurrency, error handling across service boundaries, or database interactions

   **When a backend project is detected and no CI story already exists for this spec:**

   Create a single **CI setup story** with the following checklist:

   ```markdown
   ## Requirements

   - [ ] **Static analysis**: Configure and run static analysis tooling appropriate to the project's language/runtime
   - [ ] **Test runner with race detection**: Configure the test runner to enable race detection (or equivalent concurrency safety checks) in CI
   - [ ] **Formatting enforcement**: Configure automated formatting checks in CI to enforce consistent code style
   - [ ] **CI pipeline integration**: Add the above checks to the project's CI/CD pipeline so they run on every PR
   ```

   - Title: "CI: Static Analysis, Race Detection, and Formatting for {Capability Title}"
   - Apply the `ci` and `foundation` labels using the try-then-create pattern
   - The CI story SHOULD be a foundation story (merged before feature stories)
   - All language-agnostic: use "static analysis" not "go vet", "race detection" not "-race flag", "formatting" not "gofmt"

   Do NOT create a CI story if:
   - The spec is purely frontend, documentation, or configuration
   - A CI story already exists for this spec (check existing issues)

   **5.2.4: No retroactive governing comment PRs.**

   <!-- Governing: ADR-0020, SPEC-0016 REQ "Go Code Quality Guidelines" -->

   When planning stories, MUST NOT create standalone issues or PRs whose sole purpose is to add governing comments to existing code retroactively. Governing comments (per ADR-0020) are added as part of feature implementation — they go in the PR that implements or modifies the governed code, not in a separate cleanup PR.

   **5.3: Write task checklists.** Each story issue body MUST follow the **Story Issue** template from `references/issue-authoring.md` § Body Templates. The template defines the canonical `## Requirements` (RFC 2119 task checklist) and `## Acceptance Criteria` sections; this skill MUST NOT inline its own variant. The template's rules — exact requirement-name match against the spec, SPEC number references, WHEN/THEN pairs derived from scenarios (not invented), every requirement in exactly one story — apply.

   **Tracker-specific deviation**: For Beads, replace the markdown `## Requirements` checklist with native subtasks (`bd subtask add` per requirement, each subtask titled with the requirement name and bodied with the normative statement + WHEN/THEN scenarios + spec reference). All other trackers (GitHub, Gitea, GitLab, Jira, Linear) use the markdown form per the template. See `references/issue-authoring.md` § Cross-Tracker Considerations for the full deviation table.

   After the requirements and acceptance criteria sections, unless `--no-branches` is set, append a `### PR Convention` section:
   - Include the tracker-specific close keyword referencing the story issue number
   - Include a reference to the parent epic and governing spec
   - Tracker-specific close keywords:
     - **GitHub/Gitea**: `Closes #{issue-number}`
     - **GitLab**: `Closes #{issue-number}` (in MR description)
     - **Beads**: `bd resolve`
     - **Jira**: `{PROJECT-KEY}-{number}` reference
     - **Linear**: `{TEAM}-{number}` reference
   - Use CLAUDE.md `PR Conventions` settings when available (Close Keyword, Ref Keyword, Include Spec Reference)

   **5.4: Set up dependencies between stories.** Where stories have logical ordering (e.g., setup before core logic, core before extensions), set up dependency relationships between story issues using the tracker's native features. If using Beads, use `bd dep add`.

   **5.5: Gather tracker-specific config.** If the tracker requires configuration not already saved (e.g., repo owner/name for GitHub, project key for Jira), use `AskUserQuestion` to ask the user. Offer to save the config to the `### SDD Configuration` section in CLAUDE.md.

   **5.6: Project grouping.** Unless `--no-projects` is set:
   - **Default (per-epic)**: For each epic, create a tracker-native project and add the epic and its child stories:
     - **GitHub**: Projects V2 via `gh project create` CLI or MCP tools, then `gh project item-add` to add issues. **After creating the project, MUST link it to the repository** using `gh project link {project-number} --owner {owner} --repo {owner}/{repo}` so it appears in the repository's Projects tab.
     - **Gitea**: Project via MCP tools (use `ToolSearch` to discover). MUST ensure the project is associated with the repository.
     - **GitLab**: Milestone or board
     - **Jira**: Use existing project scope (no new project needed)
     - **Linear**: Project or cycle
     - **Beads**: No-op (the epic IS the grouping)
   - **`--project <name>`**: Create a single project with the given name and add all issues to it
   - Use `ToolSearch` to discover project-creation MCP tools at runtime
   - Read CLAUDE.md `Projects > Default Mode` and cached project IDs for settings. If a project ID is already cached for this spec, reuse it instead of creating a new one.
   - **Repository linking is critical**: For trackers that support project-repository associations (GitHub Projects V2, Gitea), the project MUST be linked to the repository after creation. Without this step, the project exists but is invisible from the repository's Projects tab.
   - **Graceful failure**: If project creation fails, warn the user but do not block issue creation. Report the failure in the final summary.

   **5.7: Workspace enrichment.** After project creation, enrich the project with navigational context and structure. Read CLAUDE.md `Projects` configuration for custom settings (Views, Columns, Iteration Weeks). All enrichment steps use **graceful degradation**: if a feature is unavailable for the tracker, skip that step and log "Skipped {step}: {tracker} does not support {feature}". (Governing: SPEC-0011, ADR-0012)

   **For GitHub Projects V2:**
   1. **Set project description**: A short summary referencing the spec number and capability title.
   2. **Write project README**: Use the GitHub Projects V2 GraphQL API to set the project README field. The README serves as agent-navigable context and SHALL follow this template. To populate the **Key Files** section, read the spec's `design.md` for referenced file paths and architectural components, then use `Grep` to find the primary implementation files (entry points, config, models, routes) relevant to the spec's domain. Include file paths with line numbers pointing to key symbols (class definitions, function signatures, config blocks).
      ```markdown
      # {Capability Title}
      ## Spec
      - [spec.md]({spec-dir}/{name}/spec.md)
      - [design.md]({spec-dir}/{name}/design.md)
      ## Governing ADRs
      - ADR-XXXX: {title}
      ## Key Files
      - {file}:{line} — {description of what this entry point / class / config does}
      ## Stories
      | # | Title | Branch | Status |
      |---|-------|--------|--------|
      | #{n} | {title} | {branch} | Open |
      ## Dependencies
      - #{n} → #{m} (prerequisite)
      ```
   3. **Add iteration field**: Create a "Sprint" iteration field via GraphQL with cycle length from CLAUDE.md `Projects > Iteration Weeks` (default: 2 weeks). Assign foundation stories to Sprint 1, dependents to Sprint 2, etc.
   4. **Create named views**: Create three views via GraphQL using names from CLAUDE.md `Projects > Views` (default: "All Work" table, "Board" board, "Roadmap" roadmap). If a default "Table" view exists, rename it to the first configured view.

   **For Gitea:**
   1. **Create milestones**: One milestone per epic. Assign stories to the milestone corresponding to their epic.
   2. **Configure board columns**: Create columns from CLAUDE.md `Projects > Columns` (default: Todo, In Progress, In Review, Done).
   3. **Create native dependency links**: For each story that depends on another, create a native dependency via `POST /repos/{owner}/{repo}/issues/{index}/dependencies` (or via MCP tools discovered by `ToolSearch`).

   **For other trackers**: Skip tracker-specific enrichment. Log skipped steps in the report.

   **Auto-label creation** (cross-cutting, all trackers): When applying labels in any step (epic label, story label, spec label), use the try-then-create pattern (see `references/shared-patterns.md`). (Governing: SPEC-0011 REQ "Auto-Create Labels")

6. **Fallback: Generate `tasks.md`** (when no tracker is available). Governing: SPEC-0006, ADR-0007.

   Write `{spec-dir}/{capability-name}/tasks.md` co-located with spec.md and design.md. MUST NOT generate `tasks.md` when a tracker is available — tasks live in the tracker OR in `tasks.md`, never both.

   **Template format:**
   ```markdown
   # Tasks: {Capability Title}

   Spec: SPEC-XXXX
   Generated: {date}

   ## 1. {Section Title}

   - [ ] 1.1 {Task description} (REQ "{Requirement Name}", SPEC-XXXX)
   - [ ] 1.2 {Task description} (REQ "{Requirement Name}", SPEC-XXXX)

   ## 2. {Section Title}

   - [ ] 2.1 {Task description} (REQ "{Requirement Name}", SPEC-XXXX)
   ```

   **Generation rules:**
   - Each `### Requirement:` MUST produce at least one task
   - Group tasks into numbered `## N. Section Title` sections by functional area, ordered by prerequisites
   - Checkbox format: `- [ ] X.Y Task description` where X is section number, Y is task number within section
   - Each task MUST reference the governing requirement name and spec number in parentheses
   - Complex requirements with multiple scenarios MAY produce multiple tasks
   - Tasks SHALL be small enough to complete in one coding session with a verifiable completion criterion
   - Progress is tracked by counting `- [x]` (completed) vs `- [ ]` (pending) lines

7. **Clean up** the team when done (if `--review` was used).

8. **Report the plan.** Summarize what was created:
   - Which tracker was used (or tasks.md fallback)
   - Number of epics and stories created, with how many requirements were grouped into each story
   - **Foundation stories** created (if any), with the `foundation` label and their dependent feature stories
   - **Dependency graph** showing the ordering of foundation stories, serialized stories, and parallelizable stories (Governing: SPEC-0015 REQ "Foundation Story Detection")
   - **Hotspot analysis results**: list of detected hotspot files with percentages, and any serialization constraints applied (Governing: SPEC-0015 REQ "Hotspot Analysis")
   - **Companion test stories** created for UI-touching stories (if any), with references to the feature stories they cover (Governing: SPEC-0016 REQ "Frontend Test Scaffolding")
   - Number of project groupings created (or "skipped" if `--no-projects` was set)
   - Whether branch naming conventions were included in issue bodies (or "skipped" if `--no-branches`)
   - Whether PR conventions were included in issue bodies (or "skipped" if `--no-branches`)
   - Where the user can find them
   - Suggest `/sdd:prime` before starting implementation so agents have architecture context

   **Example dependency graph output:**
   ```
   ### Dependency Graph

   Foundation (merge first):
     #281 Extract shared LLM client package [foundation]
     #282 Stub config fields and route registration [foundation]

   Serialized (hotspot: cmd/server/main.go):
     #283 Server wiring → #284 Route handlers (sequential)

   Parallel (no conflicts):
     #285 CLI tool
     #286 Batch processor

   Order: #281, #282 (foundation) → #283, #285, #286 (parallel) → #284 (after #283)
   ```

## Team Handoff Protocol (only for `--review` mode)

Follow the standard protocol from the plugin's `references/shared-patterns.md` § "Team Handoff Protocol". The drafter is the planner; the reviewer checks that every spec requirement appears in exactly one story, groupings are functionally cohesive, task checklists correctly reference specs, and dependency ordering is logical.

## Rules

- MUST read both spec.md and design.md before creating any issues
- MUST group requirements into 3-4 story-sized issues by functional area — NEVER create one issue per requirement (Governing: SPEC-0010 REQ "Requirement Grouping", ADR-0011)
- Every `### Requirement:` section in the spec MUST appear in exactly one story's task checklist
- Every story MUST contain a `## Requirements` section with a task checklist referencing the spec number, requirement names, normative statements, and WHEN/THEN scenarios
- Task checklist WHEN/THEN pairs MUST be derived from the spec's scenarios, not invented
- For Beads, MUST use native subtasks (`bd subtask add`) instead of markdown checklists
- Story groupings SHOULD target 200-500 line PRs — functional cohesion takes priority over line-count targets (Governing: SPEC-0010 REQ "PR Size Target")
- Coupled requirements (same files, shared data structures) MUST be placed in the same story (Governing: SPEC-0010 REQ "Grouping Heuristics")
- MUST use `ToolSearch` to discover tracker MCP tools at runtime — never assume specific tools are available
- MUST follow the Config Resolution pattern from `references/shared-patterns.md` to read configuration from CLAUDE.md
- MUST offer to save tracker preference to the `### SDD Configuration` section in CLAUDE.md when a tracker is selected for the first time
- When writing config to CLAUDE.md, preserve existing keys — only update changed sections
- Dependency ordering between stories SHOULD reflect logical implementation order, not spec document order
- Project grouping failures MUST NOT prevent issue creation
- MUST link created projects to the repository for trackers that support project-repository associations (e.g., GitHub Projects V2 via `gh project link`, Gitea). Without linking, projects are invisible from the repository's Projects tab.
- Branch slug MUST be derived from the story title (kebab-case, max 50 chars), not invented
- PR close keywords MUST match the detected tracker
- MUST use `ToolSearch` for project tools at runtime
- `--project` and `--no-projects` are mutually exclusive; if both provided, warn and use `--no-projects`
- `--no-branches` disables both `### Branch` AND `### PR Convention` sections
- MUST use the try-then-create pattern (see `references/shared-patterns.md`) for all label applications — never fail on missing labels (Governing: SPEC-0011 REQ "Auto-Create Labels")
- MUST enrich projects after creation with descriptions, READMEs, views, iterations (GitHub) or milestones, columns, dependencies (Gitea) (Governing: SPEC-0011, ADR-0012)
- Enrichment failures MUST be skipped and reported, never fail the entire operation (Governing: SPEC-0011 REQ "Graceful Degradation")
- CLAUDE.md `Projects > Views`, `Projects > Columns`, `Projects > Iteration Weeks` are all optional with sensible defaults — do NOT overwrite existing keys when they are absent
- Story issues MUST be consumable by `/sdd:work` and `/sdd:review` — they use the same `### Branch` and `### PR Convention` structural sections (Governing: SPEC-0010 REQ "Downstream Compatibility")
- When `--scrum` is set, organize and enrich MUST run automatically after grooming — NEVER require the user to run `/sdd:organize` or `/sdd:enrich` separately (Governing: SPEC-0012 REQ "Automatic Organize and Enrich")
- Stories that involve HTTP endpoints MUST include a `## Security Checklist` section with authentication, input validation, output encoding, rate limiting, and body size limit items (Governing: ADR-0018, SPEC-0016 REQ "Security Checklist in Issues")
- The security checklist MUST NOT be added to stories that do not involve HTTP endpoints (DB migrations, background jobs, CLI commands, library refactoring, etc.) (Governing: SPEC-0016 REQ "Security Checklist in Issues")
- The security checklist MUST be placed after `## Acceptance Criteria` and before `### Branch` / `### PR Convention` sections
- Stories that touch UI components (HTML templates, JavaScript, CSS, HTMX) MUST have companion test stories created alongside them (Governing: ADR-0019, SPEC-0016 REQ "Frontend Test Scaffolding")
- Companion test stories MUST cover template render tests, JS unit tests (if JS is involved), and HTMX integration tests (if HTMX is involved)
- Companion test stories MUST reference the feature story they cover and MUST depend on (be blocked by) that feature story
- Companion test stories MUST NOT be created for backend-only stories (API-only, database, CLI, background jobs, library code)
- Companion test stories SHOULD be estimated at no more than half the effort of the feature story
- Engineer B MUST provide a substantive objection for any story that has a weak requirement, vague scope, or missing spec reference — generic approval without review is not acceptable (Governing: SPEC-0012 REQ "Scrum Team Composition")
- The sprint report MUST be emitted at the end of every `--scrum` run, even if all stories were deferred (Governing: SPEC-0012 REQ "Sprint Report")
- `--scrum` and `--review` are mutually exclusive; if both are provided, `--scrum` takes precedence and `--review` is silently ignored
- MUST detect backend projects from manifests and create a CI foundation story with static analysis, race detection, and formatting checks when applicable (Governing: SPEC-0016 REQ "Go Code Quality Guidelines")
- CI stories MUST be language-agnostic: "static analysis" not "go vet", "race detection" not "-race flag", "formatting" not "gofmt"
- MUST NOT create standalone PRs or issues whose sole purpose is to retroactively add governing comments to existing code (Governing: ADR-0020)
- Governing comments are added as part of feature implementation PRs, not in separate cleanup PRs
- MUST identify shared types, packages, and helper functions needed by 2+ stories and extract them into `foundation`-labeled stories (Governing: SPEC-0015 REQ "Foundation Story Detection", ADR-0017 Layer 1)
- Foundation stories MUST be scheduled to merge before any dependent feature story begins work
- When multiple features require the same config fields or server wiring, MUST create a single consolidated wiring story rather than allowing independent additions
- MUST output a dependency graph showing which feature stories depend on which foundation stories
- MUST analyze recent git history (last 50 commits or 30 days, whichever is larger) for hotspot files modified by >50% of recent PRs (Governing: SPEC-0015 REQ "Hotspot Analysis", ADR-0017 Layer 1)
- Stories touching hotspot files MUST be serialized, not parallelized
- MUST report detected hotspots with file path and percentage of recent PRs that touched them
- The hotspot threshold (default 50%) SHOULD be read from CLAUDE.md `## SDD Configuration` if present
- **v5.0.0+**: MUST trigger Tier 4 issues sync on entry per Step 4a — sync from tracker before grouping requirements, subject to 5-min dedup. On failure, fall back to live queries with one-line warning, never block (Governing: ADR-0026, SPEC-0019 REQ "Tier 4 Always-Sync Issues for Sprint Skills")
- **v5.0.0+**: MUST run qmd-aware issue duplicate check per Step 5.1a — surface existing issues that overlap with the spec's scope before creating story issues; user can skip / link / proceed (Governing: ADR-0024, SPEC-0019 REQ "qmd-Smart Sprint Skills")
- **v5.0.0+**: MUST run qmd-aware code awareness per Step 5.2.0 — for each functional area, retrieve existing code that already implements related capability; frame stories as "extend X in path/to/file" when matches exist; size accordingly (~150-300 lines for extends, 200-500 lines for greenfield) (Governing: ADR-0024, SPEC-0019 REQ "qmd-Smart Sprint Skills")
