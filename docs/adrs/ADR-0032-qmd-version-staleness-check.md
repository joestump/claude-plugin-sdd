---
status: proposed
date: 2026-05-04
decision-makers: Joe Stump
extends: [ADR-0024]
related: [ADR-0026, ADR-0031]
---

# ADR-0032: qmd Version-Staleness Check Policy in /sdd:index

## Context and Problem Statement

ADR-0024 makes qmd a hard dependency at install time but says nothing about how the SDD plugin notices when the installed qmd is behind a newer release. In practice, qmd ships meaningful fixes — embed-session timeout extensions, model-load improvements, MCP additions — and users on stale versions silently miss them. The user reported a real instance: indexing the stumpcloud poly-repo on qmd 2.1.0 hit the 30-minute embed-session timeout that newer qmd releases may address, and there was no signal in `/sdd:index`'s output suggesting an upgrade might help.

The naive fix — running `npm view @tobilu/qmd version` on every `/sdd:index` invocation — is rude and slow. `npm view` typically takes 500ms–2s and depends on registry availability; chaining it onto every skill call would gate indexing behind the npm registry's health and add a recurring tax on every operation. The right shape is a cached check with a sane refresh interval, rendered as a non-blocking banner that informs without obstructing.

## Decision Drivers

* **Information cost is asymmetric.** A user running stale qmd loses real capability silently (slower embeds, missing features, worse search quality). A user with current qmd loses nothing from a no-op check.
* **Network calls must not gate local operations.** `/sdd:index` is a local-first skill — it works offline, against a local sqlite index, without registry access. A version check that errors closed (blocking the skill on `npm view` failures) would break that property.
* **Refresh cadence should match release cadence.** qmd ships releases at most weekly; checking more often than that is pure waste. A 7-day cache amortizes the network call across all skill invocations in that window.
* **The cache is per-package, not per-project.** Multiple SDD-using projects share `~/.cache/sdd-plugin/qmd-version.json` because the package being checked is the same. The cache key is the package name, not the calling repo.
* **Banner placement signals priority.** A warning rendered at the top of every report — before the operation's heading — is the right surface for a non-blocking nudge. Burying it in a footer or a `### Health` section dilutes the signal.

## Considered Options

* **Option 1**: No version check — the user notices upgrades via release notes or word of mouth.
* **Option 2**: Inline `npm view` on every invocation — accurate but rude.
* **Option 3**: Cached check at the qmd CLI itself (push to upstream).
* **Option 4**: Cached check in the SDD plugin with a configurable refresh interval and a non-blocking banner.
* **Option 5**: Cached check that *blocks* the skill if installed < latest — forces upgrade.

## Decision Outcome

Chosen option: **"Option 4 — Cached check with 7-day refresh, non-blocking banner"**, because it surfaces the upgrade signal where the user will see it (top of every `/sdd:index` report) without coupling indexing to network availability or imposing a recurring per-call tax. The other options each fail on a specific axis:

- Option 1 leaves users on stale versions silently — exactly the bug we're fixing.
- Option 2 makes every `/sdd:index` invocation slower and breaks indexing entirely when the npm registry is down.
- Option 3 is the right long-term fix but is upstream qmd's call, not the plugin's. The plugin can adopt this when qmd ships it.
- Option 5 is paternalistic — there are legitimate reasons to defer an upgrade (production schedule, regression testing, dependency pinning), and the plugin shouldn't decide for the user.

### Sub-decision 1: Cache at `~/.cache/sdd-plugin/qmd-version.json`

The cache lives under `~/.cache/sdd-plugin/` (a new SDD-plugin-owned cache directory, sibling to `~/.cache/qmd/`). Schema:

```json
{ "latest": "2.1.3", "checked_at": "2026-05-04T10:30:00Z" }
```

The cache file is created on first invocation if absent. The directory is created with `mkdir -p ~/.cache/sdd-plugin` before the first write. No locking is needed — the cache is read-mostly and write-collisions produce a slightly stale read at worst, never corruption (atomic rename via `mv` on the `npm view` output if write contention is a real concern, but expected to be rare).

### Sub-decision 2: 7-day refresh interval

Seven days strikes the balance for qmd's release cadence (≤weekly). Refreshing more often is pure waste; refreshing less often misses fixes that affect the user's workflow within a release cycle. The interval is a hardcoded constant in `skills/index/SKILL.md`, not configurable — bikeshedding refresh intervals is not a productive use of user attention, and a wrong choice here is at most "warning surfaces a few days late."

If real telemetry shows the interval is wrong, change the constant and ship.

### Sub-decision 3: Non-blocking banner at the top of every report

When installed `<` cached latest, render a single line at the top of every `/sdd:index` report (`add`, `update`, `embed`, `status`, `remove`):

```
⚠ qmd {installed} installed; {latest} available — `npm install -g @tobilu/qmd` (may include embed-session-timeout fixes)
```

The banner appears BEFORE the report's `## QMD ...` heading so it is the first thing the user sees when scanning the output. When versions match, no banner — silence is the right signal for "you're current."

The "may include embed-session-timeout fixes" suffix references the user's specific pain point (ADR-0031) but is generic enough to remain useful for future releases. Future releases may warrant updating the suffix; for now it points at the most-cited reason a user might want to upgrade.

### Sub-decision 4: Network failures are silent

If `npm view @tobilu/qmd version` fails (offline, registry timeout, npm not in PATH, package renamed), the skill silently skips the banner. No error, no warning, no telemetry. The skill's primary job is indexing; surfacing a "couldn't check the npm registry" warning every time a user runs offline would be worse than the silent-skip.

The cache is updated only on successful `npm view`, so a transient failure doesn't poison the cache — the next invocation that meets the staleness threshold will retry.

### Sub-decision 5: Semver compare is numeric only

qmd's release pattern uses pure `major.minor.patch` (no prereleases, no build metadata, no `-rc` suffixes). The compare logic extracts the three numeric components from both versions and does a tuple compare. If qmd ever ships a prerelease tag, the parser falls through to "treat as installed >= latest" (no banner) — better to under-warn than to misparse and warn incorrectly.

### Consequences

* Good, because users on stale qmd see the upgrade signal at the right moment (about to run an indexing operation that may benefit from the fix).
* Good, because the 7-day cache means at most one `npm view` call per week per machine.
* Good, because network failures never block indexing — the version check is best-effort by design.
* Good, because the banner placement (above the report heading) is the highest-signal surface for a non-blocking nudge.
* Good, because the cache is package-keyed, so multiple SDD-using projects share the same cache without per-project configuration.
* Bad, because adds a new cache directory `~/.cache/sdd-plugin/` to the user's home — a small footprint but a new file to clean up if the user uninstalls the plugin.
* Bad, because the `(may include embed-session-timeout fixes)` suffix dates fast — it'll need updating when newer qmd releases ship for different reasons.
* Bad, because the plugin now depends on `npm` being in PATH for the version-check feature (gracefully degrades to silent-skip when absent, but the feature is offline for those users).
* Bad, because a 7-day-old cache means a freshly-released qmd version may take up to a week to surface as a banner — acceptable given that qmd's releases are not security-critical.

### Confirmation

Compliance is confirmed by:

1. `/sdd:index` Step 2 sub-step 4 reads `~/.cache/sdd-plugin/qmd-version.json` and refreshes it via `npm view @tobilu/qmd version` only when the cache is absent or older than 7 days. Verified by reading `skills/index/SKILL.md` Step 2.
2. The version-staleness banner renders at the top of every report template (`add`, `update`, `embed`, `status`, `remove`) when installed `<` cached latest. Verified by reading the report templates in Step 5 and by eval ID 214.
3. `npm view` failures (offline, timeout, not in PATH) are caught and the banner is silently skipped. Verified by eval ID 214's last assertion.
4. The cache file is keyed by package name only (no per-project keying), so multiple SDD-using projects share it. Verified by reading the cache schema in Step 2 sub-step 4.

## Pros and Cons of the Options

### Option 1: No version check

* Good, because zero implementation cost.
* Bad, because users on stale qmd silently miss fixes that affect their workflow — the bug we're fixing.

### Option 2: Inline `npm view` every invocation

* Good, because always accurate.
* Bad, because adds 500ms–2s to every `/sdd:index` invocation.
* Bad, because gates indexing behind npm registry availability.
* Bad, because hits the registry far more often than qmd's release cadence justifies.

### Option 3: Push the check upstream into qmd

* Good, because benefits every qmd user, not just the SDD plugin.
* Good, because qmd is the authoritative source for "is qmd up to date."
* Bad, because outside the SDD plugin's control — qmd would need to ship the feature.
* Reconsider, when qmd exposes a `qmd doctor` or `qmd version --check-latest` command. The SDD plugin's check can defer to it transparently at that point.

### Option 4: Cached check with 7-day refresh, non-blocking banner (chosen)

* Good, because surfaces the upgrade signal at the right moment without per-call cost.
* Good, because network failures don't block indexing.
* Good, because the cache is shared across projects.
* Bad, because adds a new cache directory.
* Bad, because the suffix message ("may include embed-session-timeout fixes") dates and needs updating.

### Option 5: Block the skill if installed < latest

* Good, because guarantees users are current before indexing.
* Bad, because paternalistic — users have legitimate reasons to defer upgrades (production freeze, regression testing, dependency pinning).
* Bad, because breaks the "local-first, network-optional" property of `/sdd:index`.
* Bad, because forces an immediate upgrade decision at the moment a user is trying to do other work.

## More Information

* This ADR extends ADR-0024 by specifying *how* the SDD plugin notices when the user's qmd version is behind a release. ADR-0024 establishes presence; this ADR establishes freshness.
* This ADR pairs with ADR-0031 (Embed-Session Retry Loop) — the retry loop is a workaround for a qmd 2.1.0 limitation, and the version-staleness banner is the signal that an upgrade may eliminate the workaround entirely.
* The 7-day refresh interval and the package name `@tobilu/qmd` are tuning constants. Both should be reviewed if qmd is renamed or relocated.
* The cache directory `~/.cache/sdd-plugin/` is a new SDD-plugin-owned location. Future plugin features that need a similar cache surface (e.g., GitHub release polling for the plugin itself) should colocate here rather than spreading caches across the home directory.
* Eval ID 214 in `evals/evals.json` exercises the cache-fresh path and the banner placement.
* The user reported this gap after a real indexing session on qmd 2.1.0 hit the embed-session-timeout that triggered ADR-0031 — having a banner in the report would have prompted a check for newer qmd releases as part of the diagnosis.
