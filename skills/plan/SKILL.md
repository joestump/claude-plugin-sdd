---
name: plan
description: Break an existing spec into trackable issues in your issue tracker. Use when the user says "plan a sprint", "create issues from spec", "break down the spec", or wants to turn requirements into tasks.
allowed-tools: Read, Glob, Grep, Bash, Write, Edit, Task, AskUserQuestion, TeamCreate, TeamDelete, TaskCreate, TaskUpdate, TaskList, TaskGet, SendMessage, ToolSearch
argument-hint: [spec-name or SPEC-XXXX] [--review] [--scrum] [--project <name>] [--no-projects] [--branch-prefix <prefix>] [--no-branches]
---

# Plan Sprint from Specification

You are breaking down an existing specification into trackable work items (epics and story-sized issues) in the user's issue tracker. Instead of creating one issue per requirement, you group related requirements into 3-4 story-sized issues by functional area, with task checklists in the issue body for requirement traceability. See ADR-0011 and SPEC-0010.

## Process

1. **Identify the target spec and parse flags**: Parse `$ARGUMENTS`.

   **Spec resolution:** Follow the standard flow in the plugin's `references/shared-patterns.md` § "Spec Resolution".

   **Flag parsing:**
   - `--scrum`: Enable scrum ceremony mode (see Scrum Mode section below). When set, the skill runs a full team-groomed planning ceremony: spec completeness audit → issue decomposition → multi-agent grooming → organize → enrich → sprint report. Mutually exclusive with `--review`; if both are set, `--scrum` takes precedence.
   - `--review`: Enable team review mode (see step 3). Ignored when `--scrum` is set.
   - `--project <name>`: Use a single combined project for all issues. Mutually exclusive with `--no-projects`.
   - `--no-projects`: Skip project creation entirely. Mutually exclusive with `--project`.
   - `--branch-prefix <prefix>`: Custom branch prefix instead of the default `feature`/`epic` prefixes.
   - `--no-branches`: Omit `### Branch` and `### PR Convention` sections from issue bodies.

   If both `--project` and `--no-projects` are provided, warn the user and use `--no-projects`.

   **If `--scrum` is set, skip to the Scrum Mode section after completing step 1. Do not proceed through steps 2–8 in sequence — scrum mode orchestrates them internally.**

2. **Read the spec**: Read both `docs/openspec/specs/{capability-name}/spec.md` and `docs/openspec/specs/{capability-name}/design.md` to understand the full scope of requirements, scenarios, and architecture.

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

1. For each referenced spec, check if `docs/openspec/specs/{name}/design.md` exists alongside `spec.md`.
2. If `design.md` is **missing**, generate a draft `design.md` co-located with `spec.md`. Use the design.md template from `/design:spec`. Set frontmatter `status: draft`. Log: "Generated draft design.md for {spec-name}."
3. If a tracker issue has **no backing spec**, generate both `docs/openspec/specs/{issue-slug}/spec.md` and `design.md` as drafts (status: draft), deriving the capability name from the issue title. Log: "Generated draft spec proposal for issue #{n}: {title}."
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
> Verify governing comments, ADR references in acceptance criteria, design.md existence, and WHEN/THEN alignment with design.md. Verdict: APPROVED, REVISE, or DEFER.

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
- Run `/design:work` to begin parallel implementation
- Run `/design:prime` before implementation sessions to load architecture context
```

---

4. **Detect the issue tracker**: Follow the "Tracker Detection" flow in the plugin's `references/shared-patterns.md`. Read the full "Config Schema" section there for the `.claude-plugin-design.json` format — it defines tracker-specific `tracker_config` fields (GitHub/Gitea/GitLab: `owner`/`repo`, Jira: `project_key`, Linear: `team_id`, Beads: `{}`), plus `projects`, `branches`, and `pr_conventions` sections used in steps 5–7. When the user selects a tracker for the first time, offer to save both `tracker` and `tracker_config` to `.claude-plugin-design.json`.

5. **Create issues in the detected tracker**:

   **5.1: Create an epic.** Create an epic (or equivalent) for the specification itself, titled "Implement {Capability Title}" with a body referencing the spec number and linking to the spec/design files. Apply the `epic` label using the **try-then-create pattern**: attempt to apply the label, and if it doesn't exist, create it with color `#6E40C9` and retry. (Governing: SPEC-0011 REQ "Auto-Create Labels")

   **5.2: Group requirements into stories.** Instead of creating one issue per requirement, group all `### Requirement:` sections into 3-4 story-sized issues by functional area. This is governed by SPEC-0010 and ADR-0011.

   **Grouping process:**
   1. Scan all `### Requirement:` sections in the spec and identify the functional areas they affect (e.g., data model, API endpoints, validation, configuration, setup).
   2. Cluster requirements by functional area cohesion — requirements that affect the same part of the system belong in the same story.
   3. Apply coupling analysis — requirements that modify the same files or share data structures MUST be placed in the same story.
   4. Apply dependency ordering — prerequisites go in earlier stories, dependents in later stories.
   5. Target 3-4 stories for a spec with 10-15 requirements (3-5 requirements per story). For specs with 4 or fewer requirements, create 1-2 stories. For a single-requirement spec, create 1 story.
   6. Each story SHOULD target a PR in the 200-500 line range. This is a heuristic — functional cohesion takes priority over line-count targets. Do NOT split functionally cohesive requirements across stories solely to meet the line-count target.

   **Creating story issues:**
   - Title: a descriptive name reflecting the story's functional area (e.g., "Setup & Configuration", "Core Auth Flow", "Validation & Error Handling")
   - Body MUST include:
     - A short description of what this story implements and its governing spec/ADR references
     - A `## Requirements` section containing a task checklist (see step 5.3)
     - Acceptance criteria summarized at the end
   - **After creating the issue** (to obtain the issue number), unless `--no-branches` is set, update the issue body to append a `### Branch` section:
     - Stories: `` `feature/{issue-number}-{slug}` `` (or custom prefix from `--branch-prefix` or `.claude-plugin-design.json` `branches.prefix`)
     - Epics: `` `epic/{issue-number}-{slug}` `` (or custom prefix from `--branch-prefix` or `.claude-plugin-design.json` `branches.epic_prefix`)
     - The slug MUST be derived from the story title using kebab-case, max 50 chars (or `.claude-plugin-design.json` `branches.slug_max_length`)
     - This requires a two-pass approach: create the issue first to get the number, then update the body

   **5.2.1: Detect HTTP endpoint stories for security checklist injection.**

   <!-- Governing: ADR-0018 (Security-by-Default), SPEC-0016 REQ "Security Checklist in Issues" -->

   After grouping requirements into stories, determine which stories involve HTTP endpoints. A story involves HTTP endpoints if ANY of the following are true:

   - The story implements, modifies, or tests HTTP endpoint handlers or route registrations
   - The grouped requirements reference endpoints, routes, middleware, request/response handling, or API paths
   - The spec's Security Requirements section (if present) applies to the story's functional area
   - The story title or description references: API, endpoint, route, handler, middleware, controller, HTTP, REST, webhook

   A story does NOT involve HTTP endpoints if it exclusively involves: database migrations, background jobs, CLI commands, library refactoring, configuration setup, CI/CD pipelines, or documentation.

   For each story that involves HTTP endpoints, you MUST append a **## Security Checklist** section to the issue body, placed after the `## Acceptance Criteria` section and before any `### Branch` or `### PR Convention` sections. Use this template:

   ```markdown
   ## Security Checklist
   - [ ] Authentication middleware applied
   - [ ] Input validation for all request parameters and body fields
   - [ ] Output encoding for user-supplied data in responses
   - [ ] Rate limiting configured
   - [ ] Request body size limits enforced
   ```

   Do NOT add the security checklist to stories that do not involve HTTP endpoints.

   **5.3: Write task checklists.** Each story issue body MUST include a `## Requirements` section with a task checklist. The format varies by tracker:

   **For GitHub, Gitea, GitLab, Jira, and Linear** — use markdown task checklists:
   ```markdown
   ## Requirements

   - [ ] **REQ "{Requirement Name}"** (SPEC-XXXX): {normative statement from the requirement}
     - WHEN {trigger from key scenario} THEN {expected outcome}
     - WHEN {trigger from another scenario} THEN {expected outcome}
   - [ ] **REQ "{Another Requirement}"** (SPEC-XXXX): {normative statement}
     - WHEN {trigger} THEN {outcome}

   ## Acceptance Criteria
   - [ ] Per SPEC-XXXX REQ "{Req 1}": {summary}
   - [ ] Per SPEC-XXXX REQ "{Req 2}": {summary}
   - [ ] Governing: ADR-XXXX ({decision title})
   ```

   - The requirement name MUST match the `### Requirement:` heading in the spec exactly
   - The SPEC reference MUST use the spec's number (e.g., `SPEC-0010`)
   - WHEN/THEN pairs MUST be derived from the requirement's scenarios, not invented
   - Every requirement in the spec MUST appear in exactly one story's task checklist

   **For Beads** — use native subtasks:
   - Create subtasks for each requirement using `bd subtask add`, linking each subtask to the parent story
   - Each subtask SHALL be titled with the requirement name
   - Each subtask body SHALL include the normative statement, WHEN/THEN scenarios, and spec reference

   After the requirements and acceptance criteria sections, unless `--no-branches` is set, append a `### PR Convention` section:
   - Include the tracker-specific close keyword referencing the story issue number
   - Include a reference to the parent epic and governing spec
   - Tracker-specific close keywords:
     - **GitHub/Gitea**: `Closes #{issue-number}`
     - **GitLab**: `Closes #{issue-number}` (in MR description)
     - **Beads**: `bd resolve`
     - **Jira**: `{PROJECT-KEY}-{number}` reference
     - **Linear**: `{TEAM}-{number}` reference
   - Use `.claude-plugin-design.json` `pr_conventions` settings when available (close_keyword, ref_keyword, include_spec_reference)

   **5.4: Set up dependencies between stories.** Where stories have logical ordering (e.g., setup before core logic, core before extensions), set up dependency relationships between story issues using the tracker's native features. If using Beads, use `bd dep add`.

   **5.5: Gather tracker-specific config.** If the tracker requires configuration not already saved (e.g., repo owner/name for GitHub, project key for Jira), use `AskUserQuestion` to ask the user. Offer to save the config to `.claude-plugin-design.json`.

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
   - Read `.claude-plugin-design.json` `projects.default_mode` and `projects.project_ids` for cached settings. If a project ID is already cached for this spec, reuse it instead of creating a new one.
   - **Repository linking is critical**: For trackers that support project-repository associations (GitHub Projects V2, Gitea), the project MUST be linked to the repository after creation. Without this step, the project exists but is invisible from the repository's Projects tab.
   - **Graceful failure**: If project creation fails, warn the user but do not block issue creation. Report the failure in the final summary.

   **5.7: Workspace enrichment.** After project creation, enrich the project with navigational context and structure. Read `.claude-plugin-design.json` `projects` configuration for custom settings (views, columns, iteration_weeks). All enrichment steps use **graceful degradation**: if a feature is unavailable for the tracker, skip that step and log "Skipped {step}: {tracker} does not support {feature}". (Governing: SPEC-0011, ADR-0012)

   **For GitHub Projects V2:**
   1. **Set project description**: A short summary referencing the spec number and capability title.
   2. **Write project README**: Use the GitHub Projects V2 GraphQL API to set the project README field. The README serves as agent-navigable context and SHALL follow this template. To populate the **Key Files** section, read the spec's `design.md` for referenced file paths and architectural components, then use `Grep` to find the primary implementation files (entry points, config, models, routes) relevant to the spec's domain. Include file paths with line numbers pointing to key symbols (class definitions, function signatures, config blocks).
      ```markdown
      # {Capability Title}
      ## Spec
      - [spec.md](docs/openspec/specs/{name}/spec.md)
      - [design.md](docs/openspec/specs/{name}/design.md)
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
   3. **Add iteration field**: Create a "Sprint" iteration field via GraphQL with cycle length from `.claude-plugin-design.json` `projects.iteration_weeks` (default: 2 weeks). Assign foundation stories to Sprint 1, dependents to Sprint 2, etc.
   4. **Create named views**: Create three views via GraphQL using names from `.claude-plugin-design.json` `projects.views` (default: "All Work" table, "Board" board, "Roadmap" roadmap). If a default "Table" view exists, rename it to the first configured view.

   **For Gitea:**
   1. **Create milestones**: One milestone per epic. Assign stories to the milestone corresponding to their epic.
   2. **Configure board columns**: Create columns from `.claude-plugin-design.json` `projects.columns` (default: Todo, In Progress, In Review, Done).
   3. **Create native dependency links**: For each story that depends on another, create a native dependency via `POST /repos/{owner}/{repo}/issues/{index}/dependencies` (or via MCP tools discovered by `ToolSearch`).

   **For other trackers**: Skip tracker-specific enrichment. Log skipped steps in the report.

   **Auto-label creation** (cross-cutting, all trackers): When applying labels in any step (epic label, story label, spec label), use the **try-then-create pattern**: attempt to apply the label, and if the tracker returns a "label not found" error, create the label with a default color and retry. Default colors: `epic`=#6E40C9, `story`=#1D76DB, `spec`=#0E8A16, other=#CCCCCC. (Governing: SPEC-0011 REQ "Auto-Create Labels")

6. **Fallback: Generate `tasks.md`** (when no tracker is available). Governing: SPEC-0006, ADR-0007.

   Write `docs/openspec/specs/{capability-name}/tasks.md` co-located with spec.md and design.md. MUST NOT generate `tasks.md` when a tracker is available — tasks live in the tracker OR in `tasks.md`, never both.

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
   - Number of project groupings created (or "skipped" if `--no-projects` was set)
   - Whether branch naming conventions were included in issue bodies (or "skipped" if `--no-branches`)
   - Whether PR conventions were included in issue bodies (or "skipped" if `--no-branches`)
   - Where the user can find them
   - Suggest `/design:prime` before starting implementation so agents have architecture context

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
- MUST check `.claude-plugin-design.json` for saved tracker preference before running detection
- MUST offer to save tracker preference when a tracker is selected for the first time
- When merging into `.claude-plugin-design.json`, preserve existing keys — only update changed sections
- Dependency ordering between stories SHOULD reflect logical implementation order, not spec document order
- Project grouping failures MUST NOT prevent issue creation
- MUST link created projects to the repository for trackers that support project-repository associations (e.g., GitHub Projects V2 via `gh project link`, Gitea). Without linking, projects are invisible from the repository's Projects tab.
- Branch slug MUST be derived from the story title (kebab-case, max 50 chars), not invented
- PR close keywords MUST match the detected tracker
- MUST use `ToolSearch` for project tools at runtime
- `--project` and `--no-projects` are mutually exclusive; if both provided, warn and use `--no-projects`
- `--no-branches` disables both `### Branch` AND `### PR Convention` sections
- MUST use try-then-create pattern for all label applications — never fail on missing labels (Governing: SPEC-0011 REQ "Auto-Create Labels")
- MUST enrich projects after creation with descriptions, READMEs, views, iterations (GitHub) or milestones, columns, dependencies (Gitea) (Governing: SPEC-0011, ADR-0012)
- Enrichment failures MUST be skipped and reported, never fail the entire operation (Governing: SPEC-0011 REQ "Graceful Degradation")
- `.claude-plugin-design.json` `projects.views`, `projects.columns`, `projects.iteration_weeks` are all optional with sensible defaults — do NOT overwrite existing keys when they are absent
- Story issues MUST be consumable by `/design:work` and `/design:review` — they use the same `### Branch` and `### PR Convention` structural sections (Governing: SPEC-0010 REQ "Downstream Compatibility")
- When `--scrum` is set, organize and enrich MUST run automatically after grooming — NEVER require the user to run `/design:organize` or `/design:enrich` separately (Governing: SPEC-0012 REQ "Automatic Organize and Enrich")
- Stories that involve HTTP endpoints MUST include a `## Security Checklist` section with authentication, input validation, output encoding, rate limiting, and body size limit items (Governing: ADR-0018, SPEC-0016 REQ "Security Checklist in Issues")
- The security checklist MUST NOT be added to stories that do not involve HTTP endpoints (DB migrations, background jobs, CLI commands, library refactoring, etc.) (Governing: SPEC-0016 REQ "Security Checklist in Issues")
- The security checklist MUST be placed after `## Acceptance Criteria` and before `### Branch` / `### PR Convention` sections
- Engineer B MUST provide a substantive objection for any story that has a weak requirement, vague scope, or missing spec reference — generic approval without review is not acceptable (Governing: SPEC-0012 REQ "Scrum Team Composition")
- The sprint report MUST be emitted at the end of every `--scrum` run, even if all stories were deferred (Governing: SPEC-0012 REQ "Sprint Report")
- `--scrum` and `--review` are mutually exclusive; if both are provided, `--scrum` takes precedence and `--review` is silently ignored
