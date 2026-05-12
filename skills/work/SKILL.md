<!-- Governing: ADR-0017 (Parallel Agent Coordination), ADR-0020 (Governing Comments), SPEC-0015 REQ "Issue Lifecycle Labels", SPEC-0015 REQ "Pre-Flight PR Awareness", SPEC-0015 REQ "Topological Merge Ordering", SPEC-0015 REQ "Design Document Isolation" -->

---
name: work
description: Pick up tracker issues and implement them in parallel using git worktrees. Use when the user says "work on issues", "implement the spec", "start coding", or wants agents to build from planned issues.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Task, WebFetch, WebSearch, TeamCreate, TeamDelete, TaskCreate, TaskUpdate, TaskList, TaskGet, SendMessage, AskUserQuestion, ToolSearch, EnterWorktree
argument-hint: [SPEC-XXXX | issue numbers | (empty = propose from backlog)] [--max-agents N] [--draft] [--dry-run] [--no-tests] [--module <name>] [--loop [--max-iterations N] [--max-prs N] [--max-minutes N] [--max-dollars N] [--lock={skip|wait|force}] [--resume] [--budget-file PATH]] [--no-chain]
---

<!-- Governing: ADR-0015 (Markdown-Native Configuration), SPEC-0014 REQ "Config Resolution Pattern" -->

# Work on Issues

You are picking up tracker issues and implementing them in parallel using git worktrees. Each issue gets its own worktree and worker agent.

<!-- Governing: ADR-0028 (/loop Autonomous Mode), SPEC-0020 REQ "Lockfile Schema and Acquisition", SPEC-0020 REQ "Budget Schema and Persistence", SPEC-0020 REQ "Telemetry Schema", SPEC-0020 REQ "Resume Contract", SPEC-0020 REQ "Resume Contract Reconciliation" -->

> **Loop Mode (V1, opt-in).** When invoked under `/loop` with the `--loop` flag, this skill enters autonomous-mode and uses the lockfile + budget primitives documented in `references/loop-primitives.md` (acquired on entry, released on exit) and the telemetry + resume contract documented in `references/loop-telemetry.md` (every iteration appends a `history.jsonl` line and emits a stdout status block; `--resume` reconciles `tracked_prs[]` and `active_worktrees[]` from the last line). The full CLI surface, all 12 stop conditions, and all 6 AskUserQuestion gates are wired in story #144 (SPEC-0020). Without `--loop`, behavior is unchanged from the rest of this document and no `.sdd/loop/` artifacts are created.

## Process

<!-- Governing: ADR-0016 (Workspace Mode), SPEC-0014 REQ "Artifact Path Resolution" -->

0. **Resolve artifact paths**: Follow the **Artifact Path Resolution** pattern from `references/shared-patterns.md` to determine the ADR and spec directories. If `$ARGUMENTS` contains `--module <name>`, resolve paths relative to that module. The resolved spec directory is `{spec-dir}`.

1. **Parse arguments**: Parse `$ARGUMENTS`.

   **Target resolution:**
   - If a SPEC number is provided (e.g., `SPEC-0003`), find all open tracker issues referencing that spec.
   - If issue numbers are provided (e.g., `42 43 47`), work on those specific issues.
   - If `$ARGUMENTS` is empty (ignoring flags), **review the backlog** (see step 4) and propose a work plan (see step 1a below) — do NOT require a spec.

   **1a. Backlog proposal (no arguments):** After discovering workable issues in step 4, analyze the backlog with a bias toward **unblocking work and feature development**:
   - Prefer issues that are blocking other issues over isolated work.
   - Prefer feature/enhancement issues over maintenance or chore issues when all else is equal.
   - Prefer issues with no dependencies (immediately startable) over blocked ones.
   - Group by epic or project when available to cluster related work.
   - Select up to `--max-agents` issues (default 4) as the proposed batch.

   Present the proposed batch to the user using `AskUserQuestion`:
   > "Here are the issues I'd like to work on. Approve or adjust before I start."

   Show a table:
   ```
   | # | Issue | Project/Epic | Rationale |
   |---|-------|-------------|-----------|
   | 1 | #42 JWT Token Generation | Auth Module | Unblocks #43 and #44 |
   | 2 | #47 Setup DB Schema | Core | No dependencies, foundational |
   | 3 | #51 User Registration API | Auth Module | High priority feature |
   ```

   Options: "Approve this batch" / "Let me pick manually" (if chosen, present full backlog and ask for issue numbers).

   **Flag parsing:**
   - `--max-agents N`: Maximum concurrent worker agents. Default: 4 (or CLAUDE.md `Worktrees > Max Agents`).
   - `--draft`: Create draft PRs instead of regular PRs. Default: off (or CLAUDE.md `Worktrees > PR Mode`).
   - `--dry-run`: Preview what would happen without creating worktrees or doing any work. Default: off.
   - `--no-tests`: Skip test execution in workers. Default: off.
   - `--module <name>`: Resolve artifact paths relative to the named module. Default: none.

2. **Load architecture context** (when a spec is provided or issues reference a spec): Read the spec's `spec.md` and `design.md`. Validate spec pairing per `references/shared-patterns.md` § "Spec Pairing Validation". Scan for referenced ADRs (e.g., `ADR-0001`) and read those too. This context will be sent to every worker. If no spec is associated with the selected issues, skip this step — workers will rely on issue body and codebase context alone.

3. **Detect tracker**: Follow the "Tracker Detection" flow in the plugin's `references/shared-patterns.md`. Fallback to `tasks.md` parsing if no tracker is found.

3a. **Ensure lifecycle labels exist** (Governing: SPEC-0015 REQ "Issue Lifecycle Labels"):

   Create the lifecycle labels using the try-then-create pattern (see `references/shared-patterns.md`) — attempt to use each label, and only create it if it doesn't exist. This avoids failures on repeated runs.

   | Label | Color | Meaning |
   |-------|-------|---------|
   | `queued` | `#CCCCCC` | Issue is in the work queue, not yet started |
   | `in-progress` | `#FBCA04` | An agent is actively working on this issue |
   | `in-review` | `#0E8A16` | A PR has been created and is awaiting review |
   | `merged` | `#6E40C9` | The PR has been merged |

   **For GitHub:**
   ```bash
   gh label create "queued" --color "CCCCCC" --description "Issue is queued for work" --force
   gh label create "in-progress" --color "FBCA04" --description "Agent is actively working" --force
   gh label create "in-review" --color "0E8A16" --description "PR created, awaiting review" --force
   gh label create "merged" --color "6E40C9" --description "PR has been merged" --force
   ```

   **For Gitea:** Use `ToolSearch` to discover label MCP tools (e.g., `mcp__gitea__label_write`). Create labels via the API equivalent. If labels already exist, the API will return an error — ignore it and proceed.

   **For `tasks.md` fallback:** Skip label creation (labels are not applicable to file-based tracking).

3b. **Define protected paths** (Governing: ADR-0017, ADR-0020, SPEC-0015 REQ "Design Document Isolation"):

   The following paths are **protected** and MUST NOT be modified by worker agents in feature branches:

   | Protected Path | Reason |
   |---------------|--------|
   | `{spec-dir}` | Spec changes require coordinated review |
   | `{adr-dir}` | ADR changes require coordinated review |
   | `CLAUDE.md` (project root) | Shared configuration — concurrent edits cause conflicts |
   | `.claude-plugin-design.json` | Plugin configuration — concurrent edits cause conflicts |

   **Exception:** Governing comments (per ADR-0020) MUST be added in feature PRs, not deferred. These are inline code comments (e.g., `// Governing: ADR-XXXX, SPEC-XXXX REQ "..."`) and are NOT considered design document modifications.

   This list is passed to every worker in step 9.4 and enforced in worker step 7a.

3c. **Tier 4 issues sync** (v5.0.0+):

   <!-- Governing: ADR-0026 (Tiered Index Freshness), SPEC-0019 REQ "Tier 4 Always-Sync Issues for Sprint Skills" -->

   Before discovering workable issues (Step 4), sync the `{repo}-issues` qmd collection from the tracker so the lead and all workers see current issue state. This also feeds the Sibling PR Manifest (Step 8a) with fresh data. Subject to the 5-min dedup window per `references/tracker-sync.md` § "Cursor Management".

   1. Read `.sdd/issues/_meta.json`. If `last_sync` is within the last 5 minutes, skip the sync silently.
   2. Otherwise, invoke per-tracker fetch+normalize per `references/tracker-sync.md`. Print: "Syncing N issues from {tracker}…".
   3. On sync failure, surface a one-line warning per `tracker-sync.md` § "Failure Modes and Degradation" and proceed with live tracker queries (the pre-v5 path) for this run. Do NOT block; work dispatch is the user's primary intent.

4. **Discover workable issues**: Search the tracker for open issues:
   - If a **spec** was provided: find all open issues referencing that spec.
   - If **issue numbers** were provided: fetch those specific issues.
   - If **no arguments** were provided: fetch all open, non-epic issues across the tracker (or the configured project/milestone scope in CLAUDE.md `Projects` if present).

   **Filtering rules:**
   - **Skip epics**: Issues labeled `epic` or titled "Implement ..." are grouping issues, not implementation work.
   - **Skip issues without `### Branch` sections**: These lack branch naming conventions. If any are found, suggest `/sdd:enrich` to add them and report which issues were skipped.
   - **Extract branch names**: Parse the `### Branch` section from each issue body to get the deterministic branch name (e.g., `feature/42-jwt-token-generation`).
   - **Extract PR conventions**: Parse the `### PR Convention` section for close keywords and epic references.
   - **Detect dependency ordering**: If issue bodies reference dependencies or logical ordering, respect that order when queuing work. For **Gitea**, query native dependencies via `GET /repos/{owner}/{repo}/issues/{index}/dependencies` (or via MCP tools discovered by `ToolSearch`) to find unblocked stories. (Governing: SPEC-0011 REQ "Gitea Native Dependencies")

   - **Enforce dependency readiness** (Governing: SPEC-0015 REQ "Issue Lifecycle Labels"): Before marking any issue as ready to work, check its dependencies:
     1. Parse the issue body for dependency references: `Depends on #NNN`, `Blocked by #NNN`, `blocks:` syntax, or any `#NNN` reference in a dependencies section.
     2. For each dependency, query the tracker for that issue's labels.
     3. If **any** dependency does NOT have the `merged` label, the issue is **blocked** and MUST NOT be started.
     4. Report blocked issues clearly:
        ```
        Issue #274 is blocked by #273 (currently: in-progress)
        ```
     5. Place blocked issues in a **deferred queue**. When a dependency reaches `merged` state (detected during monitoring in step 11), automatically move newly-unblocked issues to the ready queue.
     6. For Gitea trackers, also check native dependencies via the API in addition to body parsing.

   If no workable issues are found after filtering, report why and suggest `/sdd:plan` (no issues at all) or `/sdd:enrich` (issues exist but lack branch sections).

5. **Dry-run gate**: If `--dry-run` is set, output a preview table and stop:

   ```
   ## Dry Run: /sdd:work [SPEC-0003 | issue batch]

   Would create {N} worktrees with up to {max-agents} parallel agents.

   | # | Issue | Branch | Status |
   |---|-------|--------|--------|
   | 1 | #42 JWT Token Generation | feature/42-jwt-token-generation | Ready |
   | 2 | #43 Token Validation | feature/43-token-validation | Ready |
   | 3 | #44 Token Refresh | feature/44-token-refresh | Blocked (depends on #42) |
   | 4 | #47 Setup Auth Module | feature/47-setup-auth-module | Skipped (no ### Branch) |

   ### Skipped Issues
   - #45 Implement Auth Service (epic — skipped)
   - #47 Setup Auth Module (no ### Branch section — run `/sdd:enrich`)

   No changes were made.
   ```

5a. **Apply `queued` labels** (Governing: SPEC-0015 REQ "Issue Lifecycle Labels"): For all workable issues that passed filtering, apply the `queued` label to indicate they are in the work queue. This provides visibility into the batch before agents start.

   **For GitHub:**
   ```bash
   gh issue edit {issue-number} --add-label "queued"
   ```
   **For Gitea:** Use `ToolSearch` to discover label MCP tools and apply the label via API.

6. **Verify git state**:
   - Run `git status` to check for uncommitted changes. If there are uncommitted changes, use `AskUserQuestion` to ask:
     - "You have uncommitted changes. Continue anyway, or commit first?"
     - Options: "Continue anyway" / "Stop so I can commit"
     - If the user says stop, halt and report.
   - Run `git fetch` to ensure we have the latest remote state.

7. **Read worktree config from CLAUDE.md**: Follow the "Config Resolution" pattern in the plugin's `references/shared-patterns.md`. Read the `#### Worktrees` subsection from the `### SDD Configuration` section in CLAUDE.md. Defaults: `Base Dir`=`.claude/worktrees/`, `Max Agents`=3, `Auto Cleanup`=false, `PR Mode`="ready". CLI flags override config values.

7a. **Resolve parallelism limit** (Governing: SPEC-0015 REQ "Parallelism Limits", ADR-0017 Layer 1):

   Determine the maximum number of concurrent agents using this precedence order (highest to lowest):
   1. `--max-agents N` CLI flag (if provided)
   2. CLAUDE.md `## SDD Configuration` section, key `max-parallel-agents` (if present)
   3. Default: **4**

   **Reading from CLAUDE.md:** Scan the project's `CLAUDE.md` for a `## SDD Configuration` section. Look for a line matching `- **Max parallel agents**: N` or `max-parallel-agents: N`. Parse the integer value. Example:
   ```markdown
   ## SDD Configuration

   - **Max parallel agents**: 2
   - **Hotspot threshold**: 40%
   ```

   **Enforce the cap:** The resolved limit MUST NOT be exceeded. When more stories are ready for parallel execution than the limit allows:
   - Start up to `max-parallel-agents` stories immediately
   - Queue excess stories in dependency-respecting order
   - As active agents complete (transition to `in-review` or `merged`), start the next queued story

   **Report before starting:** Before spawning any agents, report the parallelism plan to the user:
   ```
   Starting {N} of {M} ready stories ({Q} queued, max-parallel-agents: {limit})
   ```
   Example: "Starting 4 of 8 ready stories (4 queued, max-parallel-agents: 4)"

8. **Create team**: Use `TeamCreate` to create a coordination team following the "Worker Coordination" protocol from `references/shared-patterns.md` § "Multi-Agent Team Protocols". The lead (you) manages the task queue and monitors progress. Spawn up to the resolved parallelism limit (from step 7a) worker agents using `Task` with `subagent_type: "general-purpose"`.

   If `TeamCreate` fails, fall back to single-agent sequential mode: work through each issue one at a time in the main session using `git worktree add` for each.

8a. **Build sibling PR manifest** (Governing: SPEC-0015 REQ "Pre-Flight PR Awareness"):

   Before dispatching any workers, build a pre-flight awareness manifest so each agent knows what siblings are doing. Follow the **Pre-Flight PR Awareness** pattern in `references/shared-patterns.md`.

   1. **Query the tracker for all open PRs** in the current sprint, epic, or spec scope:
      ```bash
      gh pr list --search "SPEC-XXXX" --json number,title,headRefName,body,url,labels --limit 50
      ```
      Include PRs from previous `/sdd:work` runs that haven't merged yet.

   2. **For each open PR, extract file ownership:**
      ```bash
      gh pr diff {number} --name-only
      ```
      Scan the diff for new type/struct/interface/class/function definitions to identify shared artifacts.

   3. **For foundation PRs** (labeled `foundation`), catalog all shared types and helpers with their file paths and merge status (merged = available on main, open = available after merge).

   4. **Assemble the Sibling PR Manifest** with three sections:
      - **Files Currently Being Modified by Siblings** — file paths with owning PR/issue numbers
      - **Shared Types Available** — types, helpers, and their locations (with merge status)
      - **In-Progress Sibling PRs** — table of PR number, issue, branch, files, and status

   This manifest is injected into each worker's context in step 9.4. Workers keep it current via live `SendMessage` broadcasts per the **Worker Communication Protocol** in `references/shared-patterns.md`.

9. **Create worktrees and assign work**: For each workable issue (respecting dependency order and max-agents concurrency):

   **9.1: Create the worktree.**
   ```bash
   git worktree add .claude/worktrees/{branch-name} -b {branch-name}
   ```
   Use the base directory from CLAUDE.md `Worktrees > Base Dir` if set, otherwise `.claude/worktrees/`.

   **9.2: Transition to `in-progress`** (Governing: SPEC-0015 REQ "Issue Lifecycle Labels"): When assigning an issue to a worker, update its lifecycle state:

   1. **Set assignee**: Assign the current user (or a worker identifier) to the issue.
      ```bash
      gh issue edit {issue-number} --add-assignee "@me"
      ```
      For Gitea, use `ToolSearch` to discover issue MCP tools and set the assignee via API.

   2. **Remove `queued`, apply `in-progress`**: Each transition MUST remove the previous label before applying the new one.
      ```bash
      gh issue edit {issue-number} --remove-label "queued" --add-label "in-progress"
      ```

   **9.3: Create a task** using `TaskCreate` for each issue, with the issue details, branch name, and worktree path.

   **9.4: Assign to a worker** using `TaskUpdate` with the worker's name as `owner`. Send the worker a message via `SendMessage` with all context needed to implement the issue.

10. **Worker implementation protocol**: Each worker receives and follows this protocol:

    **Worker receives:**
    - Issue number, title, and full body (with acceptance criteria)
    - Branch name (from `### Branch` section)
    - PR convention (from `### PR Convention` section)
    - Spec content (spec.md) — if a spec was resolved for this issue; omitted otherwise
    - Design content (design.md) — if a spec was resolved; omitted otherwise
    - ADR content (any referenced ADRs) — if a spec was resolved; omitted otherwise
    - **Sibling PR Manifest** (from step 8a) — files being modified by siblings, shared types available, in-progress sibling PRs
    - Worktree absolute path
    - Whether to run tests (`--no-tests` flag)
    - PR mode (`draft` or `ready`)

    **Worker steps:**
    1. All file operations use the worktree absolute path (read, write, edit, glob, grep).
    2. Read the issue body and understand the acceptance criteria.
    3. Explore existing code in the worktree to understand the codebase structure.

    3a. **qmd-aware code pre-search before writing** (v5.0.0+).

       <!-- Governing: ADR-0024 (qmd as hard dependency), SPEC-0019 REQ "qmd-Smart Sprint Skills" -->

       Before writing any new helper, type, struct, interface, or substantial code block, qmd-search `{repo}-code` for existing patterns. This complements the Sibling PR Manifest (which covers in-flight work) by surfacing patterns already on main that the worker would otherwise re-create. Mitigates the duplicate-implementation drift Foundation Story Detection (per ADR-0017) was designed to catch.

       1. Construct a hybrid query per `references/qmd-helpers.md` § "Hybrid Retrieval":
          - `lex`: the planned helper / type / function name AND key terms from its purpose (e.g., for a `parseUserID` helper: "parseUserID parse user id authentication token")
          - `vec`: a one-sentence framing of what the worker is about to implement (e.g., "extract a numeric user ID from an authenticated request context")
          - `intent: "/sdd:work — find existing helpers/types/patterns to import rather than recreate"`
          - `collections: ["{repo}-code"]`
          - `limit: 6`, `minScore: 0.4`

       2. For each match above the threshold, the worker MUST:
          - Read the matched file's relevant portion in full
          - If the existing implementation covers the worker's need, IMPORT it rather than create a duplicate
          - Broadcast `TYPE_IMPORTED: #{issue} will import {TypeName} from {file-path}` per the Worker Communication Protocol (already in `shared-patterns.md`) so the lead and siblings know

       3. If qmd returns zero matches above the threshold, proceed with the new implementation as planned.

       4. On qmd unreachable / timeout per `qmd-helpers.md` § "Error Handling", surface the error to the lead via SendMessage and stop work on this issue. Per ADR-0024, the pre-v5 fallback ("just write new code") is gone in v5; the failure mode is "fix qmd, retry."

    3b. **Coordinate with sibling workers** (Governing: SPEC-0015 REQ "Pre-Flight PR Awareness"). Follow the "Worker Communication Protocol" in `references/shared-patterns.md`. Before modifying any file:
       - **Check the Sibling PR Manifest** for files already claimed by siblings. If the file appears under "Files Currently Being Modified by Siblings", send `CONFLICT_ALERT` and wait for lead coordination instead of modifying it.
       - **Check for shared types** in the manifest's "Shared Types Available" section. If a needed type, struct, interface, or helper already exists (from a merged foundation PR or an in-progress sibling), import it from the expected location instead of creating a duplicate.
       - **Broadcast live updates** via `SendMessage` to all siblings:
         - `FILE_CLAIM: #{issue} claiming {file-path}` — before modifying any file
         - `TYPE_CREATED: #{issue} created {TypeName} in {file-path}` — after creating new shared types, structs, interfaces, or helpers
         - `AVAILABILITY: #{issue} PR merged — {artifact list} now on main` — when the lead detects a sibling PR has merged
       - **Listen for sibling broadcasts** and update the local manifest accordingly:
         - On `FILE_CLAIM` from a sibling: add the file to the "avoid modifying" list
         - On `TYPE_CREATED` from a sibling: add the type to "Shared Types Available" and import it rather than recreating
         - On `AVAILABILITY` from lead: move artifacts from "in-progress" to "available on main" and lift file avoidance for those files
    4. Implement changes to satisfy the acceptance criteria.
    5. If spec context was provided, leave governing comments in the code per `references/shared-patterns.md` § "Governing Comment Format":
       ```
       // Governing: ADR-XXXX (short description), SPEC-XXXX REQ "Requirement Name"
       ```
    6. Run tests (unless `--no-tests`). If tests fail, attempt to fix (max 2 fix attempts). If still failing after 2 attempts, report blocked with details.
    7. **Assess PR size before creating.** Run `git -C {worktree-path} diff --stat` to see the scope of changes. Use judgement about whether this warrants a standalone PR:
       - **Comments-only changes** (only comment lines added/changed, no logic): not worth a standalone PR
       - **Trivially small** (fewer than ~30 lines of substantive code across the whole branch): likely not worth a standalone PR
       - **100+ lines of meaningful code changes**: clearly worth a standalone PR
       - The in-between range (30-100 lines) requires judgement — consider whether a reviewer would find it worthwhile to context-switch for

       **If the implementation is too small to justify its own PR**, send the lead a bundle request:
       ```
       BUNDLE_REQUEST: #42 implementation is trivially small (8 lines changed, comments only). Requesting additional issues to bundle into this branch before opening a PR.
       ```
       Wait for the lead to either assign additional issues or confirm proceeding with a small PR (e.g., queue is exhausted). If additional issues are assigned, return to step 2 for each, implementing them in the same worktree, then proceed with a combined commit and PR covering all bundled issues.
    7a. **Validate diff against protected paths** (Governing: SPEC-0015 REQ "Design Document Isolation"):
        Before staging, check for modifications to protected paths defined in step 3b:
        ```bash
        git -C {worktree-path} diff --name-only
        ```
        For each modified file, check if it falls under a protected path (`{spec-dir}`, `{adr-dir}`, root `CLAUDE.md`, `.claude-plugin-design.json`).

        **If protected files are found:**
        1. Revert each protected file:
           ```bash
           git -C {worktree-path} checkout -- {protected-file}
           ```
        2. Record the intended changes as deferred updates. For each reverted file, capture what was changed and why.
        3. Include a `### Deferred Design Doc Updates` section in the PR body listing each deferred change:
           ```markdown
           ### Deferred Design Doc Updates
           - `docs/adrs/ADR-0005.md`: Update status from "proposed" to "accepted"
           - `docs/openspec/specs/auth/spec.md`: Add new requirement for token rotation
           ```

        **Exception:** Governing comments in source code files are NOT protected — they are inline code annotations, not design document modifications. Only files under the protected paths listed in step 3b are subject to this validation.

    8. Stage and commit changes:
       ```bash
       git -C {worktree-path} add .
       git -C {worktree-path} commit -m "{descriptive message}\n\nImplements #{issue-number}\nGoverning: SPEC-XXXX"
       ```
       If multiple issues were bundled, list all of them in the commit message.
    9. Push the branch:
       ```bash
       git -C {worktree-path} push -u origin {branch-name}
       ```
    10. Create a PR using the tracker's tools or CLI:
        - Title: the issue title (or a combined title if issues were bundled)
        - Body: Include close keywords for all bundled issues, reference the epic, reference the spec
        - Regular (non-draft) by default, draft if `--draft` was set
    11. **Transition to `in-review`** (Governing: SPEC-0015 REQ "Issue Lifecycle Labels"): After the PR is created, update lifecycle labels:
        ```bash
        gh issue edit {issue-number} --remove-label "in-progress" --add-label "in-review"
        ```
        If multiple issues were bundled into one PR, transition ALL bundled issues to `in-review`.
    12. Report outcome to lead via `SendMessage`: success (with PR URL and list of bundled issues) or failure (with details).

11. **Monitor, queue, and lifecycle transitions**: The lead tracks worker progress (Governing: SPEC-0015 REQ "Parallelism Limits", SPEC-0015 REQ "Issue Lifecycle Labels"):
    - **Enforce parallelism cap**: Never exceed the resolved `max-parallel-agents` limit from step 7a. Track the count of active agents at all times.
    - **Transition to `merged` on PR merge**: When a worker reports success and the PR is subsequently merged (either via `/sdd:review` or manually), transition the issue:
      ```bash
      gh issue edit {issue-number} --remove-label "in-review" --add-label "merged"
      ```
      If the work session itself does not merge PRs, the `merged` transition will be handled by `/sdd:review` or the next `/sdd:work` invocation that detects merged PRs.
    - **Tier 1 mutation update on merge** (v5.0.0+, Governing: ADR-0026, SPEC-0019 REQ "Tier 1 Mutation-Aware Updates"): After detecting a PR merge, before transitioning to `merged`, trigger a narrow re-sync of `{repo}-code` so the qmd index reflects the newly-merged code. Use the canonical update pattern from `references/qmd-helpers.md` § "Update Patterns". Best-effort and silent on success. On failure, append a one-line warning to the run log ("Index refresh failed for `{repo}-code` after merging PR #{N} — run `/sdd:index update` manually") but the merged-label transition still proceeds.
    - **Unblock deferred issues**: After any issue transitions to `merged`, re-check the deferred queue from step 4. For each deferred issue, re-query its dependencies. If ALL dependencies now have the `merged` label, move the issue to the ready queue and start it if an agent slot is available.
    - When a worker finishes, check if there are queued issues waiting.
    - If queued issues have dependency requirements, check if dependencies are now satisfied.
    - Assign the next available issue to the freed worker, maintaining up to `max-parallel-agents` active agents.
    - If a worker reports failure, note it and continue with other issues. The freed slot is available for queued work. The issue retains its `in-progress` label (do NOT transition failed issues to `merged`).
    - **Handle bundle requests**: When a worker sends a `BUNDLE_REQUEST`, check the issue queue for additional issues that could be bundled into the same branch. If available (and not blocked by dependencies), assign them to the same worker with instructions to implement in the same worktree before creating a PR. If the queue is exhausted or all remaining issues are blocked, tell the worker to proceed with the small PR as-is.
    - **Queue status reporting**: After each agent completion or queue change, log the current state: "Active: {N}/{limit}, Queued: {Q}, Completed: {C}, Failed: {F}, Blocked: {B}"

11a. **Compute topological merge order** (Governing: SPEC-0015 REQ "Topological Merge Ordering"):

   After all workers have completed and PRs are in `in-review` state, compute the optimal merge order before merging begins. Follow the **Topological Merge Ordering** pattern in `references/shared-patterns.md`.

   1. **Collect file lists for each PR:**
      ```bash
      gh pr diff {number} --name-only
      ```

   2. **Build file overlap graph.** For each pair of PRs, compute the intersection of modified files. PRs that share files have an ordering dependency.

   3. **Classify PRs into tiers:**
      - **Tier 0 (isolated)**: PRs with zero file overlap with any other PR — merge first, in any order
      - **Tier 1 (foundation)**: PRs labeled `foundation` with dependents — merge after Tier 0
      - **Tier N (dependent)**: PRs overlapping with Tier N-1 PRs — merge after predecessors, rebase first

   4. **Detect circular dependencies.** If the overlap graph contains a cycle, report it to the user and request manual resolution:
      ```
      Circular file dependency detected between PRs #X and #Y (both modify {files}).
      Please specify which should merge first.
      ```
      Do NOT proceed with merging the cycle until the user resolves it.

   5. **Offer PR stacking** when a direct dependency exists (PR B depends on PR A via issue body AND they share files):
      ```
      PR #143 depends on PR #141. Stack #143 on top of #141's branch to avoid rebase conflicts? (Y/n)
      ```

   6. **Report the merge order** to the user before merging:
      ```
      ### Merge Order

      | Order | PR | Issue | Overlapping Files | Action |
      |-------|----|-------|-------------------|--------|
      | 1 | #142 | #42 Isolated feature | (none) | Merge |
      | 1 | #145 | #45 Another isolated | (none) | Merge |
      | 2 | #141 | #41 Foundation types | main.go, sync.go | Merge, then rebase remaining |
      | 3 | #143 | #43 Depends on #141 | sync.go | Rebase, then merge |
      | 4 | #144 | #44 Touches everything | main.go, sync.go, config.go | Rebase, then merge |

      Proceed with this merge order? (Y/n)
      ```

   7. **Execute the merge sequence** (after user approval):
      - Merge all Tier 0 PRs (parallel-safe)
      - After each merge, auto-rebase all remaining open PRs against main:
        ```bash
        git fetch origin main
        git -C {worktree-path} rebase origin/main
        git -C {worktree-path} push --force-with-lease
        ```
      - If a rebase fails, report the failure and preserve the worktree for manual resolution
      - Proceed tier by tier until all PRs are merged
      - **Transition merged issues** to `merged` label per step 11's lifecycle rules

12. **Cleanup and report**: After all issues are processed:

    **12.1: Shut down team.** Send `shutdown_request` to all workers via `SendMessage`.

    **12.2: Offer worktree cleanup.** If CLAUDE.md `Worktrees > Auto Cleanup` is `true`, remove worktrees for successfully-PRed issues automatically. Otherwise, use `AskUserQuestion`:
    - "Remove worktrees for completed issues? (Failed issue worktrees are always preserved.)"
    - Options: "Yes, clean up" / "No, keep them"
    - If yes: `git worktree remove .claude/worktrees/{branch-name}` for each successful issue.

    **12.3: Batch deferred design doc updates** (Governing: SPEC-0015 REQ "Design Document Isolation"):

    After all sprint PRs are merged, collect deferred design document updates from all PR bodies:

    1. Scan each merged PR body for a `### Deferred Design Doc Updates` section.
    2. If any deferred updates exist, create a single batch PR:
       - Branch: `docs/sprint-{N}-design-updates` (or `docs/design-updates-{date}` if no sprint number is available)
       - Apply all deferred changes to the protected files on this branch
       - PR title: "Update design docs for Sprint {N}" (or "Batch design doc updates for {date}")
       - PR body: List all changes grouped by file, with references to the originating PRs
       - Label: `documentation`
    3. If no deferred updates were found across any PRs, skip this step.

    This ensures design documents are updated in a single, reviewable PR rather than risking merge conflicts from parallel modifications.

    **12.4: Final report.**

    ```
    ## Work Complete: [SPEC-0003 | issue batch]

    Implemented {N} of {M} issues using {agent-count} parallel agents.

    ### Results

    | Issue | Branch | PR | Status |
    |-------|--------|----|--------|
    | #42 JWT Token Generation | feature/42-jwt-token-generation | #101 | in-review |
    | #43 Token Validation | feature/43-token-validation | #102 | in-review |
    | #44 Token Refresh | feature/44-token-refresh | — | Failed (in-progress) |
    | #45 Session Revocation | — | — | Blocked by #44 |

    ### Failed Issues
    - **#44 Token Refresh**: Tests failing after 2 fix attempts. Worktree preserved at `.claude/worktrees/feature/44-token-refresh` for manual pickup. Error: `TokenRefreshService.refresh() returns expired token in test_refresh_expired`.

    ### Blocked Issues
    - **#45 Session Revocation**: Blocked by #44 (currently: in-progress). Will be unblocked when #44 reaches `merged`.

    ### Worktrees
    - Cleaned up: 2
    - Preserved (failed): 1

    ### Next Steps
    - Run `/sdd:review` for automated spec-aware PR review and merge
    - Fix failing issue #44 manually or re-run `/sdd:work 44`
    - Run `/sdd:check` to verify implementation alignment
    - Run `/sdd:audit` for comprehensive drift analysis
    ```

## Why `git worktree add` Instead of `EnterWorktree`

- `EnterWorktree` creates random branch names; we need deterministic names matching `### Branch` conventions from issue bodies.
- `EnterWorktree` switches the session's working directory; the lead agent must stay in the main tree to coordinate.
- `git worktree add` gives full control over branch name and worktree location.

## Error Handling

| Condition | Behavior |
|-----------|----------|
| Worker can't complete implementation | Reports failure to lead, worktree preserved for manual pickup |
| Tests fail after 2 retries | Worker reports blocked with error details, moves to next issue |
| `TeamCreate` fails | Falls back to single-agent sequential mode |
| No workable issues found | Suggest `/sdd:plan` (no issues at all) or `/sdd:enrich` (issues exist but lack `### Branch`) |
| Uncommitted changes in main tree | Ask user whether to continue or commit first |
| `git worktree add` fails (branch exists) | Check if the branch already exists remotely. If so, use `git worktree add .claude/worktrees/{branch-name} {branch-name}` (without `-b`) to check out the existing branch |
| Push fails (remote rejection) | Worker reports the error to lead; worktree preserved |
| PR creation fails | Worker reports the error to lead; branch is still pushed, user can create PR manually |
| Tracker not available | Suggest `/sdd:plan` to create issues first |
| Issue has no acceptance criteria | Worker uses the issue title and body as guidance, warns in PR description |
| Label creation fails (permissions) | Warn the user that lifecycle labels could not be created, continue without label management |
| Label transition fails | Log the failure but do NOT block work — label management is best-effort, implementation is primary |
| Dependency issue not found in tracker | Treat as unblocked (dependency may have been deleted or moved) with a warning |
| All issues are blocked by dependencies | Report the dependency graph and suggest resolving blocking issues first |
| Circular dependency detected | Report the cycle and refuse to start any issue in the cycle; suggest the user break the cycle manually |
| Sibling PR manifest query fails | Proceed without manifest — workers operate independently with live broadcasting only |
| `gh pr diff` fails for a sibling PR | Omit that PR from the manifest with a warning; continue with available data |
| Rebase fails during merge ordering | Preserve the worktree, report conflicting files, skip that PR, and continue with remaining PRs |
| Circular file dependency in merge order | Report the cycle to the user and request manual merge order specification |
| All PRs have file overlaps (no Tier 0) | Start with foundation PRs, then proceed by overlap count (fewest overlaps first) |
| Worker modifies protected path (design docs) | Revert the protected file, record change in `### Deferred Design Doc Updates` PR body section, continue with implementation |
| No deferred design doc updates after sprint | Skip batch PR creation — nothing to consolidate |
| Batch design doc PR conflicts | Report conflict to user for manual resolution |

## Rules

- A spec is NOT required — `/sdd:work` can operate from the backlog alone
- When no arguments are provided, MUST analyze the backlog and propose a batch to the user before starting any work
- MUST read spec.md and design.md before dispatching workers only when a spec is provided or resolvable from issue bodies
- MUST use `ToolSearch` to discover tracker MCP tools at runtime — never assume specific tools are available
- MUST follow the Config Resolution pattern from `references/shared-patterns.md` to read configuration from CLAUDE.md
- MUST extract branch names from issue bodies — never invent branch names
- MUST skip epics (labeled `epic` or titled "Implement ...") — only work on implementation issues
- MUST skip issues without `### Branch` sections and suggest `/sdd:enrich`
- MUST respect dependency ordering when queuing work
- MUST create regular (non-draft) PRs by default — only create draft PRs with `--draft`
- MUST leave governing comments per `references/shared-patterns.md` § "Governing Comment Format" in implemented code when spec context is available; omit when there is no spec
- MUST report all failures with actionable details — never silently skip
- MUST preserve worktrees for failed issues — never auto-clean failures
- Workers MUST use worktree absolute paths for all file operations
- Workers MUST NOT modify files outside their assigned worktree
- Workers MUST push and create PRs before reporting success
- Workers MUST assess PR size before opening a PR — do NOT create comments-only PRs or trivially small PRs (<30 lines of substantive code) as standalone PRs; send a `BUNDLE_REQUEST` to the lead instead
- Lead MUST handle `BUNDLE_REQUEST` by checking the queue for additional bundleable issues before telling the worker to proceed
- If no additional issues are available to bundle, worker MAY create a small PR and SHOULD note in the PR body why it is small (no more queued work to combine)
- The lead MUST stay in the main working tree — only workers operate in worktrees
- `--dry-run` MUST NOT create any worktrees, branches, or PRs
- Maximum 2 test-fix attempts per worker before reporting blocked
- When `TeamCreate` fails, MUST fall back to single-agent sequential mode — never error out
- For Gitea trackers, MUST query native dependencies via API to determine unblocked stories (Governing: SPEC-0011 REQ "Gitea Native Dependencies")
- MUST NOT spawn more than `max-parallel-agents` concurrent agents (default: 4); resolve from CLI flag → CLAUDE.md → default (Governing: SPEC-0015 REQ "Parallelism Limits", ADR-0017 Layer 1)
- MUST read `## SDD Configuration` from CLAUDE.md for `max-parallel-agents` setting before falling back to default
- MUST queue excess stories when more are ready than the parallelism limit allows, starting them as active agents complete
- MUST report active agent count and queue depth to the user before starting work ("Starting N of M ready stories (Q queued, max-parallel-agents: limit)")
- Workers MUST broadcast `FILE_CLAIM` via `SendMessage` before modifying any file
- Workers MUST broadcast `TYPE_CREATED` via `SendMessage` after creating new types, structs, interfaces, or shared helpers
- Workers receiving `TYPE_CREATED` MUST import the type rather than creating a duplicate
- Workers receiving `FILE_CLAIM` for a file they also need MUST send `CONFLICT_ALERT` and wait for lead coordination
- MUST ensure lifecycle labels (`queued`, `in-progress`, `in-review`, `merged`) exist before assigning work — using the try-then-create pattern (see `references/shared-patterns.md`) (Governing: SPEC-0015 REQ "Issue Lifecycle Labels")
- MUST apply `queued` label to all workable issues upon discovery
- MUST transition `queued` -> `in-progress` when an agent picks up an issue, removing the previous label first
- MUST transition `in-progress` -> `in-review` when a PR is created, removing the previous label first
- MUST transition `in-review` -> `merged` when a PR is merged, removing the previous label first
- Each label transition MUST remove the outgoing label before applying the incoming label — no issue should have two lifecycle labels simultaneously
- Label management is best-effort — if label operations fail, log the failure but do NOT block implementation work
- MUST set assignee on the issue when an agent picks it up (`gh issue edit --add-assignee "@me"` or equivalent)
- MUST check dependency status before starting work on any issue — parse issue body for `Depends on #NNN`, `Blocked by #NNN`, and `blocks:` syntax
- MUST refuse to start work on issues whose dependencies have not reached `merged` state
- MUST report blocked issues with the specific blocking dependency and its current state (e.g., "Issue #274 is blocked by #273 (currently: in-progress)")
- MUST place blocked issues in a deferred queue and re-check when dependencies transition to `merged`
- MUST detect circular dependencies and refuse to start any issue in the cycle
- Queue status reporting MUST include blocked count: "Active: {N}/{limit}, Queued: {Q}, Completed: {C}, Failed: {F}, Blocked: {B}"
- MUST build a sibling PR manifest before dispatching workers by querying the tracker for all open PRs in the sprint/epic scope (Governing: SPEC-0015 REQ "Pre-Flight PR Awareness")
- MUST inject the sibling PR manifest into each worker's context when assigning work
- Workers MUST check the sibling PR manifest before modifying files or creating types — if a file or type is already claimed by a sibling, the worker MUST coordinate rather than duplicate
- Workers MUST update their local manifest dynamically via `SendMessage` broadcasts (FILE_CLAIM, TYPE_CREATED, AVAILABILITY)
- Lead MUST broadcast `AVAILABILITY` messages when foundation or sibling PRs merge so workers can lift file avoidance directives
- MUST compute topological merge order based on file overlap analysis after all PRs reach `in-review` state (Governing: SPEC-0015 REQ "Topological Merge Ordering")
- PRs with zero file overlap MUST be merged first (Tier 0, any order)
- PRs sharing files with already-merged PRs MUST rebase before merging
- MUST report the computed merge order to the user and await approval before merging begins
- MUST offer PR stacking when two PRs have a direct dependency relationship AND share modified files
- MUST auto-rebase all remaining open PRs after each merge
- MUST detect circular file dependencies in the merge order graph and request manual resolution — do NOT merge PRs in a cycle without user input
- If a rebase fails during merge ordering, MUST preserve the worktree and report the conflict for manual resolution
- Workers MUST NOT modify protected paths (`{spec-dir}`, `{adr-dir}`, root `CLAUDE.md`, `.claude-plugin-design.json`) in feature branches (Governing: SPEC-0015 REQ "Design Document Isolation")
- Workers MUST run `git diff --name-only` before staging and revert any protected files that were modified
- Workers MUST record reverted protected-file changes in a `### Deferred Design Doc Updates` section in the PR body
- Governing comments (per ADR-0020) are inline code annotations and MUST be added in feature PRs — they are NOT subject to design document isolation
- Lead MUST collect all deferred design doc updates after sprint PRs merge and create a single batch PR for them
- If no deferred design doc updates exist across any PRs, the batch PR step MUST be skipped
- **v5.0.0+**: MUST trigger Tier 4 issues sync on entry per Step 3c — sync from tracker before Step 4 issue discovery, subject to 5-min dedup. On failure, fall back to live queries with a warning, never block (Governing: ADR-0026, SPEC-0019 REQ "Tier 4 Always-Sync Issues for Sprint Skills")
- **v5.0.0+**: Workers MUST run qmd-aware code pre-search per worker Step 3a before writing any new helper/type/struct/interface — qmd-search `{repo}-code` for matches; if found above threshold (minScore 0.4), MUST import the existing implementation and broadcast `TYPE_IMPORTED` rather than recreate (Governing: ADR-0024, SPEC-0019 REQ "qmd-Smart Sprint Skills")
- **v5.0.0+**: Lead MUST trigger Tier 1 update of `{repo}-code` after detecting a PR merge per Step 11 — best-effort, silent on success, one-line warning on failure (Governing: ADR-0026, SPEC-0019 REQ "Tier 1 Mutation-Aware Updates")

## Loop Mode (autonomous)

<!-- Governing: ADR-0028 (/loop Autonomous Mode for /sdd:work and /sdd:review), SPEC-0020 REQ "Loop Mode Opt-In", REQ "CLI Surface for Loop Controls", REQ "Backlog-Empty Stop", REQ "Iteration Budget Stop", REQ "PR-Touch Budget Stop", REQ "Wall-Clock Budget Stop", REQ "Repeated-Failure Stop", REQ "Dependency-Cycle Stop", REQ "User Interrupt Stop", REQ "Lockfile Contention Skip", REQ "Prior-Gate-Stop Honor", REQ "qmd-Unreachable Stop", REQ "Cost Budget Stop", REQ "Concurrency Invariants for /sdd:work", REQ "Backlog-Drift Gate", REQ "Ambiguous-Acceptance-Criteria Gate", REQ "Budget-Escalation Gate", REQ "Force-Unlock Gate", REQ "Repeated-Failure Gate", REQ "Gates Are Not Debounced Across Iterations", REQ "Final Report on Stop" -->

When `/sdd:work` is invoked under `/loop` with the `--loop` flag (e.g. `/loop /sdd:work --loop`), the skill enters autonomous-mode and follows the contract below on every tick. Without `--loop`, the skill behaves exactly as the rest of this document specifies and creates **no** `.sdd/loop/` artifacts (per SPEC-0020 REQ "Loop Mode Opt-In").

The runtime `/loop` skill is unchanged. `--loop` is a skill-side opt-in. `/loop` schedules ticks; everything inside a tick is the wrapped skill's concern.

### CLI surface

When `--loop` is set, `/sdd:work` accepts the following additional flags. All are optional with the documented conservative defaults (per SPEC-0020 REQ "CLI Surface for Loop Controls"). Budgets are inclusive **across the entire loop run**, not per-iteration.

| Flag | Default | Purpose |
|------|---------|---------|
| `--loop` | off | Opt into autonomous-mode |
| `--max-iterations N` | 5 | Iteration ceiling across the run |
| `--max-prs N` | 20 | Distinct-PR ceiling across the run |
| `--max-minutes N` | 60 | Wall-clock ceiling across the run |
| `--max-dollars N` | 25 | Dollar-cost ceiling; `0` disables condition #12 (estimate still tracked) |
| `--lock={skip\|wait\|force}` | `skip` | Concurrency mode on lockfile contention |
| `--resume` | off | Recover state from the most recent `history.jsonl` line |
| `--budget-file PATH` | `.sdd/loop/work.budget.json` | Override the budget-file location |
| `--no-chain` | off | Skip the post-PR chain (`/sdd:review` + `/autofix-pr`); restores legacy "open PR, stop" behavior. See "Post-PR Chain" below. |

The first write of `budget.json` records the active ceilings (per `references/loop-primitives.md` § First-write rule) so a later `--resume` cannot silently widen them.

### Per-tick flow

Each tick follows this canonical flow (control flow diagram in `docs/openspec/specs/loop-autonomous-mode/design.md`):

1. **Acquire lockfile** at `.sdd/loop/work.lock` per `references/loop-primitives.md` § Acquisition flow (skip / wait / force per `--lock`).
2. **Read budget** from `.sdd/loop/work.budget.json`; on first write, initialize ceilings, `started_at`, and `rate_table_source` (per `references/loop-primitives.md` § First-write rule).
3. **Evaluate stop conditions on entry** (see "Stop conditions" below). Any matching condition halts the loop, emits the final report, and releases the lockfile.
4. **Run the gate block** (see "AskUserQuestion Gates" below). Any gate answered `stop` halts the loop.
5. **Run the iteration body** — discover workable issues per Step 4 of the main flow above (skipping issues labeled `in-progress` per "Concurrency invariants"), dispatch workers, open PRs.
6. **For each PR opened in this iteration**, invoke the post-PR chain per "Post-PR Chain" below (unless `--no-chain` or `--dry-run`).
7. **Update budget** — increment `iterations_used`, union `prs_touched`, accumulate `tokens_in`/`tokens_out`/`agents_dispatched`, recompute `dollars_estimate`, evaluate exit-time stop conditions 3 / 4 / 5 / 12.
8. **Emit telemetry** — append a line to `.sdd/loop/work.history.jsonl` (per `references/loop-telemetry.md`) and emit the stdout status block.
9. **Release lockfile** and let `/loop` schedule the next tick.

### Stop conditions

The loop halts on any matching condition. The cause is recorded in `stop_conditions_fired[]` of the final history line.

| # | Condition | Behavior |
|---|-----------|----------|
| 1 | Backlog empty (no unblocked, unworked, in-scope issues on entry) | Final report names empty queue; release lock; do NOT signal another tick (SPEC-0020 REQ "Backlog-Empty Stop") |
| 3 | `iterations_used >= max_iterations` (entry-time check) | `stop_conditions_fired: ["iteration_budget"]` (SPEC-0020 REQ "Iteration Budget Stop") |
| 4 | `len(prs_touched) >= max_prs` (deduplicated set; entry-time + after each PR open) | `stop_conditions_fired: ["prs_touched_budget"]` (SPEC-0020 REQ "PR-Touch Budget Stop") |
| 5 | `minutes_elapsed >= max_minutes` (clock anchored at `started_at`, persists across `--resume`) | `stop_conditions_fired: ["wall_clock_budget"]` (SPEC-0020 REQ "Wall-Clock Budget Stop") |
| 6 | Same issue/PR failed twice consecutively with the same root cause | Fire the **Repeated-Failure** gate (does NOT silently halt) (SPEC-0020 REQ "Repeated-Failure Stop") |
| 7 | Issue-dependency analysis (per SPEC-0015 Layer 2) detects a cycle | Halt and surface the cycle's edges; do NOT attempt automatic break (SPEC-0020 REQ "Dependency-Cycle Stop") |
| 8 | User interrupt (Ctrl-C / session close / explicit `/loop stop`) | Drain in-flight workers (no new dispatch), release lock, emit final report, no half-states (SPEC-0020 REQ "User Interrupt Stop") |
| 9 | Lockfile holds a live PID under `--lock=skip` | Emit one-line skip note; do NOT increment counters (SPEC-0020 REQ "Lockfile Contention Skip"). `--lock=wait` blocks bounded by `max_minutes`; `--lock=force` fires the Force-Unlock gate. |
| 10 | Any prior `gates[]` entry recorded `answer == "stop"` | "Loop already stopped at gate {name} in iteration {N}"; release lock; do NOT increment counters (SPEC-0020 REQ "Prior-Gate-Stop Honor") |
| 11 | qmd unreachable for **2 consecutive** iterations | Halt with the ADR-0024 remediation message; the wrapped skill signals via stderr token `qmd-unreachable` OR exit code `EX_QMD_UNREACHABLE=78`; any successful iteration resets `qmd_failures_consecutive` to 0 (SPEC-0020 REQ "qmd-Unreachable Stop") |
| 12 | `dollars_estimate >= max_dollars` (and `max_dollars > 0`) | "Cost budget reached: $X / $Y"; `--max-dollars 0` disables the stop but `dollars_estimate` is still tracked (SPEC-0020 REQ "Cost Budget Stop") |

Condition #2 (terminal PR state) does NOT apply to `/sdd:work` — it is a `/sdd:review --loop --pr <N>` condition.

### qmd-unreachable detection protocol

The wrapped skill signals qmd-unreachable using either of these signals (per SPEC-0020 REQ "qmd-Unreachable Stop"):

1. **Stderr sentinel**: a line on stderr containing the literal token `qmd-unreachable` (per `references/qmd-helpers.md` § "Error Handling")
2. **Reserved exit code**: `EX_QMD_UNREACHABLE = 78` (matches BSD `sysexits.h` `EX_CONFIG`)

The loop reads exit status first; on non-zero, scans stderr for the sentinel as a fallback. Either signal is sufficient. On detection, increment `qmd_failures_consecutive`. On any successful iteration, reset to 0. On increment to 2, condition #11 trips.

### AskUserQuestion gates

All gates are re-evaluated **on every tick** (per SPEC-0020 REQ "Gates Are Not Debounced Across Iterations") — the skill MUST NOT cache or reuse a prior iteration's answer to suppress a current iteration's gate. Each invocation is captured verbatim in the iteration's `gates[]` array per `references/loop-telemetry.md`.

| Gate | Trigger | Prompt template | Options |
|------|---------|-----------------|---------|
| **Backlog Drift** | Unblocked-issue snapshot differs from the prior iteration's recorded snapshot | "Backlog changed since last iteration. Re-propose the next batch?" | `re-propose`, `continue`, `stop` |
| **Ambiguous Criteria** | Issue lacks `### Acceptance Criteria` OR section contains TBD/TODO markers | "Issue #{N} has ambiguous criteria. Skip, escalate, or proceed with my best interpretation?" | `skip`, `escalate`, `proceed`, `stop` |
| **Budget Escalation (80%)** | One or more active budgets cross 80% on this tick | "Approaching {budget(s)} ({used}/{total} each). Continue, raise ceiling(s), or stop?" — combined into a single prompt across all simultaneously-tripped budgets | `continue`, `raise`, `stop` |
| **Force-Unlock** | `--lock=force` AND lockfile is present | "Force-unlock previous iteration's lock? This may corrupt in-flight work." | `yes`, `no`, `stop` |
| **Repeated Failure** | Same issue/PR failed in two consecutive iterations with the same root cause | "Issue/PR #{N} failed twice with: {root-cause}. Skip, retry once more, or stop the loop?" | `skip`, `retry`, `stop` |
| **Resume-Divergence** (resume only) | A `tracked_prs[]` entry's `head_sha_at_iteration_end` does not match the live remote HEAD | "PR #{N} has diverged since the prior iteration crashed — re-attach, skip, or stop the loop?" | `re-attach`, `skip`, `stop` |

Note: the **Post-Feedback Merge** gate is a `/sdd:review --loop` gate; it does NOT fire on the work side. Backlog-Drift is a work-side-only gate.

#### Multi-budget batching (gate 80%)

When two or more budgets cross 80% in the same tick, the gate fires **once** with a combined message listing every tripped budget (per SPEC-0020 REQ "Budget-Escalation Gate"). When any budget reaches 100% in the same tick that another crosses 80%, the **100%-stop wins** (conditions 3 / 4 / 5 / 12 take precedence) and the gate is suppressed. Pseudocode in `docs/openspec/specs/loop-autonomous-mode/design.md` § Multi-budget 80% gate batching.

### Concurrency invariants

`/sdd:work --loop` MUST NOT pick up an issue already labeled `in-progress` by a sibling iteration's worktree (per SPEC-0020 REQ "Concurrency Invariants for /sdd:work"). The check happens during workable-issue discovery in each iteration, before dispatch. The iteration MUST NOT clear or contest the label — it skips the issue and picks the next one.

This invariant is independent of the lockfile (which scopes "is another *iteration* running?"). The label invariant scopes "is this *issue* already being implemented somewhere?".

### Final report

When the loop halts for any reason, the wrapped skill MUST emit a final report **before** lockfile release (per SPEC-0020 REQ "Final Report on Stop"). The report covers:

- The stop cause (single line, machine-readable name + human prose)
- Total iterations used / max
- Total PRs touched (deduplicated count) / max
- Total minutes elapsed / max
- Total dollars estimated / max
- List of every gate fired with its answer (across all iterations)
- Path to `.sdd/loop/work.budget.json` and `.sdd/loop/work.history.jsonl` for further inspection

The lockfile is released **after** the report is emitted so a stale-lock reaper on a subsequent tick sees a complete telemetry trail.

### Post-PR Chain

<!-- Governing: ADR-0030 (Post-PR Chain Pattern in /sdd:work), ADR-0010 (bounded one-round invariant), ADR-0024 (qmd as Hard Dependency), SPEC-0020 REQ "Post-PR Chain Invocation", SPEC-0020 REQ "Chain Outcome Telemetry" -->

After each PR opened in an iteration, `/sdd:work` invokes the post-PR chain — a bounded architectural review pass (`/sdd:review`, exactly one round per ADR-0010) followed by an open-ended CI / conflict / comment maintenance pass (`/autofix-pr`, the Claude Code built-in). The chain is unconditional within an iteration unless `--no-chain` or `--dry-run` is set (per SPEC-0020 REQ "Post-PR Chain Invocation"). It also runs on single-shot `/sdd:work` invocations — not just under `--loop` — so single-PR sessions get the same autonomy benefit (per ADR-0030 sub-decision 1).

**This contract applies to both `--loop` and non-loop invocations** of `/sdd:work`. In non-loop mode, the worker that opens a PR follows the same chain — and the per-PR `history.jsonl` line still records the chain outcome fields (per SPEC-0020 REQ "Chain Outcome Telemetry"; the file is single-line in non-loop mode rather than appended).

#### Chain sequence (per PR)

For each PR a worker opens in an iteration:

1. **Check `--no-chain`**. If set: log "Chain skipped for PR #{N} (--no-chain)"; record `chain_invoked: false` in the iteration's `history.jsonl` line; **omit** `review_outcome`, `autofix_pr_invoked`, and `autofix_pr_invocation_status` (per SPEC-0020 REQ "Chain Outcome Telemetry"); proceed to next PR (or exit iteration body).
2. **Check `--dry-run`**. If set: log "Would invoke /sdd:review on PR #{N}, then /autofix-pr"; record `chain_invoked: false`; omit the per-stage fields; proceed.
3. **Invoke `/sdd:review`** on PR #{N}, scoped to exactly one architectural round (ADR-0010 invariant):
   - Reviewer evaluates the PR diff against acceptance criteria
   - If REQUEST_CHANGES: responder addresses, reviewer re-evaluates within the same round
   - Round closes with one of four outcomes: `"approve"`, `"changes-requested"` (resolved in round), `"needs-human"`, or `"errored"` (qmd / infrastructure failure)
4. **Branch on review outcome**:

   | Outcome | Behavior |
   |---------|----------|
   | `"approve"` | Proceed to step 5 (`/autofix-pr` invocation) |
   | `"changes-requested"` (resolved in round) | Proceed to step 5 |
   | `"needs-human"` | Apply the `needs-human-follow-up` label to PR #{N}; proceed to step 5 (the maintenance loop may still resolve CI flakes / conflicts independently of the architectural concern) |
   | `"errored"` | Apply the `chain-failed-pre-autofix` label to PR #{N}; **skip** step 5; record `autofix_pr_invoked: false`; **omit** `autofix_pr_invocation_status` (per SPEC-0020 REQ "Post-PR Chain Invocation"); proceed to next PR. The user can rerun `/sdd:review` after fixing the infrastructure issue (e.g., qmd unreachable per ADR-0024). |

5. **Check `/autofix-pr` availability**. The command is a Claude Code built-in (not a plugin-provided skill). Probe by attempting to introspect the runtime's available commands.
   - **Unavailable** (the build does not ship the command, or introspection returns "not found"): log a one-line warning ("`/autofix-pr` is not available in this Claude Code build — install or upgrade Claude Code to enable post-PR autofix chain"); open a tracker issue tagged `claude-code-version-required` (deduped per `/sdd:work` invocation — open at most one such issue per session); record `autofix_pr_invoked: false` and `autofix_pr_invocation_status: "unavailable"`; proceed to next PR. PR creation is NOT blocked.
   - **Available**: continue to step 6.

6. **Invoke `/autofix-pr`** on PR #{N} **fire-and-forget**: `/sdd:work` does NOT wait for `/autofix-pr` to terminate; the built-in runs in its own background lifecycle managed by Claude Code, watching CI failures, review comments, and merge conflicts, and pushing corrective commits until the PR merges or is closed. `/sdd:work` returns once the invocation is **accepted** (the command was parsed and the lifecycle started).
   - On accepted invocation: record `autofix_pr_invoked: true`, `autofix_pr_invocation_status: "accepted"`.
   - On invocation error (parse failure or other invocation-time error): record `autofix_pr_invoked: true`, `autofix_pr_invocation_status: "errored"`; emit a one-line warning. The PR is NOT blocked.

7. **Telemetry**. The iteration's `history.jsonl` line records the four chain fields per the canonical schema in `references/loop-telemetry.md`:

   ```json
   {
     "chain_invoked": true,
     "review_outcome": "approve",
     "autofix_pr_invoked": true,
     "autofix_pr_invocation_status": "accepted"
   }
   ```

   In non-loop mode, the same fields are still emitted (a non-loop `/sdd:work` writes a single-line `history.jsonl` for that invocation; this is the trade documented in ADR-0030 sub-decision 6 to keep telemetry shape uniform).

#### Failure modes (summary)

| Failure | Behavior |
|---------|----------|
| User passed `--no-chain` | Skip both invocations; record `chain_invoked: false` and omit per-stage fields. Legacy "open PR, stop" behavior. |
| User passed `--dry-run` | Log "would invoke" for both; skip both invocations; record `chain_invoked: false`. |
| `/sdd:review` returns `"approve"`, `"changes-requested"` (resolved in round), or `"needs-human"` | Proceed to `/autofix-pr` |
| `/sdd:review` returns `"errored"` (qmd unreachable per ADR-0024 sub-decision 2, or other infrastructure failure) | Apply `chain-failed-pre-autofix` label; skip `/autofix-pr`; record `autofix_pr_invoked: false`; omit `autofix_pr_invocation_status` |
| `/autofix-pr` unavailable in current Claude Code build | Log warning; open one tracker issue with `claude-code-version-required` label per `/sdd:work` session (deduped); exit cleanly. PR is NOT blocked. |
| `/autofix-pr` invocation parse error | Record `autofix_pr_invocation_status: "errored"`; one-line warning; PR NOT blocked. |

#### Concurrency under `--loop`

Each loop iteration's per-PR chain is a self-contained unit (per ADR-0030 sub-decision 5). When a worker opens N PRs in parallel within a single iteration, the chain runs once per PR, in parallel across workers (one chain per PR). The chain invocations are NOT serialized across the workers in a single iteration.

ADR-0028's gates (backlog drift, ambiguous criteria, budget escalation, force-unlock, repeated failure) fire **before** the chain — they decide whether to *start* the iteration. Once an iteration runs and a PR is opened, the chain is unconditional within that iteration unless `--no-chain` is set. There is no per-PR gate that interposes between PR creation and `/sdd:review`; the architectural review is the bounded round (ADR-0010), and the post-feedback-merge gate (`/sdd:review --loop` only) is the only human-mediated checkpoint that can pause the chain's eventual merge path.

#### Cost accounting

Each chain invocation is metered by its own tool's cost surface (per ADR-0030 sub-decision 6). `/sdd:work` does **not** double-count `/sdd:review`'s tokens or `/autofix-pr`'s tokens against its own budget; those costs accrue under the invoked command's accounting. What `/sdd:work` records in `history.jsonl` is the *event* of invocation (`chain_invoked`, `review_outcome`, `autofix_pr_invoked`) so users correlating cost spikes after the fact can map them back to the iteration that opened the PR. The chain is therefore visible in telemetry as an event but not as a token line item.

#### Why this preserves ADR-0010

`/sdd:review` is invoked **exactly once** by `/sdd:work` per PR (per chain invocation). The chain does NOT loop `/sdd:review`. A second architectural round on the same PR is forbidden by ADR-0010 and forbidden here. If the user wants another round, they invoke `/sdd:review` directly (or, under `--loop`, the next iteration's `/sdd:review --loop` invocation does its own one round on that PR).

#### Bootstrap note (V1)

This contract IS the implementation of the chain; before story #148 lands, `/sdd:work` opens a PR and stops (legacy behavior). Once #148 merges, the chain is the new default unless `--no-chain` is set.

### Resume

`--resume` recovers state from the most recent `history.jsonl` line per `references/loop-telemetry.md` § Resume Contract. Counters are restored; gate evaluations are recomputed; the lockfile is treated as stale per the PID-liveness rule; `tracked_prs[]` and `active_worktrees[]` are reconciled by SHA equality with no external probing substituted.

### Telemetry

Every iteration appends a line to `.sdd/loop/work.history.jsonl` and emits the stdout status block. Skipped ticks (lockfile contention) MUST also append a line with `outcome: "skipped_lock"` and MUST NOT increment `iterations_used`. Schema details in `references/loop-telemetry.md`.

### Loop Mode Rules

- MUST NOT modify the runtime `/loop` skill — re-invocation cadence is `/loop`'s concern; the wrapped skill enforces only intra-iteration semantics
- MUST acquire the lockfile on entry, before any other work, per `references/loop-primitives.md` § Acquisition flow
- MUST evaluate PID liveness as the **sole** staleness signal; worktree presence and team-membership state MUST NOT be consulted
- MUST persist the budget atomically (write-temp + rename) on every tick
- MUST record active ceilings on first write so `--resume` cannot silently widen them
- MUST deduplicate `prs_touched` (a PR re-touched across iterations counts once)
- MUST emit the stdout status block on every iteration including skipped ticks
- MUST append a `history.jsonl` line on every iteration including skipped ticks
- MUST NOT increment `iterations_used` for a skipped tick
- MUST NOT cache or reuse a prior iteration's gate answer; every gate is re-evaluated on every tick
- MUST refuse to start an iteration when any prior `gates[]` entry recorded `answer == "stop"` (condition #10)
- MUST NOT pick up issues labeled `in-progress` by a sibling iteration's worktree (concurrency invariant)
- MUST signal qmd unreachability via stderr token `qmd-unreachable` OR exit code `EX_QMD_UNREACHABLE=78` (the wrapped skill emits; the loop layer detects)
- MUST emit the final report **before** releasing the lockfile on any halt path
- MUST invoke the post-PR chain (per "Post-PR Chain" above) for every PR opened in an iteration unless `--no-chain` or `--dry-run` is set
- The post-PR chain MUST also run on **non-loop** `/sdd:work` invocations (single-shot mode); the chain is not gated by `--loop` (per ADR-0030 sub-decision 1)
- The chain MUST invoke `/sdd:review` exactly once per PR per chain invocation (preserves ADR-0010's bounded one-round invariant)
- WHEN `/sdd:review` exits with `review_outcome: "errored"` THEN MUST apply the `chain-failed-pre-autofix` label, MUST NOT invoke `/autofix-pr`, and MUST omit `autofix_pr_invocation_status` from the per-iteration telemetry
- WHEN `/sdd:review` exits with `"needs-human"` THEN MUST apply the `needs-human-follow-up` label AND proceed to `/autofix-pr` (the maintenance loop may resolve CI / conflicts independently)
- WHEN `/autofix-pr` is unavailable THEN MUST log a warning AND open a tracker issue with the `claude-code-version-required` label (deduped at one issue per session) AND exit cleanly (PR creation MUST NOT be blocked)
- The `/autofix-pr` invocation MUST be fire-and-forget — `/sdd:work` MUST NOT wait for `/autofix-pr` to terminate
- The chain MUST NOT be double-counted in `/sdd:work`'s budget — costs of `/sdd:review` and `/autofix-pr` accrue under their own tool accounting; `/sdd:work` records only the invocation events in `history.jsonl`
