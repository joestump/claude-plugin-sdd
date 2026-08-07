<!-- Governing: ADR-0024 (qmd as hard dependency), ADR-0026 (Tiered Index Freshness Strategy), SPEC-0019 REQ "qmd-helpers Reference" -->

# qmd Helpers Reference

Canonical reference for how SDD plugin skills talk to [qmd](https://github.com/tobi/qmd). Every qmd-aware consumer skill MUST consume this reference by section name rather than inlining its own qmd CLI invocations or MCP-vs-CLI selection logic. Centralizing the patterns here keeps a future qmd API change a single-file edit and prevents per-skill drift.

This reference assumes qmd is installed and reachable per ADR-0024 (qmd is a hard dependency starting v5.0.0). If a skill needs to handle "qmd installed but this repo not yet indexed", route to `/sdd:index` rather than degrading silently.

## MCP-vs-CLI Selection

Skills MUST prefer the qmd MCP tools over the `qmd` CLI when both are available. The MCP path is declarative (no shell invocation cost, structured input/output), and both surfaces talk to the same `~/.cache/qmd/index.sqlite` so swapping is transparent for read operations. Write operations (collection-add, embed, update, context-add) are CLI-only at the time of writing.

### MCP detection

Check whether the qmd MCP is loaded by probing for a known qmd MCP tool name. The canonical detection idiom:

```
ToolSearch with query "select:mcp__plugin_qmd_qmd__status"
```

If the tool resolves, the qmd MCP is loaded. If not, fall back to the `qmd` CLI.

On harnesses without `ToolSearch` (Codex, OpenCode, Crush — per `harness-compat.md` § "Capability Map"), check your configured MCP servers for a qmd server if the harness exposes that list; otherwise skip the probe and use the CLI directly. The CLI path is always sufficient — MCP is an optimization, not a requirement.

### Operation routing

| Operation | MCP tool (preferred when loaded) | CLI fallback |
|-----------|----------------------------------|--------------|
| Hybrid query | `mcp__plugin_qmd_qmd__query` | `qmd query --json` |
| Get document | `mcp__plugin_qmd_qmd__get` | `qmd get --json` |
| Multi-get by glob/list | `mcp__plugin_qmd_qmd__multi_get` | `qmd multi-get --json` |
| Index status | `mcp__plugin_qmd_qmd__status` | `qmd status --json` |
| Collection add | _(not exposed as MCP tool)_ | `qmd collection add` |
| Collection list | _(use `status` and read `collections[]`)_ | `qmd collection list` |
| Collection remove | _(not exposed)_ | `qmd collection remove` |
| Context add | _(not exposed)_ | `qmd context add` |
| Update (re-scan) | _(not exposed)_ | `qmd update` |
| Embed | _(not exposed)_ | `qmd embed --chunk-strategy auto` |

When the MCP is not loaded but the CLI is present, every read operation falls back transparently. When neither is present, that's an init-time failure (per ADR-0024) — `/sdd:init` should have caught it.

## Hybrid Retrieval

The canonical pattern for top-K retrieval. qmd's hybrid search combines BM25 keyword matching, vector similarity, and LLM reranking; calling `query` (vs. `search` or `vsearch`) gets you the full pipeline.

### Calling via MCP

```typescript
// Pseudocode — actual invocation uses the tool's parameter shape
mcp__plugin_qmd_qmd__query({
  searches: [
    { type: "lex", query: "<exact terms or quoted phrases>" },     // first sub-query gets 2x weight
    { type: "vec", query: "<natural language question>" },
    { type: "hyde", query: "<50-100 word hypothetical answer>" }   // optional, for nuanced topics
  ],
  intent: "<background context that disambiguates>",                // recommended on every call
  collections: ["{repo}-adrs", "{repo}-specs"],                     // filter to specific collections
  limit: 8,                                                         // K — adjust per use case
  minScore: 0.3                                                     // drop low-relevance noise
})
```

### Calling via CLI

```bash
qmd query $'lex: <terms>\nvec: <question>\nintent: <context>' \
  --json -n 8 --min-score 0.3 \
  -c "{repo}-adrs" -c "{repo}-specs"
```

CLI surface rules (verified against qmd 2.x; the CLI and MCP parameter names differ):

- **The positional query MUST come immediately after `query`, before any flags.** Some qmd versions fail to parse the query when flags precede it.
- **Flags are kebab-case on the CLI**: `--min-score`, not `--minScore`. `minScore`/`limit` are the MCP tool's parameter names only — never pass them as CLI flags.
- **The result cap is `-n {K}`** (`--limit` is accepted by some versions but not all; `-n` is the documented flag). `--all` returns every match and pairs with `--min-score`.
- On any usage error, check `qmd query --help` for the installed version's flag surface rather than retrying permutations.

### Strategy: choosing sub-query types

| Goal | Sub-queries | When |
|------|-------------|------|
| Know exact symbol/file path | `lex` only | "find references to `parseUserID`" |
| Concept search | `vec` only | "decisions about authentication" |
| Best recall on a known topic | `lex` + `vec` | most common case |
| Nuanced or unfamiliar topic | `lex` + `vec` + `hyde` | "rationale for pre-emptive rate limiting" |
| Unknown vocabulary | Standalone natural-language query (no typed lines) | let the server auto-expand |

Put your strongest signal first — qmd weights the first sub-query 2× in its RRF fusion.

### Result handling

Every result has `score` (0.0–1.0), `path`, `snippet`, and `context` (the human-written summary attached via `qmd context add`). Filter by `score >= minScore` and treat scores below ~0.3 as non-matches.

For top-K retrieval used to "decide which artifacts to deep-read", typical K is 6–10. Going wider dilutes the signal; going narrower risks missing relevant artifacts.

## Exhaustive Retrieval (list-all)

Some skills need *every* document in a collection rather than a relevance-ranked top-K — e.g. `/sdd:prime`'s untargeted mode listing all ADRs and specs. **Do NOT use `qmd query` for this.** `qmd query` requires a real query string: an empty query is not a wildcard — qmd's query-expansion step garbles it (it has been observed expanding the empty query plus stray flag values into nonsense sub-queries) and the pipeline fails downstream.

The correct primitive is `qmd ls`, which enumerates a collection deterministically with no search pipeline involved:

```bash
qmd ls {repo}-adrs
qmd ls {repo}-specs
```

Output is one line per indexed file (`size  date  qmd://{collection}/{path}`). Parse the `qmd://` paths to get the document list, then read documents either via `qmd get qmd://{collection}/{path}` / `qmd multi-get`, or — since collections index local files — directly from disk at the corresponding repo path, whichever the consuming skill prefers.

If `qmd ls` is unavailable or errors, fall back to direct file enumeration over the resolved artifact directories (`{adr-dir}/*.md`, `{spec-dir}/*/spec.md`) — for exhaustive listing the filesystem is an acceptable substitute because no ranking is involved. This fallback does NOT license skipping qmd for *ranked* retrieval (per ADR-0024).

## This-Repo Collection Identification

Many skills need to filter qmd's global collection list down to "collections belonging to this repo". The plugin's per-repo naming convention (per ADR-0024 / SPEC-0019) is `{slug}-{kind}` where `kind` is one of `adrs`, `specs`, `code`, `issues` — or `{slug}-{module}-{kind}` in workspace mode.

### Compute the slug

```bash
SLUG=$(git rev-parse --show-toplevel | xargs basename | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g')
```

### Match collections by exact prefix

A collection belongs to this repo if and only if its name matches one of these exact patterns:

- `{slug}-adrs`
- `{slug}-specs`
- `{slug}-code`
- `{slug}-issues`
- `{slug}-{module}-{adrs|specs|code|issues}` (workspace mode)

**Use exact prefix match, NOT substring match.** A substring match on `{slug}` would spuriously claim sibling-repo collections — a slug like `myrepo` would match both `myrepo-adrs` (correct) and `not-myrepo-adrs` (wrong; that's a sibling repo).

### Reference implementation (bash)

```bash
matches_this_repo() {
  local name=$1
  local slug=$2
  case "$name" in
    "${slug}-adrs"|"${slug}-specs"|"${slug}-code"|"${slug}-issues") return 0 ;;
    "${slug}-"*-adrs|"${slug}-"*-specs|"${slug}-"*-code|"${slug}-"*-issues) return 0 ;;
    *) return 1 ;;
  esac
}
```

The wildcard in the workspace patterns matches the module segment (e.g., `stumpcloud-infra-adrs`). For stricter matching in workspace mode, the skill MAY enumerate known modules from `.gitmodules` or the `### Workspace Modules` table in CLAUDE.md and check membership explicitly.

### Recovering the slug from a collection name

When you have an unknown collection name and need to identify which repo it belongs to (e.g., reporting "this also embeds N chunks from M other repos"), strip the trailing `-{kind}` segment to recover the slug:

```bash
strip_kind_suffix() {
  local name=$1
  echo "$name" | sed -E 's/-(adrs|specs|code|issues)$//'
}
```

In workspace mode, the result will include the module segment (e.g., `stumpcloud-infra` strips to itself; the user reads "stumpcloud-infra" as "the infra module of stumpcloud").

## Error Handling

qmd operations can fail in ways that consumer skills MUST handle gracefully. The patterns below cover the common cases.

### Timeout

The MCP `query` tool defaults to a 5-second timeout for retrieval and longer for reranking on CPU. If a query times out:

1. Retry once with `rerank: false` — skipping the LLM reranker drops latency by 10× on CPU.
2. If the retry also times out, surface a one-line warning to the user: "qmd query timed out; degrading to BM25 retrieval for this run" and continue with `searchLex` / CLI `qmd search` (BM25-only).

### qmd not running (CLI mode only)

If a CLI call returns "qmd: command not found" or fails to spawn, the install was incomplete. Surface: "qmd CLI not found in PATH. Re-run `/sdd:init` to verify the install." Stop the skill.

### No collections for this repo

If `mcp__plugin_qmd_qmd__status` returns no collections matching the **This-Repo Collection Identification** patterns above, this repo isn't indexed. Surface: "No qmd collections found for {repo}. Run `/sdd:index` first." Stop the skill — do not fall back to "scan everything" behavior (per ADR-0024, fallback paths were eliminated in v5).

### Partial embedding

If `mcp__plugin_qmd_qmd__status` returns collections matching this repo but `needsEmbedding > 0`, the index is partially complete. Vector and hybrid search return BM25-only results for unembedded chunks (qmd handles this gracefully). Continue, but surface a one-line note: "{N} chunks unembedded for this repo — vector/hybrid search degraded until `/sdd:index embed` runs."

### Empty result set

If a hybrid query returns zero results above `minScore`, treat as a legitimate "nothing relevant found" signal. Skills that pre-search to suggest something (e.g., `/sdd:adr` suggesting frontmatter edges) MUST proceed without the suggestion rather than synthesizing one.

### Reranker on cold start

The first query of a session pays a model-load cost (a few seconds on CPU, sub-second on GPU). This is normal and not a failure. The HTTP daemon mode (`qmd mcp --http --daemon`) keeps models warm across requests; `/sdd:init` may eventually offer to start it (out of scope for SPEC-0019).

## Update Patterns

Used by mutation-aware skills (per ADR-0026 Tier 1). After a skill writes to indexed content, it MUST trigger a `qmd update` for the affected collection before returning.

### Narrow update (preferred when qmd supports it)

qmd does not currently expose a per-collection update flag at the CLI level — `qmd update` re-scans every collection in the index. Future qmd versions may add `--collection {name}` filtering; until then, the "narrow update" pattern is conceptual: trigger `qmd update` and let qmd skip unchanged files efficiently (the file-mtime scan is cheap; only chunks for changed files re-enter the indexer).

```bash
qmd update
```

The CLI is best-effort and silent on success. Surface failures as a one-line warning in the skill's report (per ADR-0026 — Tier 1 updates are best-effort, not blocking).

### Update via MCP

Not currently exposed. Use the CLI for now. When the MCP gains an `update` tool, switch to it transparently.

### When to call update

| Trigger | Owner skill |
|---------|-------------|
| New ADR file written | `/sdd:adr` |
| New or changed spec.md / design.md | `/sdd:spec` |
| Status field flipped | `/sdd:status` (the collection containing the artifact whose status changed) |
| Code merged via PR | `/sdd:work` (after merge) and `/sdd:review` (after merge) — `{repo}-code` |
| Tracker issue mutated | `/sdd:plan`, `/sdd:enrich`, `/sdd:organize`, `/sdd:review` — `{repo}-issues` |

The update is synchronous and silent on success unless it fails. On failure, the skill's report MUST include a one-line warning naming the affected collection: "Index refresh failed for `{repo}-adrs` — run `/sdd:index update` manually."

### Tier 2/3 silent updates with timestamp checks

`/sdd:prime` (Tier 2) and consumer skills (Tier 3) check the qmd index's last-modified timestamp before deciding whether to update. The check uses `qmd status` (or the MCP `status` tool) to read collection-level `lastUpdated` timestamps, takes the most recent across this-repo collections, and compares against the relevant threshold.

| Tier | Skill | Threshold |
|------|-------|-----------|
| Tier 2 | `/sdd:prime` | 60 seconds (back-to-back primes are common; skip the redundant update) |
| Tier 3 | `/sdd:check`, `/sdd:audit`, `/sdd:discover` | 120 minutes default, configurable in CLAUDE.md `### SDD Configuration` `#### Index Freshness` `**Staleness Threshold**` |

If the index is fresh (within the threshold), skip the update silently. If stale, run `qmd update` silently and emit a one-line note in the skill's report header ("Index was {age} stale — refreshed before running" for Tier 3; truthy diff summary for Tier 2).

## Consumers

The following skills consume this reference. Maintain this list when adding new consumers (the same convention as `references/issue-authoring.md` § Consumers):

| Skill | Consumes |
|-------|----------|
| `/sdd:prime` | MCP-vs-CLI Selection; Hybrid Retrieval; Update Patterns (Tier 2); This-Repo Collection Identification |
| `/sdd:check`, `/sdd:audit` | MCP-vs-CLI Selection; Hybrid Retrieval; Update Patterns (Tier 3); This-Repo Collection Identification; Error Handling (no-collections) |
| `/sdd:discover` | MCP-vs-CLI Selection; Hybrid Retrieval; Update Patterns (Tier 3); Error Handling (empty result set) |
| `/sdd:adr`, `/sdd:spec` | MCP-vs-CLI Selection; Hybrid Retrieval; Update Patterns (Tier 1); Error Handling (empty result set) |
| `/sdd:status` | Update Patterns (Tier 1) |
| `/sdd:plan`, `/sdd:work`, `/sdd:review` | All sections |
| `/sdd:enrich`, `/sdd:organize` | Update Patterns (Tier 1) |
| `/sdd:index` | This-Repo Collection Identification (for status/remove operations); Update Patterns (for `update` and `embed` subcommands) |
