<!-- Governing: ADR-0017 (Parallel Agent Coordination), SPEC-0015 REQ "Parallelism Limits" -->

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
   - `--max-agents N`: Maximum concurrent worker agents (default 4). Read CLAUDE.md `Worktrees > Max Agents` as fallback default.
   - `--draft`: Create draft PRs instead of regular PRs. Default is regular (non-draft) PRs. Read CLAUDE.md `Worktrees > PR Mode` as fallback.
   - `--dry-run`: Preview what would happen without creating worktrees or doing any work. Report the list of issues, branch names, and agent assignments, then stop.
   - `--no-tests`: Skip test execution in workers.

2. **Load architecture context** (when a spec is provided or issues reference a spec): Read the spec's `spec.md` and `design.md`. Scan for referenced ADRs (e.g., `ADR-0001`) and read those too. This context will be sent to every worker. If no spec is associated with the selected issues, skip this step — workers will rely on issue body and codebase context alone.

3. **Detect tracker**: Follow the "Tracker Detection" flow in the plugin's `references/shared-patterns.md`. Fallback to `tasks.md` parsing if no tracker is found.

4. **Discover workable issues**: Search the tracker for open issues:
   - If a **spec** was provided: find all open issues referencing that spec.
   - If **issue numbers** were provided: fetch those specific issues.
   - If **no arguments** were provided: fetch all open, non-epic issues across the tracker (or the configured project/milestone scope in CLAUDE.md `Projects` if present).

   **Filtering rules:**
   - **Skip epics**: Issues labeled `epic` or titled "Implement ..." are grouping issues, not implementation work.
   - **Skip issues without `### Branch` sections**: These lack branch naming conventions. If any are found, suggest `/design:enrich` to add them and report which issues were skipped.
   - **Extract branch names**: Parse the `### Branch` section from each issue body to get the deterministic branch name (e.g., `feature/42-jwt-token-generation`).
   - **Extract PR conventions**: Parse the `### PR Convention` section for close keywords and epic references.
   - **Detect dependency ordering**: If issue bodies reference dependencies or logical ordering, respect that order when queuing work. For **Gitea**, query native dependencies via `GET /repos/{owner}/{repo}/issues/{index}/dependencies` (or via MCP tools discovered by `ToolSearch`) to find unblocked stories. (Governing: SPEC-0011 REQ "Gitea Native Dependencies")

   If no workable issues are found after filtering, report why and suggest `/design:plan` (no issues at all) or `/design:enrich` (issues exist but lack branch sections).

5. **Dry-run gate**: If `--dry-run` is set, output a preview table and stop:

   ```
   ## Dry Run: /design:work [SPEC-0003 | issue batch]

   Would create {N} worktrees with up to {max-agents} parallel agents.

   | # | Issue | Branch | Status |
   |---|-------|--------|--------|
   | 1 | #42 JWT Token Generation | feature/42-jwt-token-generation | Ready |
   | 2 | #43 Token Validation | feature/43-token-validation | Ready |
   | 3 | #44 Token Refresh | feature/44-token-refresh | Blocked (depends on #42) |
   | 4 | #47 Setup Auth Module | feature/47-setup-auth-module | Skipped (no ### Branch) |

   ### Skipped Issues
   - #45 Implement Auth Service (epic — skipped)
   - #47 Setup Auth Module (no ### Branch section — run `/design:enrich`)

   No changes were made.
   ```

6. **Verify git state**:
   - Run `git status` to check for uncommitted changes. If there are uncommitted changes, use `AskUserQuestion` to ask:
     - "You have uncommitted changes. Continue anyway, or commit first?"
     - Options: "Continue anyway" / "Stop so I can commit"
     - If the user says stop, halt and report.
   - Run `git fetch` to ensure we have the latest remote state.

7. **Read worktree config from CLAUDE.md**: Follow the "Config Resolution" pattern in the plugin's `references/shared-patterns.md`. Read the `#### Worktrees` subsection from the `### Design Plugin Configuration` section in CLAUDE.md. Defaults: `Base Dir`=`.claude/worktrees/`, `Max Agents`=3, `Auto Cleanup`=false, `PR Mode`="ready". CLI flags override config values.

7a. **Resolve parallelism limit** (Governing: SPEC-0015 REQ "Parallelism Limits", ADR-0017 Layer 1):

   Determine the maximum number of concurrent agents using this precedence order (highest to lowest):
   1. `--max-agents N` CLI flag (if provided)
   2. CLAUDE.md `## Design Plugin Configuration` section, key `max-parallel-agents` (if present)
   3. `.claude-plugin-design.json` `worktrees.max_agents` (if present)
   4. Default: **4**

   **Reading from CLAUDE.md:** Scan the project's `CLAUDE.md` for a `## Design Plugin Configuration` section. Look for a line matching `- **Max parallel agents**: N` or `max-parallel-agents: N`. Parse the integer value. Example:
   ```markdown
   ## Design Plugin Configuration

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

8. **Create team**: Use `TeamCreate` to create a coordination team. The lead (you) manages the task queue and monitors progress. Spawn up to the resolved parallelism limit (from step 7a) worker agents using `Task` with `subagent_type: "general-purpose"`.

   If `TeamCreate` fails, fall back to single-agent sequential mode: work through each issue one at a time in the main session using `git worktree add` for each.

9. **Create worktrees and assign work**: For each workable issue (respecting dependency order and max-agents concurrency):

   **9.1: Create the worktree.**
   ```bash
   git worktree add .claude/worktrees/{branch-name} -b {branch-name}
   ```
   Use the base directory from CLAUDE.md `Worktrees > Base Dir` if set, otherwise `.claude/worktrees/`.

   **9.2: Create a task** using `TaskCreate` for each issue, with the issue details, branch name, and worktree path.

   **9.3: Assign to a worker** using `TaskUpdate` with the worker's name as `owner`. Send the worker a message via `SendMessage` with all context needed to implement the issue.

10. **Worker implementation protocol**: Each worker receives and follows this protocol:

    **Worker receives:**
    - Issue number, title, and full body (with acceptance criteria)
    - Branch name (from `### Branch` section)
    - PR convention (from `### PR Convention` section)
    - Spec content (spec.md) — if a spec was resolved for this issue; omitted otherwise
    - Design content (design.md) — if a spec was resolved; omitted otherwise
    - ADR content (any referenced ADRs) — if a spec was resolved; omitted otherwise
    - Worktree absolute path
    - Whether to run tests (`--no-tests` flag)
    - PR mode (`draft` or `ready`)

    **Worker steps:**
    1. All file operations use the worktree absolute path (read, write, edit, glob, grep).
    2. Read the issue body and understand the acceptance criteria.
    3. Explore existing code in the worktree to understand the codebase structure.
    3a. **Broadcast file claims.** Before modifying any file, the worker MUST broadcast to all sibling workers via `SendMessage`:
        ```
        FILE_CLAIM: #{issue-number} claiming {file-path}
        ```
        This notifies siblings that this file is being modified and they should avoid it or coordinate.
    3b. **Broadcast type/function creation.** After creating any new type, struct, interface, or shared helper function, the worker MUST broadcast:
        ```
        TYPE_CREATED: #{issue-number} created {TypeName} in {file-path}
        ```
        Siblings receiving this MUST import from the specified location rather than creating their own version.
    3c. **Handle incoming broadcasts.** Workers MUST listen for broadcasts from siblings:
        - On receiving `FILE_CLAIM` for a file they also plan to modify: send `CONFLICT_ALERT: #{my-issue} also needs {file-path}` to the claiming worker and the lead, then wait for coordination instructions from the lead.
        - On receiving `TYPE_CREATED` for a type they need: import from the specified location instead of creating a duplicate. Send `TYPE_IMPORTED: #{my-issue} will import {TypeName} from {file-path}` to acknowledge.
    4. Implement changes to satisfy the acceptance criteria.
    5. If spec context was provided, leave governing comments in the code:
       ```
       // Governing: SPEC-XXXX REQ "Requirement Name"
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
    11. Report outcome to lead via `SendMessage`: success (with PR URL and list of bundled issues) or failure (with details).

11. **Monitor and queue**: The lead tracks worker progress (Governing: SPEC-0015 REQ "Parallelism Limits"):
    - **Enforce parallelism cap**: Never exceed the resolved `max-parallel-agents` limit from step 7a. Track the count of active agents at all times.
    - When a worker finishes, check if there are queued issues waiting.
    - If queued issues have dependency requirements, check if dependencies are now satisfied.
    - Assign the next available issue to the freed worker, maintaining up to `max-parallel-agents` active agents.
    - If a worker reports failure, note it and continue with other issues. The freed slot is available for queued work.
    - **Handle bundle requests**: When a worker sends a `BUNDLE_REQUEST`, check the issue queue for additional issues that could be bundled into the same branch. If available (and not blocked by dependencies), assign them to the same worker with instructions to implement in the same worktree before creating a PR. If the queue is exhausted or all remaining issues are blocked, tell the worker to proceed with the small PR as-is.
    - **Queue status reporting**: After each agent completion or queue change, log the current state: "Active: {N}/{limit}, Queued: {Q}, Completed: {C}, Failed: {F}"

12. **Cleanup and report**: After all issues are processed:

    **12.1: Shut down team.** Send `shutdown_request` to all workers via `SendMessage`.

    **12.2: Offer worktree cleanup.** If CLAUDE.md `Worktrees > Auto Cleanup` is `true`, remove worktrees for successfully-PRed issues automatically. Otherwise, use `AskUserQuestion`:
    - "Remove worktrees for completed issues? (Failed issue worktrees are always preserved.)"
    - Options: "Yes, clean up" / "No, keep them"
    - If yes: `git worktree remove .claude/worktrees/{branch-name}` for each successful issue.

    **12.3: Final report.**

    ```
    ## Work Complete: [SPEC-0003 | issue batch]

    Implemented {N} of {M} issues using {agent-count} parallel agents.

    ### Results

    | Issue | Branch | PR | Status |
    |-------|--------|----|--------|
    | #42 JWT Token Generation | feature/42-jwt-token-generation | #101 | Success |
    | #43 Token Validation | feature/43-token-validation | #102 | Success |
    | #44 Token Refresh | feature/44-token-refresh | — | Failed: tests failing |

    ### Failed Issues
    - **#44 Token Refresh**: Tests failing after 2 fix attempts. Worktree preserved at `.claude/worktrees/feature/44-token-refresh` for manual pickup. Error: `TokenRefreshService.refresh() returns expired token in test_refresh_expired`.

    ### Worktrees
    - Cleaned up: 2
    - Preserved (failed): 1

    ### Next Steps
    - Run `/design:review` for automated spec-aware PR review and merge
    - Fix failing issue #44 manually or re-run `/design:work 44`
    - Run `/design:check` to verify implementation alignment
    - Run `/design:audit` for comprehensive drift analysis
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
| No workable issues found | Suggest `/design:plan` (no issues at all) or `/design:enrich` (issues exist but lack `### Branch`) |
| Uncommitted changes in main tree | Ask user whether to continue or commit first |
| `git worktree add` fails (branch exists) | Check if the branch already exists remotely. If so, use `git worktree add .claude/worktrees/{branch-name} {branch-name}` (without `-b`) to check out the existing branch |
| Push fails (remote rejection) | Worker reports the error to lead; worktree preserved |
| PR creation fails | Worker reports the error to lead; branch is still pushed, user can create PR manually |
| Tracker not available | Suggest `/design:plan` to create issues first |
| Issue has no acceptance criteria | Worker uses the issue title and body as guidance, warns in PR description |

## Rules

- A spec is NOT required — `/design:work` can operate from the backlog alone
- When no arguments are provided, MUST analyze the backlog and propose a batch to the user before starting any work
- MUST read spec.md and design.md before dispatching workers only when a spec is provided or resolvable from issue bodies
- MUST use `ToolSearch` to discover tracker MCP tools at runtime — never assume specific tools are available
- MUST follow the Config Resolution pattern from `references/shared-patterns.md` to read configuration from CLAUDE.md
- MUST extract branch names from issue bodies — never invent branch names
- MUST skip epics (labeled `epic` or titled "Implement ...") — only work on implementation issues
- MUST skip issues without `### Branch` sections and suggest `/design:enrich`
- MUST respect dependency ordering when queuing work
- MUST create regular (non-draft) PRs by default — only create draft PRs with `--draft`
- MUST leave governing comments (`// Governing: SPEC-XXXX REQ "..."`) in implemented code when spec context is available; omit when there is no spec
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
- MUST NOT spawn more than `max-parallel-agents` concurrent agents (default: 4); resolve from CLI flag → CLAUDE.md → `.claude-plugin-design.json` → default (Governing: SPEC-0015 REQ "Parallelism Limits", ADR-0017 Layer 1)
- MUST read `## Design Plugin Configuration` from CLAUDE.md for `max-parallel-agents` setting before falling back to `.claude-plugin-design.json` or default
- MUST queue excess stories when more are ready than the parallelism limit allows, starting them as active agents complete
- MUST report active agent count and queue depth to the user before starting work ("Starting N of M ready stories (Q queued, max-parallel-agents: limit)")
- Workers MUST broadcast `FILE_CLAIM` via `SendMessage` before modifying any file
- Workers MUST broadcast `TYPE_CREATED` via `SendMessage` after creating new types, structs, interfaces, or shared helpers
- Workers receiving `TYPE_CREATED` MUST import the type rather than creating a duplicate
- Workers receiving `FILE_CLAIM` for a file they also need MUST send `CONFLICT_ALERT` and wait for lead coordination
