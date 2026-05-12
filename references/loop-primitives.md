<!-- Governing: ADR-0028 (/loop Autonomous Mode), SPEC-0020 REQ "Lockfile Schema and Acquisition", SPEC-0020 REQ "PID Liveness as Sole Staleness Signal", SPEC-0020 REQ "Lockfile Contention Skip", SPEC-0020 REQ "Budget Schema and Persistence", SPEC-0020 REQ "Cost Budget Stop", SPEC-0020 REQ "Budget Schema — comments_pushed Definition" -->

# Loop Primitives

This reference defines the **lockfile** and **budget** primitives that `/sdd:work --loop` and `/sdd:review --loop` sit on. It is the implementation contract for SPEC-0020 stories #138 (this file) and feeds the wiring stories #144, #145, and #148.

The primitives are procedural patterns: an agent following the SKILL.md flow runs each pattern verbatim. Both files are written via **atomic write** (write-temp + rename in the same directory) so concurrent readers always see a consistent snapshot.

All paths are relative to the repository root. The skill name placeholder `{skill}` is `work` for `/sdd:work --loop` and `review` for `/sdd:review --loop`.

## Lockfile

### Path

`.sdd/loop/{skill}.lock`

### Schema

The lockfile is JSON. It MUST contain at minimum these four fields:

| Field | Type | Notes |
|-------|------|-------|
| `pid` | int | OS process ID of the iteration that holds the lock |
| `iteration` | int | Iteration number (1-based) of the holder |
| `started_at` | string | ISO 8601 UTC timestamp of the holder's entry |
| `skill` | string | `"work"` or `"review"` |

Example:

```json
{
  "pid": 12345,
  "iteration": 3,
  "started_at": "2026-05-09T14:50:00Z",
  "skill": "work"
}
```

Implementations MAY add additional fields (e.g., `host`, `loop_run_id`) but readers MUST tolerate unknown fields and MUST NOT depend on any field outside the four above.

### Atomic acquisition

The lockfile MUST be written atomically. The canonical pattern:

```
1. Compute the desired lockfile content as a JSON string with a trailing newline.
2. Write the content to .sdd/loop/{skill}.lock.tmp in the same directory as the target.
3. fsync the temp file (when the platform exposes fsync).
4. rename(.sdd/loop/{skill}.lock.tmp, .sdd/loop/{skill}.lock)
```

`rename(2)` on the same filesystem is atomic on POSIX, so a concurrent reader sees either the pre-existing file (if any) or the new one — never a partial write. Windows `MoveFileEx` with `MOVEFILE_REPLACE_EXISTING` provides equivalent semantics.

If the parent directory `.sdd/loop/` does not exist, the implementation MUST create it (recursively) before the temp write.

### Graceful exit

On any graceful exit path (loop halts on stop condition, user interrupt completes, error path that emits the final report), the implementation MUST remove the lockfile via `unlink(.sdd/loop/{skill}.lock)` after the final report has been emitted but before the process returns.

If the process crashes (or is killed) before the unlink runs, the lockfile is left on disk and is reaped by the **next iteration's PID-liveness check** (below).

### PID-liveness check (sole staleness signal)

When a lockfile already exists, the iteration MUST evaluate staleness using **PID liveness alone**. Worktree presence and team-membership state MUST NOT be consulted as staleness signals (see SPEC-0020 REQ "PID Liveness as Sole Staleness Signal" and ADR-0028 Concurrency model for the rationale).

#### POSIX

```
result = kill(pid, 0)
case result:
  exit 0           => alive (return ALIVE)
  errno == EPERM   => alive — process exists but we lack permission to signal (return ALIVE)
  errno == ESRCH   => dead — process gone (return DEAD)
  other            => ambiguous (return AMBIGUOUS)
```

#### Windows

```
handle = OpenProcess(SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid)
if handle == NULL:
  if GetLastError() == ERROR_INVALID_PARAMETER:
    return DEAD          // PID not in the process table
  else:
    return AMBIGUOUS     // commonly access denied; treat as alive
GetExitCodeProcess(handle, &code)
CloseHandle(handle)
if code == STILL_ACTIVE (259):
  return ALIVE
else:
  return DEAD
```

#### Ambiguous results

Ambiguous probe results MUST be treated as **ALIVE** (skip the iteration), and the implementation MUST emit a one-line warning so the user knows a probe failed:

```
Lockfile staleness check ambiguous for pid {pid} on {platform} — treating as alive (skipping this tick).
```

### Acquisition flow

Given the `--lock={skip|wait|force}` mode and the lockfile state, the iteration's entry-time flow is:

```
read_lock = read_and_parse(.sdd/loop/{skill}.lock)
if read_lock is missing:
    write_lock_atomically(pid=current_pid, iteration=N, started_at=now_utc, skill=...)
    return PROCEED

probe = pid_liveness(read_lock.pid)

if probe == DEAD:
    unlink(.sdd/loop/{skill}.lock)
    emit_one_line("Reaped stale lock for pid {read_lock.pid}")
    write_lock_atomically(...)
    return PROCEED

# probe is ALIVE or AMBIGUOUS — both are treated as "lock held"

if mode == "skip":           # default
    emit_one_line("Previous iteration {read_lock.iteration} still active (pid {read_lock.pid}) — skipping this tick")
    return SKIP_TICK         # MUST NOT increment counters

if mode == "wait":
    poll_interval = 5  # seconds; per design.md Open Question 1
    deadline = budget.started_at + max_minutes * 60
    while now() < deadline:
        sleep(poll_interval)
        re_read = read_and_parse(.sdd/loop/{skill}.lock)
        if re_read is missing OR pid_liveness(re_read.pid) == DEAD:
            # Same path as the missing/dead case above
            try_acquire_atomically()
            return PROCEED
    # max_minutes exhausted — fall through to wall-clock budget stop
    return WALL_CLOCK_BUDGET_EXHAUSTED

if mode == "force":
    # Gate is fired by the wrapped skill (work/review SKILL.md)
    answer = ask_user_question("Force-unlock previous iteration's lock? This may corrupt in-flight work.",
                               options=["yes", "no", "stop"])
    record_gate("force-unlock", question, answer, now_utc)
    if answer == "yes":
        force_unlock_reap(read_lock.pid)
        write_lock_atomically(...)
        return PROCEED
    elif answer == "no":
        return SKIP_TICK
    else:
        return HALT
```

### Force-unlock reap helper

The `force_unlock_reap(pid)` helper is exposed for the Force-Unlock gate (which is wired in stories #144 and #145):

```
unlink(.sdd/loop/{skill}.lock)
emit_one_line("Force-unlocked previous iteration (was pid {pid}) — proceeding")
```

The helper MUST NOT terminate the foreign PID. It removes the lockfile only; if a previous iteration's process is genuinely still running, the user accepted the risk by answering `yes` at the gate.

### What is NOT a staleness signal

Per SPEC-0020 REQ "PID Liveness as Sole Staleness Signal":

| Signal | Why it is NOT consulted |
|--------|--------------------------|
| Worktree presence | Failed-issue worktrees are preserved indefinitely per `skills/work/SKILL.md` Rules; they routinely outlive the iteration that created them. |
| Team membership / `TaskList` count | `TeamCreate` failures cause `/sdd:work` to fall back to single-agent mode where there are no team members. |
| `.sdd/issues/_meta.json` recency | Tier 4 sync is best-effort; freshness has no bearing on whether a prior iteration is still alive. |
| Open PR count | PR open is asynchronous against the lockfile lifecycle. |

The only authoritative staleness signal is the PID-liveness probe.

## Budget

### Path

`.sdd/loop/{skill}.budget.json` (or the `--budget-file` override path)

### Schema

The budget file is JSON. Every required field MUST be present on every write — implementations MUST NOT omit fields even when the value is zero or empty.

| Field | Type | Notes |
|-------|------|-------|
| `started_at` | string (ISO 8601 UTC) | First-tick start time. MUST persist across `--resume`. |
| `max_iterations` | int | Active ceiling. Recorded on first write so resume cannot silently change it. |
| `max_prs` | int | Active ceiling. Inactive (informational) in single-PR review mode. |
| `max_minutes` | int | Active ceiling. |
| `max_dollars` | number | Active ceiling. `0` disables condition #12 but `dollars_estimate` is still tracked. |
| `iterations_used` | int | Cumulative across the entire loop run. |
| `prs_touched` | string[] | Deduplicated PR identifiers (e.g., `"#142"`). A PR re-touched across iterations counts once. |
| `comments_pushed` | int | Cumulative review comments pushed by the loop. **Counts BOTH top-level review comments AND reply-to-comment messages** per SPEC-0020 REQ "Budget Schema — comments_pushed Definition". |
| `merges_attempted` | int | Cumulative merge API calls. |
| `minutes_elapsed` | int | Cumulative wall-clock minutes since `started_at`. |
| `tokens_in` | int | Cumulative input tokens across all models. |
| `tokens_out` | int | Cumulative output tokens across all models. |
| `agents_dispatched` | int | Cumulative worker / reviewer / responder Task spawns. |
| `dollars_estimate` | number | Recomputed each tick from `tokens_in`/`tokens_out` and the rate table. |
| `rate_table_source` | string | `"CLAUDE.md SDD config"` or `"built-in default"` (see Rate-table sourcing below). |
| `qmd_failures_consecutive` | int | Resets to 0 on any successful iteration; trips condition #11 on increment to 2. |

Example:

```json
{
  "started_at": "2026-05-09T14:32:00Z",
  "max_iterations": 5,
  "max_prs": 20,
  "max_minutes": 60,
  "max_dollars": 25.00,
  "iterations_used": 2,
  "prs_touched": ["#141", "#142", "#143", "#145"],
  "comments_pushed": 7,
  "merges_attempted": 1,
  "minutes_elapsed": 18,
  "tokens_in": 1843210,
  "tokens_out": 412057,
  "agents_dispatched": 6,
  "dollars_estimate": 14.92,
  "rate_table_source": "CLAUDE.md SDD config",
  "qmd_failures_consecutive": 0
}
```

### Schema validation

Before reading or writing, implementations MUST validate the schema. A budget file missing any required field is invalid; the implementation MUST refuse the read and emit a one-line error so the user can either delete the file (start fresh) or fix it manually:

```
Budget file at {path} is missing required field {field} — refusing to load. Delete the file to start a fresh run, or restore the missing field manually.
```

Schema validation MUST run on every read, not just on resume.

### Atomic read-modify-write

On every tick the wrapped skill:

```
1. Read .sdd/loop/{skill}.budget.json (validate schema)
2. Increment the relevant counters (iterations_used, prs_touched union, etc.)
3. Recompute dollars_estimate from the rate table
4. Evaluate stop conditions 3 (iterations), 4 (PRs), 5 (minutes), 12 (dollars)
5. Write the file back atomically (write-temp + rename in the same directory)
```

Atomic write semantics are identical to the lockfile (write `.budget.json.tmp` and rename). The rename MUST happen on the same filesystem.

### First-write rule (defaults locked-in)

On the **first write** of a fresh budget file (no existing file at `.sdd/loop/{skill}.budget.json` and `--resume` not set), the implementation MUST record:

- `started_at = now_utc`
- `max_iterations`, `max_prs`, `max_minutes`, `max_dollars` from the resolved CLI flags (defaults: 5 / 20 / 60 / 25 — applied if no flag was passed)
- All cumulative counters initialized to 0
- `prs_touched = []`
- `qmd_failures_consecutive = 0`
- `rate_table_source` resolved per Rate-table sourcing below

Recording the active ceilings on first write is what makes `--resume` safe: a subsequent `--resume` invocation MUST NOT silently change the ceilings, even if the user passes different `--max-*` flags. (The wrapped skill MAY warn that the resume override is ignored.)

### Reset

The budget MUST reset only when:

1. The user invokes a fresh loop run (no `--resume`) and `.sdd/loop/{skill}.budget.json` does not yet exist; OR
2. The user explicitly deletes `.sdd/loop/{skill}.budget.json` before the run.

Implementations MUST NOT reset the budget on any other condition (e.g., the lockfile being stale, a stop condition firing, or a budget-escalation gate answer of `raise`). When the user answers `raise` at the budget-escalation gate, the implementation updates the relevant ceiling fields in place — it does not reset counters.

### Deduplication of `prs_touched`

`prs_touched` MUST be deduplicated. Implementations MUST treat `["#142", "#142"]` as `["#142"]` after the union. The canonical pattern:

```
prs_touched_new = sorted(set(prs_touched_existing) | {pr_just_touched})
```

This dedup is what makes condition #4 reliable: a foundation PR re-touched across two iterations counts once toward `max_prs`.

### `comments_pushed` accounting

Per SPEC-0020 REQ "Budget Schema — comments_pushed Definition", **BOTH** of the following MUST increment `comments_pushed` by 1:

| Activity | Increments |
|----------|------------|
| Top-level PR review comment | +1 per `POST /repos/{owner}/{repo}/pulls/{number}/reviews` (or tracker-equivalent) |
| Reply to an existing review comment | +1 per `POST /repos/{owner}/{repo}/pulls/{number}/comments` (or tracker-equivalent) |

Both consume tracker API rate limits and represent loop-driven activity, so a single counter that conflates the two is the faithful spend proxy in single-PR review mode (where `prs_touched` is informational).

### Cost budget evaluation (condition #12)

`dollars_estimate` is recomputed on **every tick** as the sum across all models used in the loop run:

```
dollars_estimate = Σ_models (tokens_in_model × rate_in_model_per_token + tokens_out_model × rate_out_model_per_token)
```

Rates are stored as USD per million tokens (per common conventions); convert to per-token by dividing by 1_000_000.

The condition fires when `dollars_estimate >= max_dollars` AND `max_dollars > 0`. Setting `--max-dollars 0` disables the stop but the implementation MUST still track `dollars_estimate` and surface it in telemetry.

The fired stop emits the user-facing message:

```
Cost budget reached: ${dollars_estimate:.2f} / ${max_dollars:.2f}
```

### Rate-table sourcing

The per-model rate table is resolved on every tick (allowing CLAUDE.md edits to take effect on the next tick) using this priority order:

#### Priority 1: CLAUDE.md `### Loop Cost Rates`

Look for a `### Loop Cost Rates` subsection inside the `### SDD Configuration` section of the project-root `CLAUDE.md`. Format:

```markdown
### SDD Configuration

#### Loop Cost Rates

| Model | Input ($/Mtok) | Output ($/Mtok) |
|-------|----------------|------------------|
| claude-opus-4-7 | 15.00 | 75.00 |
| claude-sonnet-4-7 | 3.00 | 15.00 |
| claude-haiku-4-7 | 0.25 | 1.25 |
```

When present and parseable, set `rate_table_source = "CLAUDE.md SDD config"` and use these rates.

#### Priority 2: Built-in default table

The plugin compiles in this default rate table as the fallback:

| Model | Input ($/Mtok) | Output ($/Mtok) |
|-------|----------------|------------------|
| `claude-opus-4-7` | 15.00 | 75.00 |
| `claude-sonnet-4-7` | 3.00 | 15.00 |
| `claude-haiku-4-7` | 0.25 | 1.25 |

When the CLAUDE.md block is missing or unparseable, set `rate_table_source = "built-in default"`.

#### Unknown models

If the loop run uses a model that is not in the active rate table, the implementation MUST:

1. Treat the unknown model's rate as **zero** for `dollars_estimate` purposes (cost under-counted, never over-counted).
2. Append a one-line warning the first time the unknown model is observed in this run:
   ```
   Unknown model in cost accounting: {model} — contributing $0.00 to dollars_estimate. Add a row to ### Loop Cost Rates in CLAUDE.md to fix.
   ```

Per SPEC-0020 design.md Open Question 2, this is conservative-by-construction; a future ADR may add an explicit `unknown-model` rate-table-source value.

### Resume contract notes

`--resume` reads the most recent `.sdd/loop/{skill}.history.jsonl` line and restores all cumulative counters from it (per SPEC-0020 REQ "Resume Contract"). The budget file's recorded ceilings are authoritative on resume — the implementation MUST refuse to silently widen them based on the new invocation's flags.

The full resume contract — including PR/worktree reconciliation against `tracked_prs` and `active_worktrees` — lands in story #140 (telemetry + resume), which extends this primitive surface.

## Implementation checklist

A skill body that satisfies SPEC-0020 stories #138, #144, and #145 MUST implement the following helpers (or their language-equivalent):

- `acquire_lock(skill, mode, max_minutes) -> {PROCEED, SKIP_TICK, HALT, WALL_CLOCK_BUDGET_EXHAUSTED}`
- `release_lock(skill)` — graceful unlink at exit
- `pid_liveness(pid) -> {ALIVE, DEAD, AMBIGUOUS}`
- `force_unlock_reap(pid)` — used only after the Force-Unlock gate confirms
- `read_budget(path) -> Budget | error`
- `write_budget_atomic(path, budget)`
- `init_budget(path, ceilings, started_at)` — first-write helper that records the locked-in ceilings
- `dedup_pr(budget, pr_id)` — append `pr_id` to `prs_touched` if not present
- `record_comment_pushed(budget)` — `+= 1` (top-level OR reply, per SPEC-0020)
- `record_merge_attempt(budget)` — `+= 1`
- `compute_dollars_estimate(budget, rate_table) -> number`
- `load_rate_table(claude_md_path) -> {table, source}` — Priority 1 → Priority 2 fallback
- `evaluate_cost_stop(budget) -> bool` — `dollars_estimate >= max_dollars` AND `max_dollars > 0`

These helpers are exposed for both `work` and `review` skills (the `{skill}` parameter scopes the file paths only; the helpers themselves are skill-agnostic).
