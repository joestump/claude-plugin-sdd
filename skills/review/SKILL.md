<!-- Governing: ADR-0017, SPEC-0015 REQ "Conflict-Marker CI Gate" -->

---
name: review
description: Review and merge PRs produced by /sdd:work using reviewer-responder agent pairs. Use when the user says "review PRs", "review the spec PRs", or wants automated spec-aware code review.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Task, WebFetch, WebSearch, TeamCreate, TeamDelete, TaskCreate, TaskUpdate, TaskList, TaskGet, SendMessage, AskUserQuestion, ToolSearch
argument-hint: [SPEC-XXXX or PR numbers] [--pairs N] [--no-merge] [--dry-run] [--module <name>] [--loop [--pr N] [--max-iterations N] [--max-prs N] [--max-minutes N] [--max-dollars N] [--lock={skip|wait|force}] [--resume] [--budget-file PATH]]
---

<!-- Governing: ADR-0015 (Markdown-Native Configuration), SPEC-0014 REQ "Config Resolution Pattern" -->

# Review and Merge PRs

You are reviewing PRs produced by `/sdd:work` using reviewer-responder agent pairs. Each pair processes PRs through exactly one review-response round: the reviewer checks the diff against spec acceptance criteria, the responder addresses feedback, and the reviewer re-evaluates. Approved PRs are merged; unresolved PRs are left with comments for human follow-up. See ADR-0010 and SPEC-0009.

<!-- Governing: ADR-0028 (/loop Autonomous Mode), SPEC-0020 REQ "Lockfile Schema and Acquisition", SPEC-0020 REQ "Budget Schema and Persistence", SPEC-0020 REQ "Telemetry Schema", SPEC-0020 REQ "Resume Contract", SPEC-0020 REQ "Resume Contract Reconciliation" -->

> **Loop Mode (V1, opt-in).** When invoked under `/loop` with the `--loop` flag (and optionally `--pr <N>` for single-PR watch mode), this skill enters autonomous-mode and uses the lockfile + budget primitives documented in `references/loop-primitives.md` (acquired on entry, released on exit) and the telemetry + resume contract documented in `references/loop-telemetry.md` (every iteration appends a `history.jsonl` line; `--resume` reconciles `tracked_prs[]` via SHA equality with `head_sha_at_iteration_end`). The full CLI surface, the active stop conditions (#2 / #3 / #5 / #6 / #8 / #9 / #10 / #11 / #12, with #4 inactive in single-PR mode), and the review-side gates (ambiguous-criteria, budget-escalation, post-feedback-merge, force-unlock, repeated-failure — note: ADR-0010's bounded one-round invariant is preserved per iteration) are wired in story #145 (SPEC-0020). Without `--loop`, behavior is unchanged from the rest of this document and no `.sdd/loop/` artifacts are created.

## Process

<!-- Governing: ADR-0016 (Workspace Mode), SPEC-0014 REQ "Artifact Path Resolution" -->

0. **Resolve artifact paths**: Follow the **Artifact Path Resolution** pattern from `references/shared-patterns.md` to determine the spec directory. If `$ARGUMENTS` contains `--module <name>`, resolve paths relative to that module. The resolved spec directory is `{spec-dir}`.

1. **Parse arguments**: Parse `$ARGUMENTS`.

   **Target resolution:**
   - If a SPEC number is provided (e.g., `SPEC-0003`), find all open PRs whose branch names match the spec's issue branch patterns or whose bodies reference the spec number.
   - If PR numbers are provided (e.g., `101 102 105`), fetch exactly those PRs.
   - If `$ARGUMENTS` is empty (ignoring flags), list available specs by globbing `{spec-dir}/*/spec.md`, read the title from each, and use `AskUserQuestion` to ask which spec's PRs to review.

   **Flag parsing:**
   - `--pairs N`: Number of reviewer-responder pairs. Default: 2 (or CLAUDE.md `Review > Max Pairs`).
   - `--no-merge`: Approve PRs but do not merge them. Default: off.
   - `--dry-run`: Preview which PRs would be reviewed without taking any action. Default: off.
   - `--module <name>`: Resolve artifact paths relative to the named module. Default: none.

2. **Detect tracker**: Follow the "Tracker Detection" flow in the plugin's `references/shared-patterns.md`, but only GitHub, GitLab, and Gitea are supported (PR/MR capability required). If the saved tracker is Beads, Jira, or Linear, inform the user that `/sdd:review` requires a tracker with PR support.

3. **Discover target PRs**: Search the tracker for open PRs matching the target.
   - **GitHub**: `gh pr list --search "SPEC-XXXX" --json number,title,headRefName,body,url --limit 50` or `gh pr view {number} --json number,title,headRefName,body,url` for explicit PR numbers.
   - **Gitea**: Use MCP tools (discovered via `ToolSearch`) to list pull requests.
   - **GitLab**: Use MCP tools or `glab mr list --search "SPEC-XXXX"`.

   If no open PRs are found, inform the user and suggest running `/sdd:work` to create PRs from planned issues.

3a. **Conflict-marker CI gate** (Governing: ADR-0017, SPEC-0015 REQ "Conflict-Marker CI Gate"):

   Before any review logic runs, scan ALL files in every target PR diff for unresolved merge conflict markers. This is a zero-tolerance gate — any file type, any conflict marker means instant rejection.

   **For each target PR:**

   1. Fetch the full diff:
      - **GitHub**: `gh pr diff {number}`
      - **Gitea**: Use MCP tools (discovered via `ToolSearch`) to fetch the PR diff.
      - **GitLab**: Use MCP tools or `glab mr diff`.

   2. Scan every line of the diff for conflict markers: `<<<<<<<`, `=======`, `>>>>>>>`.

   3. **If ANY conflict markers are found:**
      - Collect all offending file paths and line numbers.
      - Submit a `REQUEST_CHANGES` review immediately:
        - **GitHub**: `gh api repos/{owner}/{repo}/pulls/{number}/reviews -f event=REQUEST_CHANGES -f body="..."` with the rejection message below.
        - **Gitea**: Use MCP tools (discovered via `ToolSearch`) to submit a review.
        - **GitLab**: Use MCP tools or `glab` CLI.
      - Rejection message:
        ```
        ## Conflict Markers Detected

        This PR contains unresolved merge conflict markers and cannot be reviewed.

        | File | Line(s) |
        |------|---------|
        | {file-path} | {line-numbers} |

        Please resolve all conflicts and push again.
        ```
      - **Skip this PR entirely** — do not proceed to architecture context loading or review for this PR. Report it as "Rejected: conflict markers" in the final summary.

   4. **If no conflict markers are found**, proceed to step 4 for this PR.

3c. **Tier 4 issues sync** (v5.0.0+):

   <!-- Governing: ADR-0026 (Tiered Index Freshness), SPEC-0019 REQ "Tier 4 Always-Sync Issues for Sprint Skills" -->

   Before computing the topological merge order (Step 11a) and before reviewers query for missing ADR/issue references (Step 4a), sync the `{repo}-issues` qmd collection from the tracker. Subject to the 5-min dedup window per `references/tracker-sync.md` § "Cursor Management".

   1. Read `.sdd/issues/_meta.json`. If `last_sync` is within the last 5 minutes, skip the sync silently.
   2. Otherwise, invoke per-tracker fetch+normalize per `references/tracker-sync.md`. Print: "Syncing N issues from {tracker}…".
   3. On sync failure, surface a one-line warning per `tracker-sync.md` § "Failure Modes and Degradation" and proceed with live tracker queries (the pre-v5 path) for this run. Do NOT block; PR review is the user's primary intent.

4. **Load architecture context** (Governing: SPEC-0009 REQ "Architecture Context Loading"):
   - If a spec identifier is provided or can be inferred from PR metadata (e.g., PR body contains "SPEC-XXXX"), read `spec.md`, `design.md`, and any referenced ADRs from the resolved spec directory. Validate spec pairing per `references/shared-patterns.md` § "Spec Pairing Validation".
   - If no governing spec can be inferred (e.g., PRs specified by number with no spec reference), proceed with general code review only and note in the report that spec compliance could not be verified.
   - This context will be sent to all reviewer agents.

4a. **qmd-aware missing-reference retrieval** (v5.0.0+):

   <!-- Governing: ADR-0024 (qmd as hard dependency), SPEC-0019 REQ "qmd-Smart Sprint Skills" -->

   Reviewers MUST search `{repo}-adrs` and `{repo}-issues` to identify ADRs the PR should reference and prior issues the PR touches. The point: a PR that modifies authentication code should reference the auth ADR (ADR-0011 in the SPEC-0019 example). Without a qmd assist, this requires the reviewer to remember the entire ADR/issue corpus. With qmd, the reviewer surfaces missing references as findings.

   For each PR being reviewed:

   1. Construct a hybrid query per `references/qmd-helpers.md` § "Hybrid Retrieval" derived from the PR's diff:
      - `lex`: keywords from the PR title + file path basenames + named symbols touched
      - `vec`: a one-sentence summary of what the PR changes
      - `intent: "/sdd:review — find ADRs and prior issues this PR should reference"`
      - `collections: ["{repo}-adrs", "{repo}-issues"]`
      - `limit: 8`, `minScore: 0.4`

   2. For each match above the threshold:
      - **ADR match**: Check whether the PR body or any modified file's governing comment block already references the matched ADR. If NOT, raise as a finding ("Should this PR reference ADR-{XXXX} ({title})?") with the relevant ADR section that suggests the connection.
      - **Issue match**: Check whether the PR body already references the matched issue (via `Closes #N`, `Fixes #N`, `Part of #N`, or `Related: #N`). If NOT, surface as informational note rather than a blocking finding ("PR appears related to open issue #{N} ({title}) — consider linking").

   3. Inject the missing-reference findings into the reviewer's review (alongside the spec-acceptance-criteria findings already in Step 9). Each finding cites the qmd retrieval evidence (matched ADR/issue ID + score) so the reviewer's responder can evaluate whether the connection is real.

   4. On qmd unreachable / timeout per `qmd-helpers.md` § "Error Handling", surface the error and stop. Per ADR-0024, no fallback in v5.

5. **Read review config from CLAUDE.md**: Follow the "Config Resolution" pattern in the plugin's `references/shared-patterns.md`. Read the `#### Review` subsection from the `### SDD Configuration` section in CLAUDE.md. Defaults: `Max Pairs`=2, `Merge Strategy`="squash", `Auto Cleanup`=false. CLI flags override: `--pairs N` overrides `Max Pairs`, `--no-merge` prevents merging.

6. **Dry-run gate**: If `--dry-run` is set, output a preview table and stop:

   ```
   ## Dry Run: /sdd:review SPEC-0003

   Would review {N} PRs using {pair-count} reviewer-responder pairs.

   | # | PR | Title | Branch | CI | Pair |
   |---|-----|-------|--------|-----|------|
   | 1 | #101 | JWT Token Generation | feature/42-jwt-token-generation | Pass | Pair 1 |
   | 2 | #102 | Token Validation | feature/43-token-validation | Pass | Pair 2 |
   | 3 | #103 | Token Refresh | feature/44-token-refresh | Fail | Skipped |

   No reviews submitted. No merges performed.
   ```

7. **Create team** (Governing: SPEC-0009 REQ "Team Formation"):

   **Adaptive pair count**: If the number of PRs is less than the configured pair count, reduce to `min(PR count, configured pairs)` to avoid idle agents. If only 1 PR, use 1 pair.

   Use `TeamCreate` to create a coordination team. Spawn agents:
   - N **reviewer** agents (`general-purpose`) — one per pair
   - N **responder** agents (`general-purpose`) — one per pair

   If `TeamCreate` fails, fall back to single-agent sequential mode: for each PR, review the diff against acceptance criteria, then address any issues directly (acting as both reviewer and responder). This mode skips the response round — if issues are found, leave review comments for human follow-up instead of auto-fixing.

8. **Distribute PRs** (Governing: SPEC-0009 REQ "PR Distribution"):

   Assign PRs to pairs using round-robin:
   - PR 1 → Pair 1, PR 2 → Pair 2, PR 3 → Pair 1, PR 4 → Pair 2, ...

   Create tasks via `TaskCreate` for each PR, assign to the appropriate pair.

9. **Phase 1 — Review** (Governing: SPEC-0009 REQ "Review Protocol"):

   Each reviewer receives their assigned PRs and processes them sequentially:

   **Reviewer steps:**
   1. Fetch the PR diff using the tracker's API or CLI.
   2. Read the linked issue body to extract acceptance criteria.
   3. **Check CI status**: Before reviewing the diff, verify all status checks are green:
      - **GitHub**: `gh pr checks {number}` or `gh pr view {number} --json statusCheckRollup` — ALL checks MUST pass.
      - **Gitea**: Use MCP tools (discovered via `ToolSearch`) to query commit status, or `GET /repos/{owner}/{repo}/commits/{sha}/status`.
      - **GitLab**: Use MCP tools or `glab ci status`.
      - If any checks are failing or pending, do NOT proceed with code review. Report to lead: "PR #{number} has failing CI checks — skipping review until checks pass." The lead should retry after checks complete or report it as blocked.
   4. Check the diff against:
      - Spec acceptance criteria (from the issue body's `## Requirements` or `## Acceptance Criteria` section)
      - Governing ADR compliance
      - General code quality (tests, regressions, clean diffs)
   5. Submit a review via the tracker's review API:
      - **GitHub**: `gh api` or MCP tools — submit review with event `APPROVE`, `COMMENT`, or `REQUEST_CHANGES`, including line-level comments where applicable.
      - **Gitea**: Use MCP tools (discovered via `ToolSearch`) to submit a pull request review.
      - **GitLab**: Use MCP tools or `glab` CLI to add review comments.
   6. If the PR is clean (no issues found), submit `APPROVE` and skip the response round for that PR.
   7. Report outcome to lead via `SendMessage`.

   **Review quality rules:**
   - Reviews MUST reference specific spec acceptance criteria or ADR decisions when identifying issues.
   - Reviews MUST NOT raise stylistic concerns that are not spec-relevant.
   - Line-level comments SHOULD be used for specific code issues.

10. **Phase 2 — Response** (Governing: SPEC-0009 REQ "Response Protocol"):

    For PRs that received `REQUEST_CHANGES`, the responder addresses feedback:

    **Responder steps:**
    1. **Locate or create worktree**: Check if a worktree from `/sdd:work` still exists at `.claude/worktrees/{branch-name}`. If so, reuse it (run `git pull` first). If not, create a new one: `git worktree add .claude/worktrees/{branch-name} {branch-name}`.
    2. Read each review comment from the tracker API.
    3. Make the requested code changes in the worktree.
    4. Commit with a descriptive message and push to the PR branch.
    5. Reply to each review comment indicating how it was addressed (e.g., "Fixed in commit abc1234") using the tracker's comment reply API.
    6. If a comment cannot be resolved (conflicting requirements, unclear feedback), reply explaining why and report to the lead.
    7. Report outcome to lead via `SendMessage`.

11. **Phase 3 — Re-evaluation and Merge** (Governing: SPEC-0009 REQ "Re-evaluation and Merge"):

    After the responder pushes fixes, the reviewer re-evaluates:

    1. Fetch the updated PR diff.
    2. **Re-check CI status**: Verify all status checks are green after the responder's push. If checks are failing, report as blocked (do not approve or merge).
    3. If all issues are addressed and CI is green, submit `APPROVE`.
    4. If unresolved issues remain or CI is failing, leave a summary comment listing what remains and report to the lead that the PR requires human follow-up.
    5. If approved and `--no-merge` is NOT set:
       - Merge the PR using the configured strategy (default: squash).
       - **GitHub**: `gh pr merge {number} --squash` (or `--merge` / `--rebase` per config).
       - **Gitea**: Use MCP tools (discovered via `ToolSearch`) to merge.
       - **GitLab**: Use MCP tools or `glab mr merge`.
       - The tracker's native close-on-merge behavior will automatically close the linked story issue.
    5a. **Tier 1 mutation update on merge** (v5.0.0+, Governing: ADR-0026, SPEC-0019 REQ "Tier 1 Mutation-Aware Updates"): After a successful merge, trigger narrow re-syncs of BOTH `{repo}-code` (the merge changed code) AND `{repo}-issues` (the linked story issue closed). Use the canonical update pattern from `references/qmd-helpers.md` § "Update Patterns". Best-effort and silent on success. On failure of either, append a one-line warning to the run log ("Index refresh failed for `{collection}` after merging PR #{N} — run `/sdd:index update` manually") but the merge itself is reported as successful.
    6. **Close parent epic if all stories are done**: After a successful merge, check whether the closed story's parent epic should also be closed:
       a. Parse the PR body for an epic reference (e.g., `Part of #XX` or the configured `Ref Keyword` from CLAUDE.md `PR Conventions`). If no epic reference is found, skip this step.
       b. Fetch the epic issue and extract its child story references. Read the `PR Conventions > Ref Keyword` from CLAUDE.md config (default: "Part of") and use it to find child issues:
          - **GitHub**: Search for open issues that reference the epic number in their body using the configured ref keyword (e.g., `{Ref Keyword} #{epic-number}`), or list issues in the same project/milestone.
          - **Gitea**: Use MCP tools (discovered via `ToolSearch`) to list issues referencing the epic with the configured ref keyword, or query the epic's milestone for open issues.
          - **GitLab**: Use MCP tools or `glab` CLI to find open issues referencing the epic with the configured ref keyword.
       c. If **all** child story issues are now closed (no open stories remain), close the epic issue:
          - **GitHub**: `gh issue close {epic-number}`
          - **Gitea**: Use MCP tools (discovered via `ToolSearch`) to close the issue.
          - **GitLab**: Use MCP tools or `glab issue close {epic-number}`.
          - Add a comment on the epic: "All child stories have been merged. Closing epic automatically."
       d. If some child stories are still open, do nothing — the epic remains open.
       e. Report epic closure (or not) to the lead via `SendMessage`.
    7. If approved and `--no-merge` IS set, report as "approved, pending manual merge".

12. **Cleanup and report** (Governing: SPEC-0009 REQ "Reporting"):

    **12.1: Shut down team.** Send `shutdown_request` to all agents via `SendMessage`.

    **12.2: Offer worktree cleanup.** If CLAUDE.md `Review > Auto Cleanup` is `true`, remove worktrees for successfully-processed PRs automatically. Otherwise, preserve them.

    **12.3: Final report.**

    ```
    ## Review Complete: SPEC-0003

    Reviewed {N} PRs using {pair-count} reviewer-responder pairs.

    ### Results

    | PR | Title | CI | Review | Merge | Status |
    |----|-------|----|--------|-------|--------|
    | #101 | JWT Token Generation | Pass | Approved | Merged (squash) | Complete |
    | #102 | Token Validation | Pass | Approved | Merged (squash) | Complete |
    | #103 | Token Refresh | Pass | Changes requested | — | Needs human follow-up |

    ### Needs Human Follow-up
    - **#103 Token Refresh**: Reviewer found unresolved issue after response round. Comment left on PR: "Token expiry edge case not covered by tests."

    ### Skipped (CI failing)
    - (none in this example)

    ### Epics
    - Closed: #50 Implement Auth Module (all 2 stories merged)
    - Still open: (none in this example)

    ### Worktrees
    - Reused: 2
    - Created: 1
    - Cleaned up: 0

    ### Next Steps
    - Review unresolved PR #103 and address remaining feedback
    - Run `/sdd:check` to verify implementation alignment
    - Run `/sdd:audit` for comprehensive drift analysis
    ```

## Error Handling

| Condition | Behavior |
|-----------|----------|
| Single PR review fails (API error) | Log failure, skip that PR, continue with remaining PRs |
| Merge conflict on merge | Report conflict, leave PR unmerged for human resolution |
| `TeamCreate` fails | Fall back to single-agent sequential mode |
| No open PRs found | Suggest `/sdd:work` to create PRs |
| No tracker detected | Error: tracker with PR/MR support is required |
| Responder cannot resolve feedback | Reply explaining why, report to lead, leave for human |
| Push fails during response | Responder reports error, PR skipped for that round |
| Worktree in unexpected state | `git pull` and verify correct branch; if unrecoverable, create fresh worktree |
| CI checks failing or pending | Skip review for that PR; report as blocked until checks pass |
| CI checks pass after re-evaluation but code issues remain | Report as "CI green, code changes requested" — do not merge |
| Epic closure fails (API error) | Log warning, report in final summary — epic remains open for manual closure |
| Cannot determine parent epic from PR body | Skip epic closure check for that PR — no error |
| Conflict markers detected in PR diff | Reject with REQUEST_CHANGES listing file paths and line numbers; skip all further review for that PR |

## Rules

- MUST load spec and design context before dispatching reviewers
- MUST use `ToolSearch` to discover tracker MCP tools at runtime — never assume specific tools are available
- MUST follow the Config Resolution pattern from `references/shared-patterns.md` to read configuration from CLAUDE.md
- MUST use round-robin distribution across pairs (Governing: SPEC-0009 REQ "PR Distribution")
- MUST limit to exactly one review-response round per PR — no unbounded iteration (Governing: ADR-0010)
- Reviewers MUST reference spec acceptance criteria in their reviews — not just style (Governing: SPEC-0009 REQ "Review Protocol")
- Reviewers MUST NOT raise stylistic concerns that are not spec-relevant
- Responders MUST reuse existing worktrees from `/sdd:work` when available (Governing: SPEC-0009 REQ "Response Protocol")
- Responders MUST reply to each review comment with how it was addressed
- MUST only merge PRs that have been approved by the reviewer
- MUST NOT merge PRs when `--no-merge` is set
- MUST check for parent epic closure after every successful merge — if all child stories under the epic are closed, close the epic automatically
- MUST NOT close an epic if any child story is still open
- Default merge strategy is squash — configurable via CLAUDE.md `Review > Merge Strategy`
- MUST report all failures with actionable details — never silently skip (Governing: SPEC-0009 REQ "Error Handling")
- `--dry-run` MUST NOT submit reviews, push commits, or merge PRs
- Adaptive pair count: reduce pairs to min(PR count, configured pairs) for small batches
- When `TeamCreate` fails, MUST fall back to single-agent sequential mode — never error out
- MUST verify all CI/CD status checks (GitHub Actions, Gitea Actions, GitLab CI) are green before reviewing a PR — never review a PR with failing checks
- MUST re-verify CI status after responder pushes fixes — never merge with failing checks
- MUST NOT merge a PR unless ALL status checks are passing
- This skill reads CLAUDE.md configuration but MUST NOT write to it (consumer, not producer) (Governing: SPEC-0009 REQ "Configuration Persistence")
- MUST scan ALL files in every PR diff for conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`) before any review logic runs (Governing: SPEC-0015 REQ "Conflict-Marker CI Gate")
- MUST reject PRs with conflict markers using REQUEST_CHANGES with file paths and line numbers — zero tolerance, any file type
- MUST skip all further review (architecture context loading, spec compliance, code quality) for PRs rejected by the conflict-marker gate
- Conflict-marker gate runs before CI checks — a PR with conflict markers is rejected even if CI is green
- **v5.0.0+**: MUST trigger Tier 4 issues sync on entry per Step 3c — sync from tracker before Step 4a (qmd-aware missing-reference retrieval) and Step 11a (topological merge order). On failure, fall back to live queries with a warning, never block (Governing: ADR-0026, SPEC-0019 REQ "Tier 4 Always-Sync Issues for Sprint Skills")
- **v5.0.0+**: Reviewers MUST run qmd-aware missing-reference retrieval per Step 4a — qmd-search `{repo}-adrs` and `{repo}-issues` for ADRs and prior issues the PR should reference; surface missing ADR refs as findings (with citation), surface missing issue refs as informational notes (Governing: ADR-0024, SPEC-0019 REQ "qmd-Smart Sprint Skills")
- **v5.0.0+**: After successful merge, MUST trigger Tier 1 updates of BOTH `{repo}-code` AND `{repo}-issues` per Step 11.5a — best-effort, silent on success, one-line warnings on failure (Governing: ADR-0026, SPEC-0019 REQ "Tier 1 Mutation-Aware Updates")

## Loop Mode (autonomous)

<!-- Governing: ADR-0028 (/loop Autonomous Mode for /sdd:work and /sdd:review), ADR-0010 (Parallel PR Review and Response Skill), SPEC-0020 REQ "Loop Mode Opt-In", REQ "CLI Surface for Loop Controls", REQ "Terminal-PR Stop", REQ "Iteration Budget Stop", REQ "Wall-Clock Budget Stop", REQ "Cost Budget Stop", REQ "PR-Touch Budget Stop", REQ "Repeated-Failure Stop", REQ "User Interrupt Stop", REQ "Lockfile Contention Skip", REQ "Prior-Gate-Stop Honor", REQ "qmd-Unreachable Stop", REQ "Concurrency Invariants for /sdd:review", REQ "Ambiguous-Acceptance-Criteria Gate", REQ "Budget-Escalation Gate", REQ "Post-Feedback-Merge Gate", REQ "Force-Unlock Gate", REQ "Repeated-Failure Gate", REQ "Single-PR Review Loop Semantics", REQ "ADR-0010 Bounded-Iteration Preservation", REQ "Final Report on Stop" -->

When `/sdd:review` is invoked under `/loop` with the `--loop` flag (e.g. `/loop /sdd:review --loop` or `/loop /sdd:review --loop --pr 142`), the skill enters autonomous-mode and follows the contract below on every tick. Without `--loop`, the skill behaves exactly as the rest of this document specifies and creates **no** `.sdd/loop/` artifacts (per SPEC-0020 REQ "Loop Mode Opt-In").

The runtime `/loop` skill is unchanged. `--loop` is a skill-side opt-in. `/loop` schedules ticks; everything inside a tick is the wrapped skill's concern. **ADR-0010's bounded one-round invariant is preserved verbatim**: each iteration executes exactly one review-response round per PR; loop iteration MUST NOT amount to multiple review-response rounds on the same PR within one iteration (per SPEC-0020 REQ "ADR-0010 Bounded-Iteration Preservation").

### CLI surface

When `--loop` is set, `/sdd:review` accepts the following additional flags. All shared loop flags carry the documented conservative defaults; `--pr <N>` is review-specific (per SPEC-0020 REQ "CLI Surface for Loop Controls"). Budgets are inclusive **across the entire loop run**, not per-iteration.

| Flag | Default | Purpose |
|------|---------|---------|
| `--loop` | off | Opt into autonomous-mode |
| `--max-iterations N` | 5 | Iteration ceiling across the run |
| `--max-prs N` | 20 | Distinct-PR ceiling across the run (inactive in single-PR mode — see "Single-PR Review Loop Semantics") |
| `--max-minutes N` | 60 | Wall-clock ceiling across the run |
| `--max-dollars N` | 25 | Dollar-cost ceiling; `0` disables condition #12 (estimate still tracked) |
| `--lock={skip\|wait\|force}` | `skip` | Concurrency mode on lockfile contention |
| `--resume` | off | Recover state from the most recent `history.jsonl` line |
| `--budget-file PATH` | `.sdd/loop/review.budget.json` | Override the budget-file location |
| `--pr N` | none | Single-PR watch mode — see "Single-PR Review Loop Semantics" below |

The first write of `budget.json` records the active ceilings (per `references/loop-primitives.md` § First-write rule) so a later `--resume` cannot silently widen them.

### Per-tick flow

Each tick follows this canonical flow:

1. **Acquire lockfile** at `.sdd/loop/review.lock` per `references/loop-primitives.md` § Acquisition flow (skip / wait / force per `--lock`).
2. **Read budget** from `.sdd/loop/review.budget.json`; on first write, initialize ceilings, `started_at`, and `rate_table_source`.
3. **Evaluate stop conditions on entry** (see "Stop conditions" below). Any matching condition halts the loop, emits the final report, and releases the lockfile.
4. **Run the gate block** (see "AskUserQuestion Gates" below).
5. **Discover or fetch the target PR(s)** — the existing flow (Steps 3–11 above) runs as the iteration body, scoped to either the discovered PR set (multi-PR mode) or the single PR named by `--pr` (single-PR mode).
6. **Apply the head-SHA concurrency invariant** (see below) — defer review of any PR whose remote HEAD matches the prior iteration's recorded `head_sha_at_iteration_end`.
7. **Run the review round** for each non-deferred PR — exactly one round per PR per iteration (ADR-0010 invariant).
8. **Before merging an APPROVED PR**, evaluate the **Post-Feedback-Merge** gate (see below).
9. **Update budget** — increment `iterations_used`, `comments_pushed` (top-level + replies both count, per SPEC-0020 REQ "Budget Schema — comments_pushed Definition"), `merges_attempted`, `agents_dispatched`, `tokens_in`/`tokens_out`, recompute `dollars_estimate`, evaluate exit-time stop conditions 3 / 5 / 12 (and #4 in multi-PR mode).
10. **Emit telemetry** — append a line to `.sdd/loop/review.history.jsonl` (per `references/loop-telemetry.md`) and emit the stdout status block.
11. **Release lockfile** and let `/loop` schedule the next tick.

### Stop conditions

Active stop conditions for `/sdd:review --loop`. Note: condition #1 (backlog empty) and #7 (dependency cycle) are work-side-only.

| # | Condition | Behavior |
|---|-----------|----------|
| 2 | Target PR reaches a terminal state (merged, closed, or labeled with the project's configured do-not-merge label) — single-PR mode only | Halt with "PR #{N} reached terminal state: {state}"; release lock; do NOT signal another tick (SPEC-0020 REQ "Terminal-PR Stop") |
| 3 | `iterations_used >= max_iterations` (entry-time check) | `stop_conditions_fired: ["iteration_budget"]` (SPEC-0020 REQ "Iteration Budget Stop") |
| 4 | `len(prs_touched) >= max_prs` — **inactive in single-PR mode** (see "Single-PR Review Loop Semantics") | `stop_conditions_fired: ["prs_touched_budget"]` for multi-PR mode (SPEC-0020 REQ "PR-Touch Budget Stop") |
| 5 | `minutes_elapsed >= max_minutes` (clock anchored at `started_at`, persists across `--resume`) | `stop_conditions_fired: ["wall_clock_budget"]` (SPEC-0020 REQ "Wall-Clock Budget Stop") |
| 6 | Same PR failed twice consecutively with the same root cause | Fire the **Repeated-Failure** gate (does NOT silently halt) (SPEC-0020 REQ "Repeated-Failure Stop") |
| 8 | User interrupt (Ctrl-C / session close / explicit `/loop stop`) | Drain in-flight responder pushes, release lock, emit final report, no half-states (SPEC-0020 REQ "User Interrupt Stop") |
| 9 | Lockfile holds a live PID under `--lock=skip` | Emit one-line skip note; do NOT increment counters (SPEC-0020 REQ "Lockfile Contention Skip"). `--lock=wait` blocks bounded by `max_minutes`; `--lock=force` fires the Force-Unlock gate. |
| 10 | Any prior `gates[]` entry recorded `answer == "stop"` | "Loop already stopped at gate {name} in iteration {N}"; release lock; do NOT increment counters (SPEC-0020 REQ "Prior-Gate-Stop Honor") |
| 11 | qmd unreachable for **2 consecutive** iterations | Halt with the ADR-0024 remediation message; the wrapped skill signals via stderr token `qmd-unreachable` OR exit code `EX_QMD_UNREACHABLE=78`; any successful iteration resets `qmd_failures_consecutive` to 0 (SPEC-0020 REQ "qmd-Unreachable Stop") |
| 12 | `dollars_estimate >= max_dollars` (and `max_dollars > 0`) | "Cost budget reached: $X / $Y"; `--max-dollars 0` disables but `dollars_estimate` is still tracked (SPEC-0020 REQ "Cost Budget Stop") |

### qmd-unreachable detection protocol

Identical contract as `/sdd:work --loop`. The wrapped skill signals qmd-unreachable using either of these signals (per SPEC-0020 REQ "qmd-Unreachable Stop"):

1. **Stderr sentinel**: a line on stderr containing the literal token `qmd-unreachable`
2. **Reserved exit code**: `EX_QMD_UNREACHABLE = 78`

The loop reads exit status first; on non-zero, scans stderr for the sentinel as a fallback. On detection, increment `qmd_failures_consecutive`. On any successful iteration, reset to 0. On increment to 2, condition #11 trips.

### AskUserQuestion gates

All gates are re-evaluated **on every tick** (per SPEC-0020 REQ "Gates Are Not Debounced Across Iterations") — the skill MUST NOT cache or reuse a prior iteration's answer. Each invocation is captured verbatim in the iteration's `gates[]` array per `references/loop-telemetry.md`.

The review-side gate set is:

| Gate | Trigger | Prompt template | Options |
|------|---------|-----------------|---------|
| **Ambiguous Criteria** | The PR's underlying issue lacks `### Acceptance Criteria` OR contains TBD/TODO markers | "Issue #{N} has ambiguous criteria. Skip, escalate, or proceed with my best interpretation?" | `skip`, `escalate`, `proceed`, `stop` |
| **Budget Escalation (80%)** | One or more active budgets cross 80% on this tick. **In single-PR mode**, the gate evaluates only `max_iterations`, `max_minutes`, and `max_dollars` and MUST NOT mention `prs_touched`. | "Approaching {budget(s)} ({used}/{total} each). Continue, raise ceiling(s), or stop?" | `continue`, `raise`, `stop` |
| **Post-Feedback Merge** | The responder addressed *human* review comments (login is not an agent identity) since the previous iteration AND the loop is about to merge | "Responder addressed human feedback on PR #{N}. Merge now or hold for human re-review?" | `merge`, `hold`, `stop` |
| **Force-Unlock** | `--lock=force` AND lockfile is present | "Force-unlock previous iteration's lock? This may corrupt in-flight work." | `yes`, `no`, `stop` |
| **Repeated Failure** | Same PR failed in two consecutive iterations with the same root cause | "Issue/PR #{N} failed twice with: {root-cause}. Skip, retry once more, or stop the loop?" | `skip`, `retry`, `stop` |
| **Resume-Divergence** (resume only) | A `tracked_prs[]` entry's `head_sha_at_iteration_end` does not match the live remote HEAD | "PR #{N} has diverged since the prior iteration crashed — re-attach, skip, or stop the loop?" | `re-attach`, `skip`, `stop` |

Note: **Backlog-Drift** is a `/sdd:work --loop` gate; it does NOT fire on the review side.

#### Multi-budget batching (gate 80%)

When two or more budgets cross 80% in the same tick, the gate fires **once** with a combined message listing every tripped budget. When any budget reaches 100% in the same tick that another crosses 80%, the **100%-stop wins** (conditions 3 / 5 / 12 — and 4 in multi-PR mode) and the gate is suppressed.

In single-PR mode, the gate's combined message MUST NOT mention `prs_touched` regardless of `--max-prs` (per SPEC-0020 REQ "Single-PR Review Loop Semantics").

#### Why the Post-Feedback-Merge gate exists

ADR-0010 caps each `/sdd:review` invocation at exactly one review-response round per PR. Across loop iterations, a sequence of approve → next-iteration could approximate "infinite review rounds" if the responder kept pushing fixes. The Post-Feedback-Merge gate breaks that approximation by inserting a human-mediated checkpoint when **human** review comments (not sibling-agent reviewer comments) have been addressed. This preserves ADR-0010's bounded-iteration invariant under loop wrapping.

The gate's "human vs. agent" detection compares the comment author's tracker login against a list of known agent identities (configurable in the future; for V1, treat the loop's own session identity and the configured `### SDD Configuration > Agent Logins` list as agent identities — everyone else is human).

### Concurrency invariants (head-SHA defer)

`/sdd:review --loop` MUST NOT submit a new review on a PR whose previous-iteration responder has not yet pushed fixes (per SPEC-0020 REQ "Concurrency Invariants for /sdd:review"). The check is **SHA equality alone**:

```
recorded_sha = last_history_line.tracked_prs[#PR].head_sha_at_iteration_end
current_sha  = git ls-remote origin {pr.branch} | head -1
if recorded_sha == current_sha:
    defer review of this PR with the spec-quoted note:
    "PR #{N}: no new commits since iteration {M} (head_sha_at_iteration_end matches remote HEAD)"
```

Out-of-band signals (e.g., responder commentary about fixes being incoming) MUST NOT be used. CI mid-flight is NOT a lock-contention condition; it remains under the existing per-PR CI gate (skip until green) — see Step 9.3 above.

### Single-PR Review Loop Semantics

When `--pr <N>` is provided, the loop watches a single PR across iterations (per SPEC-0020 REQ "Single-PR Review Loop Semantics"):

- `prs_touched` MUST be informational and MUST remain `["#N"]` for the life of the run
- Condition #4 (PR-touch budget) MUST be **inactive**
- Active stop conditions are: #2 (terminal PR), #3 (iterations), #5 (minutes), #6 (repeated failure), #8 (interrupt), #9 (lock), #10 (prior gate stop), #11 (qmd), #12 (dollars)
- `comments_pushed` and `merges_attempted` MUST remain visible counters — uncapped by default, reported on every tick in the status block
- The Budget-Escalation 80% gate MUST evaluate only `max_iterations`, `max_minutes`, and `max_dollars` and MUST NOT mention `prs_touched`

Single-PR mode is the canonical "watch this PR until it merges" shape. Multi-PR mode (no `--pr`) is the "review whatever is in the discovered PR set" shape and uses the full active-condition set.

### ADR-0010 bounded-iteration preservation

The single most-important invariant the review-side loop preserves: **each `/sdd:review` invocation MUST still execute exactly one review-response round per PR within the iteration** (per SPEC-0020 REQ "ADR-0010 Bounded-Iteration Preservation"). The reviewer evaluates, the responder addresses (if REQUEST_CHANGES), the reviewer re-evaluates. After that round closes, the iteration moves on or stops. A second architectural round on the same PR within the same iteration is forbidden by ADR-0010 and forbidden here.

Across iterations, the **Post-Feedback-Merge** gate (above) is the only path that could otherwise approximate "infinite review rounds" — and it is human-mediated rather than agentic. The user explicitly approves each merge that follows a human-feedback-addressed iteration.

### Final report

When the loop halts for any reason, the wrapped skill MUST emit a final report **before** lockfile release (per SPEC-0020 REQ "Final Report on Stop"). The report covers:

- The stop cause (single line, machine-readable name + human prose)
- Total iterations used / max
- In multi-PR mode: total PRs touched (deduplicated count) / max. In single-PR mode: total comments pushed and merges attempted (informational, no max).
- Total minutes elapsed / max
- Total dollars estimated / max
- List of every gate fired with its answer (across all iterations)
- Path to `.sdd/loop/review.budget.json` and `.sdd/loop/review.history.jsonl` for further inspection

### Resume

`--resume` recovers state from the most recent `history.jsonl` line per `references/loop-telemetry.md` § Resume Contract. Counters are restored; gate evaluations are recomputed; the lockfile is treated as stale per the PID-liveness rule; `tracked_prs[]` is reconciled by SHA equality (silent re-attach on match, resume-divergence gate on mismatch, skip on terminal state) — no external probing substituted.

### Telemetry

Every iteration appends a line to `.sdd/loop/review.history.jsonl` and emits the stdout status block. Skipped ticks (lockfile contention) MUST also append a line with `outcome: "skipped_lock"` and MUST NOT increment `iterations_used`. Schema details in `references/loop-telemetry.md`.

### Loop Mode Rules

- MUST NOT modify the runtime `/loop` skill — re-invocation cadence is `/loop`'s concern; the wrapped skill enforces only intra-iteration semantics
- MUST acquire the lockfile on entry, before any other work, per `references/loop-primitives.md` § Acquisition flow
- MUST evaluate PID liveness as the **sole** staleness signal
- MUST persist the budget atomically (write-temp + rename) on every tick
- MUST record active ceilings on first write so `--resume` cannot silently widen them
- In multi-PR mode, MUST deduplicate `prs_touched` (a PR re-reviewed across iterations counts once)
- In single-PR mode, MUST keep `prs_touched == ["#N"]` for the life of the run; condition #4 MUST NOT fire
- MUST emit the stdout status block on every iteration including skipped ticks
- MUST append a `history.jsonl` line on every iteration including skipped ticks
- MUST NOT increment `iterations_used` for a skipped tick
- MUST NOT cache or reuse a prior iteration's gate answer; every gate is re-evaluated on every tick
- MUST refuse to start an iteration when any prior `gates[]` entry recorded `answer == "stop"` (condition #10)
- MUST defer review of any PR whose remote HEAD matches the prior iteration's `head_sha_at_iteration_end` (head-SHA concurrency invariant; SHA equality is the sole verification rule)
- MUST NOT treat CI mid-flight as lock contention — that stays under the existing per-PR CI gate
- MUST signal qmd unreachability via stderr token `qmd-unreachable` OR exit code `EX_QMD_UNREACHABLE=78` (the wrapped skill emits; the loop layer detects)
- MUST count BOTH top-level review comments AND reply-to-comment messages in `comments_pushed` (per SPEC-0020 REQ "Budget Schema — comments_pushed Definition")
- MUST fire the Post-Feedback-Merge gate before invoking the merge API when the responder addressed *human* review comments since the prior iteration; only `merge` invokes the merge API
- MUST execute exactly one review-response round per PR per iteration (ADR-0010 invariant; never multiple rounds on the same PR within one iteration)
- MUST emit the final report **before** releasing the lockfile on any halt path
