---
name: prime
description: Load ADR and spec context into the session for architecture-aware responses. Use when the user says "prime context", "load architecture", starts a new session, or wants Claude to know about existing decisions.
allowed-tools: Read, Glob, Grep, Bash
argument-hint: "[topic] [--module <name>]"
---

# Prime Architecture Context

Load existing ADRs and specs into the session so Claude can give architecture-aware responses.

## Process

<!-- Governing: ADR-0016 (Workspace Mode), SPEC-0014 REQ "Artifact Path Resolution" -->

0. **Resolve artifact paths**: Follow the **Artifact Path Resolution** pattern from `${CLAUDE_PLUGIN_ROOT}/references/shared-patterns.md` to determine the ADR and spec directories. If `$ARGUMENTS` contains `--module <name>`, resolve paths relative to that module; otherwise, in a workspace, aggregate across all modules. The resolved ADR directory is `{adr-dir}` and spec directory is `{spec-dir}`.

   <!-- Governing: ADR-0016 (Workspace Mode), SPEC-0014 REQ "Cross-Module Aggregation" -->

   **Cross-module aggregation**: When in aggregate mode (no `--module`, workspace detected), iterate over all discovered modules. For each module, resolve its artifact paths independently. Prefix every artifact reference in the output with the module name in square brackets: `[api] ADR-0001`, `[worker] SPEC-0003`. When `--module` is provided, scope to that single module — no prefix needed. When in single-module mode (no workspace), operate normally without prefixes.

1. **Check if init has been run**: Read `CLAUDE.md` at the project root (or module root if `--module` is set) and check if it contains references to an ADR or spec directory. If CLAUDE.md does not exist or lacks SDD plugin references, output:

   ```
   CLAUDE.md does not have SDD plugin references. Run `/sdd:init` first to set up your project, then re-run `/sdd:prime`.
   ```

   Then stop. Do NOT proceed with scanning.

1a. **Tier 2 session-start update** (v5.0.0+):

   <!-- Governing: ADR-0026 (Tiered Index Freshness), SPEC-0019 REQ "Tier 2 Session-Start Update via /sdd:prime" -->

   Run `qmd update` (cheap file-mtime scan) on entry to catch changes from outside the current Claude session — other developers, CI bots, branch switches, manually edited files. Skip the update when the qmd index was touched within the last 60 seconds (back-to-back primes are common; the short-circuit prevents redundant work).

   1. Run `qmd status --json` and parse the response to find the maximum `lastUpdated` timestamp across this-repo collections (identified via the exact-prefix match algorithm from the collection names — e.g., `claude-plugin-sdd-adrs`, `claude-plugin-sdd-specs`).
   2. If the most recent timestamp is within the last 60 seconds, skip the update entirely (no output).
   3. Otherwise, invoke `qmd update`. The update is silent on success when the diff is empty. If the update added/modified/removed any documents, print exactly one line in the report header (between the `## Architecture Context Loaded` heading and the section tables): `Refreshed index ({a} added, {m} updated, {r} removed across this repo's collections)`.
   4. After the update, run `qmd status --json` again and sum the `(documents - embedded)` count across this repo's collections. If non-zero, surface a one-line note in the report header (after the refresh line, if any): `{N} chunks unembedded — run \`/sdd:index embed\` (≈{seconds}s on this machine, foreground; or wait for the next mutation skill to backfill)`. Do NOT prompt via AskUserQuestion — the surface is informational, not a decision the user needs to make right now.

2. **Retrieve artifacts via qmd** (unified path for all modes, v5.1.0+):
   
   <!-- Governing: ADR-0024 (qmd as hard dependency), SPEC-0019 REQ "qmd-Smart Context Loading" -->
   
   All artifact retrieval now uses qmd hybrid search for consistency, flexibility, and efficiency. Both untargeted and topic-filtered modes use the same code path with different parameters, executed via the `qmd query` CLI.
   
   **For untargeted priming** (`/sdd:prime` with no topic):
   - Query for all ADRs with `qmd query --json -c {repo}-adrs --limit 10000 --minScore 0` plus a second query for all specs with `qmd query --json -c {repo}-specs --limit 10000 --minScore 0`
   - In workspace mode, repeat for each module's per-module collections (`{repo}-{module}-adrs`, etc.)
   - The `--limit 10000` and `--minScore 0` retrieve all matches without filtering
   
   **For topic-filtered priming** (`/sdd:prime {topic}`):
   - Construct a hybrid query with both `lex` (keyword match) and `vec` (semantic match) sub-queries per `${CLAUDE_PLUGIN_ROOT}/references/qmd-helpers.md` § "Hybrid Retrieval"
   - Run: `qmd query --json -c {repo}-adrs -c {repo}-specs --limit 8 --minScore 0.3 '<queries>'`
   - If zero candidates above `minScore: 0.3`, output: `No ADRs or specs matched the topic "{topic}". Try a broader term, or run `/sdd:prime` without a topic to see all artifacts.`
   
   For each retrieved artifact:
   - Parse the JSON response to extract: ID, title (from first `#` heading), status, superseded-by (from frontmatter)
   - For ADRs: extract summary from first 2-3 sentences of `## Decision Outcome`
   - For specs: extract summary from first sentence of `## Overview`; count requirements and scenarios
   - Sort by artifact ID number (natural sort: ADR-0001, ADR-0002, ..., SPEC-0001, ...)

3. **Filter non-authoritative artifacts** (applies to untargeted mode; topic-filtered mode surfaces all matches with badges):
   - Partition into authoritative (`accepted`, `proposed`, `draft`, `review`, `approved`, `implemented`, or missing) and non-authoritative (`superseded`, `deprecated`, `rejected`)
   - Exclude non-authoritative from main tables, collect for footer
   - In topic-filtered mode, surface non-authoritative matches with a `⚠` badge since topic filtering is often investigative

3a. **Status Field Extraction algorithm**. Two formats are supported because legacy SDD-using repos predate YAML frontmatter:

   1. **YAML frontmatter** (canonical, current SDD template): look for a `status:` key inside the `---` … `---` frontmatter block at the top of the file.
   2. **Inline bullet** (legacy / hand-authored): if no YAML frontmatter exists OR YAML has no `status:` field, scan the first 30 lines for a line matching `- **Status:** {value}` (case-insensitive on "Status"; tolerate `*` or `+` as the bullet marker; tolerate `Status:` without the bold).
   3. **Strip refinement notes**: the inline-bullet form sometimes carries a parenthetical refinement note: `- **Status:** accepted (refined by ADR-0010, 2026-05-03)`. Split on the first `(`, trim trailing whitespace, and use only the leading word ("accepted"). The parenthetical content is preserved in the source file but is not rendered in prime tables — it would blow out column width for a corner case better surfaced by `/sdd:graph` or by reading the artifact directly.
   4. **No status found**: if neither form yields a value, record the artifact as having no parseable status. Render as `—` in the table when other artifacts in the same corpus have status; drop the Status column entirely when *zero* artifacts in the corpus have status (see Step 5 rendering rule).

4. **Extract summaries for context** (v5.1.0+):
   
   To make prime output immediately useful without opening files, extract concise summaries:
   - **For ADRs**: first 2-3 sentences from the decision outcome explaining what was decided and why
   - **For specs**: first sentence of the Overview section, truncated at ~140 characters
   - These summaries appear alongside titles in all output modes to provide at-a-glance context

5. **Handle edge cases**:
   - If `{adr-dir}` does not exist: "The `{adr-dir}` directory does not exist. Run `/sdd:adr [description]` to create your first ADR."
   - If `{spec-dir}` does not exist: "The `{spec-dir}` directory does not exist. Run `/sdd:spec [capability]` to create your first spec."
   - If neither directory has any artifacts: "No design artifacts found. Create an ADR with `/sdd:adr` or a spec with `/sdd:spec` first."
   - If ADRs exist but no specs (or vice versa), present whichever exists and note the other is empty

7. **Present results** using the appropriate output format below.

## Output

### Without topic filter (`/sdd:prime`):

```
## Architecture Context Loaded

Refreshed index (15 added, 174 updated across this repo's collections).

Primed session with {N} ADRs and {M} specs.

### Architecture Decision Records

| ID | Title | Status | Key Decision |
|----|-------|--------|--------------|
| ADR-0001 | {title} | {status} | {one-sentence summary of decision outcome} |

### Specifications

| ID | Title | Status | Requirements |
|----|-------|--------|--------------|
| SPEC-0001 | {title} | {status} | {N} requirements, {M} scenarios |

### Artifact Summaries (v5.1.0+)

**ADR-0001: {title}** (accepted)
{2-3 sentence summary of context, decision, and rationale.}

**ADR-0002: {title}** (proposed)
{2-3 sentence summary.}

**SPEC-0001: {title}**
{2-3 sentence summary of what the spec covers and key requirements.}

### Non-Authoritative (excluded)
- ADR-XXXX: {title} → superseded by ADR-YYYY
- ADR-XXXX: {title} (deprecated)
- SPEC-XXXX: {title} (rejected)

### Quick Reference
- Check for drift: `/sdd:check [target]`
- Full audit: `/sdd:audit [scope]`
- List all artifacts: `/sdd:list`
```

> **Notes**: 
> - The "Artifact Summaries" section provides context without opening files and is new in v5.1.0
> - The "Non-Authoritative (excluded)" section MUST only appear when there are excluded artifacts. If all artifacts are authoritative, omit the section entirely.
> - The "Refreshed index" line appears only when the index had changes; omit when the diff is empty

### Workspace aggregate mode (`/sdd:prime` in a multi-module project):

```
## Architecture Context Loaded

Primed session with {N} ADRs and {M} specs across {K} modules.

### Architecture Decision Records

| Module | ID | Title | Status | Key Decision |
|--------|----|-------|--------|--------------|
| [api] | ADR-0001 | {title} | {status} | {one-sentence summary} |
| [worker] | ADR-0001 | {title} | {status} | {one-sentence summary} |

### Specifications

| Module | ID | Title | Status | Requirements |
|--------|----|-------|--------|--------------|
| [api] | SPEC-0001 | {title} | {status} | {N} requirements, {M} scenarios |
| [worker] | SPEC-0001 | {title} | {status} | {N} requirements, {M} scenarios |

### Artifact Summaries (v5.1.0+)

**[api] ADR-0001: {title}** (accepted)
{2-3 sentence summary of context, decision, and rationale.}

**[worker] SPEC-0001: {title}**
{2-3 sentence summary of what the spec covers and key requirements.}

### Non-Authoritative (excluded)
- [api] ADR-XXXX: {title} → superseded by ADR-YYYY
- [worker] SPEC-XXXX: {title} (deprecated)

### Quick Reference
- Check for drift: `/sdd:check [target]`
- Check single module: `/sdd:check --module api [target]`
- Full audit: `/sdd:audit [scope]`
- List all artifacts: `/sdd:list`
```

### With topic filter (`/sdd:prime {topic}`):

```
## Architecture Context Loaded (filtered: "{topic}")

Primed session with {N} ADRs and {M} specs matching "{topic}".

### Matching ADRs

| ID | Title | Status | Relevance |
|----|-------|--------|-----------|
| ADR-XXXX | {title} | {status} | {why this matched the topic} |
| ADR-XXXX | {title} | ⚠ superseded | {why this matched the topic} |

### Matching Specs

| ID | Title | Status | Relevance |
|----|-------|--------|-----------|
| SPEC-XXXX | {title} | {status} | {why this matched the topic} |

### Summaries

**ADR-XXXX: {title}**
{2-3 sentence summary of context, decision, and rationale.}

**ADR-XXXX: {title}** ⚠ superseded by ADR-YYYY
{2-3 sentence summary. Final sentence notes: "This decision was superseded by ADR-YYYY — see the replacement for current guidance."}

**SPEC-XXXX: {title}**
{2-3 sentence summary of what the spec covers and key requirements.}

### Skipped (not relevant to "{topic}")
- ADR-XXXX: {title}
- SPEC-XXXX: {title}
```

## Rules

- This skill is READ-ONLY -- it MUST NOT modify any files
- MUST check for init before scanning -- do not silently proceed without design references in CLAUDE.md
- Topic filtering uses semantic matching, not keyword search -- leverage Claude's understanding of related concepts
- MUST include the "Skipped" section when using topic filter so the user knows what was excluded
- MUST include the "Summaries" section when using topic filter with 2-3 sentence summaries of each matching artifact
- If a section (ADRs or specs) is empty, omit that section's table rather than showing an empty table
- Sort ADRs by number, sort specs by number
- The "Key Decision" column should be a single sentence summarizing the decision outcome, not the full text
- MUST use the **Status Field Extraction** algorithm in Step 3a to support both YAML-frontmatter and inline-bullet formats — silently leaving the Status column blank for legacy repos that use `- **Status:** {value}` is misleading and was reported as a real-world bug
- MUST drop the Status column entirely when zero artifacts in the rendered corpus have a parseable status — a uniformly-blank column reads as "all unknown" and is worse than no column at all. When *some* artifacts have status and others do not, render missing as `—` so the asymmetry is visible. **Workspace aggregate mode**: the rendered corpus is the union across all modules — drop the column only when ZERO artifacts across ALL modules have status. If even one module has status, keep the column and render `—` for the modules that do not (the asymmetry is the signal). Single-module mode applies the rule to that module's corpus directly
- MUST strip parenthetical refinement notes from extracted status values (e.g., `accepted (refined by ADR-0010, 2026-05-03)` → `accepted`) — the full text remains in the source file; prime tables show the lifecycle word only
- In workspace aggregate mode, MUST prefix each artifact with its module name in square brackets (e.g., `[api] ADR-0001`)
- In workspace aggregate mode, MUST include the Module column in output tables
- In workspace aggregate mode, sort by module name first, then by artifact number within each module
- When `--module` is provided, do NOT prefix artifacts — behave as single-module
- MUST partition artifacts into authoritative vs non-authoritative — `superseded`, `deprecated`, and `rejected` are non-authoritative; everything else (including missing/empty status) is authoritative (Governing: ADR-0027)
- MUST exclude non-authoritative artifacts from main tables and the header counts in the untargeted output — they appear only in the "Non-Authoritative (excluded)" footer
- MUST omit the "Non-Authoritative (excluded)" footer entirely when there are zero excluded artifacts — never render an empty section
- MUST render superseded artifacts in the footer with a transition link: `ADR-XXXX: {title} → superseded by ADR-YYYY`. If `superseded-by` metadata is missing, render as `ADR-XXXX: {title} (superseded — no replacement recorded)` so the dead-end is visible
- In topic-filtered mode, MUST surface non-authoritative artifacts that match the topic with a `⚠ {status}` badge in the table and a "superseded by" note in the summary — do NOT silently exclude them, since topic filtering is for historical/investigative use
- In workspace aggregate mode, MUST prefix non-authoritative footer entries with the module bracket (e.g., `[api] ADR-XXXX: ...`) consistent with main-table prefixing
- **v5.0.0+**: MUST run Tier 2 session-start update per Step 1a — `qmd update` on entry unless the index was touched within 60s. Surface refresh diff as one-line note when non-zero; otherwise silent. Surface unembedded chunk count as one-line informational note (no AskUserQuestion) (Governing: ADR-0026, SPEC-0019 REQ "Tier 2 Session-Start Update via /sdd:prime")
- **v5.1.0+**: MUST use unified qmd retrieval for both untargeted and topic-filtered modes (removes the pre-v5.1 dual-path design). Both paths use `qmd query` with different limit/minScore parameters: untargeted uses `limit: 10000, minScore: 0` to retrieve all artifacts; topic-filtered uses `limit: 8, minScore: 0.3` for top-K relevance (Governing: ADR-0024, proposed refinement)
- **v5.1.0+**: MUST include an "Artifact Summaries" section in untargeted output — 2-3 sentence summaries for each ADR (from decision outcome) and spec (from overview). This provides context without opening files and is especially valuable for large artifact sets (Governing: proposed enhancement to SPEC-0019)
- **v5.1.0+**: Summaries are extracted via qmd query responses (no additional file reads needed) — use the JSON response's body/content fields and parse to extract summary sentences using simple heuristics (first 2-3 sentences ending with a period)
