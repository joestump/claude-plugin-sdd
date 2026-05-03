---
name: index
description: Index a repository's ADRs, OpenSpec specs, and source code into qmd collections for hybrid (BM25 + vector + reranker) semantic search. Use when the user says "index this repo", "load into qmd", "make my code/specs searchable", "set up qmd for this project", or wants agents to be able to search architecture artifacts and code semantically.
allowed-tools: Bash, Read, Glob, Grep, AskUserQuestion
argument-hint: [add|update|embed|status|remove] [--module <name>] [--foreground|--skip]
---

<!-- Governing: ADR-0015 (Markdown-Native Configuration), ADR-0016 (Workspace Mode), ADR-0024 (qmd hard dependency), ADR-0026 (Tiered Index Freshness) -->

# Index Repository into QMD

Create per-repository [qmd](https://github.com/tobi/qmd) collections so agents and humans can run hybrid search across a repo's ADRs, OpenSpec specs, and source code from a single query plane. Each repository owns three collections (`{repo}-adrs`, `{repo}-specs`, `{repo}-code`) so searches can be filtered cleanly with `qmd query "..." -c {repo}-adrs`. Workspace projects (ADR-0016) get one set of collections per module: `{repo}-{module}-{kind}`.

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

Before doing anything else, verify the environment. Each check has its own short-circuit message — do not chain them silently.

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

### Step 3: Derive Collection Names

1. Compute the repo slug:

   ```bash
   git rev-parse --show-toplevel | xargs basename | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g'
   ```

2. Build the collection name set:
   - **Single-module project** (no workspace, or `--module` provided): `{repo}-adrs`, `{repo}-specs`, `{repo}-code`. Where `{repo}` is the slug from step 3.1, plus the module name when `--module` is provided (e.g., `stumpcloud-infra-adrs`).
   - **Workspace aggregate mode** (no `--module`, multiple modules detected): one triple per module — `{repo}-{module}-adrs`, `{repo}-{module}-specs`, `{repo}-{module}-code`. The skill iterates Steps 4–7 once per module.

3. Resolve absolute paths for each collection's source directory:
   - `*-adrs` → `{module-root}/{adr-dir}` (from Step 0)
   - `*-specs` → `{module-root}/{spec-dir}` (from Step 0)
   - `*-code` → `{module-root}` (the entire repo or module root)

### Step 4: Dispatch to the Operation

Route to one of the operations below based on Step 1's subcommand. Each operation assumes Steps 2–3 already ran.

#### Operation: add

For each collection in the name set:

1. **Skip if it already exists**: Run `qmd collection list` and check whether the collection name appears. If it does, note it as `already-exists` and continue to the next collection — `qmd collection add` is a no-op on an existing name and will NOT refresh the mask or path. To change either, the user must `qmd collection remove {name}` first (or use `/sdd:index remove` then `/sdd:index add`).

2. **Skip if the source directory is missing**: For the ADR or spec collection, if its source directory does not exist, warn `"Skipping {name}: {path} does not exist."` and continue. Do not skip the code collection — the module root always exists.

3. **Build the file mask**. The qmd CLI takes only `--name` and `--mask` (no `--ignore` flag). qmd already auto-excludes `node_modules/`, `.git/`, `.cache/`, `vendor/`, `dist/`, and `build/` at the indexer level (see `store.js` `excludeDirs`), so the mask only needs to set what to *include*:
   - ADR collection: `--mask "ADR-*.md"` (matches the MADR filename convention from ADR-0003)
   - Spec collection: `--mask "**/*.md"` (catches both `spec.md` and `design.md`)
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

#### Operation: update

1. Verify this repo's collections exist in `qmd collection list`. If none exist, output: "No qmd collections found for {repo}. Run `/sdd:index add` first." and stop.
2. Note the global scope to the user before invoking: `qmd update` re-scans **every** collection in the user's index. qmd does not currently expose per-collection filtering on `update` and there is no shell-level workaround — a per-repo update would have to come from upstream qmd. If `qmd collection list` shows collections that do not belong to this repo, surface their count so the user understands what is about to happen.
3. Run `qmd update`.
4. After the update, prompt the user via `AskUserQuestion` whether to re-embed now (the embed operation below). New documents are not searchable via vector/hybrid search until they are embedded.

#### Operation: embed

Per ADR-0026's embed policy, this operation runs silently with a hardware-aware default. No `AskUserQuestion` prompt — prompting CPU users every time produced the same answer 95% of the time and was friction the user did not want.

1. **Detect GPU**: Run `qmd status` and scan for a "running on CPU" warning. The presence of that warning means CPU-only.

2. **Choose mode** based on hardware and explicit flags in `$ARGUMENTS`:

   | Hardware | Flag | Mode |
   |----------|------|------|
   | GPU | _(default)_ | Foreground (fast — no reason to background) |
   | CPU | _(default)_ | Background (do not block the session — embedding takes ~1s/chunk on CPU) |
   | _any_ | `--foreground` | Foreground (user wants chunk counts inline) |
   | _any_ | `--skip` | No-op — print "Embed skipped per --skip flag" and exit |

3. **Pre-embed scope disclosure** (concrete cross-repo accounting). `qmd embed` operates on the entire qmd index — it generates embeddings for any unembedded chunks across all collections, not just this repo's. Before invoking it, call `qmd status` (or the qmd MCP `status` tool) to get the authoritative scope:

   - **Total pending across the index**: the `needsEmbedding` field
   - **Pending attributable to this repo**: identify this-repo collections via **exact prefix match** on the collection name — a collection belongs to this repo if and only if its name equals `{slug}-adrs`, `{slug}-specs`, or `{slug}-code` (or `{slug}-{module}-{kind}` in workspace mode). **Do NOT use substring match**: a slug like `myrepo` would otherwise spuriously claim collections like `not-myrepo-adrs` belonging to a sibling repo. Match against the full collection name from `collections[]`. To estimate this-repo-pending, sum `(documents - embedded)` across the matched collections (per-collection embedded count comes from `qmd ls {collection}` or by tracking the diff before/after the most recent `qmd update`).
   - **Pending attributable to other repos**: total minus this-repo's share. Sample 2-3 of the other repo names from the unmatched collections (strip the trailing `-{kind}` segment to recover the slug) so the user sees concretely *whose* chunks they are about to embed.

   Surface this in the report concretely:

   > "Pending across the index: **{total} chunks**. Of those, **{this} are from {repo}**; **{other} are from {N} other indexed repos** ({sample-repo-slug-1}, {sample-repo-slug-2}, …). Embedding will process all of them in this run."

   This replaces the abstract "operates on the entire index" callout. Users with a single indexed repo see "0 from other repos" and the line is short; users with several repos see the cross-repo cost upfront and can choose to skip (`--skip`) and batch later.

4. **Run the chosen mode**:

   ```bash
   # Foreground
   qmd embed --chunk-strategy auto

   # Background
   qmd embed --chunk-strategy auto > /tmp/qmd-embed-{repo}.log 2>&1
   ```

   The `--chunk-strategy auto` flag uses tree-sitter for Go/TS/JS/Python/Rust files (cleaner chunks at function/class boundaries) and falls back to regex for everything else, including markdown. This produces dramatically better code-search recall than regex chunking and is non-negotiable for code collections.

5. **Background mode reporting**: When backgrounded, the report uses the "After `embed` (background)" template below. The completion notification from the harness lands in the next session turn; the user can also run `/sdd:index status` to check progress against the log file.

#### Operation: status

1. Run `qmd status` and capture the output.
2. Run `qmd collection list` and filter to rows whose name starts with the repo slug (or `{repo}-{module}-` in workspace mode).
3. Render the filtered view in the templated output format below. If `qmd status` reports CPU-only mode, surface that warning verbatim under a `### Health` section.

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

## Output

### After `add` or default first run

```
## QMD Index Created for {repo}

{If invoked with no subcommand, include this line:}
Auto-routed: collections did not exist → ran `add` then started `embed` ({foreground|background|skipped}).

### Collections
| Name | Source | Documents | Embedded |
|------|--------|-----------|----------|
| {repo}-adrs | {abs path to ADR dir} | {N} | {yes/no/in-progress} |
| {repo}-specs | {abs path to spec dir} | {N} | {yes/no/in-progress} |
| {repo}-code | {abs path to module root} | {N} | {yes/no/in-progress} |

{Optional one-line note: total unique chunks queued for embedding, and a reminder that qmd auto-excludes node_modules/.git/.cache/vendor/dist/build.}

### Search Examples
- ADRs only: `qmd query "{topic from a recent ADR title}" -c {repo}-adrs`
- Code only: `qmd query "{a function or pattern likely in the codebase}" -c {repo}-code`
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

{N} documents need re-embedding to become searchable via vector/hybrid query.

### Next Steps
- Run `/sdd:index embed` to refresh vectors for the {N} new/modified documents
```

### After `embed` (foreground)

```
## QMD Embeddings {Generated|Refreshed}

Embedded {N} chunks across {M} collections in {duration}.

### Embedded Collections
| Collection | Documents | Chunks |
|------------|-----------|--------|
| {repo}-adrs | {N} | {C} |
| {repo}-specs | {N} | {C} |
| {repo}-code | {N} | {C} |

Hybrid search (`qmd query`) and vector search (`qmd vsearch`) are now available.
```

### After `embed` (background — embed kicked off, not yet complete)

```
## QMD Embeddings In Progress for {repo}

Embedding ~{N} chunks in the background. Log: `/tmp/qmd-embed-{repo}.log`. Re-run `/sdd:index status` to check progress, or wait for the background completion notification.

While it runs, BM25 keyword search via `qmd search -c {repo}-{...}` is already available; vector and hybrid search will turn on as embeddings land.
```

### After `status`

```
## QMD Status for {repo}

### Collections
| Name | Documents | Vectors | Last Modified | Source |
|------|-----------|---------|---------------|--------|
| {repo}-adrs | {N} | {V} | {timestamp} | {abs path} |
| {repo}-specs | {N} | {V} | {timestamp} | {abs path} |
| {repo}-code | {N} | {V} | {timestamp} | {abs path} |

### Health
- Index: {path to sqlite} ({size})
- GPU: {available|none — running on CPU}
- {Any qmd status warnings, verbatim}
```

### After `remove`

```
## QMD Collections Removed for {repo}

| Name | Status |
|------|--------|
| {repo}-adrs | removed ({N} documents dropped) |
| {repo}-specs | removed ({N} documents dropped) |
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
- MUST create three collections per repo (or per module in workspace mode), not one — collection-level filtering (`-c <name>`) is the primary mechanism users will use to keep ADR/spec/code searches separate
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
