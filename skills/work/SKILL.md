<!-- Governing: ADR-0017 (Parallel Agent Coordination), ADR-0020 (Governing Comments), SPEC-0015 REQ "Issue Lifecycle Labels", SPEC-0015 REQ "Pre-Flight PR Awareness", SPEC-0015 REQ "Topological Merge Ordering", SPEC-0015 REQ "Design Document Isolation" -->

---
name: work
description: Pick up tracker issues and implement them in parallel using git worktrees. Use when the user says "work on issues", "implement the spec", "start coding", or wants agents to build from planned issues.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Task, WebFetch, WebSearch, TeamCreate, TeamDelete, TaskCreate, TaskUpdate, TaskList, TaskGet, SendMessage, AskUserQuestion, ToolSearch, EnterWorktree
argument-hint: [SPEC-XXXX | issue numbers | (empty = propose from backlog)] [--max-agents N] [--draft] [--dry-run] [--no-tests] [--module <name>]
---

<!-- Governing: ADR-0015 (Markdown-Native Configuration), SPEC-0014 REQ "Config Resolution Pattern" -->

# Work on Issues

You are picking up tracker issues and implementing them in parallel using git worktrees. Each issue gets its own worktree and worker agent.

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
    3a. **Coordinate with sibling workers** (Governing: SPEC-0015 REQ "Pre-Flight PR Awareness"). Follow the "Worker Communication Protocol" in `references/shared-patterns.md`. Before modifying any file:
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
