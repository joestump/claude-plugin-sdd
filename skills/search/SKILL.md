---
name: search
description: Unified semantic exploration skill combining qmd hybrid retrieval with cgg call graph generation. Use when the user says "search the codebase", "find ADRs about X", "what specs cover Y", "search architecture", or wants to semantically explore design artifacts and code together.
allowed-tools: Bash, Read, Glob, Grep, mcp__plugin_qmd_qmd__query, mcp__plugin_qmd_qmd__status
argument-hint: [query] [--output markdown|json] [--unfiltered] [--module <name>]
---

# Unified Semantic Search

Search ADRs, specs, and code simultaneously using qmd hybrid retrieval, then enrich results with cgg call graphs for deeper code exploration.

## Process

<!-- Governing: ADR-0033 (cgg call graph integration), ADR-0024 (qmd as hard dependency), SPEC-0034 REQ "Hybrid Retrieval Across All Collections", SPEC-0034 REQ "Call Graph Generation Uses cgg With Filtering" -->

0. **Handle no-args / --help**: If `$ARGUMENTS` is empty or contains `--help`, output the usage block below and stop:

   ```
   Usage: /sdd:search <query> [--output markdown|json] [--unfiltered] [--module <name>]

   Examples:
     /sdd:search "JWT authentication"
     /sdd:search "payment processing" --output json
     /sdd:search "token validation" --unfiltered
     /sdd:search "auth middleware" --module api

   Searches ADRs, specs, and code with qmd hybrid retrieval, then generates
   call graphs with cgg for the most relevant code matches.
   ```

1. **Parse arguments**: Extract from `$ARGUMENTS`:
   - `<query>`: everything before any `--` flags (required; stop here if empty after flag extraction)
   - `--output markdown|json`: output format (default: `markdown`)
   - `--unfiltered`: when present, skip filter derivation and pass raw query keywords to cgg
   - `--module <name>`: when present, scope all collections and cgg to that module

2. **Compute the repo slug and collection names**:

   <!-- Governing: ADR-0024 (qmd as hard dependency), SPEC-0019 REQ "qmd-helpers Reference" -->

   Compute the slug per `references/qmd-helpers.md` § "This-Repo Collection Identification":

   ```bash
   SLUG=$(git rev-parse --show-toplevel | xargs basename | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g')
   ```

   - **Standard mode** (no `--module`): target collections `{slug}-adrs`, `{slug}-specs`, `{slug}-code`
   - **Workspace mode** (`--module <name>` provided): target collections `{slug}-{module}-adrs`, `{slug}-{module}-specs`, `{slug}-{module}-code`

3. **Validate qmd collections exist**:

   Use `mcp__plugin_qmd_qmd__status` (or `qmd status --json` as CLI fallback per `references/qmd-helpers.md` § "MCP-vs-CLI Selection") to list available collections. Apply exact-prefix match from `references/qmd-helpers.md` § "This-Repo Collection Identification".

   If none of the three target collections exist, stop with: "No qmd collections found for {repo}. Run `/sdd:index` first."

   Note which collections are missing (e.g., only `-adrs` and `-specs` but not `-code`) — search only what exists.

4. **Run qmd hybrid retrieval**:

   <!-- Governing: ADR-0024 (qmd as hard dependency), SPEC-0034 REQ "Hybrid Retrieval Across All Collections" -->

   Issue three separate qmd queries — one per collection type — so that ADR, spec, and code results are already partitioned when building output sections. Use MCP tool `mcp__plugin_qmd_qmd__query` (preferred) or `qmd query --json` as CLI fallback.

   **ADR query** (if `{slug}-adrs` or `{slug}-{module}-adrs` collection exists):
   ```
   searches: [
     { type: "lex", query: "<query verbatim>" },
     { type: "vec", query: "Architecture decisions about <query>" }
   ],
   intent: "/sdd:search — find ADRs relevant to: <query>",
   collections: ["{slug}-adrs"],    // or {slug}-{module}-adrs
   limit: 8,
   minScore: 0.3
   ```

   **Spec query** (if `{slug}-specs` or `{slug}-{module}-specs` collection exists):
   ```
   searches: [
     { type: "lex", query: "<query verbatim>" },
     { type: "vec", query: "Specifications and requirements for <query>" }
   ],
   intent: "/sdd:search — find specs relevant to: <query>",
   collections: ["{slug}-specs"],    // or {slug}-{module}-specs
   limit: 8,
   minScore: 0.3
   ```

   **Code query** (if `{slug}-code` or `{slug}-{module}-code` collection exists):
   ```
   searches: [
     { type: "lex", query: "<query verbatim>" },
     { type: "vec", query: "Source code implementing <query>" }
   ],
   intent: "/sdd:search — find code relevant to: <query>",
   collections: ["{slug}-code"],    // or {slug}-{module}-code
   limit: 8,
   minScore: 0.3
   ```

   Filter each result set: keep only items with `score >= 0.3`. Collect the three partitioned result sets.

   **No-matches path**: If all three queries return zero results above `minScore`, output the following and stop — do NOT proceed to cgg:

   ```
   No relevant ADRs, specs, or code found for '{query}'. Try a broader search term.
   ```

5. **Derive cgg filter** (unless `--unfiltered` was passed):

   <!-- Governing: ADR-0033 (cgg call graph integration), SPEC-0034 REQ "Call Graph Generation Uses cgg With Filtering" -->

   From the code query results, extract filter tokens per `references/cgg-integration.md` § "Filter Derivation Strategy — From qmd code matches":

   1. Take each matched file path stem (e.g., `auth/jwt.go` → `jwt`, `auth`)
   2. Take each qmd-matched symbol or heading keyword surfaced in the result snippets
   3. Compose a regex alternation: `token1|token2|token3`

   If the code query returned no results (collection absent or zero matches), fall back to keyword-based derivation per `references/cgg-integration.md` § "Filter Derivation Strategy — From requirement keywords":
   - Lowercase and split the query on spaces/punctuation
   - Strip common stop words (`the`, `a`, `an`, `for`, `with`, `of`, `in`, `and`, `or`, `to`)
   - Compose alternation from remaining terms

   If `--unfiltered` was passed, skip this step entirely. Warn the user:
   ```
   Generating unfiltered call graph — output may be large. Use /cgg directly for advanced scoping.
   ```

6. **Generate call graph with cgg**:

   <!-- Governing: ADR-0033 (cgg call graph integration), SPEC-0034 REQ "Call Graph Generation Uses cgg With Filtering", SPEC-0034 REQ "Error Messages and Logs Must Be Clear" -->

   Follow `references/cgg-integration.md` § "Availability Check" first:

   ```bash
   which cgg >/dev/null 2>&1
   ```

   If cgg is not found, record the unavailability notice and skip to step 7 (graceful degradation).

   Determine the target path:
   - Standard mode: repo root (`git rev-parse --show-toplevel`)
   - Workspace mode (`--module <name>`): resolve module source dir per `references/shared-patterns.md` § "Artifact Path Resolution"

   Invoke cgg per `references/cgg-integration.md` § "cgg Invocation Pattern":

   ```bash
   # With filter:
   timeout 30 cgg <target-path> --filter "<filter-regex>" --format mermaid 2>/tmp/cgg-stderr-$$.txt
   # Without filter (--unfiltered):
   timeout 30 cgg <target-path> --format mermaid 2>/tmp/cgg-stderr-$$.txt
   CGG_EXIT=$?
   CGG_STDERR=$(cat /tmp/cgg-stderr-$$.txt)
   rm -f /tmp/cgg-stderr-$$.txt
   ```

   Handle exit codes per `references/cgg-integration.md` § "Exit code handling":
   - Exit 0: normalize the Mermaid output per `references/cgg-integration.md` § "Mermaid Output Normalization"
   - Exit 1: record "Call graph generation failed: {stderr}" and skip to step 7
   - Exit 124: record timeout message per `references/cgg-integration.md` § "Timeout Handling" and skip to step 7
   - Other exit: treat as exit 1

   Apply node cap: if the Mermaid output has more than 20 nodes (lines matching `^\s+\w+\[`), trim to top 20 by connectivity and add the trimming comment per `references/cgg-integration.md` § "Node cap".

   Normalize output per `references/cgg-integration.md` § "Mermaid Output Normalization":
   - Sort nodes alphabetically
   - Rewrite `graph LR` or `graph RL` to `graph TD`
   - Strip memory-address node ID prefixes
   - Append legend footer `%% Showing entry points + main flow; internal helpers omitted`
   - Validate all `-->` edges reference declared nodes; remove dangling edges

   Handle unsupported-language warnings per `references/cgg-integration.md` § "Unsupported Language Handling".

7. **Produce output**:

   <!-- Governing: SPEC-0034 REQ "Markdown Output Format", SPEC-0034 REQ "JSON Output Format" -->

   **Markdown output** (default, or `--output markdown`):

   ```markdown
   ## Search Results: {query}

   Found {A} ADRs, {S} specs, {C} code snippets for "{query}".

   ### 1. Matching ADRs

   {For each ADR result, sorted by score descending:}
   - **{ADR-ID}: {title}** (score: {score:.2f})
     {1-2 sentence relevance note derived from the result snippet and context}

   {If no ADR matches:}
   No matching ADRs found.

   ### 2. Matching Specs

   {For each spec result, sorted by score descending:}
   - **{SPEC-ID}: {title}** (score: {score:.2f})
     {1-2 sentence relevance note derived from the result snippet and context}

   {If no spec matches:}
   No matching specs found.

   ### 3. Relevant Code Snippets

   {For each code result, sorted by score descending:}
   - **{path}** (score: {score:.2f})
     {1-2 sentence description of what this code does relative to the query}

   {If no code matches:}
   No relevant code found.

   ### 4. Call Graphs

   {If cgg unavailable:}
   Call graphs unavailable — install cgg with: cargo install cgg
   or see https://github.com/NeuralNotwerk/cgg

   {If cgg timed out:}
   Call graph generation timed out (30s). The codebase may be very large.
   Try: /cgg <module/path> --filter <keyword> to narrow the scope.

   {If cgg failed:}
   Call graph generation failed: {stderr}

   {If --unfiltered:}
   > Generating unfiltered call graph — output may be large. Use /cgg directly for advanced scoping.

   {If cgg succeeded:}
   <!-- Call graph: {filter used or "unfiltered"}, generated {date} -->
   ```mermaid
   graph TD
       ...
   %% Showing entry points + main flow; internal helpers omitted
   ```

   {If no nodes matched the filter after trimming:}
   No call graph nodes matched the filter. Try broadening your search term or use --unfiltered.

   ### 5. Summary

   | Collection | Matches |
   |-----------|---------|
   | ADRs      | {A}     |
   | Specs     | {S}     |
   | Code      | {C}     |
   | Call graph nodes | {N or "unavailable"} |

   {If cgg succeeded:} Refine the call graph with: `/cgg {target-path} --filter "{filter}"`
   {If no call graph:} Generate a focused call graph with: `/cgg {target-path} --filter "{derived-filter-keywords}"`
   ```

   **JSON output** (`--output json`):

   Emit a single JSON object:

   ```json
   {
     "query": "<query>",
     "adr_matches": [
       {
         "id": "ADR-XXXX",
         "title": "<title>",
         "path": "<path>",
         "score": 0.85,
         "snippet": "<snippet text>"
       }
     ],
     "spec_matches": [
       {
         "id": "SPEC-XXXX",
         "title": "<title>",
         "path": "<path>",
         "score": 0.75,
         "snippet": "<snippet text>"
       }
     ],
     "code_snippets": [
       {
         "path": "<path>",
         "score": 0.65,
         "snippet": "<snippet text>"
       }
     ],
     "call_graphs": [
       {
         "filter": "<filter-regex or null>",
         "mermaid": "<normalized mermaid block or null>",
         "error": "<error message or null>"
       }
     ]
   }
   ```

   For the `call_graphs` array:
   - When cgg succeeds: `mermaid` contains the normalized Mermaid string, `error` is `null`
   - When cgg is unavailable/fails/times out: `mermaid` is `null`, `error` contains the user-facing message
   - `filter` is `null` when `--unfiltered` was used

## Rules

- This skill is READ-ONLY — it MUST NOT create, modify, or delete any files
- MUST check qmd availability and collections before querying; stop with a clear message if none found for this repo
- MUST issue three separate qmd queries (ADRs, specs, code) so result sets are cleanly partitioned by collection type
- MUST use `limit: 8` and `minScore: 0.3` for all qmd queries per SPEC-0034
- MUST gracefully degrade when cgg is unavailable or fails — return qmd sections 1–3 with a one-line notice in section 4, never fail the skill (Governing: ADR-0033, SPEC-0034 REQ "Graceful Degradation")
- When cgg succeeds, MUST normalize Mermaid output per `references/cgg-integration.md` § "Mermaid Output Normalization" before embedding
- MUST cap call graph at 20 nodes; add trimming comment when nodes are omitted
- When `--unfiltered` is set, MUST skip filter derivation AND emit the large-graph warning before invoking cgg
- When `--module <name>` is set, MUST scope all qmd collections to `{slug}-{module}-{kind}` AND scope cgg to the module source directory
- ADR and spec entries in markdown output MUST include the ID, title, score, and a 1–2 sentence relevance note
- JSON output MUST match the schema in step 7 exactly — no extra top-level keys
- No-matches path (zero results above minScore across all three collections) MUST output the exact message: `No relevant ADRs, specs, or code found for '{query}'. Try a broader search term.` — and stop before invoking cgg
- The help/no-args output MUST include a usage line, at least two examples, and a brief explanation
- Use `##` for the top-level heading and `###` for sections within the report
- Do NOT invoke cgg if the no-matches path is taken
- MUST prefer MCP tool `mcp__plugin_qmd_qmd__query` over the qmd CLI; fall back to CLI only when the MCP is not loaded (per `references/qmd-helpers.md` § "MCP-vs-CLI Selection")
- All cgg invocation patterns, error messages, filter derivation, timeout handling, and graceful degradation MUST follow `references/cgg-integration.md` verbatim — do not inline custom variants
