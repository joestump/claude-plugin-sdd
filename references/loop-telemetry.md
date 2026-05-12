<!-- Governing: ADR-0028 (/loop Autonomous Mode), SPEC-0020 REQ "Telemetry Schema", SPEC-0020 REQ "Resume Contract", SPEC-0020 REQ "Resume Contract Reconciliation", SPEC-0020 REQ "Chain Outcome Telemetry" -->

# Loop Telemetry and Resume Contract

This reference defines the **per-iteration telemetry record** (`.sdd/loop/{skill}.history.jsonl`), the **stdout status block** every iteration emits, and the **`--resume` reconciliation contract** that crash-recovers a loop run from the most recent history line. It complements `references/loop-primitives.md` (lockfile + budget) — that file covers iteration-entry / counter primitives; this file covers iteration-record / recovery primitives.

This is the implementation contract for SPEC-0020 story #140 and feeds the wiring stories #144, #145, and #148.

The `{skill}` placeholder is `work` for `/sdd:work --loop` and `review` for `/sdd:review --loop`.

## Status Block (stdout)

Every iteration MUST emit a stdout status block before returning. **Including iterations skipped due to lock contention** (per SPEC-0020 REQ "Telemetry Schema" — "Status block is always emitted") — the user sampling the session needs to see the outcome of every tick.

The canonical layout (per ADR-0028 design; the wrapped skill MAY add lines but MUST NOT remove these):

```
## Loop Iteration {N}/{max} — /sdd:{skill} --loop

Started: {iso-8601-utc}
Backlog: {unblocked} unblocked, {blocked} blocked, {in-progress} in-progress     # /sdd:work only
Iteration plan: {short summary of what will be attempted}                         # /sdd:work only
Tracked PR: #{N} ({state}, head_sha {short})                                      # /sdd:review --pr only

Budget remaining: {iters_left} iterations, {prs_left} PRs, {minutes_left} minutes, ${dollars_left:.2f}
Stop conditions evaluated: {list or "none triggered"}
Concurrency: {lock-state-summary}

Outcome: {summary}

Next tick: scheduled by /loop                                                     # or "Loop ended" on halt
```

For a **skipped** tick (lockfile held), the block MUST include the spec-quoted skip note in the `Outcome` line:

```
Outcome: Previous iteration {N-1} still active (pid {pid}) — skipping this tick
```

The status block is informational; durable state lives in `history.jsonl`.

## history.jsonl Schema

### Path

`.sdd/loop/{skill}.history.jsonl` (append-only)

### Per-line schema

Each line is a complete JSON object representing one iteration. Required fields (per SPEC-0020 REQ "Telemetry Schema"):

| Field | Type | Notes |
|-------|------|-------|
| `iteration` | int | Iteration number, 1-based |
| `skill` | string | `"work"` or `"review"` |
| `started_at` | string (ISO 8601 UTC) | When the iteration entered |
| `ended_at` | string (ISO 8601 UTC) | When the iteration exited (including skipped ticks) |
| `outcome` | string | One of `"ok"`, `"halted"`, `"skipped_lock"`, `"errored"` |
| `prs_touched_this_iter` | string[] | PR identifiers (e.g., `"#142"`) touched in this iteration only |
| `agents_dispatched_this_iter` | int | Worker / reviewer / responder Task spawns this iteration |
| `tokens_in_this_iter` | int | Input tokens consumed this iteration |
| `tokens_out_this_iter` | int | Output tokens produced this iteration |
| `dollars_this_iter` | number | Cost attributed to this iteration |
| `budget_snapshot` | object | Mirror of `budget.json` after this iteration's writes |
| `tracked_prs` | object[] | Typed PR-state input for resume (see below) |
| `active_worktrees` | object[] | Typed worktree-state input for resume (see below) |
| `gates` | object[] | Every `AskUserQuestion` invocation in this iteration, verbatim |
| `stop_conditions_fired` | string[] | Stop conditions that triggered this iteration (empty if iteration completed normally) |

#### Optional post-PR-chain fields (per SPEC-0020 REQ "Chain Outcome Telemetry")

These are emitted by `/sdd:work --loop` per ADR-0030. They are part of the `history.jsonl` schema but their presence depends on whether the chain ran:

| Field | Type | Presence rule |
|-------|------|---------------|
| `chain_invoked` | bool | Always present in `/sdd:work` lines (`true` unless `--no-chain` or `--dry-run` skipped the chain) |
| `review_outcome` | string | Present only when `chain_invoked == true`. One of `"approve"`, `"changes-requested"`, `"needs-human"`, `"errored"` |
| `autofix_pr_invoked` | bool | Present only when `chain_invoked == true` |
| `autofix_pr_invocation_status` | string | Present only when `autofix_pr_invoked == true`. One of `"accepted"`, `"unavailable"`, `"errored"`. Absent when `/sdd:review` errored (`autofix_pr_invoked: false` per SPEC-0020 REQ "Post-PR Chain Invocation") |

When `--no-chain` is set, the line MUST record `chain_invoked: false` and MUST OMIT `review_outcome`, `autofix_pr_invoked`, and `autofix_pr_invocation_status` (per SPEC-0020 REQ "Chain Outcome Telemetry").

### `gates[]` schema

Every `AskUserQuestion` invocation in the iteration MUST be captured **verbatim**:

```json
{
  "name": "ambiguous-criteria",
  "question": "Issue #149 has ambiguous criteria. Skip, escalate, or proceed with my best interpretation?",
  "answer": "escalate",
  "at": "2026-05-09T14:54:13Z"
}
```

| Field | Type | Notes |
|-------|------|-------|
| `name` | string | One of: `backlog-drift`, `ambiguous-criteria`, `budget-escalation`, `post-feedback-merge`, `force-unlock`, `repeated-failure`, `resume-divergence`. Stable identifier across iterations. |
| `question` | string | The exact prompt text shown to the user, with all interpolations resolved |
| `answer` | string | The user's option choice or free-text response (e.g., `"continue"`, `"raise"`, `"stop"`, `"42"`) |
| `at` | string (ISO 8601 UTC) | When the gate was answered |

The `gates[]` array is the **most important debug surface** for "why did the loop stop?". A post-mortem can reconstruct exactly which gates fired and what the user answered.

### `tracked_prs[]` schema

One entry per PR the iteration interacted with. These are the **typed inputs for the resume contract** — the recorded fields are authoritative; resume MUST NOT use external probing in their place.

```json
{
  "number": 142,
  "branch": "feature/123-foo",
  "head_sha_at_iteration_start": "abc1234",
  "head_sha_at_iteration_end": "def5678",
  "state_at_end": "open"
}
```

| Field | Type | Notes |
|-------|------|-------|
| `number` | int | PR number |
| `branch` | string | Head branch name (used for `git ls-remote` on resume) |
| `head_sha_at_iteration_start` | string | Full or short SHA observed at iteration entry |
| `head_sha_at_iteration_end` | string | Full or short SHA observed at iteration exit (after any pushes by the loop) |
| `state_at_end` | string | One of `"open"`, `"merged"`, `"closed"` |

The `head_sha_at_iteration_end` field is also the input for `/sdd:review --loop`'s "no new commits since prior iteration" check (per SPEC-0020 REQ "Concurrency Invariants for /sdd:review"): SHA equality with the live remote HEAD means no new commits, defer review.

### `active_worktrees[]` schema

One entry per worktree the iteration left on disk (whether successful or **failed**). Failed-issue worktrees MUST be included so the resume contract can report them without scanning the filesystem (per `skills/work/SKILL.md` Rules: "MUST preserve worktrees for failed issues — never auto-clean failures").

```json
{
  "path": ".sdd/worktrees/feature-123-foo",
  "branch": "feature/123-foo",
  "head_sha": "def5678"
}
```

| Field | Type | Notes |
|-------|------|-------|
| `path` | string | Absolute or repo-relative path to the worktree |
| `branch` | string | The branch checked out in the worktree |
| `head_sha` | string | The worktree branch's HEAD SHA at iteration exit |

### Canonical example

A complete `history.jsonl` line from a successful `/sdd:work --loop` iteration that opened one PR and ran the chain:

```json
{
  "iteration": 2,
  "skill": "work",
  "started_at": "2026-05-09T14:50:00Z",
  "ended_at": "2026-05-09T14:58:00Z",
  "outcome": "ok",
  "prs_touched_this_iter": ["#142"],
  "agents_dispatched_this_iter": 1,
  "tokens_in_this_iter": 412300,
  "tokens_out_this_iter": 98417,
  "dollars_this_iter": 3.21,
  "budget_snapshot": {
    "iterations_used": 2,
    "prs_touched": ["#141", "#142"],
    "minutes_elapsed": 18,
    "tokens_in": 1843210,
    "tokens_out": 412057,
    "dollars_estimate": 14.92,
    "comments_pushed": 0,
    "merges_attempted": 0,
    "agents_dispatched": 4,
    "qmd_failures_consecutive": 0,
    "rate_table_source": "CLAUDE.md SDD config"
  },
  "tracked_prs": [
    {"number": 142, "branch": "feature/123-foo", "head_sha_at_iteration_start": "abc1234", "head_sha_at_iteration_end": "def5678", "state_at_end": "open"}
  ],
  "active_worktrees": [
    {"path": ".sdd/worktrees/feature-123-foo", "branch": "feature/123-foo", "head_sha": "def5678"}
  ],
  "chain_invoked": true,
  "review_outcome": "approve",
  "autofix_pr_invoked": true,
  "autofix_pr_invocation_status": "accepted",
  "gates": [],
  "stop_conditions_fired": []
}
```

This line MUST round-trip through any compliant writer/reader without loss.

### Skipped-tick line

When the lockfile is held and `--lock=skip` returns `SKIP_TICK` (per `references/loop-primitives.md` § Acquisition flow), the iteration MUST still append a history line:

```json
{
  "iteration": 3,
  "skill": "work",
  "started_at": "2026-05-09T15:00:00Z",
  "ended_at": "2026-05-09T15:00:00Z",
  "outcome": "skipped_lock",
  "prs_touched_this_iter": [],
  "agents_dispatched_this_iter": 0,
  "tokens_in_this_iter": 0,
  "tokens_out_this_iter": 0,
  "dollars_this_iter": 0.00,
  "budget_snapshot": { ... unchanged from previous line ... },
  "tracked_prs": [],
  "active_worktrees": [],
  "gates": [],
  "stop_conditions_fired": []
}
```

Note: `iterations_used` in `budget_snapshot` MUST NOT be incremented for a skipped tick (per SPEC-0020 REQ "Lockfile Contention Skip").

## Sensitive content (treat-as-secret)

Per SPEC-0020 REQ "Telemetry Schema" sensitive-content note, `history.jsonl` is potentially sensitive: `gates[].question` may interpolate user-supplied content (issue bodies, PR titles, branch names) and `gates[].answer` may include free-text user input.

### Storage and transmission

- The file MUST be written under `.sdd/loop/` which is covered by the `.sdd/` gitignore entry from SPEC-0019.
- The file MUST NOT be uploaded to telemetry (Anthropic's or any third party's) without explicit user opt-in.
- The file MUST be documented as treat-as-secret in the same class as `.env` and tracker tokens. The first time the file is created in a repo, the wrapped skill MUST emit a one-line warning:

  ```
  Created .sdd/loop/{skill}.history.jsonl — this file may contain sensitive content (issue bodies, user answers). It is gitignored. Do not upload to external telemetry.
  ```

### Optional redaction (CLAUDE.md `### Loop Logging`)

If the project's CLAUDE.md contains a `### Loop Logging` block under `### SDD Configuration`, the wrapped skill SHOULD apply the listed redaction patterns before writing the line. Format:

```markdown
### SDD Configuration

#### Loop Logging

| Pattern | Replace with |
|---------|--------------|
| `(?i)token=\S+` | `token=<redacted>` |
| `(?i)api[_-]?key=\S+` | `api_key=<redacted>` |
```

Each row's `Pattern` is a regex (Python `re` / Go `regexp` flavor); `Replace with` is the substitution string. Patterns are applied to `gates[].question` and `gates[].answer` only (the user-supplied surfaces). Counters and structured fields are not subject to redaction.

When no `### Loop Logging` block is present, no redaction is applied — the file is treat-as-secret as a whole.

## --resume Contract

`--resume` is the recovery path after a crash, host reboot, or explicit pause. The resumed run reads the most recent `history.jsonl` line and continues from the recorded budget state.

### Restored from the last line (authoritative)

| Field | Source in last history line |
|-------|------------------------------|
| `iterations_used` | `budget_snapshot.iterations_used` |
| `prs_touched` | `budget_snapshot.prs_touched` |
| `comments_pushed` | `budget_snapshot.comments_pushed` |
| `merges_attempted` | `budget_snapshot.merges_attempted` |
| `minutes_elapsed` | `budget_snapshot.minutes_elapsed` |
| `tokens_in`, `tokens_out` | `budget_snapshot.{tokens_in,tokens_out}` |
| `agents_dispatched` | `budget_snapshot.agents_dispatched` |
| `dollars_estimate` | `budget_snapshot.dollars_estimate` |
| `qmd_failures_consecutive` | `budget_snapshot.qmd_failures_consecutive` |
| Iteration counter | `iteration` (next iteration is `iteration + 1`) |
| `tracked_prs` (typed inputs) | `tracked_prs` |
| `active_worktrees` (typed inputs) | `active_worktrees` |
| Recorded `gates[]` | `gates` (audit context only — see no-replay rule) |

### Recomputed on resume entry

| What | Why |
|------|-----|
| Next iteration's stop-condition evaluation | Conditions depend on current state, not a frozen snapshot |
| Next iteration's gate evaluation | The no-replay rule (below) — stale judgments do NOT carry over |
| Per-iteration timestamp (`started_at` of the new iteration) | A resumed iteration is a new wall-clock event |
| Elapsed-since-last-tick wall-clock delta | The pause duration is irrelevant; only `minutes_elapsed` from `budget_snapshot` matters |
| Lockfile state | Treated as stale per the PID-liveness rule from `references/loop-primitives.md` § PID-liveness check. The resumed iteration MUST reap a stale lock and acquire a fresh one. If the recorded PID is alive, resume aborts (see below). |

### No-replay rule (gate answers)

Recorded `gates[]` answers are loaded as **audit context only**. They MUST NOT be replayed as silent answers in the resumed run.

If a gate fires in the first iteration of the resumed run, the wrapped skill MUST `AskUserQuestion` again — even if the same gate answered `continue` (or `raise`, etc.) in the prior session. The trade is explicit: a stale "continue" answer in a different session context could rubber-stamp work the user no longer wants. Re-asking is the conservative default.

### Resume entry abort: live recorded PID

If the lockfile's recorded PID is **alive** on resume, this is an extremely rare anomaly (the prior process did not actually crash). The resumed run MUST abort with a one-line note directing the user to use `--lock=force` or wait for the live process to exit:

```
Resume aborted: lockfile recorded pid {pid} is still alive. Either wait for the previous run to exit, or pass --lock=force to override.
```

The resume run MUST NOT proceed to the iteration body in this case.

## Resume Reconciliation

Per SPEC-0020 REQ "Resume Contract Reconciliation", on resume entry the wrapped skill MUST reconcile prior-iteration artifacts using the typed inputs in the last `history.jsonl` line. **External probing of GitHub or the filesystem to discover prior PRs or worktrees MUST NOT substitute for the typed inputs**; the recorded fields are authoritative.

### PR reconciliation

```
for pr in last_history_line.tracked_prs:

    if pr.state_at_end == "merged" or pr.state_at_end == "closed":
        emit_one_line(f"PR #{pr.number} was already {pr.state_at_end} at prior iteration end — not re-attaching")
        continue

    # state_at_end == "open"
    recorded_sha = pr.head_sha_at_iteration_end
    current_sha  = git_ls_remote_origin_branch(pr.branch)

    if recorded_sha == current_sha:
        # Silent re-attach — no new commits since prior iteration ended
        register_pr_for_this_run(pr)
    else:
        # Drift — fire the resume-divergence gate
        answer = ask_user_question(
            f"PR #{pr.number} has diverged since the prior iteration crashed — re-attach, skip, or stop the loop?",
            options=["re-attach", "skip", "stop"]
        )
        record_gate("resume-divergence", question, answer, now_utc)
        if answer == "re-attach":
            register_pr_for_this_run(pr)
        elif answer == "skip":
            # do nothing; PR is left out of this run
            pass
        else:
            halt_loop()
```

The drift gate MUST appear in the resumed iteration's `gates[]` array exactly like any other gate.

### Worktree reconciliation

```
for wt in last_history_line.active_worktrees:
    actual_branch = current_branch(wt.path) if exists(wt.path) else None
    actual_sha    = current_head(wt.path)   if exists(wt.path) else None

    if exists(wt.path) and actual_branch == wt.branch and actual_sha == wt.head_sha:
        # Silent re-attach
        register_worktree_for_this_run(wt)
    else:
        # Worktrees with mismatched SHA, missing path, or different branch checked out
        # MUST be reported but NOT auto-cleaned (per skills/work/SKILL.md Rules)
        emit_one_line(
            f"Worktree {wt.path} {'missing' if not exists(wt.path) else 'diverged'} — "
            f"leaving in place per worktree-preservation rule"
        )
```

Worktrees with **no associated open PR** in `tracked_prs` are also reported (one-line note) but never auto-cleaned. The user owns worktree cleanup.

### Why typed inputs over external probing

The contract is explicit about not using `gh pr list` or filesystem scans on resume because:

1. **Reproducibility.** A resumed run that discovers PRs by querying GitHub will see whatever state GitHub shows *now* — possibly different from what the iteration recorded. Typed inputs are deterministic.
2. **Confidentiality.** External probing can leak the resume into rate-limit / audit-log territory the user did not authorize on resume.
3. **Worktree preservation.** Filesystem scans would surface worktrees from much older iterations as if they were this run's state. The `active_worktrees[]` array tells us exactly which worktrees this run owns.

A code-review check during implementation MUST flag any external probe in the resume reconciliation path that should have used the typed inputs.

## Implementation checklist

A skill body that satisfies SPEC-0020 story #140 MUST implement (or its language-equivalent):

- `emit_status_block(...)` — stdout block layout per "Status Block" above
- `append_history_line(skill, record)` — atomic append to `.sdd/loop/{skill}.history.jsonl` (per the canonical schema; `outcome` field present for every line including skipped ticks)
- `read_last_history_line(skill) -> Line | None` — for `--resume`
- `reconcile_tracked_prs(prs)` — silent re-attach on SHA match; resume-divergence gate on mismatch; skip with note on terminal state
- `reconcile_active_worktrees(wts)` — silent re-attach on full match; one-line note on mismatch / missing
- `apply_logging_redactions(text, claude_md_path)` — `### Loop Logging` redaction pass; pass-through if no block declared
- `record_gate(name, question, answer, at)` — adds the entry to the in-progress iteration record so it lands in the next history-line append
- `record_chain_outcome(chain_invoked, review_outcome, autofix_pr_invoked, autofix_pr_invocation_status)` — sets the post-PR chain fields per SPEC-0020 REQ "Chain Outcome Telemetry" presence rules

These helpers consume the budget surface from `references/loop-primitives.md` (e.g., `budget_snapshot` is a structured copy of the budget after the iteration's writes) and are consumed by the wiring stories #144 (work loop), #145 (review loop), and #148 (post-PR chain).
