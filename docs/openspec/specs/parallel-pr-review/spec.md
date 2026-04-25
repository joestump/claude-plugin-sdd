# SPEC-0009: Parallel PR Review and Response

## Overview

A skill that automates the PR review-and-merge cycle by organizing agents into reviewer-responder pairs. After `/sdd:work` produces draft PRs, `/sdd:review` discovers them, assigns each PR to a reviewer-responder pair, and runs exactly one review-response round. Approved PRs are merged; unresolved PRs are left with comments for human follow-up. See ADR-0010.

## Requirements

### Requirement: PR Discovery

The `/sdd:review` skill SHALL accept either a spec identifier or explicit PR numbers to determine which PRs to process. Discovery MUST use the same tracker detection flow as `/sdd:plan` (SPEC-0007).

#### Scenario: Discovery by spec number

- **WHEN** a user runs `/sdd:review SPEC-0003`
- **THEN** the skill SHALL search for open PRs whose branch names match the spec's issue branch patterns (e.g., `feature/{N}-{slug}`) or whose bodies reference the spec number, and SHALL include all matching PRs in the review queue

#### Scenario: Discovery by PR numbers

- **WHEN** a user runs `/sdd:review 101 102 105`
- **THEN** the skill SHALL fetch exactly those PRs from the tracker and include them in the review queue

#### Scenario: No argument provided

- **WHEN** a user runs `/sdd:review` with no arguments (ignoring flags)
- **THEN** the skill SHALL list available specs by globbing `docs/openspec/specs/*/spec.md`, reading each title, and using `AskUserQuestion` to let the user choose

#### Scenario: No open PRs found

- **WHEN** no open PRs match the target
- **THEN** the skill SHALL inform the user and suggest running `/sdd:work` to create PRs from planned issues

### Requirement: Tracker Detection

The skill SHALL detect the user's tracker using the same detection flow as `/sdd:plan` (SPEC-0007, Requirement: Tracker Detection). The skill MUST check `.claude-plugin-design.json` for a saved tracker preference before running detection.

#### Scenario: Saved preference available

- **WHEN** `.claude-plugin-design.json` exists with a `"tracker"` key and the tracker is still available
- **THEN** the skill SHALL use the saved tracker and configuration directly without prompting

#### Scenario: No tracker detected

- **WHEN** no tracker is detected
- **THEN** the skill SHALL inform the user that a tracker is required for PR review and exit

### Requirement: Architecture Context Loading

The skill SHALL load the governing spec and ADR context before dispatching reviewers, so that reviews can verify spec compliance.

#### Scenario: Spec and design loaded

- **WHEN** a spec identifier is provided or can be inferred from PR metadata
- **THEN** the skill SHALL read `spec.md`, `design.md`, and any referenced ADRs from the resolved spec directory, and SHALL provide this context to all reviewer agents

#### Scenario: No spec context available

- **WHEN** PRs are specified by number and no governing spec can be inferred from their bodies
- **THEN** the skill SHALL proceed with general code review only and SHALL note in the report that spec compliance could not be verified

### Requirement: Team Formation

The skill SHALL create a team of reviewer and responder agents organized into pairs. The default configuration SHALL be 2 pairs (4 agents total). The pair count MUST be configurable.

#### Scenario: Default team formation

- **WHEN** a user runs `/sdd:review SPEC-0003` without `--pairs`
- **THEN** the skill SHALL create 2 reviewer agents and 2 responder agents, forming 2 pairs

#### Scenario: Custom pair count

- **WHEN** a user runs `/sdd:review SPEC-0003 --pairs 1`
- **THEN** the skill SHALL create 1 reviewer and 1 responder, forming 1 pair

#### Scenario: Adaptive pair count

- **WHEN** the number of PRs to review is less than 2
- **THEN** the skill SHALL reduce to 1 pair regardless of the `--pairs` setting to avoid idle agents

#### Scenario: Team creation failure

- **WHEN** `TeamCreate` fails
- **THEN** the skill SHALL fall back to single-agent sequential mode: review each PR, address feedback, and optionally merge, all in the main session

### Requirement: PR Distribution

The skill SHALL distribute PRs across reviewer-responder pairs using round-robin assignment.

#### Scenario: Round-robin assignment

- **WHEN** 5 PRs are queued and 2 pairs are available
- **THEN** Pair 1 SHALL receive PRs 1, 3, 5 and Pair 2 SHALL receive PRs 2, 4

#### Scenario: Single PR

- **WHEN** only 1 PR is queued
- **THEN** Pair 1 SHALL receive that PR and Pair 2 SHALL remain idle (or not be spawned per the adaptive pair count requirement)

### Requirement: Review Protocol

Each reviewer agent SHALL read the PR diff, check it against the governing spec's acceptance criteria, and submit a formal review via the tracker's review API.

#### Scenario: GitHub review submission

- **WHEN** the tracker is GitHub
- **THEN** the reviewer SHALL use `gh api` or MCP tools to submit a PR review with event `COMMENT`, `APPROVE`, or `REQUEST_CHANGES`, including line-level comments where applicable

#### Scenario: Gitea review submission

- **WHEN** the tracker is Gitea
- **THEN** the reviewer SHALL use MCP tools (discovered via `ToolSearch`) to submit a pull request review

#### Scenario: GitLab MR review

- **WHEN** the tracker is GitLab
- **THEN** the reviewer SHALL use MCP tools or `glab` CLI to add review comments to the merge request

#### Scenario: Review content

- **WHEN** a reviewer submits a review
- **THEN** the review MUST reference specific spec acceptance criteria or ADR decisions when identifying issues, and MUST NOT raise stylistic concerns that are not spec-relevant

#### Scenario: Clean PR

- **WHEN** a reviewer finds no spec compliance issues or code quality problems
- **THEN** the reviewer SHALL submit an `APPROVE` review and skip the response round for that PR

### Requirement: Response Protocol

Each responder agent SHALL address the reviewer's feedback by checking out the PR branch, making fixes, pushing commits, and replying to review comments.

#### Scenario: Worktree reuse

- **WHEN** a worktree from `/sdd:work` still exists for the PR's branch
- **THEN** the responder SHALL reuse that worktree instead of creating a new one

#### Scenario: New worktree creation

- **WHEN** no existing worktree is found for the PR's branch
- **THEN** the responder SHALL create a new worktree using `git worktree add .claude/worktrees/{branch-name} {branch-name}`

#### Scenario: Addressing feedback

- **WHEN** the responder receives review comments
- **THEN** the responder SHALL read each comment, make the requested code changes in the worktree, commit with a descriptive message, and push to the PR branch

#### Scenario: Replying to comments

- **WHEN** the responder pushes fix commits
- **THEN** the responder SHALL reply to each review comment indicating how it was addressed (e.g., "Fixed in commit abc1234") using the tracker's comment reply API

#### Scenario: Unable to address feedback

- **WHEN** the responder cannot resolve a review comment (e.g., conflicting requirements, unclear feedback)
- **THEN** the responder SHALL reply to the comment explaining why it could not be resolved, and SHALL report this to the lead agent

### Requirement: Re-evaluation and Merge

After the responder addresses feedback, the reviewer SHALL re-evaluate the PR. If satisfied, the PR SHALL be approved and merged (unless `--no-merge` is set).

#### Scenario: Approved after response

- **WHEN** the reviewer re-reads the updated diff and finds all issues addressed
- **THEN** the reviewer SHALL submit an `APPROVE` review

#### Scenario: Not approved after response

- **WHEN** the reviewer re-reads the updated diff and finds unresolved issues
- **THEN** the reviewer SHALL leave a summary comment listing what remains unresolved, and SHALL report to the lead that the PR requires human follow-up

#### Scenario: Merge on approval

- **WHEN** a PR is approved and `--no-merge` is NOT set
- **THEN** the lead agent SHALL merge the PR using the tracker's merge API with the configured merge strategy (default: squash)

#### Scenario: No-merge mode

- **WHEN** a PR is approved and `--no-merge` IS set
- **THEN** the lead agent SHALL NOT merge the PR but SHALL report it as "approved, pending manual merge"

#### Scenario: Merge strategy configuration

- **WHEN** `.claude-plugin-design.json` contains `review.merge_strategy`
- **THEN** the skill SHALL use the configured strategy (`squash`, `merge`, or `rebase`) instead of the default `squash`

#### Scenario: Issue closure on merge

- **WHEN** a PR is merged and the PR body contains a close keyword (e.g., `Closes #42`)
- **THEN** the tracker SHALL automatically close the linked story issue via its native close-on-merge behavior

### Requirement: Epic Closure on Story Completion

After a successful merge, the skill SHALL check whether the parent epic should be closed. If all child story issues under an epic are closed, the epic SHALL be closed automatically.

#### Scenario: All stories merged — epic closed

- **WHEN** a PR is merged, the linked story issue is closed, and all other story issues under the same parent epic are also closed
- **THEN** the skill SHALL close the parent epic issue and add a comment indicating automatic closure

#### Scenario: Some stories still open — epic remains open

- **WHEN** a PR is merged and the linked story issue is closed, but other story issues under the same parent epic are still open
- **THEN** the skill SHALL NOT close the parent epic

#### Scenario: No epic reference in PR

- **WHEN** a PR is merged but the PR body contains no epic reference (no `Part of #XX` or configured `ref_keyword`)
- **THEN** the skill SHALL skip the epic closure check for that PR without error

#### Scenario: Epic closure failure

- **WHEN** an attempt to close an epic fails (API error, permission issue)
- **THEN** the skill SHALL log a warning and include the failure in the final report, leaving the epic open for manual closure

### Requirement: Dry Run Mode

The skill SHALL support a `--dry-run` flag that previews which PRs would be reviewed without taking any action.

#### Scenario: Dry run output

- **WHEN** a user runs `/sdd:review SPEC-0003 --dry-run`
- **THEN** the skill SHALL list all matching PRs with their numbers, titles, branch names, and pair assignments, without creating a team, submitting reviews, or merging anything

### Requirement: Configuration Persistence

The skill SHALL read review configuration from `.claude-plugin-design.json`. The skill SHALL NOT write to `.claude-plugin-design.json` (it is a consumer, not a producer of configuration).

#### Scenario: Review config schema

- **WHEN** `.claude-plugin-design.json` contains a `review` section
- **THEN** the skill SHALL read `review.max_pairs` (default 2), `review.merge_strategy` (default "squash"), and `review.auto_cleanup` (default false) and apply them

#### Scenario: No review config

- **WHEN** `.claude-plugin-design.json` does not contain a `review` section
- **THEN** the skill SHALL use defaults: 2 pairs, squash merge, no auto-cleanup

### Requirement: Reporting

The skill SHALL produce a summary report after all PRs are processed.

#### Scenario: Report contents

- **WHEN** the review cycle completes
- **THEN** the skill SHALL report: number of PRs reviewed, number approved and merged, number approved but not merged (if `--no-merge`), number requiring human follow-up, any failures, and worktree cleanup status

### Requirement: Error Handling

The skill SHALL handle individual PR failures gracefully without stopping the entire operation.

#### Scenario: Single PR failure

- **WHEN** a reviewer or responder encounters an error on a specific PR (e.g., API failure, merge conflict)
- **THEN** the skill SHALL log the failure with the PR number and error details, skip that PR, and continue processing remaining PRs

#### Scenario: Merge conflict

- **WHEN** a merge is attempted but fails due to conflicts
- **THEN** the skill SHALL report the conflict and leave the PR unmerged for human resolution
