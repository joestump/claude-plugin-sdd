---
name: index
description: Index a repository's ADRs, OpenSpec specs, and source code into qmd collections for hybrid (BM25 + vector + reranker) semantic search. Use when the user says "index this repo", "load into qmd", "make my code/specs searchable", "set up qmd for this project", or wants agents to be able to search architecture artifacts and code semantically.
allowed-tools: Bash, Read, Glob, Grep, AskUserQuestion
argument-hint: [add|update|embed|status|remove] [--module <name>] [--foreground|--skip] [--reprobe]
---

<!-- Governing: ADR-0015 (Markdown-Native Configuration), ADR-0016 (Workspace Mode), ADR-0024 (qmd hard dependency), ADR-0025 (Tracker Issues as Fourth qmd Collection), ADR-0026 (Tiered Index Freshness), ADR-0031 (Embed-Session Retry Loop), ADR-0032 (qmd Version-Staleness Check), SPEC-0019 REQ "Issues Collection Layout", SPEC-0019 REQ "Issues Collection Sync via /sdd:index" -->

# Index Repository into QMD

Create per-repository [qmd](https://github.com/tobi/qmd) collections so agents and humans can run hybrid search across a repo's ADRs, OpenSpec specs, source code, and tracker issues from a single query plane. Each repository owns four collections (`{repo}-adrs`, `{repo}-specs`, `{repo}-code`, `{repo}-issues`) so searches can be filtered cleanly with `qmd query "..." -c {repo}-adrs`. The issues collection is populated by syncing the configured tracker into `.sdd/issues/{id}.md` files (per ADR-0025 and `references/tracker-sync.md`). Workspace projects (ADR-0016) get one set of collections per module: `{repo}-{module}-{kind}`.

## Process

<!-- Governing: ADR-0016 (Workspace Mode), SPEC-0014 REQ "Artifact Path Resolution" -->

0. **Resolve artifact paths**: Follow the **Artifact Path Resolution** pattern from `references/shared-patterns.md`. If `$ARGUMENTS` contains `--module <name>`, scope to that module; otherwise, in a workspace, iterate all modules. The resolved ADR directory is `{adr-dir}` and spec directory is `{spec-dir}`, both per-module in workspace mode.

### Step 1: Parse Subcommand

Read `$ARGUMENTS`. The first positional token (ignoring `--module <name>`) selects the operation:

| Token | Operation |
|-------|-----------|
| `add` | Create collections only — do not embed |
| `update` | Re-index existing collections (`qmd update`) |
| `embed` | Generate or refresh vector embeddings (`qmd embed --chunk-strategy auto`) |
| `status` | Show qmd status filtered to this repo's collections |
| `remove` | Drop this repo's collections (asks for confirmation) |
| _(none)_ | Default: add (or update if collections exist) → embed |

### Step 2: Preflight Checks

Before doing anything else, verify the environment. Each check has its own short-circuit message — do not chain them silently. Checks 4 and 5 are non-blocking diagnostics: they emit warnings rendered at the top of the final report (see **Report Banner** in Step 5) but do not stop the operation. Checks 1–3 are hard preconditions and stop the skill on failure.

1. **qmd installed**: Run `command -v qmd >/dev/null 2>&1`. If missing, output and stop:

   ```
   qmd CLI not found. Install it with `npm install -g @tobilu/qmd` (or `bun install -g @tobilu/qmd`), then re-run this skill. See https://github.com/tobi/qmd for details.
   ```

2. **Inside a git repository**: Run `git rev-parse --show-toplevel`. If it fails, output: "Not inside a git repository. `/sdd:index` derives the collection name from the repo root — `cd` into a checkout and try again." Then stop.

3. **CLAUDE.md exists with SDD references**: Read `CLAUDE.md` at the project root (or module root if `--module` is set). If it does not exist or lacks references to an ADR/spec directory, output:

   ```
   CLAUDE.md does not have SDD plugin references. Run `/sdd:init` first so this skill knows where to find ADRs and specs.
   ```

   Then stop. The skill needs CLAUDE.md to know the ADR/spec paths and to extract the per-collection context summary (Step 4).

4. **qmd version staleness check** (non-blocking; Governing: ADR-0032). Read the cache at `~/.cache/sdd-plugin/qmd-version.json`. Schema:

   ```json
   { "latest": "2.1.3", "checked_at": "2026-05-04T10:30:00Z" }
   ```

   - **Cache miss or stale (>7 days)**: refresh via `npm view @tobilu/qmd version 2>/dev/null`. Write the result back to the cache file (creating `~/.cache/sdd-plugin/` if absent). On any failure (offline, registry timeout, npm not in PATH), silently skip the warning — DO NOT block, DO NOT error. Network failures are common and should never gate indexing.
   - **Cache hit (≤7 days old)**: use the cached `latest` value as-is — no `npm view` call.
   - Read installed version: `qmd --version 2>&1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+'`.
   - If installed `<` latest (semver compare on major.minor.patch — pure numeric, no prerelease handling needed for qmd's release pattern), set the report banner:

     ```
     ⚠ qmd {installed} installed; {latest} available — `npm install -g @tobilu/qmd` (may include embed-session-timeout fixes)
     ```

   The banner renders at the top of every report template (see Step 5). If versions match, no banner.

5. **qmd hardware mode** (non-blocking; Governing: ADR-0026 embed policy, ADR-0031 retry loop). Determines GPU vs. CPU for embed scheduling. The previous detection technique — scanning `qmd status` for the "running on CPU" warning — is structurally wrong because the warning emits only when the embedding model loads (during `qmd embed`), never in `qmd status`. Replaced with a cached probe of qmd's own emitted output.

   Read the cache at `~/.cache/sdd-plugin/qmd-hardware.json`. Schema:

   ```json
   { "qmd_version": "2.1.0", "qmd_path": "/usr/bin/qmd", "hardware": "cpu", "detected_at": "2026-05-04T10:30:00Z" }
   ```

   - **Cache hit AND qmd_version matches `qmd --version` AND qmd_path matches `command -v qmd`**: use the cached `hardware` value (`gpu` or `cpu`). Skip the probe.
   - **Cache miss, version mismatch, path mismatch, or `--reprobe` flag in `$ARGUMENTS`**: defer detection to the first embed run — see **Operation: embed** Step 1 below. Until then, **assume CPU** (conservative default; worst case is a backgrounded fast embed for a GPU machine on first run).
   - The cache is keyed by `(qmd_version, qmd_path)` so an upgrade or relocation of qmd invalidates it automatically. The cache file is treated as untrusted input — if it fails to parse as JSON or is missing required fields, treat as a cache miss.

   Surface the resolved hardware as a one-line note in the report header (`Hardware: GPU (cached)` or `Hardware: CPU (cached)` or `Hardware: assumed CPU (probing on next embed)`).

6. **qmd install writability** (non-blocking; surfaces as report warning). When qmd was installed via `sudo npm install -g`, its `node-llama-cpp` GPU build artifacts cannot be written under `/usr/lib/node_modules/...` by a non-root user, which silently forces CPU mode even on GPU machines. Detect:

   ```bash
   qmd_root=$(npm root -g 2>/dev/null)/@tobilu/qmd/node_modules/node-llama-cpp/llama
   if [ -d "$qmd_root" ] && [ ! -w "$qmd_root" ]; then
     # surface warning
   fi
   ```

   If unwritable, surface the diagnosis in the report (DO NOT auto-fix — destructive ownership changes need user consent):

   ```
   ⚠ qmd installed at {npm-root-g}/@tobilu/qmd is not writable by $USER.
   node-llama-cpp cannot build GPU artifacts under it; embeds will fall back to CPU (~3.4s/chunk).
   Fix options:
     1. Reinstall under your home: npm config set prefix ~/.npm-global && npm install -g @tobilu/qmd
     2. Take ownership: sudo chown -R $USER {npm-root-g}/@tobilu/qmd/node_modules/node-llama-cpp
   ```

   If `npm root -g` fails or the path does not exist, skip silently — qmd may be installed via a different package manager (bun, manual build) that doesn't have this problem.

### Step 3: Derive Collection Names

1. Compute the repo slug:

   ```bash
   git rev-parse --show-toplevel | xargs basename | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g'
   ```

2. Build the collection name set (per ADR-0025 / SPEC-0019, the issues collection is the fourth per-repo collection alongside adrs, specs, and code):
   - **Single-module project** (no workspace, or `--module` provided): `{repo}-adrs`, `{repo}-specs`, `{repo}-code`, `{repo}-issues`. Where `{repo}` is the slug from step 3.1, plus the module name when `--module` is provided (e.g., `stumpcloud-infra-adrs`).
   - **Workspace aggregate mode** (no `--module`, multiple modules detected): one quadruple per module — `{repo}-{module}-adrs`, `{repo}-{module}-specs`, `{repo}-{module}-code`, `{repo}-{module}-issues`. The skill iterates Steps 4–7 once per module.

3. Resolve absolute paths for each collection's source directory:
   - `*-adrs` → `{module-root}/{adr-dir}` (from Step 0)
   - `*-specs` → `{module-root}/{spec-dir}` (from Step 0)
   - `*-code` → `{module-root}` (the entire repo or module root)
   - `*-issues` → `{module-root}/.sdd/issues/` (the local sync cache populated from the configured tracker — see Step 4 `add` operation sub-step 6 and the `update` operation issues sync)

### Step 4: Dispatch to the Operation

Route to one of the operations below based on Step 1's subcommand. Each operation assumes Steps 2–3 already ran.

#### Operation: add

For each collection in the name set:

1. **Skip if it already exists**: Run `qmd collection list` and check whether the collection name appears. If it does, note it as `already-exists` and continue to the next collection — `qmd collection add` is a no-op on an existing name and will NOT refresh the mask or path. To change either, the user must `qmd collection remove {name}` first (or use `/sdd:index remove` then `/sdd:index add`).

2. **Skip if the source directory is missing**: For the ADR or spec collection, if its source directory does not exist, warn `"Skipping {name}: {path} does not exist."` and continue. Do not skip the code collection — the module root always exists.

3. **Build the file mask**. The qmd CLI takes only `--name` and `--mask` (no `--ignore` flag). qmd already auto-excludes `node_modules/`, `.git/`, `.cache/`, `vendor/`, `dist/`, and `build/` at the indexer level (see `store.js` `excludeDirs`), so the mask only needs to set what to *include*:
   - ADR collection: `--mask "ADR-*.md"` (matches the MADR filename convention from ADR-0003)
   - Spec collection: `--mask "**/*.md"` (catches both `spec.md` and `design.md`)
   - Issues collection: `--mask "*.md"` (the synced issue files are flat under `.sdd/issues/`, one per issue, named `{id}.md` per ADR-0025 sub-decision 1)
   - Code collection: derive the mask from what is actually in the repo. Rank tracked extensions:

     ```bash
     git ls-files | grep -oE '\.[a-zA-Z0-9]+$' | sort | uniq -c | sort -rn
     ```

     Build a brace-expansion glob covering the dominant languages plus `md`. For a Go + Markdown repo: `--mask "**/*.{go,md}"`. For a TypeScript + Python repo: `--mask "**/*.{ts,tsx,py,md}"`. Always include `md` so README files and inline design notes get indexed alongside code.

4. **Create the collection**:

   ```bash
   qmd collection add "{absolute-path}" --name "{collection-name}" --mask "{mask}"
   ```

   qmd prints "{N} unique hashes need vectors" after each successful add. **These per-add counts are NOT additive across collections** because qmd dedupes chunks globally — the same file mentioned in multiple collections only counts once toward the index-wide pending total. Do not sum them in the final report. Instead, after all `qmd collection add` calls complete, run `qmd status` (or call the qmd MCP `status` tool) once to obtain the authoritative index-wide pending count, and use that single number in the report.

5. **Attach a context summary**. qmd's reranker uses these strings as a relevance signal — strong context here pays off on every future query against the collection. The single biggest quality variable is *information density*: a 70-word summary that names actual libraries, file types, decision themes, and content scope produces dramatically better reranker behavior than three vague sentences. Skeletal templates produce skeletal context.

   **Information checklist** (the summary SHOULD cover all four — drop a bullet only if the repo genuinely lacks it):

   - **Project domain** — what the project does in plain language ("self-hosted Proton Mail relay", "music library manager with multi-DB persistence", not "this project uses X plugin")
   - **Primary languages with versions where relevant** — "Go 1.22", "TypeScript with React 18 + HTMX", "Python 3.12 with FastAPI" — versions matter for code-collection retrieval
   - **Named libraries, frameworks, or domain technologies** — "Ent ORM, sqlx, goose migrations, Cobra CLI", "Docusaurus theme, MDX, Mermaid", "go-proton-api, OpenPGP, SRP login" — specific names are reranker gold
   - **Content scope unique to this collection** — for `*-adrs`: dominant decision themes and the MADR format; for `*-specs`: what capabilities the specs govern, OpenSpec spec.md+design.md pairing; for `*-code`: what's in scope (and what qmd's built-in excludes already strip)

   **Worked example** — context strings actually attached to this very repo's collections, written to the checklist above:

   - `*-adrs`: *"Architecture Decision Records for the claude-plugin-sdd project — a Claude Code plugin for spec-driven development with ADR governance, OpenSpec specs, sprint planning, parallel implementation, and code review. MADR format. Decision themes include workspace mode, drift detection, scrum mode, frontmatter DAG, and qmd integration."*
   - `*-specs`: *"OpenSpec specifications for the claude-plugin-sdd project — paired spec.md and design.md files with RFC 2119 requirements governing the SDD plugin's skills (init, prime, check, audit, plan, work, review, index, graph) and the workflows that compose them."*
   - `*-code`: *"Source for claude-plugin-sdd — a Claude Code plugin for spec-driven development. Languages: Markdown/MDX (skill bodies, ADRs, specs), TypeScript/TSX/JS (Docusaurus theme), JSON (plugin manifest, eval fixtures), some Python (helper scripts). qmd's built-in excludes already strip node_modules, .git, .cache, vendor, dist, build."*

   **Per-collection skeleton** — start from these and fill in with the checklist; never ship the skeleton verbatim:

   - `*-adrs`: "Architecture Decision Records for the {repo} project — {project domain in plain language}. MADR format. Decision themes: {3-5 dominant themes from scanning ADR titles}."
   - `*-specs`: "OpenSpec specifications for the {repo} project — paired spec.md and design.md files with RFC 2119 requirements governing {what the specs govern, derived from spec titles}."
   - `*-code`: "Source for {repo} — {project domain}. Languages: {detected languages with versions}. Named libraries: {top 3-5 from imports/manifests}."

   Attach via:

   ```bash
   qmd context add "qmd://{collection-name}/" "{summary}"
   ```

   The trailing slash is the canonical form for collection-root context. qmd silently appends one if you omit it, but writing it explicitly keeps the command and stored state in sync.

   If CLAUDE.md is too thin to derive a domain description (or the repo lacks one entirely), use `AskUserQuestion` to ask the user for a one-line project description, then synthesize the rest from `git ls-files` extension counts and from scanning ADR/spec titles. Don't ship a vague summary just because CLAUDE.md was thin — the reranker quality cost is real.

6. **Issues collection initial sync** (per ADR-0025 / SPEC-0019 REQ "Issues Collection Sync via /sdd:index"). The `*-issues` collection is unique among the four — its source directory `.sdd/issues/` is initially empty (no synced issue files exist until the first sync). Before running `qmd collection add` for the issues collection, run an initial sync via the tracker-sync layer to populate `.sdd/issues/`:

   1. Detect the configured tracker per the **Tracker Detection** flow in `references/shared-patterns.md`. If no tracker is detected, skip the issues collection entirely with a one-line warning ("No tracker configured — skipping `{repo}-issues` collection. Run `/sdd:init` to configure a tracker, or use the tasks.md fallback per ADR-0007."). Continue with the other three collections.
   2. If a tracker is detected, invoke the per-tracker fetch+normalize per `references/tracker-sync.md` § "Per-Tracker Sync" → relevant tracker section. The sync writes one `.sdd/issues/{id}.md` file per open and recently-closed issue, using the canonical frontmatter schema documented in `tracker-sync.md` § "Canonical Frontmatter Schema".
   3. After the sync completes, write the cursor to `.sdd/issues/_meta.json` per `tracker-sync.md` § "Cursor Management".
   4. Then proceed with `qmd collection add` for the `*-issues` collection per the steps above.
   5. The context summary for the issues collection (sub-step 5) SHOULD describe the tracker source and the issue scope, e.g.: *"Tracker issues for the {repo} project — synced from {tracker} ({owner}/{repo}). Each file under `.sdd/issues/` is one issue with frontmatter (id, status, labels, assignees, created/updated, references to specs/ADRs and dependencies) and the verbatim issue body. Open and recently-closed issues both appear; closed issues retain `status: closed` and `closed: {timestamp}` fields."*

   On sync failure (rate limit, auth, network), surface the error per `tracker-sync.md` § "Failure Modes and Degradation" and skip the issues collection — the other three collections still get created.

#### Operation: update

1. Verify this repo's collections exist in `qmd collection list`. If none exist, output: "No qmd collections found for {repo}. Run `/sdd:index add` first." and stop.
2. Note the global scope to the user before invoking: `qmd update` re-scans **every** collection in the user's index. qmd does not currently expose per-collection filtering on `update` and there is no shell-level workaround — a per-repo update would have to come from upstream qmd. If `qmd collection list` shows collections that do not belong to this repo, surface their count so the user understands what is about to happen.
3. **Issues collection re-sync first** (per SPEC-0019 REQ "Issues Collection Sync via /sdd:index"). Before running `qmd update`, re-fetch tracker issues into `.sdd/issues/` so the qmd file scan picks up new and changed issues. Use the per-tracker fetch+normalize per `references/tracker-sync.md`, with the cursor from `.sdd/issues/_meta.json` for incremental sync. Print a one-line note: "Syncing N issues from {tracker}…". On sync failure, surface the error and continue with the existing local cache (per `tracker-sync.md` § "Failure Modes and Degradation").
4. Run `qmd update`.
5. After the update, prompt the user via `AskUserQuestion` whether to re-embed now (the embed operation below). New documents are not searchable via vector/hybrid search until they are embedded.

#### Operation: embed

Per ADR-0026's embed policy, this operation runs silently with a hardware-aware default. No `AskUserQuestion` prompt — prompting CPU users every time produced the same answer 95% of the time and was friction the user did not want. Per ADR-0031, embed runs are wrapped in a bounded retry loop because qmd's embed sessions abort at ~30 minutes on CPU.

1. **Resolve hardware mode** from the cache populated in Step 2 sub-step 5. Three states:

   - `gpu` (cached) — proceed in foreground by default
   - `cpu` (cached) — proceed in background by default
   - `assumed cpu (probing)` — first invocation with no cache. Proceed in **background** (conservative default), AND tee stderr to the embed log so the post-run probe (Step 4b below) can detect the actual hardware mode and write the cache.

   Override precedence: explicit `--foreground` / `--skip` flags in `$ARGUMENTS` always win over the cached default.

2. **Choose mode** based on hardware and explicit flags in `$ARGUMENTS`:

   | Hardware | Flag | Mode |
   |----------|------|------|
   | GPU | _(default)_ | Foreground (fast — no reason to background) |
   | CPU | _(default)_ | Background (do not block the session — embedding takes ~1s/chunk on CPU) |
   | _any_ | `--foreground` | Foreground (user wants chunk counts inline) |
   | _any_ | `--skip` | No-op — print "Embed skipped per --skip flag" and exit |

3. **Pre-embed scope disclosure** (concrete cross-repo accounting). `qmd embed` operates on the entire qmd index — it generates embeddings for any unembedded chunks across all collections, not just this repo's. Before invoking it, call `qmd status` (or the qmd MCP `status` tool) to get the authoritative scope:

   - **Total pending across the index**: the `needsEmbedding` field
   - **Pending attributable to this repo**: identify this-repo collections via **exact prefix match** on the collection name — a collection belongs to this repo if and only if its name equals `{slug}-adrs`, `{slug}-specs`, `{slug}-code`, or `{slug}-issues` (or `{slug}-{module}-{kind}` in workspace mode, where `{kind}` is one of `adrs`/`specs`/`code`/`issues`). **Do NOT use substring match**: a slug like `myrepo` would otherwise spuriously claim collections like `not-myrepo-adrs` belonging to a sibling repo. Match against the full collection name from `collections[]`. To estimate this-repo-pending, sum `(documents - embedded)` across the matched collections (per-collection embedded count comes from `qmd ls {collection}` or by tracking the diff before/after the most recent `qmd update`).
   - **Pending attributable to other repos**: total minus this-repo's share. Sample 2-3 of the other repo names from the unmatched collections (strip the trailing `-{kind}` segment to recover the slug) so the user sees concretely *whose* chunks they are about to embed.

   Surface this in the report concretely:

   > "Pending across the index: **{total} chunks**. Of those, **{this} are from {repo}**; **{other} are from {N} other indexed repos** ({sample-repo-slug-1}, {sample-repo-slug-2}, …). Embedding will process all of them in this run."

   This replaces the abstract "operates on the entire index" callout. Users with a single indexed repo see "0 from other repos" and the line is short; users with several repos see the cross-repo cost upfront and can choose to skip (`--skip`) and batch later.

4. **Run the chosen mode inside a bounded retry loop** (Governing: ADR-0031). qmd's embed sessions abort at ~30 minutes with `Session expired — skipping N remaining chunks` and exit 0 — a partial completion that the previous version of this skill mistook for full success. The retry loop closes that gap.

   **Single round** is one invocation of:

   ```bash
   # Foreground
   qmd embed --chunk-strategy auto

   # Background
   qmd embed --chunk-strategy auto > /tmp/qmd-embed-{repo}.log 2>&1
   ```

   The `--chunk-strategy auto` flag uses tree-sitter for Go/TS/JS/Python/Rust files (cleaner chunks at function/class boundaries) and falls back to regex for everything else, including markdown. This produces dramatically better code-search recall than regex chunking and is non-negotiable for code collections.

   **Loop control** (foreground mode — runs inline in the skill body):

   ```
   round=1
   max_rounds=5
   while round <= max_rounds:
     run single round, capture stderr to /tmp/qmd-embed-{repo}.log
     re-read `qmd status` → record `needsEmbedding`
     if needsEmbedding == 0: break (full success)
     if NOT (last log contains "Session expired" OR "skipping remaining"): break (genuine error, not a timeout)
     round += 1
   ```

   Cap at **5 rounds**. Five 30-minute sessions covers ~2.5 hours of CPU embed wall time, which is enough for any reasonable repo (the user's stumpcloud poly-repo at 1181 chunks finishes in 2-3 rounds). If the cap is hit with `needsEmbedding > 0` still pending, surface in the report:

   ```
   ⚠ Embed retry cap hit ({max_rounds} rounds, ~{total_minutes}min wall time). {N} chunks still pending.
   This usually means qmd is hitting the same chunks repeatedly without progress — possible chunk-level error.
   Inspect /tmp/qmd-embed-{repo}.log for "Failed to embed" lines, then re-run `/sdd:index embed` to continue.
   ```

   **Loop control** (background mode — runs inside the backgrounded shell wrapper, NOT the foreground skill body, so the user gets the prompt back immediately):

   ```bash
   (
     for round in 1 2 3 4 5; do
       qmd embed --chunk-strategy auto >> /tmp/qmd-embed-{repo}.log 2>&1
       pending=$(qmd status | awk '/Pending:/ {print $2}')
       [ "$pending" = "0" ] && break
       grep -qE 'Session expired|skipping remaining' /tmp/qmd-embed-{repo}.log || break
     done
   ) &
   ```

   The harness completion notification fires when the outer subshell exits.

4a. **Surface multi-round nature in the report**. After the loop completes (foreground) OR is launched (background), include in the report:

   ```
   Embedded {total_chunks} chunks across {rounds_completed} round(s).
   {if rounds_completed > 1: "(qmd embed sessions expire at ~30min on CPU; auto-relaunched per ADR-0031.)"}
   ```

   This makes the multi-round behavior legible — users running long CPU embeds need to understand why their 1-hour wall time produced multiple log entries.

4b. **Hardware probe from stderr** (only when Step 1 hardware was `assumed cpu (probing)`). After at least one round has produced output to `/tmp/qmd-embed-{repo}.log`, parse that log for the canonical CPU sentinel:

   ```bash
   if grep -qiE 'running on cpu|gpu .* not available|cuda .* not found' /tmp/qmd-embed-{repo}.log; then
     hardware="cpu"
   else
     hardware="gpu"
   fi
   ```

   Write the result to `~/.cache/sdd-plugin/qmd-hardware.json` per Step 2 sub-step 5's schema, including the current `qmd --version` and `command -v qmd` for cache invalidation. On the next invocation, Step 2 sub-step 5 reads this directly without probing.

   In background mode, the probe runs inside the same backgrounded wrapper after the retry loop completes, so the cache is populated by the time the next skill invocation starts.

5. **Background mode reporting**: When backgrounded, the report uses the "After `embed` (background)" template below. The completion notification from the harness lands in the next session turn; the user can also run `/sdd:index status` to check progress against the log file.

#### Operation: status

1. Run `qmd status` and capture the output. Extract `needsEmbedding` (the index-wide pending count).
2. Run `qmd collection list` and filter to rows whose name starts with the repo slug (or `{repo}-{module}-` in workspace mode).
3. **Compute failed-vs-pending breakdown**. qmd does not currently expose a "failed chunks" field in `qmd status` (and ADR-0024 forbids reading the sqlite index directly). Approximate by parsing `/tmp/qmd-embed-{repo}.log` for the most recent run's session-expired tail:

   ```bash
   if [ -f /tmp/qmd-embed-{repo}.log ]; then
     # Count "skipping remaining" mentions in the tail of the most recent embed run.
     # Each "Session expired" line is followed by a count: "skipping N remaining chunks".
     failed=$(grep -oE 'skipping ([0-9]+) remaining chunks' /tmp/qmd-embed-{repo}.log | tail -1 | grep -oE '[0-9]+')
   fi
   ```

   - `embedded` = `Documents.Vectors` from `qmd status`
   - `pending_total` = `Documents.Pending` from `qmd status`
   - `failed_prior_run` = the count parsed above (0 if no log exists or no "skipping" lines found)
   - `pending_never_tried` = `pending_total - failed_prior_run` (clamped to ≥0; if the math goes negative, the log is from a stale run — fall back to 0 failed)

   Render under a new `### Index Health` section in the report. When `failed_prior_run > 0`, include a remediation hint:

   ```
   {failed} chunks failed on the prior embed run (session expired).
   Re-run `/sdd:index embed` — the retry loop (ADR-0031) will pick them up.
   ```

   Note: this is a best-effort estimate. The log file is global per repo (not per round), so if multiple embed runs have happened since the last log rotation, the number may be conservative. Surface as "approximate" in the report when the log is older than 24h.

4. Render the filtered view in the templated output format below. If the most recent embed log contains a "running on CPU" warning, surface that under `### Index Health` alongside the Hardware row from Step 2 sub-step 5.

#### Operation: remove

1. Compute the same collection name set as Step 3 (so workspace mode removes all per-module triples for the repo unless `--module` narrows it).
2. Use `AskUserQuestion` to confirm with the exact collection list and document counts. Removing a collection drops its index entries and embeddings — this is destructive and not undoable without re-indexing.
3. On confirmation, run `qmd collection remove {name}` for each collection in turn. Report which were removed and which did not exist.

#### Operation: (default — no subcommand)

Detect the right path automatically:
- If `qmd collection list` shows none of this repo's collections → run `add` then `embed`.
- If at least one of this repo's collections exists → run `update` then offer `embed` via `AskUserQuestion`.

Tell the user which path was taken at the top of the report so the auto-routing is not surprising.

### Step 5: Render the Report

Use the template that matches the operation. In workspace aggregate mode, render one collection table per module under per-module subheadings (`### [api] Collections`, `### [worker] Collections`).

**Report Banner**: every report template below begins with a banner section that surfaces non-blocking preflight warnings from Step 2 sub-steps 4–6. The banner is omitted entirely when there are no warnings. Banner format:

```
{if version-staleness warning from sub-step 4: render that line}
{if install-writability warning from sub-step 6: render that block}
{if Hardware row was "assumed cpu (probing)" and probe just completed: "Detected hardware: {gpu|cpu} (cached for future runs)"}
```

Render the banner BEFORE the report's `## QMD ...` heading so it is the first thing the user sees.

## Output

### After `add` or default first run

```
{Report Banner — see Step 5}

## QMD Index Created for {repo}

{If invoked with no subcommand, include this line:}
Auto-routed: collections did not exist → ran `add` then started `embed` ({foreground|background|skipped}).

### Collections
| Name | Source | Documents | Embedded |
|------|--------|-----------|----------|
| {repo}-adrs | {abs path to ADR dir} | {N} | {yes/no/in-progress} |
| {repo}-specs | {abs path to spec dir} | {N} | {yes/no/in-progress} |
| {repo}-code | {abs path to module root} | {N} | {yes/no/in-progress} |
| {repo}-issues | `.sdd/issues/` (synced from {tracker}) | {N} | {yes/no/in-progress} |

{Optional one-line note: total unique chunks queued for embedding, and a reminder that qmd auto-excludes node_modules/.git/.cache/vendor/dist/build.}

### Search Examples
- ADRs only: `qmd query "{topic from a recent ADR title}" -c {repo}-adrs`
- Code only: `qmd query "{a function or pattern likely in the codebase}" -c {repo}-code`
- Issues only: `qmd query "{topic from an open issue}" -c {repo}-issues`
- Across architecture: `qmd query "..." -c {repo}-adrs -c {repo}-specs`
- Via the qmd MCP server: call its `query` tool with `collections: ["{repo}-adrs"]`

### Next Steps
{If embed is in-progress: include "Background embed running — log: /tmp/qmd-embed-{repo}.log. Re-run `/sdd:index status` to check progress."}
{If skipped: include "Run `/sdd:index embed` — semantic and hybrid search are disabled until vectors exist."}
- After adding new ADRs/specs/code, re-run `/sdd:index update`
- The qmd MCP server (`mcp__plugin_qmd_qmd__*` tools, if you have the qmd plugin loaded) sees new collections immediately — no Claude Code restart required. Verified empirically against running sessions.
- Consider recording this with `/sdd:adr "Adopt qmd for cross-repo semantic search"` — there is no ADR for this yet
```

### After `update`

```
## QMD Index Updated for {repo}

### Indexed
| Collection | Added | Modified | Removed |
|------------|-------|----------|---------|
| {repo}-adrs | {a} | {m} | {r} |
| {repo}-specs | {a} | {m} | {r} |
| {repo}-code | {a} | {m} | {r} |
| {repo}-issues | {a} | {m} | {r} |

{N} documents need re-embedding to become searchable via vector/hybrid query.

### Next Steps
- Run `/sdd:index embed` to refresh vectors for the {N} new/modified documents
```

### After `embed` (foreground)

```
{Report Banner — see Step 5}

## QMD Embeddings {Generated|Refreshed}

Embedded {N} chunks across {M} collections in {duration} ({rounds} round{s}).
{if rounds > 1: "(qmd embed sessions expire at ~30min on CPU; auto-relaunched per ADR-0031.)"}

### Embedded Collections
| Collection | Documents | Chunks |
|------------|-----------|--------|
| {repo}-adrs | {N} | {C} |
| {repo}-specs | {N} | {C} |
| {repo}-code | {N} | {C} |
| {repo}-issues | {N} | {C} |

{if retry cap was hit with pending > 0: render the retry-cap warning block from Operation: embed Step 4}

Hybrid search (`qmd query`) and vector search (`qmd vsearch`) are now available.
```

### After `embed` (background — embed kicked off, not yet complete)

```
{Report Banner — see Step 5}

## QMD Embeddings In Progress for {repo}

Embedding ~{N} chunks in the background (up to 5 rounds, ~30min each on CPU; will auto-stop at 0 pending or 5 rounds).
Log: `/tmp/qmd-embed-{repo}.log`. Re-run `/sdd:index status` to check progress, or wait for the background completion notification.

While it runs, BM25 keyword search via `qmd search -c {repo}-{...}` is already available; vector and hybrid search will turn on as embeddings land.
```

### After `status`

```
{Report Banner — see Step 5}

## QMD Status for {repo}

### Collections
| Name | Documents | Vectors | Last Modified | Source |
|------|-----------|---------|---------------|--------|
| {repo}-adrs | {N} | {V} | {timestamp} | {abs path} |
| {repo}-specs | {N} | {V} | {timestamp} | {abs path} |
| {repo}-code | {N} | {V} | {timestamp} | {abs path} |
| {repo}-issues | {N} | {V} | {timestamp} | `.sdd/issues/` (last sync: {iso-timestamp}) |

### Index Health
- Index: {path to sqlite} ({size})
- Hardware: {GPU | CPU} ({cached|probing})
- Embedded: {V} chunks
- Pending (never tried): {pending_never_tried}
- Failed (prior run): {failed_prior_run} {if approximate: "(approximate — log >24h old)"}
- {if failed > 0: render the remediation hint from Operation: status Step 3}
- {if log contains "running on CPU" and Hardware = CPU: "Confirmed: qmd is running on CPU (per /tmp/qmd-embed-{repo}.log)"}
- {Any other qmd status warnings, verbatim}
```

### After `remove`

```
## QMD Collections Removed for {repo}

| Name | Status |
|------|--------|
| {repo}-adrs | removed ({N} documents dropped) |
| {repo}-specs | removed ({N} documents dropped) |
| {repo}-issues | removed ({N} documents dropped); `.sdd/issues/` cache preserved (gitignored) |
| {repo}-code | removed ({N} documents dropped) |

To rebuild the index later, run `/sdd:index`.
```

### Workspace aggregate mode

In aggregate mode, render one section per module before the report's shared sections (Health, Next Steps):

```
## QMD Index {Created|Updated} for {repo} ({K} modules)

### [api] Collections
| Name | Source | Documents | Embedded |
|------|--------|-----------|----------|
| {repo}-api-adrs | ... | ... | ... |
| {repo}-api-specs | ... | ... | ... |
| {repo}-api-code | ... | ... | ... |

### [worker] Collections
| Name | Source | Documents | Embedded |
|------|--------|-----------|----------|
| {repo}-worker-adrs | ... | ... | ... |
| ...

### Search Examples
- Single module: `qmd query "..." -c {repo}-api-adrs`
- All modules' ADRs: `qmd query "..." -c {repo}-api-adrs -c {repo}-worker-adrs`

### Next Steps
- Scope a future run to one module: `/sdd:index update --module api`
```

## Rules

- MUST run preflight checks (qmd installed, in git repo, CLAUDE.md present) before any side-effecting `qmd` command — partial failures are confusing and hard to undo
- MUST derive the repo name from `git rev-parse --show-toplevel` rather than the current working directory; users may invoke from a subdirectory
- MUST use the **Artifact Path Resolution** pattern from `references/shared-patterns.md` instead of hardcoding `docs/adrs/` or `docs/openspec/specs/` — repos can override these paths in CLAUDE.md (Governing: ADR-0015)
- MUST create four collections per repo (or per module in workspace mode): `-adrs`, `-specs`, `-code`, and `-issues` — collection-level filtering (`-c <name>`) is the primary mechanism users will use to keep different content types separate. The issues collection MAY be skipped (with a warning) when no tracker is configured per ADR-0007 (Governing: ADR-0025, SPEC-0019 REQ "Issues Collection Layout")
- MUST run an issues sync via `references/tracker-sync.md` BEFORE running `qmd collection add` for the issues collection in the `add` operation — the source directory `.sdd/issues/` is initially empty, so the collection has nothing to scan until the first sync writes the markdown files (Governing: SPEC-0019 REQ "Issues Collection Sync via /sdd:index")
- MUST run an issues sync via `references/tracker-sync.md` BEFORE `qmd update` in the `update` operation — fresh issue state must land in `.sdd/issues/` before the file scan picks up the changes
- MUST attach a `qmd context add` summary to every collection — qmd's reranker uses context strings to disambiguate results, and uncontextualized collections produce noisier hybrid scores
- MUST use `--chunk-strategy auto` when embedding so code files chunk on AST boundaries (function, class, import) instead of arbitrary character offsets — produces dramatically better code search recall
- MUST detect existing collections via `qmd collection list` before re-creating; re-running `add` on an existing collection is a no-op in qmd but will not refresh path or mask, so a stale config can persist silently
- MUST surface that `qmd update` and `qmd embed` operate on the entire qmd index (no per-collection filter exists). For embed specifically, MUST do this concretely with the pre-embed scope disclosure in the embed Process step — abstract callouts are easy to gloss over; named other-repo counts force the user to register the cost
- MUST NOT sum the per-collection "{N} unique hashes need vectors" output that `qmd collection add` prints — those numbers are pre-dedup and overstating the embed scope confuses users. Use the index-wide count from `qmd status` (or the qmd MCP `status` tool) as the authoritative number in the report
- MUST offer the three-way background/foreground/skip choice via `AskUserQuestion` before `qmd embed` on a CPU-only machine, with **background** as the recommended default — embedding the EmbeddingGemma 300M model on CPU runs at roughly 1s per chunk and a foreground embed silently blocks the session for many minutes
- MUST write `qmd context add` paths with an explicit trailing slash (`qmd://{collection-name}/`) — qmd auto-appends one when omitted, so writing it explicitly keeps the issued command and stored state in sync and avoids confusion when a user later inspects context with `qmd context list`
- MUST rely on qmd's built-in directory excludes (`node_modules/`, `.git/`, `.cache/`, `vendor/`, `dist/`, `build/`) rather than trying to construct exclude patterns — qmd's CLI does not accept an `--ignore` flag, and the built-in list already covers the common dependency/output directories
- MUST confirm via `AskUserQuestion` before `remove` — dropping a collection deletes embeddings that take real time and (on CPU) significant compute to regenerate
- MUST NOT modify `.claude-plugin/plugin.json` — skills auto-discover from `skills/`; touching the manifest causes plugin reload churn
- MUST NOT create the `docs/adrs/` or `docs/openspec/specs/` directories if they are absent — that is the job of `/sdd:adr` and `/sdd:spec`. Skip the corresponding collection with a warning instead.
- MUST suggest recording this capability with `/sdd:adr` in the report — no ADR exists yet for adopting qmd, and the user explicitly noted this is an architectural decision worth documenting after the skill is in use
- In workspace aggregate mode, MUST iterate per-module and prefix collections as `{repo}-{module}-{kind}` so the same `--module` filter works in both `/sdd:index` and `/sdd:check`
- When `--module` is provided, MUST scope to that single module — do not touch sibling modules' collections
- MUST detect qmd hardware mode via the cached probe at `~/.cache/sdd-plugin/qmd-hardware.json` (Step 2 sub-step 5) — MUST NOT scan `qmd status` output for the "running on CPU" warning (the warning emits during `qmd embed` model-load only, never in `qmd status`; this was a real-world bug). MUST NOT read filesystem markers under `~/.cache/qmd/` to infer hardware — couples to qmd internals (Governing: ADR-0026 embed policy)
- MUST key the hardware cache by `(qmd --version, command -v qmd)` so reinstalling or upgrading qmd invalidates the cache automatically. MUST treat the cache file as untrusted input — JSON parse errors or schema mismatches re-trigger detection
- MUST default to CPU/background on first invocation when the hardware cache is cold — populating the cache from the embed run's own stderr is a one-time wasted-foreground cost for GPU users, acceptable in exchange for never blocking a CPU user's session unexpectedly (Governing: ADR-0026)
- MUST wrap `qmd embed` in a bounded retry loop (max 5 rounds) that re-reads `qmd status` after each round and relaunches when `Pending > 0` AND the prior round's stderr contained `Session expired` or `skipping remaining` (Governing: ADR-0031). MUST surface the round count in the report when `rounds > 1` so users understand the multi-round wall time
- MUST surface a retry-cap-hit warning with a remediation hint (inspect the log for "Failed to embed" lines) when the loop exits with `Pending > 0` after 5 rounds — the user needs to know it stopped progressing, not that it succeeded silently (Governing: ADR-0031)
- MUST distinguish failed-on-prior-run from never-tried-pending in the status report by parsing the most recent embed log for `skipping ([0-9]+) remaining chunks`. The failed count is approximate (log granularity is per-repo, not per-round) and MUST be marked as such when the log is older than 24h
- MUST render the qmd version-staleness banner at the top of every report when installed `<` cached latest. Cache lives at `~/.cache/sdd-plugin/qmd-version.json` with a 7-day refresh interval. MUST silently skip the banner when `npm view` fails (offline, registry timeout) — version checks NEVER block indexing (Governing: ADR-0032)
- MUST NOT call `npm view` on every invocation — the 7-day cache is the rate limit. The cache file is keyed by package name only (`@tobilu/qmd`), so multiple SDD-using projects share the cache without interference
- MUST run the qmd-install writability check (Step 2 sub-step 6) and surface the diagnosis-only warning when `$(npm root -g)/@tobilu/qmd/node_modules/node-llama-cpp/llama` is not writable by `$USER`. MUST NOT auto-fix — `chown` and `npm config set prefix` are user decisions with downstream effects
- MUST NOT read or modify qmd's internal sqlite index (`~/.cache/qmd/index.sqlite`) directly — even when qmd doesn't expose the data we want (e.g., per-chunk failure markers), the boundary is "qmd CLI/MCP only" per ADR-0024. Use log-file parsing or wait for qmd to expose the field upstream
