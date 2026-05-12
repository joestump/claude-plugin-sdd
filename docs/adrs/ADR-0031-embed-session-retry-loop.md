---
status: proposed
date: 2026-05-04
decision-makers: Joe Stump
extends: [ADR-0026]
related: [ADR-0024]
---

# ADR-0031: Embed-Session Retry Loop with Bounded Rounds

## Context and Problem Statement

`qmd embed` aborts at approximately 30 minutes with `Session expired — skipping N remaining chunks / skipping remaining document batches` and exits 0 — a partial completion that looks identical to a successful run from the caller's perspective. On a CPU-only machine running EmbeddingGemma 300M, a single session embeds roughly 500–700 chunks before the timeout fires. Real-world repos routinely exceed this: indexing the user's stumpcloud poly-repo (1181 pending chunks) embedded only 547 chunks in one session, then aborted with 149 explicit failures and 485 remaining batches, all reported by `/sdd:index embed` as "done."

The original `/sdd:index` skill design assumed a single embed invocation would either succeed or surface an error via non-zero exit. Neither happens — qmd's session-timeout exit path returns 0 with the partial-completion message in stderr, and the skill had no mechanism to detect, much less recover from, the partial state. Users were left with silently incomplete indexes whose vector/hybrid search degraded gracefully (BM25 still works) but never reached the recall they were promised.

The fix needs to handle three things: detect the partial completion, relaunch embed automatically until the work is done, and bound the relaunch loop so a chunk-level error doesn't produce an infinite retry. It also needs to make the multi-round behavior legible — a 1181-chunk CPU embed will take 2–3 rounds (≈90 minutes wall time) and users need to understand why.

## Decision Drivers

* **Silent partial completion is the worst failure mode.** Users trust the skill's "done" report; an incomplete index that *looks* complete actively misleads downstream skills (`/sdd:check`, `/sdd:audit`) into thinking they have full coverage when they don't.
* **The retry signal is unambiguous.** qmd's stderr contains the literal `Session expired` and `skipping remaining` strings, and `qmd status` reports `Pending > 0` after a partial run. Two corroborating signals make false-positive relaunches impossible.
* **Unbounded retries hide chunk-level errors.** If a specific chunk consistently fails to embed (encoding issue, file-size limit, model-input boundary), a "retry until done" loop spins forever. A bounded cap forces the failure surface up where the user can act.
* **The cap should match real workflows.** Five 30-minute rounds = 2.5 hours of embed wall time. That covers any reasonable single-repo embed (the 1181-chunk stumpcloud case finishes in 2–3 rounds). Going higher hides genuine errors; going lower forces multiple skill invocations on a real-world repo.
* **Foreground vs background loop.** In foreground mode the loop runs inline and the user watches the rounds tick by. In background mode the loop runs inside the backgrounded shell wrapper so the user gets the prompt back immediately and the harness completion notification fires at loop exit.

## Considered Options

* **Option 1**: Status quo — single embed invocation, report "done" regardless of partial completion. (The bug.)
* **Option 2**: Single retry — relaunch embed once if partial completion detected.
* **Option 3**: Unbounded retry loop until `Pending == 0`.
* **Option 4**: Bounded retry loop (max N rounds), exit early on success or genuine error, surface multi-round nature in the report.
* **Option 5**: Push the fix upstream into qmd — extend session lifetime or add internal auto-resume.

## Decision Outcome

Chosen option: **"Option 4 — Bounded retry loop, max 5 rounds"**, because it closes the silent-partial-completion failure mode without introducing an infinite-loop hazard, surfaces the multi-round behavior so users understand the wall-time cost, and stays within the plugin's existing layer (no upstream changes required). The other options each fail on a specific axis:

- Option 1 is the bug we're fixing.
- Option 2 is half the fix — a 1181-chunk repo needs 2–3 rounds, not 2, and the cliff between "single retry" and "multiple retries" is arbitrary.
- Option 3 hides chunk-level errors behind an infinite retry, which is a worse failure mode than the original bug because it consumes user time silently.
- Option 5 is the right long-term fix but out of scope for the SDD plugin to drive on qmd's release cadence. The bounded retry loop is a clean upstream-friendly mitigation that can be removed if/when qmd extends session lifetime.

### Sub-decision 1: Cap at 5 rounds

Five 30-minute sessions covers ≈2.5 hours of embed wall time. The empirical case (stumpcloud at 1181 chunks) finishes in 2–3 rounds; a 5-round cap leaves headroom for repos in the 1500–3000 chunk range, which is the practical ceiling for the SDD plugin's use cases (architecture artifacts + source code per repo, not whole-monorepo indexes). Repos beyond that size are likely workspace-mode candidates anyway (ADR-0016) and split across modules, each of which fits comfortably under the cap.

The cap is hardcoded in `skills/index/SKILL.md` rather than configurable. A configurable cap invites bikeshedding and complicates the skill body for ≤5% of users. If real telemetry shows the cap is too low for common cases, raise the constant and ship; if it's wrong systematically, that's a signal to fix the upstream session timeout.

### Sub-decision 2: Detect via two corroborating signals

The loop relaunches if and only if BOTH conditions hold after a round completes:
1. `qmd status` reports `Pending > 0`
2. The round's stderr contains `Session expired` OR `skipping remaining`

Either signal alone produces false positives: `Pending > 0` could mean "qmd skipped a chunk because of a genuine error and won't retry" (relaunching does nothing); the stderr sentinel alone could appear in a log from a prior run. Requiring both eliminates both failure modes.

### Sub-decision 3: Surface multi-round behavior in the report

When `rounds_completed > 1`, the After-embed report includes:

```
Embedded {N} chunks across {rounds} round(s).
(qmd embed sessions expire at ~30min on CPU; auto-relaunched per ADR-0031.)
```

This makes the wall-time cost legible. Users who run a 90-minute embed need to know it was three 30-minute rounds, not a single 90-minute session — otherwise the next time they see their session sitting at "embedding" for 30 minutes they'll worry it's hung when it's actually working as designed.

When `rounds_completed == max_rounds AND Pending > 0`, the report includes a retry-cap-hit warning with a remediation hint:

```
⚠ Embed retry cap hit (5 rounds, ~150min wall time). N chunks still pending.
This usually means qmd is hitting the same chunks repeatedly without progress — possible chunk-level error.
Inspect /tmp/qmd-embed-{repo}.log for "Failed to embed" lines, then re-run `/sdd:index embed` to continue.
```

### Consequences

* Good, because the silent-partial-completion failure mode is closed — `/sdd:index` reports honestly whether the embed reached `Pending == 0`.
* Good, because the bounded loop bounds wall time while still handling the realistic multi-session case.
* Good, because two corroborating signals eliminate both false-positive and false-negative retry triggers.
* Good, because the multi-round report message gives users the mental model they need for a 90-minute CPU embed.
* Good, because the background-mode wrapper means the user is not blocked through the loop.
* Bad, because a 5-round CPU embed can run 2.5 hours wall time — but this is the actual cost of indexing a large repo on CPU, not new cost introduced by this ADR.
* Bad, because the hardcoded cap will be wrong for someone, eventually. Mitigated by surfacing the cap-hit warning with a remediation hint.
* Bad, because the loop relies on a string match against qmd's stderr (`Session expired`, `skipping remaining`) — if qmd changes the wording, the loop breaks closed (single round, looks like a partial success again). Mitigated by the eval cases that exercise this path; an upstream qmd change shows up in CI.

### Confirmation

Compliance is confirmed by:

1. `/sdd:index embed` runs an inline retry loop in foreground mode and a backgrounded retry loop in background mode. Verified by reading `skills/index/SKILL.md` Operation: embed Step 4.
2. The loop is capped at 5 rounds and exits early when `Pending == 0` or when the prior round's stderr lacks the session-expired sentinel. Verified by eval ID 216.
3. The After-embed report mentions the round count when `rounds > 1` and references this ADR. Verified by eval ID 216 and by reading the report templates in Step 5.
4. The retry-cap warning surfaces a remediation hint when the cap is hit with `Pending > 0`. Verified by eval ID 216.

## Pros and Cons of the Options

### Option 1: Status quo (the bug)

* Bad, because partial completions are reported as "done" — actively misleads the user and downstream skills.
* Bad, because users discover the gap only when search results are unexpectedly thin, often weeks later.

### Option 2: Single retry

* Good, because handles the most common case (one timeout, then completion).
* Bad, because a 1181-chunk repo needs 2–3 retries, so the bug recurs at scale.
* Bad, because the choice of "1 retry" is as arbitrary as "5" but with worse coverage.

### Option 3: Unbounded retry loop

* Good, because guarantees `Pending == 0` at exit when nothing is genuinely failing.
* Bad, because a chunk-level failure (encoding, size limit) produces an infinite loop that consumes user time silently.
* Bad, because the worst failure mode (silent infinite retry) is strictly worse than the silent partial completion it replaces.

### Option 4: Bounded retry loop, max 5 rounds (chosen)

* Good, because closes the partial-completion failure mode for realistic repo sizes.
* Good, because the cap forces chunk-level errors up where the user can act.
* Good, because the multi-round report message makes wall-time legible.
* Bad, because the cap is hardcoded and will eventually be wrong for someone.
* Bad, because the stderr-string detection is brittle to upstream wording changes (mitigated by evals).

### Option 5: Push upstream into qmd

* Good, because removes the need for plugin-side retry logic entirely.
* Good, because benefits every qmd consumer, not just the SDD plugin.
* Bad, because qmd's release cadence is outside the plugin's control — the plugin would have to ship with a "wait for qmd 2.x" comment in the meantime.
* Bad, because the retry loop in the plugin is a 30-line wrapper; the cost of carrying it temporarily is small.
* Reconsider, when qmd exposes either a longer session lifetime or an internal auto-resume.

## More Information

* This ADR extends ADR-0026 by specifying *how* `/sdd:index embed` handles a specific failure mode in qmd's embed implementation.
* The 5-round cap and the stderr sentinel strings (`Session expired`, `skipping remaining`) are tuning constants chosen for qmd 2.1.0. Both should be reviewed when qmd ships a new release.
* Eval ID 216 in `evals/evals.json` exercises the retry loop, the early-exit conditions, the cap-hit warning, and the multi-round report message.
* The user reported this bug after `/sdd:index embed` claimed completion on a 1181-chunk stumpcloud poly-repo while leaving 634 chunks unembedded across `Pending` and `Failed` states.
