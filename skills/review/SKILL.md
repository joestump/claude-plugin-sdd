---
name: review
description: Review and merge PRs produced by /design:work using reviewer-responder agent pairs. Use when the user says "review PRs", "review the spec PRs", or wants automated spec-aware code review.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Task, WebFetch, WebSearch, TeamCreate, TeamDelete, TaskCreate, TaskUpdate, TaskList, TaskGet, SendMessage, AskUserQuestion, ToolSearch
argument-hint: [SPEC-XXXX or PR numbers] [--pairs N] [--no-merge] [--dry-run] [--module <name>]
---

<!-- Governing: ADR-0015 (Markdown-Native Configuration), SPEC-0014 REQ "Config Resolution Pattern" -->

# Review and Merge PRs

You are reviewing PRs produced by `/design:work` using reviewer-responder agent pairs. Each pair processes PRs through exactly one review-response round: the reviewer checks the diff against spec acceptance criteria, the responder addresses feedback, and the reviewer re-evaluates. Approved PRs are merged; unresolved PRs are left with comments for human follow-up. See ADR-0010 and SPEC-0009.

## Process

<!-- Governing: ADR-0016 (Workspace Mode), SPEC-0014 REQ "Artifact Path Resolution" -->

0. **Resolve artifact paths**: Follow the **Artifact Path Resolution** pattern from `references/shared-patterns.md` to determine the spec directory. If `$ARGUMENTS` contains `--module <name>`, resolve paths relative to that module. The resolved spec directory is `{spec-dir}`.

1. **Parse arguments**: Parse `$ARGUMENTS`.

   **Target resolution:**
   - If a SPEC number is provided (e.g., `SPEC-0003`), find all open PRs whose branch names match the spec's issue branch patterns or whose bodies reference the spec number.
   - If PR numbers are provided (e.g., `101 102 105`), fetch exactly those PRs.
   - If `$ARGUMENTS` is empty (ignoring flags), list available specs by globbing `{spec-dir}/*/spec.md`, read the title from each, and use `AskUserQuestion` to ask which spec's PRs to review.

   **Flag parsing:**
   - `--pairs N`: Number of reviewer-responder pairs (default 2). Read CLAUDE.md `Review > Max Pairs` as fallback default.
   - `--no-merge`: Approve PRs but do not merge them. Leave for manual merge.
   - `--dry-run`: Preview which PRs would be reviewed without taking any action.

2. **Detect tracker**: Follow the "Tracker Detection" flow in the plugin's `references/shared-patterns.md`, but only GitHub, GitLab, and Gitea are supported (PR/MR capability required). If the saved tracker is Beads, Jira, or Linear, inform the user that `/design:review` requires a tracker with PR support.

3. **Discover target PRs**: Search the tracker for open PRs matching the target.
   - **GitHub**: `gh pr list --search "SPEC-XXXX" --json number,title,headRefName,body,url --limit 50` or `gh pr view {number} --json number,title,headRefName,body,url` for explicit PR numbers.
   - **Gitea**: Use MCP tools (discovered via `ToolSearch`) to list pull requests.
   - **GitLab**: Use MCP tools or `glab mr list --search "SPEC-XXXX"`.

   If no open PRs are found, inform the user and suggest running `/design:work` to create PRs from planned issues.

4. **Load architecture context** (Governing: SPEC-0009 REQ "Architecture Context Loading"):
   - If a spec identifier is provided or can be inferred from PR metadata (e.g., PR body contains "SPEC-XXXX"), read `spec.md`, `design.md`, and any referenced ADRs from the resolved spec directory.
   - If no governing spec can be inferred (e.g., PRs specified by number with no spec reference), proceed with general code review only and note in the report that spec compliance could not be verified.
   - This context will be sent to all reviewer agents.

5. **Read review config from CLAUDE.md**: Follow the "Config Resolution" pattern in the plugin's `references/shared-patterns.md`. Read the `#### Review` subsection from the `### Design Plugin Configuration` section in CLAUDE.md. Defaults: `Max Pairs`=2, `Merge Strategy`="squash", `Auto Cleanup`=false. CLI flags override: `--pairs N` overrides `Max Pairs`, `--no-merge` prevents merging.

6. **Dry-run gate**: If `--dry-run` is set, output a preview table and stop:

   ```
   ## Dry Run: /design:review SPEC-0003

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

   If `TeamCreate` fails, fall back to single-agent sequential mode: review each PR, address feedback, and optionally merge, all in the main session.

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
    1. **Locate or create worktree**: Check if a worktree from `/design:work` still exists at `.claude/worktrees/{branch-name}`. If so, reuse it (run `git pull` first). If not, create a new one: `git worktree add .claude/worktrees/{branch-name} {branch-name}`.
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
    6. **Close parent epic if all stories are done**: After a successful merge, check whether the closed story's parent epic should also be closed:
       a. Parse the PR body for an epic reference (e.g., `Part of #XX` or the configured `Ref Keyword` from CLAUDE.md `PR Conventions`). If no epic reference is found, skip this step.
       b. Fetch the epic issue and extract its child story references. Identify child stories by:
          - **GitHub**: Search for open issues that reference the epic number in their body (`Part of #{epic-number}`), or list issues in the same project/milestone.
          - **Gitea**: Use MCP tools (discovered via `ToolSearch`) to list issues referencing the epic, or query the epic's milestone for open issues.
          - **GitLab**: Use MCP tools or `glab` CLI to find open issues referencing the epic.
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
    - Run `/design:check` to verify implementation alignment
    - Run `/design:audit` for comprehensive drift analysis
    ```

## Error Handling

| Condition | Behavior |
|-----------|----------|
| Single PR review fails (API error) | Log failure, skip that PR, continue with remaining PRs |
| Merge conflict on merge | Report conflict, leave PR unmerged for human resolution |
| `TeamCreate` fails | Fall back to single-agent sequential mode |
| No open PRs found | Suggest `/design:work` to create PRs |
| No tracker detected | Error: tracker with PR/MR support is required |
| Responder cannot resolve feedback | Reply explaining why, report to lead, leave for human |
| Push fails during response | Responder reports error, PR skipped for that round |
| Worktree in unexpected state | `git pull` and verify correct branch; if unrecoverable, create fresh worktree |
| CI checks failing or pending | Skip review for that PR; report as blocked until checks pass |
| CI checks pass after re-evaluation but code issues remain | Report as "CI green, code changes requested" — do not merge |
| Epic closure fails (API error) | Log warning, report in final summary — epic remains open for manual closure |
| Cannot determine parent epic from PR body | Skip epic closure check for that PR — no error |

## Rules

- MUST load spec and design context before dispatching reviewers
- MUST use `ToolSearch` to discover tracker MCP tools at runtime — never assume specific tools are available
- MUST follow the Config Resolution pattern from `references/shared-patterns.md` to read configuration from CLAUDE.md
- MUST use round-robin distribution across pairs (Governing: SPEC-0009 REQ "PR Distribution")
- MUST limit to exactly one review-response round per PR — no unbounded iteration (Governing: ADR-0010)
- Reviewers MUST reference spec acceptance criteria in their reviews — not just style (Governing: SPEC-0009 REQ "Review Protocol")
- Reviewers MUST NOT raise stylistic concerns that are not spec-relevant
- Responders MUST reuse existing worktrees from `/design:work` when available (Governing: SPEC-0009 REQ "Response Protocol")
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
