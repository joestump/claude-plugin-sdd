---
status: draft
date: 2026-05-03
implements: [ADR-0024, ADR-0025, ADR-0026]
requires: [SPEC-0014, SPEC-0018]
---

# SPEC-0019: qmd-Native Skills

## Overview

Realizes the v5.0.0 architecture (ADR-0024 hard qmd dependency, ADR-0025 tracker issues as a fourth qmd collection, ADR-0026 tiered freshness strategy) by making every appropriate SDD plugin skill qmd-aware. The plugin moves from "every read-side skill scans the entire ADR + spec corpus" to "every read-side skill retrieves the top-K relevant artifacts via qmd hybrid search, then reads in full only what matters." Authoring skills (`/sdd:adr`, `/sdd:spec`) gain pre-search to suggest frontmatter edges. Sprint skills (`/sdd:plan`, `/sdd:work`, `/sdd:review`) gain awareness of existing code and existing tracker issues. Mutation-aware updates and a per-tier freshness model keep the index honest without per-call user friction.

This spec is the input to the v5.0.0 sprint. It defines what must be true after the implementation lands; per-skill exact algorithms live in updated SKILL.md files. Two new shared references absorb the cross-cutting concerns: `references/qmd-helpers.md` (retrieval pattern, MCP-vs-CLI, error handling) and `references/tracker-sync.md` (per-tracker fetch and normalize for the issues collection).

## Requirements

### Requirement: qmd Preflight Enforcement

`/sdd:init` MUST refuse to operate when the `qmd` CLI is not available in `PATH`. The check happens before any CLAUDE.md write or skills-table convergence. Error output MUST include the install command (`npm install -g @tobilu/qmd` or `bun install -g @tobilu/qmd`) and a link to qmd's repository.

#### Scenario: qmd missing on a fresh machine

- WHEN the user runs `/sdd:init` and `command -v qmd` returns non-zero
- THEN `/sdd:init` MUST output the canonical error message naming the install command and stop without modifying CLAUDE.md, `.gitignore`, or any other file
- AND the exit signal MUST be visible enough that downstream tooling (CI, install scripts) can detect the missing dependency

#### Scenario: qmd present but not yet authenticated to a model registry

- WHEN the user runs `/sdd:init` and `command -v qmd` succeeds but `qmd status` reports the GGUF models are not yet downloaded
- THEN `/sdd:init` MUST proceed (model download is qmd's responsibility on first embed, not an init prerequisite)
- AND `/sdd:init`'s final report SHOULD note that the first `/sdd:index embed` will trigger a one-time ~2GB model download

#### Scenario: re-running `/sdd:init` after a successful install

- WHEN the user has already run `/sdd:init` successfully and re-runs it
- THEN the qmd preflight passes (idempotent)
- AND no spurious changes are introduced to CLAUDE.md or `.gitignore`

### Requirement: qmd Assumption in Consumer Skills

Every qmd-aware skill MAY assume qmd is installed and reachable on `PATH` (because `/sdd:init` enforced it per the Preflight requirement) and MUST NOT include conditional fallback paths gated on qmd availability. If a skill needs to handle "qmd installed but this repo not yet indexed", it MUST route to `/sdd:index` rather than silently degrading.

#### Scenario: a consumer skill encounters an unindexed repo

- WHEN `/sdd:check` runs in a repo where `qmd collection list` shows no `{repo}-*` collections
- THEN the skill MUST output: "No qmd collections found for {repo}. Run `/sdd:index` first." and stop
- AND MUST NOT fall back to the pre-v5 "scan the entire corpus" behavior

#### Scenario: a consumer skill encounters a partially indexed repo (missing embeddings)

- WHEN `/sdd:check` runs in a repo where collections exist but `qmd status` shows pending chunks for those collections
- THEN the skill MUST proceed using BM25-only retrieval (qmd handles this gracefully by returning lex matches when vectors are missing)
- AND MUST surface a one-line note: "{N} chunks unembedded — vector/hybrid search disabled until `/sdd:index embed` runs"

### Requirement: Plugin Version Bump to v5.0.0

The release that lands all requirements in this spec MUST bump `.claude-plugin/plugin.json` `version` from the current 4.x line to **5.0.0**. The CHANGELOG MUST document the qmd dependency under "Breaking Changes" with the install command.

#### Scenario: v5.0.0 install on a machine without qmd

- WHEN a user installs `sdd@claude-plugin-sdd` v5.0.0 and runs `/sdd:init` without qmd installed
- THEN `/sdd:init` MUST emit the install command and stop, per the Preflight requirement
- AND the failure mode MUST be obvious enough that a user upgrading from v4.x understands they have new install work

### Requirement: Issues Collection Layout

The plugin MUST sync tracker issues to `.sdd/issues/{number}.md` (or `.sdd/issues/{tracker-id}.md` for trackers using non-numeric IDs like Jira `PROJ-123`). Each synced file MUST carry the canonical frontmatter schema and the issue body verbatim. Synced files MUST be under `.sdd/issues/`, never directly under `.sdd/` or elsewhere.

The frontmatter schema MUST include: `id`, `title`, `status` (normalized: `open` / `closed` / `merged` / `draft`), `labels`, `assignees`, `author`, `created`, `updated`, `closed`, `url`, `tracker`, and a `references` block parsing `SPEC-XXXX` and `ADR-XXXX` mentions plus `Blocks:` / `Blocked by:` dependency edges from the issue body.

#### Scenario: syncing a GitHub issue with full metadata

- WHEN `/sdd:index update` runs against a repo configured for GitHub and an issue exists at `https://github.com/owner/repo/issues/142` with title, body, labels, assignees, and timestamps
- THEN a file `.sdd/issues/142.md` MUST be written with the canonical frontmatter populated from the GitHub API response
- AND the body MUST be the verbatim issue body
- AND the `tracker` frontmatter field MUST equal `github`

#### Scenario: syncing a Jira issue with composite ID

- WHEN `/sdd:index update` runs against a repo configured for Jira and an issue exists with key `PROJ-123`
- THEN a file `.sdd/issues/PROJ-123.md` MUST be written (preserving the dash in the filename)
- AND the `id` frontmatter field MUST equal `PROJ-123`

#### Scenario: re-syncing an issue whose body changed

- WHEN `/sdd:index update` runs and an issue's body has changed since the last sync
- THEN the existing `.sdd/issues/{id}.md` MUST be overwritten with the current body and updated `updated` timestamp
- AND no merge or diff MUST be attempted (the tracker is the source of truth; the local cache is replaceable)

### Requirement: Tracker Sync Layer

The per-tracker fetch and normalize logic MUST live in a single `references/tracker-sync.md` reference file. Consumer skills (`/sdd:index`, `/sdd:plan`, `/sdd:work`, `/sdd:review`, `/sdd:enrich`, `/sdd:organize`) MUST consume it by section name and MUST NOT inline tracker-specific API calls in their own SKILL.md files. The reference MUST cover all seven supported trackers: GitHub, Gitea, GitLab, Jira, Linear, Beads, and `tasks.md` fallback.

#### Scenario: a new tracker is added in the future

- WHEN a new tracker (e.g., `Bitbucket`) is added to the supported set
- THEN the only file requiring substantive edits MUST be `references/tracker-sync.md` (plus minimal entries in `references/shared-patterns.md` § Tracker Detection)
- AND no consumer skill SKILL.md MUST need to learn the new tracker's API shape

#### Scenario: a tracker API rate-limits or returns an error during sync

- WHEN the tracker-sync layer encounters a 429 or 5xx response
- THEN it MUST retry with exponential backoff up to 3 times before reporting a sync failure
- AND a sync failure MUST surface a clear error to the consumer skill that triggered it, not a silent partial sync

### Requirement: Issues Collection Sync via /sdd:index

`/sdd:index update` MUST sync the `{repo}-issues` (or `{repo}-{module}-issues` in workspace mode) collection as part of its normal pass. Consumer skills (`/sdd:plan`, `/sdd:work`, `/sdd:review`, `/sdd:enrich`, `/sdd:organize`) MUST trigger an opportunistic sync at start-of-run if the issues collection has not been synced within the last 5 minutes.

#### Scenario: /sdd:plan starts after an idle session

- WHEN `/sdd:plan SPEC-0019` runs and the last issues sync was >5 minutes ago
- THEN the skill MUST trigger an issues-only sync via the tracker-sync layer before grouping requirements into stories
- AND MUST output a one-line note: "Syncing N issues from {tracker}…"

#### Scenario: /sdd:work starts immediately after /sdd:plan

- WHEN `/sdd:work` runs within 5 minutes of a `/sdd:plan` invocation that already synced issues
- THEN the skill MUST skip the redundant sync and proceed
- AND MUST silently note (in trace output, not user-facing) that the sync was skipped due to recency

### Requirement: .sdd Gitignore Enforcement

`/sdd:init` MUST add `.sdd/` to the project's `.gitignore` (creating `.gitignore` if absent). The entry MUST be appended exactly once; running `/sdd:init` repeatedly MUST NOT produce duplicate `.sdd/` lines. Other entries in `.gitignore` MUST be preserved exactly.

#### Scenario: fresh project with no .gitignore

- WHEN `/sdd:init` runs in a project that has no `.gitignore`
- THEN `/sdd:init` MUST create `.gitignore` containing `.sdd/`
- AND MUST NOT create or modify any other entry

#### Scenario: project with existing .gitignore that includes .sdd/

- WHEN `/sdd:init` runs and `.gitignore` already contains `.sdd/` (anywhere in the file)
- THEN `/sdd:init` MUST leave the file unchanged
- AND MUST NOT append a duplicate

#### Scenario: project with .gitignore that does NOT include .sdd/

- WHEN `/sdd:init` runs and `.gitignore` exists but does not contain `.sdd/`
- THEN `/sdd:init` MUST append `.sdd/` to the end of the file (preceded by a single newline if the file does not end with one)
- AND all existing entries MUST remain in their original positions

### Requirement: qmd-helpers Reference

The plugin MUST provide a `references/qmd-helpers.md` shared reference covering: how to call qmd (prefer the qmd MCP `mcp__plugin_qmd_qmd__*` tools when loaded; fall back to the `qmd` CLI otherwise), how to format result candidates for downstream consumption, how to handle qmd errors (timeout, no-collections, partial-embedding), and how skills should detect "this repo's collections" via exact-prefix match on collection names. Every qmd-aware consumer skill MUST consume this reference by section name.

#### Scenario: a skill needs to retrieve top-K candidates

- WHEN `/sdd:check` needs to find the ADRs and specs governing a target file
- THEN the skill MUST use the canonical retrieval pattern from `references/qmd-helpers.md` § Hybrid Retrieval
- AND MUST NOT inline its own qmd CLI invocation

#### Scenario: a skill needs to identify this-repo collections

- WHEN any skill needs to filter to "collections belonging to this repo"
- THEN the skill MUST use the exact-prefix match pattern documented in `references/qmd-helpers.md` § This-Repo Collection Identification
- AND MUST NOT use substring match (which would spuriously claim e.g., `not-myrepo-adrs` for slug `myrepo`)

### Requirement: Tier 1 Mutation-Aware Updates

Every skill that writes to indexed content MUST trigger a narrow `qmd update` for the affected collection(s) before returning. The update is synchronous and silent unless it fails. Failures MUST surface as a one-line warning in the skill's normal report output.

| Skill | Writes to | Affected collection |
|-------|-----------|---------------------|
| `/sdd:adr` | new ADR file | `{repo}-adrs` |
| `/sdd:spec` | new spec.md / design.md | `{repo}-specs` |
| `/sdd:status` | YAML or inline status field | The collection containing the artifact whose status changed |
| `/sdd:work` | merged PR (changed code) | `{repo}-code` |
| `/sdd:plan`, `/sdd:enrich`, `/sdd:organize` | tracker issues | `{repo}-issues` |
| `/sdd:review` | merged PR (changed code AND closed issues) | `{repo}-code` AND `{repo}-issues` |

#### Scenario: /sdd:adr finishes writing a new ADR

- WHEN `/sdd:adr` completes and writes `docs/adrs/ADR-NNNN-foo.md`
- THEN before returning, the skill MUST invoke the canonical update pattern from `references/qmd-helpers.md` to refresh the `{repo}-adrs` collection
- AND the skill's success report MUST not mention the update (silent on success)

#### Scenario: a Tier 1 update fails

- WHEN `/sdd:adr` finishes writing the file but the qmd update fails (e.g., qmd daemon crashed)
- THEN the skill's report MUST include a one-line warning: "Index refresh failed for {repo}-adrs — run `/sdd:index update` manually"
- AND the artifact MUST still be reported as successfully written (the update is best-effort, not blocking)

### Requirement: Tier 2 Session-Start Update via /sdd:prime

`/sdd:prime` MUST run `qmd update` (cheap file-mtime scan) on entry to catch changes from outside the current session. The update MUST be skipped when the qmd index was touched within the last 60 seconds (back-to-back primes are common). The update MUST be silent on success unless the diff is non-zero. After the update, `/sdd:prime` MUST surface the count of unembedded chunks for this repo's collections via a one-line note (no AskUserQuestion).

#### Scenario: /sdd:prime runs at the start of a fresh session

- WHEN `/sdd:prime` runs and the qmd index was last touched >60s ago
- THEN the skill MUST invoke `qmd update` silently
- AND MUST print a one-line note in the report header IF the update added/modified/removed any documents (otherwise omit the line entirely)

#### Scenario: /sdd:prime runs back-to-back

- WHEN `/sdd:prime` runs and the qmd index was last touched <60s ago
- THEN the skill MUST skip the update
- AND MUST NOT emit any update-related output

#### Scenario: /sdd:prime sees unembedded chunks for this repo

- WHEN `/sdd:prime` finishes loading context and `qmd status` reports unembedded chunks belonging to this repo's collections
- THEN the report MUST surface a one-line note: "{N} chunks unembedded — run `/sdd:index embed` (≈{seconds}s on this machine, foreground; or wait for the next mutation skill to backfill)"
- AND MUST NOT prompt the user via AskUserQuestion

### Requirement: Tier 3 Staleness Threshold for Consumer Skills

Read-only consumer skills (`/sdd:check`, `/sdd:audit`, `/sdd:discover`) MUST check the qmd index's last-modified timestamp on entry. If older than the configured staleness threshold, the skill MUST run a silent `qmd update` first and print a one-line note: "Index was {age} stale — refreshed before running."

The threshold default MUST be **120 minutes** (2 hours), configurable in CLAUDE.md `### SDD Configuration` `#### Index Freshness` `**Staleness Threshold**` (e.g., `30m`, `4h`).

#### Scenario: /sdd:check runs after a long idle period

- WHEN `/sdd:check` runs and the qmd index's last-modified timestamp is >120 minutes ago
- THEN the skill MUST trigger `qmd update` silently before performing retrieval
- AND MUST emit the staleness note in its report header

#### Scenario: user has configured a shorter threshold

- WHEN CLAUDE.md `### SDD Configuration` `#### Index Freshness` `**Staleness Threshold**` is `30m` and `/sdd:check` runs 31 minutes after the last update
- THEN the skill MUST honor the configured threshold and trigger the update

#### Scenario: index is fresh

- WHEN `/sdd:check` runs and the qmd index was updated within the configured threshold
- THEN the skill MUST NOT trigger an update
- AND MUST proceed silently (no staleness note in the report)

### Requirement: Tier 4 Always-Sync Issues for Sprint Skills

`/sdd:plan`, `/sdd:work`, `/sdd:review`, `/sdd:enrich`, and `/sdd:organize` MUST sync the issues collection on entry, regardless of staleness threshold, subject to the 5-minute deduplication window from the Issues Collection Sync requirement.

#### Scenario: /sdd:work runs after a teammate closes an issue in the browser

- WHEN `/sdd:work` runs and an issue was closed in the GitHub UI 30 seconds before
- THEN the issues sync MUST run (assuming the >5min dedup window has elapsed since the last sync, which it has not in this case — but if it had been >5min)
- AND the closed issue MUST appear with `status: closed` in `.sdd/issues/{N}.md` after the sync

#### Scenario: a Tier 4 sync fails mid-sprint

- WHEN the issues sync fails for `/sdd:plan` (e.g., GitHub rate limit)
- THEN the skill MUST fall back to live tracker queries (the pre-qmd path) for issue context within this run
- AND MUST emit a one-line warning: "Issues sync failed — degrading to live tracker queries for this run"
- AND MUST NOT block on the failure

### Requirement: CPU-Default-Background Embed Policy

`/sdd:index embed` (and any internal qmd-embed call from another skill) MUST detect GPU availability via `qmd status` and apply this policy:

- GPU present → run synchronously (foreground)
- CPU only → run as a backgrounded Bash command, log to `/tmp/qmd-embed-{repo}.log`, return the report immediately

The skill MUST accept `--foreground` and `--skip` flags as overrides. The skill MUST NOT prompt the user via AskUserQuestion to choose between modes — the hardware-aware default is the right behavior.

#### Scenario: CPU-only embed defaults to background

- WHEN `/sdd:index embed` runs on a machine where `qmd status` reports "running on CPU"
- THEN the embed command MUST be launched in the background with stdout/stderr redirected to `/tmp/qmd-embed-{repo}.log`
- AND the report MUST surface the log path and indicate that completion will be signaled by the harness's background-task notification

#### Scenario: GPU present runs synchronously

- WHEN `/sdd:index embed` runs on a GPU-enabled machine
- THEN the embed MUST run synchronously
- AND the report MUST include the embedded chunk count and elapsed time

#### Scenario: explicit foreground override on CPU machine

- WHEN `/sdd:index embed --foreground` runs on a CPU-only machine
- THEN the skill MUST honor the override and run synchronously
- AND MUST NOT background despite the CPU detection

### Requirement: qmd-Smart Drift Skills

`/sdd:check`, `/sdd:audit`, and `/sdd:discover` MUST use qmd hybrid retrieval to identify the top-K candidate ADRs, specs, and (for /sdd:discover) existing decisions before reading any artifact in full. The pre-v5 "read the entire corpus" path MUST be removed from these skills (it remains in older plugin versions, not in v5.0.0+).

For `/sdd:check {target}` and `/sdd:audit {target}`, the retrieval query MUST be derived from the target's content (file path, governing comment block, code summary). For `/sdd:discover`, the retrieval query MUST be the candidate decision the agent is about to suggest, used to rule out duplicates.

#### Scenario: /sdd:check identifies governing artifacts via qmd

- WHEN `/sdd:check src/auth/login.go` runs
- THEN the skill MUST construct a hybrid query from the file's path, the governing comment block (if present), and a summary of the file's exported symbols
- AND MUST retrieve the top-8 candidates from `{repo}-adrs` and `{repo}-specs` via qmd
- AND MUST read those candidates in full before evaluating drift

#### Scenario: /sdd:discover rules out duplicate decisions

- WHEN `/sdd:discover` is about to suggest "Use JWT for session tokens" as an implicit decision
- THEN the skill MUST first run a qmd query against `{repo}-adrs` for that suggestion
- AND IF a top result has cosine similarity ≥0.7 to the suggestion, the skill MUST NOT include the suggestion (an ADR likely already covers it)
- AND MUST log the suppressed suggestion + the matched ADR in the report's "Skipped" section

### Requirement: qmd-Smart Authoring Skills

`/sdd:adr` and `/sdd:spec` MUST pre-search the corresponding collection before writing the new artifact. The search query MUST be the user's description (from `$ARGUMENTS`) plus any context the agent has gathered. Top-K results MUST be surfaced to the user via AskUserQuestion as candidate frontmatter edges (`supersedes`, `extends`, `related` for ADRs; `requires`, `extends` for specs).

#### Scenario: /sdd:adr finds a related prior decision

- WHEN `/sdd:adr "Switch from REST to gRPC"` runs and the corpus contains ADR-0008 ("Use REST for the API")
- THEN the skill MUST surface ADR-0008 to the user via AskUserQuestion
- AND MUST offer "supersedes ADR-0008" as one of the candidate edges to include in the new ADR's frontmatter
- AND the user MUST be able to accept, reject, or modify each suggested edge

#### Scenario: /sdd:spec finds a prerequisite spec

- WHEN `/sdd:spec "Authentication"` runs and the corpus contains SPEC-0014 ("Token Validation")
- THEN the skill MUST surface SPEC-0014 to the user via AskUserQuestion
- AND MUST offer "requires SPEC-0014" as a candidate edge

#### Scenario: pre-search returns nothing relevant

- WHEN `/sdd:adr "Pick a CSV parsing library"` runs and qmd returns no results above the relevance threshold
- THEN the skill MUST proceed without surfacing edge suggestions
- AND MUST emit a one-line note: "No related artifacts found — drafting from scratch"

### Requirement: qmd-Smart Sprint Skills

`/sdd:plan`, `/sdd:work`, and `/sdd:review` MUST use qmd retrieval to inform their sprint-level decisions:

- `/sdd:plan` MUST search `{repo}-code` and `{repo}-issues` to size and frame stories accurately. Stories that touch existing code MUST be framed as "extend X in path/to/file" rather than "implement from scratch".
- `/sdd:work` workers MUST search `{repo}-code` for existing patterns (helpers, conventions, sibling implementations) before writing new code. This mitigates the duplicate-implementation drift the Foundation Story Detection pattern (per ADR-0017) was designed to catch.
- `/sdd:review` reviewers MUST search `{repo}-adrs` and `{repo}-issues` to identify ADRs the PR should reference and prior issues the PR touches.

#### Scenario: /sdd:plan recognizes existing code that solves part of a story

- WHEN `/sdd:plan SPEC-0019` runs and one requirement involves "user session management" while `{repo}-code` already contains a `internal/session/store.go` with relevant functions
- THEN the corresponding story body MUST reference the existing file ("extend `internal/session/store.go`")
- AND MUST size the story accordingly (smaller than greenfield)

#### Scenario: /sdd:work avoids re-creating an existing helper

- WHEN a `/sdd:work` worker is about to write a `parseUserID` helper and qmd retrieval surfaces an existing `internal/auth/parse.go:parseUserID` in `{repo}-code`
- THEN the worker MUST import the existing helper rather than create a duplicate
- AND MUST broadcast `TYPE_IMPORTED` per ADR-0017's Worker Communication Protocol

#### Scenario: /sdd:review surfaces a missing ADR reference

- WHEN `/sdd:review` is reviewing a PR that modifies authentication code and qmd retrieval against `{repo}-adrs` returns ADR-0011 (which governs auth) but the PR does not reference ADR-0011 in its body or governing comments
- THEN the reviewer MUST raise this as a finding ("Should this PR reference ADR-0011?")
- AND MUST cite the relevant ADR section that suggests the connection

### Requirement: qmd-Smart Context Loading

`/sdd:prime {topic}` MUST use qmd hybrid retrieval to identify the top-K most relevant ADRs and specs to the topic, then read those in full and present them. This replaces the pre-v5 "read every ADR + every spec, then filter" path. Untargeted `/sdd:prime` (no topic) MUST still load all artifacts, since the user has explicitly asked for a corpus overview.

#### Scenario: /sdd:prime with a topic argument

- WHEN `/sdd:prime auth` runs against a corpus of 23 ADRs and 18 specs
- THEN the skill MUST construct a qmd query from the topic and retrieve the top-K candidates from `{repo}-adrs` and `{repo}-specs`
- AND MUST read only those candidates in full before producing the prime report
- AND MUST NOT read every artifact in the corpus

#### Scenario: /sdd:prime with no topic

- WHEN `/sdd:prime` runs with no topic argument
- THEN the skill MUST behave as today: load all ADR / spec metadata for the overview table
- AND MUST NOT use qmd retrieval (no topic = no query to construct)

## Out of Scope (deferred to future specs)

- Tier 5 scheduled background sync (per ADR-0026 § "Tier 5") — deferred to v5.1 or later, after V1 ships and produces evidence about long-tail staleness cases
- A native qmd MCP extension exposing collection-add / context-add / update / embed as MCP tools — would let `/sdd:index` operate via MCP only and remove the CLI dependency. Tracked as an upstream qmd feature request.
- Cross-repo semantic queries — currently each repo's collections are siloed. A future spec might define a "this repo + my other indexed repos" mode for `/sdd:check` and similar.
- Issue-level frontmatter graph integration — the `references` block in synced issue files lists `SPEC-XXXX` and `ADR-XXXX` mentions, but these are NOT yet consumed by `/sdd:graph`. Integrating issues into the artifact graph (so an issue can be a node) is a separate spec.
