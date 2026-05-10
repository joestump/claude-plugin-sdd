---
status: draft
date: 2026-05-10
implements: [ADR-0028]
requires: [SPEC-0015]
extends: [SPEC-0009]
---

# SPEC-0020: /loop Autonomous Mode for /sdd:work and /sdd:review

## Overview

Defines how `/sdd:work` and `/sdd:review` cooperate with the runtime `/loop` skill so users can grind a backlog (or watch a single PR) autonomously without losing the user-in-the-loop preference. The contract is opt-in via a `--loop` flag on each skill: the runtime re-invokes the skill, and the skill enforces stop conditions, concurrency, user-prompt gates, budget ceilings, and inter-iteration telemetry. `/loop` itself is unchanged.

This spec realizes ADR-0028 by translating its sub-decisions into RFC 2119 requirements. It covers the CLI surface for both skills, the twelve stop conditions (iteration / PR / wall-clock / dollar budgets, repeated failure, dependency cycle, user interrupt, lockfile contention, qmd-unreachable, and prior-gate stop), the lock-and-skip concurrency model with PID liveness as the sole staleness signal, the six `AskUserQuestion` gates (backlog drift, ambiguous criteria, budget escalation, post-feedback merge, force-unlock, repeated failure), the on-disk artifacts (`.sdd/loop/{skill}.lock`, `.budget.json`, `.history.jsonl`), the resume contract for crash recovery, and the single-PR `/sdd:review --loop --pr <N>` watch mode.

This spec is not web-facing. No public HTTP surface is created; ADR-0018 security-by-default does not apply. All artifacts are project-local under `.sdd/loop/` and treated as treat-as-secret by default per the sensitive-content note in this spec's "Telemetry Schema" requirement.

## Requirements

### Requirement: Loop Mode Opt-In

`/sdd:work` and `/sdd:review` MUST accept a `--loop` flag that opts into autonomous mode. The flag MUST be off by default; absence of the flag MUST preserve the pre-existing skill behavior unchanged. Loop mode MUST NOT modify the runtime `/loop` skill — re-invocation cadence remains `/loop`'s concern; everything inside an iteration is the wrapped skill's concern.

#### Scenario: User invokes the skill without --loop

- **WHEN** a user runs `/sdd:work SPEC-0019` with no `--loop` flag
- **THEN** the skill MUST behave exactly as it does today (single invocation, no lockfile, no budget file, no history line)
- **AND** the skill MUST NOT create `.sdd/loop/` or any artifact under it

#### Scenario: User invokes the skill with --loop under /loop

- **WHEN** a user runs `/loop /sdd:work --loop`
- **THEN** the runtime `/loop` MUST handle iteration scheduling
- **AND** the wrapped skill MUST enter the autonomous-mode contract (stop-condition evaluation, lockfile, budget, telemetry) on every tick

### Requirement: CLI Surface for Loop Controls

When `--loop` is set, both skills MUST accept the following flags. All flags MUST be optional with the documented conservative defaults.

| Flag | Applies to | Default | Purpose |
|------|-----------|---------|---------|
| `--max-iterations N` | both | 5 | Iteration ceiling across the loop run |
| `--max-prs N` | both | 20 | Distinct-PR ceiling across the loop run |
| `--max-minutes N` | both | 60 | Wall-clock ceiling across the loop run |
| `--max-dollars N` | both | 25 | Dollar-cost ceiling; `0` disables the cost ceiling |
| `--lock={skip\|wait\|force}` | both | `skip` | Concurrency mode on lockfile contention |
| `--resume` | both | off | Recover state from the most recent `history.jsonl` line |
| `--budget-file PATH` | both | `.sdd/loop/{skill}.budget.json` | Override the budget-file location |
| `--pr N` | review | none | Single-PR watch mode (see "Single-PR Review Loop Semantics") |

Budgets MUST be inclusive across the entire loop run, not per-iteration.

#### Scenario: Conservative defaults applied when no flags are passed

- **WHEN** a user runs `/loop /sdd:work --loop` with no budget flags
- **THEN** the skill MUST apply: `max_iterations=5`, `max_prs=20`, `max_minutes=60`, `max_dollars=25`, `lock=skip`
- **AND** these defaults MUST be recorded in `budget.json` on first write so resume cannot silently change them

#### Scenario: User widens a budget explicitly

- **WHEN** a user runs `/loop /sdd:work --loop --max-prs 50 --max-dollars 100`
- **THEN** the skill MUST honor those values
- **AND** the recorded `budget.json` MUST reflect them as the active ceilings

### Requirement: Backlog-Empty Stop (Condition #1)

`/sdd:work --loop` MUST stop when the filtered backlog (unblocked, unworked, in-scope issues) is empty on entry. The skill MUST emit a final report naming the empty queue as the stop cause and MUST release the lockfile.

#### Scenario: Loop run completes the backlog

- **WHEN** `/sdd:work --loop` enters iteration N and the discovery phase returns zero workable issues
- **THEN** the skill MUST stop the loop, emit a final report ("Backlog empty — N iterations used, M PRs touched"), and release the lockfile
- **AND** MUST NOT signal `/loop` to schedule another tick

### Requirement: Terminal-PR Stop (Condition #2)

`/sdd:review --loop --pr <N>` MUST stop when the target PR reaches a terminal state: merged, closed, or labeled with the project's configured do-not-merge label.

#### Scenario: PR is merged between iterations

- **WHEN** `/sdd:review --loop --pr 142` enters iteration N and PR #142's tracker state is `merged`
- **THEN** the skill MUST stop the loop and report "PR #142 reached terminal state: merged"
- **AND** MUST release the lockfile and not signal another tick

### Requirement: Iteration Budget Stop (Condition #3)

The loop MUST stop when `iterations_used >= max_iterations`. The check MUST run on entry to each tick, after lockfile acquisition and before the gate block. The recorded stop cause MUST be `iteration_budget`.

#### Scenario: Iteration ceiling reached

- **WHEN** `iterations_used` would become 6 on the 6th tick of a run with `max_iterations=5`
- **THEN** the skill MUST stop on entry to that tick and record `stop_conditions_fired: ["iteration_budget"]` in the final history line

### Requirement: PR-Touch Budget Stop (Condition #4)

The loop MUST stop when `len(prs_touched) >= max_prs`. The set MUST be deduplicated — a PR re-reviewed across two iterations counts once. For `/sdd:review --loop --pr <N>` the dimension MUST be inactive (see "Single-PR Review Loop Semantics") and MUST NOT trigger this stop.

#### Scenario: PR-touch ceiling reached mid-iteration

- **WHEN** `/sdd:work --loop --max-prs 5` would open a sixth distinct PR in an iteration
- **THEN** the skill MUST stop the iteration after the fifth PR opens, record the cause as `prs_touched_budget`, and not schedule another tick

#### Scenario: Single-PR review mode does not trigger this stop

- **WHEN** `/sdd:review --loop --pr 142` runs for ten iterations
- **THEN** `prs_touched` MUST remain `["#142"]` and MUST NOT trip condition #4

### Requirement: Wall-Clock Budget Stop (Condition #5)

The loop MUST stop when `minutes_elapsed >= max_minutes`. The clock MUST start at the recorded `started_at` in `budget.json` and MUST persist across `--resume`.

#### Scenario: Wall-clock ceiling reached

- **WHEN** `/sdd:review --loop --max-minutes 30` enters its 5th tick at minute 31 of the run
- **THEN** the skill MUST stop on entry and record `stop_conditions_fired: ["wall_clock_budget"]`

### Requirement: Repeated-Failure Stop (Condition #6)

The loop MUST detect when the same issue or PR has failed in two consecutive iterations with the same root-cause signature. On detection the skill MUST trigger the "Repeated Failure" `AskUserQuestion` gate (see "AskUserQuestion Gates") rather than silently halt. If the user answers `stop`, the loop halts; otherwise it continues per the user's choice.

#### Scenario: Same issue fails twice with the same error

- **WHEN** issue #44 fails iteration 2 with root cause "tests failing in module X" and fails iteration 3 with the same root cause
- **THEN** on iteration 3's exit the skill MUST fire the Repeated Failure gate naming #44 and the root cause
- **AND** the user's answer MUST be recorded in the next iteration's `gates[]` entry

### Requirement: Dependency-Cycle Stop (Condition #7)

`/sdd:work --loop` MUST stop when issue-dependency analysis (per SPEC-0015 Layer 2 machine-readable dependencies) detects a cycle in the workable backlog. The skill MUST surface the cycle's edges and request manual resolution; it MUST NOT attempt to break the cycle automatically.

#### Scenario: Two issues block each other

- **WHEN** `/sdd:work --loop` discovers that issue #50 has `Blocks: #51` and issue #51 has `Blocks: #50`
- **THEN** the skill MUST stop, emit "Dependency cycle detected: #50 ↔ #51 — please resolve manually"
- **AND** MUST NOT attempt to pick either issue

### Requirement: User Interrupt Stop (Condition #8)

The loop MUST honor user-initiated interrupts (Ctrl-C, session close, explicit `/loop stop`) by completing the current iteration's already-dispatched work without dispatching new work, then releasing the lockfile and emitting a final report. The interrupt MUST NOT leave half-states (orphaned worktrees from this iteration, dangling labels, partially-pushed branches).

#### Scenario: User presses Ctrl-C mid-iteration

- **WHEN** the user interrupts a `/sdd:work --loop` run while three workers are mid-implementation
- **THEN** the skill MUST allow the three in-flight workers to drain (push or report failure), release the lockfile, and emit a final report
- **AND** MUST NOT dispatch a fourth worker after the interrupt was received
- **AND** MUST NOT signal `/loop` to schedule another tick

### Requirement: Lockfile Contention Skip (Condition #9)

When the lockfile holds a live PID and `--lock` is `skip` (the default), the new iteration MUST skip with a one-line note ("Previous iteration N still active (pid {pid}) — skipping this tick") and MUST NOT advance any counters. When `--lock=wait`, the new iteration MUST block until the lock releases, bounded by `max_minutes`. When `--lock=force`, the skill MUST trigger the "Force-Unlock" `AskUserQuestion` gate before overriding the lock.

#### Scenario: Default skip on live previous iteration

- **WHEN** `/sdd:work --loop` ticks while `.sdd/loop/work.lock` holds PID 12345 and `kill -0 12345` succeeds
- **THEN** the skill MUST emit the one-line skip note, NOT increment `iterations_used`, and return so `/loop` can schedule the next tick

#### Scenario: Wait mode blocks until lock releases

- **WHEN** the user passes `--lock=wait --max-minutes 60` and the lock is held
- **THEN** the skill MUST block (polling at a reasonable interval) until the lock releases or `minutes_elapsed >= max_minutes`
- **AND** if the wait exceeds `max_minutes`, the wall-clock budget stop MUST fire

### Requirement: Prior-Gate-Stop Honor (Condition #10)

If any prior `AskUserQuestion` gate in this loop run answered `stop`, the loop MUST treat the run as halted and MUST NOT re-prompt or re-dispatch on subsequent ticks. The recorded stop cause MUST cite the originating gate.

#### Scenario: User stopped at a gate two iterations ago

- **WHEN** the budget-escalation gate in iteration 3 returned `stop` and `/loop` fires a 4th tick anyway
- **THEN** the skill MUST detect the prior `stop` answer in `history.jsonl`, emit "Loop already stopped at gate budget-escalation in iteration 3", release the lockfile, and not run the iteration

### Requirement: qmd-Unreachable Stop (Condition #11)

The loop MUST stop after qmd has been unreachable for two consecutive iterations. The wrapped skill (governed by ADR-0024) MUST signal qmd-unreachable by exiting non-zero AND either (a) emitting a stderr line containing the literal token `qmd-unreachable`, OR (b) exiting with reserved exit code `EX_QMD_UNREACHABLE=78`. The loop MUST track a `qmd_failures_consecutive` counter in `budget.json`. Any successful iteration MUST reset the counter to zero. On the second consecutive failure the loop MUST halt with a user-facing message naming ADR-0024 and instructing the user to fix qmd before resuming.

#### Scenario: Single transient outage recovers

- **WHEN** iteration 2 emits `qmd-unreachable` on stderr and exits 78, but iteration 3 succeeds
- **THEN** the skill MUST set `qmd_failures_consecutive=1` after iteration 2 and reset it to `0` after iteration 3
- **AND** the loop MUST continue normally

#### Scenario: Two consecutive failures halt the loop

- **WHEN** iterations 2 and 3 both signal qmd-unreachable
- **THEN** on iteration 3's exit the skill MUST stop the loop, emit "qmd unreachable for 2 iterations — fix per ADR-0024 (e.g., restart qmd daemon) and resume", and capture the last error
- **AND** MUST record `stop_conditions_fired: ["qmd_unreachable"]` in the final history line

### Requirement: Cost Budget Stop (Condition #12)

The loop MUST stop when `dollars_estimate >= max_dollars`. `dollars_estimate` MUST be recomputed on each tick as `Σ(tokens_in × rate_in + tokens_out × rate_out)` over each model used. The per-model rate table MUST be sourced in priority order: (1) a `### Loop Cost Rates` block in CLAUDE.md's `### SDD Configuration`; (2) a built-in default table compiled into the plugin. The chosen source MUST be recorded in `budget.json` `rate_table_source`. Setting `--max-dollars 0` MUST disable this stop.

#### Scenario: Cost ceiling reached mid-run

- **WHEN** iteration 4 of a `--max-dollars 25` run pushes `dollars_estimate` to 25.43
- **THEN** the skill MUST stop on iteration 4's exit, emit "Cost budget reached: \$25.43 / \$25.00", and record `stop_conditions_fired: ["cost_budget"]`

#### Scenario: Cost ceiling disabled

- **WHEN** the user passes `--max-dollars 0`
- **THEN** the skill MUST NOT evaluate condition #12 on any tick
- **AND** `dollars_estimate` MUST still be tracked and reported for transparency

### Requirement: Lockfile Schema and Acquisition

On entry, before any other work, the skill MUST acquire `.sdd/loop/{skill}.lock` (where `{skill}` is `work` or `review`). The lockfile MUST be written atomically (write-temp + rename) and MUST contain at minimum: `pid`, `iteration`, `started_at` (ISO 8601 UTC), and `skill`. On graceful exit the skill MUST remove the lockfile. On crash the lockfile MUST be reaped on the next tick per the "PID Liveness" requirement.

#### Scenario: Fresh lock acquisition

- **WHEN** `/sdd:work --loop` enters tick 1 and `.sdd/loop/work.lock` does not exist
- **THEN** the skill MUST write the lockfile atomically with the current PID, iteration number, ISO-8601 timestamp, and `skill: "work"`
- **AND** MUST proceed to budget evaluation

### Requirement: PID Liveness as Sole Staleness Signal

When a lockfile already exists, the skill MUST evaluate staleness using PID liveness alone: on POSIX, `kill -0 <pid>` succeeding means the lock is held; failing with `ESRCH` means the lock is stale and MUST be reaped. On Windows, the platform-equivalent probe (e.g., `OpenProcess` + `GetExitCodeProcess`) MUST be used. Ambiguous results MUST be treated as "alive" (skip the iteration) and a one-line warning MUST be surfaced. The presence or absence of worktrees MUST NOT be used as a staleness signal because failed-issue worktrees are preserved indefinitely per `skills/work/SKILL.md` Rules. The presence or absence of team members MUST NOT be used as a staleness signal because `TeamCreate` failures cause `/sdd:work` to fall back to single-agent mode where there are no team members.

#### Scenario: Stale lock from a crashed previous iteration

- **WHEN** the lockfile records PID 9999 and `kill -0 9999` returns `ESRCH`
- **THEN** the skill MUST reap the lockfile (remove it), emit a one-line note ("Reaped stale lock for pid 9999"), and acquire a fresh lock

#### Scenario: Live previous iteration with worktrees still present

- **WHEN** the lockfile records a live PID AND failed-issue worktrees from a much earlier iteration still exist on disk
- **THEN** the skill MUST treat the lock as held based on the live PID alone
- **AND** MUST NOT use the worktree presence as evidence either way

#### Scenario: Single-agent fallback iteration's lock is honored

- **WHEN** `TeamCreate` previously failed and the prior iteration ran in single-agent mode (no team members), and that PID is still live
- **THEN** the new tick MUST treat the lock as held by the live PID
- **AND** MUST NOT use the absence of team members to claim the lock is stale

### Requirement: Concurrency Invariants for /sdd:work

`/sdd:work --loop` MUST NOT pick up an issue already labeled `in-progress` by a sibling iteration's worktree. The check MUST happen during workable-issue discovery in each iteration, before dispatch.

#### Scenario: Sibling iteration is implementing #50

- **WHEN** iteration 2 of `/sdd:work --loop` discovers issue #50 carrying the `in-progress` label
- **THEN** the iteration MUST skip #50 and pick the next workable issue
- **AND** MUST NOT clear or contest the label

### Requirement: Concurrency Invariants for /sdd:review

`/sdd:review --loop` MUST NOT submit a new review on a PR whose previous-iteration responder has not yet pushed fixes. The skill MUST verify by comparing the current remote HEAD SHA of the PR's branch against `head_sha_at_iteration_end` recorded for that PR in the previous iteration's `history.jsonl` line (per "Telemetry Schema"). If the two SHAs are equal, no new commits have landed since the prior iteration ended and the iteration MUST defer review of that PR. SHA equality is the sole verification rule; out-of-band signals (e.g., responder commentary about fixes being incoming) MUST NOT be used. CI mid-flight MUST NOT be treated as lock contention; it MUST remain handled by the existing per-PR CI gate (skip until green).

#### Scenario: No new commits since prior iteration ended

- **WHEN** iteration 3 of `/sdd:review --loop` finds PR #142's current remote HEAD SHA equals the `head_sha_at_iteration_end` recorded for #142 in iteration 2's `history.jsonl` line
- **THEN** the iteration MUST defer review of #142 to the next tick
- **AND** MUST emit a one-line note ("PR #142: no new commits since iteration 2 (head_sha_at_iteration_end matches remote HEAD)")

#### Scenario: CI is mid-flight

- **WHEN** the target PR has CI checks running
- **THEN** the skill MUST defer per the existing per-PR CI gate
- **AND** MUST NOT treat this as lockfile contention

### Requirement: Backlog-Drift Gate

`/sdd:work --loop` MUST trigger an `AskUserQuestion` "Backlog Drift" gate when the unblocked-issue set has shifted (added or removed issues) since the previous iteration's recorded snapshot. The gate MUST present at minimum the options `re-propose`, `continue`, `stop`. The user's answer MUST be recorded in the iteration's `gates[]` entry.

#### Scenario: New high-priority issue lands between iterations

- **WHEN** iteration 2 starts and issue #99 (newly opened, unblocked) was not in iteration 1's backlog snapshot
- **THEN** the skill MUST fire the gate ("Backlog changed since last iteration. Re-propose the next batch?") with options `re-propose`, `continue`, `stop`
- **AND** the user's choice MUST drive the next batch selection

### Requirement: Ambiguous-Acceptance-Criteria Gate

Both skills MUST trigger an `AskUserQuestion` "Ambiguous Criteria" gate when an issue lacks a `### Acceptance Criteria` section, or when that section contains TBD/TODO markers. The gate MUST offer at minimum `skip`, `escalate`, `proceed`, `stop`.

#### Scenario: Issue body has "TBD" under acceptance criteria

- **WHEN** `/sdd:work --loop` would dispatch a worker against issue #149 whose body's Acceptance Criteria section reads "TBD"
- **THEN** the skill MUST fire the gate ("Issue #149 has ambiguous criteria. Skip, escalate, or proceed with my best interpretation?") with `skip`, `escalate`, `proceed`, `stop`
- **AND** MUST honor the user's choice before dispatching

### Requirement: Budget-Escalation Gate (80% Threshold, Multi-Budget Batching)

When any active budget would cross 80% on the current tick, the skill MUST fire the "Budget Escalation" gate. When two or more budgets cross 80% in the same tick, the skill MUST batch them into a single combined gate prompt enumerating every tripped budget. When any budget would reach 100% in the same tick that another crosses 80%, the 100%-stop conditions (3, 4, 5, 12) MUST take precedence and the gate MUST be suppressed for that tick. In single-PR review mode, the gate MUST evaluate only the active budgets (`max_iterations`, `max_minutes`, `max_dollars`) and MUST NOT mention `prs_touched`.

#### Scenario: One budget crosses 80%

- **WHEN** iteration 4 of a `--max-iterations 5` run would set `iterations_used=4`
- **THEN** the skill MUST fire the gate ("Approaching iterations (4/5). Continue, raise ceiling, or stop?") with options `continue`, `raise`, `stop`

#### Scenario: Three budgets cross 80% in the same tick

- **WHEN** iteration 4 simultaneously crosses 80% on iterations, minutes, and dollars
- **THEN** the skill MUST fire a single combined gate listing all three ("Approaching iterations (4/5), minutes (49/60), and dollars (\$21.00/\$25.00). Continue, raise ceiling(s), or stop?")
- **AND** MUST NOT fire three separate prompts

#### Scenario: 100% stop wins over 80% gate

- **WHEN** the same tick would push `iterations_used` to 5 (100% of `max_iterations=5`) and `minutes_elapsed` to 49 (just past 80% of `max_minutes=60`)
- **THEN** condition #3 MUST fire, the loop MUST stop, and the budget-escalation gate MUST NOT prompt

### Requirement: Post-Feedback-Merge Gate

`/sdd:review --loop` MUST trigger the "Post-Feedback Merge" gate before merging a PR if the responder addressed human review comments (not just sibling-agent reviewer comments) since the previous iteration. This gate preserves ADR-0010's bounded-iteration invariant by ensuring the loop never silently performs a merge that humans expected to re-review. Options MUST include at minimum `merge`, `hold`, `stop`.

#### Scenario: Human commented, responder addressed, loop is about to merge

- **WHEN** iteration 3 finds PR #142 has new commits from the responder addressing comments left by a human reviewer (login is not an agent identity) since iteration 2
- **THEN** the skill MUST fire the gate ("Responder addressed human feedback on PR #142. Merge now or hold for human re-review?")
- **AND** MUST honor the user's choice before invoking the merge API

### Requirement: Force-Unlock Gate

When `--lock=force` is set and a lockfile is present, the skill MUST trigger the "Force-Unlock" gate every time before reaping the lock. The gate MUST NOT be debounced across iterations.

#### Scenario: Force-unlock requested with a held lock

- **WHEN** the user passes `--lock=force` and the lockfile holds a live PID
- **THEN** the skill MUST fire the gate ("Force-unlock previous iteration's lock? This may corrupt in-flight work.") with `yes`, `no`, `stop`
- **AND** MUST proceed only on `yes`

### Requirement: Repeated-Failure Gate

When the same issue or PR has failed in two consecutive iterations with the same root-cause signature (per condition #6), the skill MUST fire the "Repeated Failure" gate offering at minimum `skip`, `retry`, `stop`. The gate MUST include the root-cause signature verbatim in the prompt.

#### Scenario: Issue #44 fails twice with the same test failure

- **WHEN** issue #44 has now failed in iterations 2 and 3 with root cause "tests failing in module X"
- **THEN** the skill MUST fire the gate ("Issue #44 failed twice with: tests failing in module X. Skip, retry once more, or stop the loop?")
- **AND** MUST honor the user's choice before the next tick dispatches

### Requirement: Gates Are Not Debounced Across Iterations

Each `AskUserQuestion` gate MUST be re-evaluated on every tick. The skill MUST NOT cache or reuse a prior iteration's answer to suppress a current iteration's gate. The trade is explicit: chattiness is the conservative default.

#### Scenario: Same gate fires in two consecutive iterations

- **WHEN** the backlog-drift gate fired in iteration 2 with answer `continue`, and iteration 3 again detects backlog drift
- **THEN** the skill MUST fire the gate again in iteration 3 with the current drift state
- **AND** MUST NOT auto-apply iteration 2's answer

### Requirement: Budget Schema and Persistence

The skill MUST persist budget state to `.sdd/loop/{skill}.budget.json` (or the `--budget-file` override path). The file MUST be written atomically (write-temp + rename). The schema MUST include at minimum these fields:

| Field | Type | Notes |
|-------|------|-------|
| `started_at` | ISO 8601 UTC | First-tick start time |
| `max_iterations` | int | Active ceiling |
| `max_prs` | int | Active ceiling |
| `max_minutes` | int | Active ceiling |
| `max_dollars` | number | Active ceiling; `0` means disabled |
| `iterations_used` | int | Cumulative |
| `prs_touched` | string[] | Deduplicated PR identifiers (e.g., `"#142"`) |
| `comments_pushed` | int | Cumulative review comments pushed |
| `merges_attempted` | int | Cumulative merge API calls |
| `minutes_elapsed` | int | Cumulative wall-clock |
| `tokens_in` | int | Cumulative |
| `tokens_out` | int | Cumulative |
| `agents_dispatched` | int | Cumulative worker / reviewer / responder Task spawns |
| `dollars_estimate` | number | Recomputed each tick |
| `rate_table_source` | string | `"CLAUDE.md SDD config"` or `"built-in default"` |
| `qmd_failures_consecutive` | int | Resets to 0 on any successful iteration |

On every tick, the skill MUST read the file, increment the relevant counters, evaluate stop conditions 3, 4, 5, and 12, and write the file back. Budgets MUST reset only when the user invokes a fresh loop run (no `--resume`) or deletes the budget file.

#### Scenario: Atomic write avoids partial-file corruption

- **WHEN** a tick concludes and writes the updated `budget.json`
- **THEN** the skill MUST write to a temp file in the same directory and rename over the existing file
- **AND** a concurrent reader MUST see either the pre-write or post-write content, never a partial file

#### Scenario: PR set is deduplicated across iterations

- **WHEN** PR #142 is touched in iteration 1 and re-touched in iteration 3
- **THEN** `prs_touched` MUST contain exactly one occurrence of `"#142"`
- **AND** condition #4 MUST count it once

### Requirement: Budget Schema — comments_pushed Definition

The `comments_pushed` counter in `budget.json` (and the corresponding per-iteration deltas in `history.jsonl`) MUST count BOTH top-level review comments AND reply-to-comment messages pushed by the loop. Both kinds of activity consume tracker API rate limits and represent loop-driven activity, so both MUST be reflected in the spend proxy. The wrapped skill MUST instrument every comment-push API call (top-level or reply) and contribute to the counter.

#### Scenario: A reviewer iteration pushes a top-level comment and three replies

- **WHEN** iteration 2 of `/sdd:review --loop --pr 142` posts one top-level review comment and three replies to existing review threads on PR #142
- **THEN** `comments_pushed` MUST increase by 4 in `budget.json`
- **AND** the iteration's `history.jsonl` line MUST reflect the same delta

### Requirement: Telemetry Schema

Each iteration MUST emit a stdout status block (visible in the session) summarizing the iteration plan, budget remaining, stop conditions evaluated, concurrency state, and outcome. Each iteration MUST also append a JSON line to `.sdd/loop/{skill}.history.jsonl`. The line schema MUST include at minimum: `iteration`, `skill`, `started_at`, `ended_at`, `outcome`, `prs_touched_this_iter`, `agents_dispatched_this_iter`, `tokens_in_this_iter`, `tokens_out_this_iter`, `dollars_this_iter`, `budget_snapshot` (mirroring the budget fields), `tracked_prs` (array, see below), `active_worktrees` (array, see below), `gates[]` (array of `{name, question, answer, at}`), and `stop_conditions_fired` (array). The `gates[]` array MUST capture every `AskUserQuestion` invocation in the iteration verbatim, including the prompt text, the user's answer, and the timestamp.

`tracked_prs` MUST be an array of objects, one per PR the iteration interacted with. Each object MUST include at minimum: `number` (int, the PR number), `branch` (string, the head branch name), `head_sha_at_iteration_start` (string, the PR's head SHA observed at iteration entry), `head_sha_at_iteration_end` (string, the PR's head SHA observed at iteration exit, after any pushes by the loop), and `state_at_end` (one of `"open"`, `"merged"`, `"closed"`). These fields are the typed inputs for the resume contract's HEAD-SHA reconciliation and for the `/sdd:review` "no new commits since prior iteration" check.

`active_worktrees` MUST be an array of objects, one per worktree the iteration left on disk (whether successful or failed). Each object MUST include at minimum: `path` (string, absolute or repo-relative path to the worktree), `branch` (string, the branch checked out in the worktree), and `head_sha` (string, the worktree branch's HEAD SHA at iteration exit). The array MUST include failed-issue worktrees so the resume contract can re-attach or report them without external probing.

The `history.jsonl` file MUST be treated as containing potentially-sensitive content. It is written under `.sdd/loop/` (covered by the `.sdd/` gitignore entry from SPEC-0019). The file MUST NOT be uploaded to telemetry without explicit user opt-in. Where a project declares a `### Loop Logging` block in CLAUDE.md with redaction patterns, the skill SHOULD apply those patterns before writing. Where no such block exists, the file MUST be documented as treat-as-secret in the same class as `.env` and tracker tokens.

#### Scenario: Gate invocation is captured verbatim

- **WHEN** the ambiguous-criteria gate fires for issue #149 with answer `escalate`
- **THEN** the next history line's `gates[]` MUST include `{"name": "ambiguous-criteria", "question": "Issue #149 has ambiguous criteria. Skip, escalate, or proceed with my best interpretation?", "answer": "escalate", "at": "<ISO-8601 UTC>"}`

#### Scenario: Status block is always emitted

- **WHEN** any iteration completes (including a skipped tick due to lock contention)
- **THEN** the skill MUST emit the stdout status block before returning so users sampling the session see the iteration's outcome

#### Scenario: tracked_prs and active_worktrees are captured each iteration

- **WHEN** iteration 2 of `/sdd:work --loop` opens PR #142 on branch `feature/123-foo` (HEAD `abc1234` at entry, `def5678` at exit) and leaves a worktree at `.sdd/worktrees/feature-123-foo` checked out at `def5678`
- **THEN** iteration 2's history line MUST include `tracked_prs: [{"number": 142, "branch": "feature/123-foo", "head_sha_at_iteration_start": "abc1234", "head_sha_at_iteration_end": "def5678", "state_at_end": "open"}]`
- **AND** MUST include `active_worktrees: [{"path": ".sdd/worktrees/feature-123-foo", "branch": "feature/123-foo", "head_sha": "def5678"}]`

### Requirement: Resume Contract

`--resume` MUST recover state from the most recent `history.jsonl` line. The skill MUST restore from the last line: `iterations_used`, `prs_touched`, `minutes_elapsed`, `tokens_in`, `tokens_out`, `agents_dispatched`, `dollars_estimate`, `comments_pushed`, `merges_attempted`, `qmd_failures_consecutive`, the iteration counter, the `tracked_prs` array, the `active_worktrees` array, and the recorded `gates[]` entries (kept as audit context only — they MUST NOT be replayed as silent answers). The skill MUST recompute from scratch: the next iteration's stop-condition evaluation, the next iteration's gate evaluation, the per-iteration timestamp, and the elapsed-since-last-tick wall-clock delta. The lockfile MUST be treated as stale per the PID-liveness rule. In-flight worktrees and open PRs from the prior iteration MUST be inspected exactly once at resume entry, using the typed inputs in `tracked_prs` and `active_worktrees` (per "Resume Contract Reconciliation").

#### Scenario: Resume finds the prior PID is still alive

- **WHEN** `/sdd:work --loop --resume` runs and the lockfile's recorded PID is still live
- **THEN** the skill MUST abort the resume with a one-line note directing the user to use `--lock=force` or wait for the live process to exit

#### Scenario: Stale gate answers are not replayed

- **WHEN** the prior run's last history line records `gates: [{"name": "budget-escalation", "answer": "raise"}]` and the resumed run's first iteration also crosses 80% on a budget
- **THEN** the skill MUST fire a fresh budget-escalation gate
- **AND** MUST NOT auto-apply the prior `raise` answer

### Requirement: Resume Contract Reconciliation

On resume, the skill MUST reconcile prior-iteration artifacts using the `tracked_prs` and `active_worktrees` fields persisted in the last `history.jsonl` line. External probing of GitHub or the filesystem to discover prior PRs or worktrees MUST NOT substitute for the typed inputs; the recorded fields are authoritative.

For each entry in `tracked_prs` whose `state_at_end` is `"open"`, the skill MUST fetch the current remote HEAD SHA for the recorded `branch` and compare it against `head_sha_at_iteration_end`. On match, the PR MUST be re-attached silently. On mismatch, the skill MUST fire the resume-divergence drift gate ("PR #N has diverged since the prior iteration crashed — re-attach, skip, or stop the loop?") with options `re-attach`, `skip`, `stop`, and MUST honor the user's choice before proceeding. PRs whose `state_at_end` is `"merged"` or `"closed"` MUST be skipped silently with a one-line note.

For each entry in `active_worktrees`, the skill MUST verify the worktree exists at the recorded `path` and that its current branch HEAD matches `head_sha`. Worktrees with a matching SHA MUST be re-attached silently. Worktrees with a mismatched SHA, a missing path, or a different branch checked out MUST be reported (one-line note per worktree) and MUST NOT be auto-cleaned, consistent with `skills/work/SKILL.md` Rules ("MUST preserve worktrees for failed issues — never auto-clean failures").

#### Scenario: Resume with matching HEAD SHAs

- **WHEN** `/sdd:work --loop --resume` runs and `tracked_prs[0]` records PR #142 with `head_sha_at_iteration_end="def5678"` and `state_at_end="open"`, and the current remote HEAD for the recorded branch is `def5678`
- **THEN** the skill MUST silently re-attach #142, restore counters from the last history line, and proceed
- **AND** MUST NOT re-prompt about #142

#### Scenario: Resume with diverged PR head fires the drift gate

- **WHEN** `/sdd:work --loop --resume` runs and `tracked_prs[0]` records PR #142 with `head_sha_at_iteration_end="def5678"` and `state_at_end="open"`, but the current remote HEAD for the recorded branch is `9999aaa` (someone force-pushed)
- **THEN** the skill MUST fire the resume-divergence drift gate with options `re-attach`, `skip`, `stop`
- **AND** MUST honor the user's choice before proceeding

#### Scenario: Resume skips PRs already terminal

- **WHEN** `/sdd:work --loop --resume` runs and `tracked_prs[0]` records PR #142 with `state_at_end="merged"`
- **THEN** the skill MUST skip #142 silently with a one-line note ("PR #142 was already merged at prior iteration end — not re-attaching")
- **AND** MUST NOT fetch the remote HEAD for #142

### Requirement: Single-PR Review Loop Semantics

`/sdd:review --loop --pr <N>` MUST watch a single PR across iterations. In this mode `prs_touched` MUST be informational and MUST remain `["#N"]` for the life of the run; condition #4 MUST be inactive. The active stop conditions for this mode MUST be #1 (N/A; replaced by #2), #2 (terminal PR state), #3 (iterations), #5 (minutes), #6 (repeated failure), #8 (interrupt), #9 (lock), #10 (prior gate stop), #11 (qmd), and #12 (dollars). `comments_pushed` and `merges_attempted` MUST remain visible counters — uncapped by default but reported in the status block on every tick. The 80% budget-escalation gate in this mode MUST evaluate only `max_iterations`, `max_minutes`, and `max_dollars`.

#### Scenario: prs_touched is inactive in single-PR mode

- **WHEN** `/sdd:review --loop --pr 142` runs for 10 iterations
- **THEN** `prs_touched` MUST equal `["#142"]` after all 10 iterations
- **AND** condition #4 MUST NOT have fired regardless of `max_prs`

#### Scenario: Budget-escalation gate omits PR dimension

- **WHEN** the budget-escalation gate fires in single-PR mode and `max_iterations`, `max_minutes`, and `max_dollars` are all near 80%
- **THEN** the gate prompt MUST list those three dimensions only
- **AND** MUST NOT mention `prs_touched`

### Requirement: ADR-0010 Bounded-Iteration Preservation

`/sdd:review --loop` MUST preserve ADR-0010's per-PR bounded one-round invariant. Each `/sdd:review` invocation MUST still execute exactly one review-response round per PR within the iteration; loop iteration MUST NOT amount to multiple review-response rounds on the same PR within one iteration. Across iterations, the post-feedback-merge gate (per "Post-Feedback-Merge Gate") gates the only path that could otherwise approximate "infinite review rounds" — making it human-mediated rather than agentic.

#### Scenario: Two iterations on the same PR each do one round

- **WHEN** iteration 1 reviews PR #142 (round 1: review → respond → re-evaluate → comment) and iteration 2 reviews #142 again
- **THEN** iteration 2 MUST execute exactly one review-response round per ADR-0010
- **AND** MUST NOT chain into a second response within the same iteration

### Requirement: Final Report on Stop

When the loop halts for any reason, the skill MUST emit a final report covering: the stop cause, total iterations used, total PRs touched, total minutes elapsed, total dollars estimated, list of gates fired with their answers, and the path to the persisted `budget.json` and `history.jsonl` for further inspection. The report MUST be emitted before lockfile release.

#### Scenario: Final report after cost-budget stop

- **WHEN** condition #12 fires on iteration 4
- **THEN** the skill MUST emit a final report naming `cost_budget`, citing `dollars_estimate=$25.43 / max_dollars=$25`, listing the gates fired across iterations 1-4, and pointing to `.sdd/loop/work.budget.json` and `.sdd/loop/work.history.jsonl`
- **AND** MUST release `.sdd/loop/work.lock` after the report is emitted

## Out of Scope

- Scheduled-agent integration via the `schedule` skill (cron-style remote runs).
- Web-dashboard observability for loop telemetry.
- Multi-machine loop coordination (e.g., distributed lockfiles across hosts).
- Autonomous looping for read-only skills (`/sdd:audit`, `/sdd:check`) — a separate ADR.
- Adding new gate categories beyond the six enumerated here — future ADRs may add gates as novel decisions are discovered.
