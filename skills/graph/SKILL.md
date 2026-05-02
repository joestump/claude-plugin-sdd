<!-- Governing: ADR-0023 (Frontmatter DAG and /sdd:graph Skill), SPEC-0018 REQ "Graph Construction", SPEC-0018 REQ "Graph Validation" -->

---
name: graph
description: Build and query the SDD artifact graph. Use when the user wants to validate frontmatter edges, find impact/ancestors/chain for an ADR or spec, detect orphans or cycles, or backfill edges from prose. Currently supports validate / impact / ancestors / chain / orphans / cycles, with workspace-mode aggregation; backfill lands in Story 7.
allowed-tools: Bash, Read, Glob, Grep, Task
argument-hint: <verb> [<artifact-id>] [--scope <subtree>] [--module <name>] [--table | --mermaid | --json]
---

# /sdd:graph — Artifact Graph Skill

You are running `/sdd:graph`. This skill builds an in-memory directed graph of the project's ADRs, specs, and governed source files, then answers queries against it.

This skill differs from other SDD skills: instead of orchestrating Claude through markdown instructions, it delegates the deterministic build/validate/traverse work to a Python helper at `lib/graph.py` in this skill's directory. The output of the helper is the contract — JSON output (Story 6) is the stable shape any future MCP would consume. Markdown is reserved for orchestration and review UX (e.g., the `backfill` mode's accept/edit/reject in Story 7).

## Process

<!-- Governing: ADR-0016 (Workspace Mode), SPEC-0014 REQ "Artifact Path Resolution" -->

0. **Resolve artifact paths**: Follow the **Artifact Path Resolution** pattern from `references/shared-patterns.md` to determine the ADR and spec directories. The resolved ADR directory is `{adr-dir}` and spec directory is `{spec-dir}`.

   In Story 2 the helper accepts a single root and a single ADR/spec dir per invocation. Workspace-mode aggregation (multiple modules, `[module]/ID` prefixes) lands in Story 5.

1. **Parse the verb and flags from `$ARGUMENTS`**.

   Currently supported: `validate`, `impact <id>`, `ancestors <id>`, `chain <id>`, `orphans`, `cycles`. Backfill (`backfill`) is recognized at the argparse layer and returns a clear "not yet implemented (planned for Story 7)" message with exit code 2.

   Traversal verbs require an artifact ID argument (e.g., `ADR-0023`, `SPEC-0018`, or `[api]/SPEC-0001` in workspace aggregate mode). If the ID is unknown, the helper exits 1 and suggests closest matches.

   The `--module <name>` flag scopes a workspace-mode invocation to a single module: the helper builds only that module's graph with unprefixed IDs. Without `--module` in a workspace project, the helper aggregates all modules with `[module]/ID` prefixes. On single-module projects (no `.gitmodules` and no `### Workspace Modules` table), `--module` is rejected with a clear error.

2. **Locate the helper script**.

   The helper lives at `{skill-dir}/lib/graph.py`, where `{skill-dir}` is the absolute path to this skill's directory (the `Base directory for this skill` line in the skill invocation header). The helper is invoked via `python3` and reads from the project root passed via `--root`.

3. **Invoke the helper**.

   For `validate`:

   ```bash
   python3 {skill-dir}/lib/graph.py validate --root {project-root} [--adr-dir DIR] [--spec-dir DIR]
   ```

   For traversal verbs:

   ```bash
   python3 {skill-dir}/lib/graph.py impact {ARTIFACT-ID} --root {project-root}
   python3 {skill-dir}/lib/graph.py ancestors {ARTIFACT-ID} --root {project-root}
   python3 {skill-dir}/lib/graph.py chain {ARTIFACT-ID} --root {project-root}
   ```

   - `{project-root}` is the working directory (typically `.`).
   - `{adr-dir}` and `{spec-dir}` are passed only if Step 0 resolved a non-default location (e.g., a workspace module). For a single-module project, omit them and the helper defaults to `docs/adrs/` and `docs/openspec/specs/` under the root.
   - Traversal verbs refuse to run if validation has hard errors. Run `validate` first if the user reports unexpected output.

4. **Present the helper's stdout to the user verbatim**.

   The helper emits markdown directly. Do not reformat or summarize unless the user asks.

5. **Surface the helper's exit code**.

   - Exit `0`: graph validates clean (no hard errors). Warnings, if any, are visible in the output.
   - Exit `1`: hard errors. The graph is not queryable until they are fixed. Do not proceed to other verbs.
   - Exit `2`: invocation error (bad arguments, missing root). This is a skill bug — surface it as such.

## Workspace mode

Per SPEC-0014 § "Workspace Detection," the helper auto-detects workspace mode:

1. Look for `.gitmodules` in the project root (parses `[submodule "name"]` and `path =` entries).
2. Fall back to a `### Workspace Modules` table in the project-root `CLAUDE.md` (Module / Root columns).
3. Otherwise treat the project as single-module.

For each discovered module, the helper resolves ADR/spec paths via the **Artifact Path Resolution** pattern (reads the module's `CLAUDE.md` for declarations, falls back to `docs/adrs/` and `docs/openspec/specs/`).

**Aggregate mode** (no `--module` in a workspace): the helper builds each module's graph independently, prefixes every node ID with `[module]/`, and merges into a single graph. Cross-module edges authored as `requires: ["[shared]/SPEC-0001"]` resolve against the merged graph; cycle detection and ID resolution operate over the full aggregate so cross-module cycles are caught.

**Module-scoped mode** (`--module foo`): the helper builds only that module's graph with unprefixed IDs. Cross-module references in that module's frontmatter become unresolved-ID hard errors — this is intentional (use aggregate mode if you want cross-module behavior).

**Single-module mode** (no workspace detected): the helper operates on the project root with unprefixed IDs, identical to pre-Story-5 behavior.

## Verbs

### `validate`

Builds the graph and reports diagnostics. No ID argument required.

### `impact <id>`

Renders a top-down ASCII DAG: queried artifact at the top, dependents flowing below via derived inverse edges. Direct dependents (one hop) are immediate children; transitive dependents are nested. Each edge is labeled with its derived inverse type and a `(derived)` annotation; the connector uses a dashed arrow `─ ─►`. Default edge types for the source/target kind pair are unlabeled to reduce visual noise (e.g., `governs` for ADR→spec, `implements` for spec→ADR).

### `ancestors <id>`

Renders ancestor paths in a single contiguous diagram with the queried artifact at the bottom (per SPEC-0018 § Layout rules). Each enumerated leaf-to-target path is rendered as a top-down chain (most-distant ancestor first, edge labels and `┆` continuation glyphs flowing down), separated by a blank line from the next path, with the queried artifact appearing exactly once at the bottom. The vertical connector uses the dashed glyph `┆` because the visual flow is the inverse of the authored relationship; edge labels reflect the derived inverse type with the `(derived)` annotation.

The vertical-stack approximation of multi-parent fan-in (vs. a side-by-side merging Y) is a tractable ASCII-only rendering — multi-parent inputs read as a sequence of independent ancestor paths feeding into the shared queried node.

### `chain <id>`

Single contiguous bidirectional diagram: ancestors above (rendered as top-down chains with the target's title suppressed at the bottom of each), the queried artifact in the middle (rendered once as `<title> (queried)`), and impact below (rendered as a top-down indented tree). The two regions are visually joined by a single `│` continuation through the queried node — no markdown subheadings, no `▼` glyphs.

### `orphans`

Surfaces three categories of orphan as flat markdown tables (default for flat results per SPEC-0018):

1. **Source files without governing artifacts** — non-markdown source files in the project tree that contain no `Governing:` comment block. Discovered by a dedicated walk so these files do not become graph nodes (they remain invisible to traversal queries) but DO surface here. The walk uses the same exclusions as the graph builder (`.git`, `node_modules`, `vendor`, build/cache dirs, `docs/`, `skills/`, `references/`, etc.). Markdown files are skipped — they participate via frontmatter (ADRs, specs) or are out of scope for v1 (READMEs, ad-hoc docs).
2. **Specs with no implementing code** — specs that no source file's governing comment references.
3. **ADRs with no implementing spec** — ADRs that no spec declares `implements:` against.

Optional `--scope <subtree>` restricts category 1 to source files under the given path. Categories 2 and 3 always cover the full graph.

**Operator-facing framing.** A spec is flagged whenever no `Governing:` comment in source code references it; comment-less code is invisible by design (per SPEC-0018 § "Files without governing comments"). For repos that haven't yet attached governing comments to source code, expect every spec and ADR to be flagged. The output includes a one-line preamble explaining this so first-time readers know the verb is working as intended, not reporting a real catastrophe.

### `cycles`

Lists any cycles detected during validation. Note: traversal/diagnostic verbs only run after validation passes (the hard-error gate in `main()`), so this verb's output in v1 is always "No cycles detected." The verb exists for tooling that wants to confirm cycle-freeness without running full validation.

### Backfill (Story 7 — not yet implemented)

`backfill` will be added in Story 7. Currently returns a "not yet implemented" error.

## Output formats

Per SPEC-0018 § Output Formats, the helper supports four output formats. Defaults are shape-aware: hierarchical results (`chain`, `impact`, `ancestors`) default to ASCII DAG; flat results (`orphans`, `cycles`) default to markdown table. Format flags are mutually exclusive.

| Flag | Format | Use case |
|------|--------|----------|
| (none) | Shape-default | Terminal viewing — ASCII DAG for hierarchical, markdown table for flat |
| `--table` | Markdown table | Force tabular output on hierarchical verbs (columns: ID, Type, Edge, Authored) |
| `--mermaid` | Mermaid flowchart | Visual format for embedding in docs / PR descriptions. Authored edges = `-->`; derived edges = `-.->` |
| `--json` | Versioned JSON | Machine consumption — the contract for any future MCP, IDE plugin, or dashboard |

### JSON schema

Every JSON response includes a top-level `schema_version` field. The current version is `"1"`. Breaking changes require a new schema version and a versioned addendum to SPEC-0018 § Output Formats.

**Traversal verbs** (`impact`, `ancestors`, `chain`):

Each result entry's `edges[]` describes the relationship FROM the result TO the traversal subgraph (the queried artifact and any other visited node) — not the reverse. A result with both an authored `implements` edge and a derived `governed-by` edge to the queried artifact would emit both edges; a result with only one direction emits only that one.

```json
{
  "schema_version": "1",
  "query": {"verb": "impact", "id": "ADR-0023"},
  "results": [
    {
      "id": "SPEC-0018",
      "type": "spec",
      "module": null,
      "title": "SPEC-0018: Artifact Graph",
      "edges": [
        {"type": "implements", "target": "ADR-0023", "derived": false}
      ]
    }
  ]
}
```

**Error envelope** (any JSON-mode failure):

```json
{
  "schema_version": "1",
  "query": {"verb": "impact", "id": "ADR-9999"},
  "error": {
    "code": "unknown-artifact",
    "message": "unknown artifact `ADR-9999`",
    "suggestions": ["ADR-0023", "ADR-0022", "ADR-0021"]
  }
}
```

Distinguishable from success responses by the presence of a top-level `error` field instead of `results`. Other error codes: `graph-has-errors` (validation failed; see `validate --json` for details).

**Diagnostic verb `orphans`**:

```json
{
  "schema_version": "1",
  "query": {"verb": "orphans"},
  "results": {
    "code_files_without_governing": [...],
    "specs_without_implementing_code": [...],
    "adrs_without_implementing_spec": [...]
  }
}
```

**Diagnostic verb `cycles`**:

```json
{
  "schema_version": "1",
  "query": {"verb": "cycles"},
  "results": []
}
```

**`validate`**:

```json
{
  "schema_version": "1",
  "query": {"verb": "validate"},
  "results": {
    "nodes": 41,
    "authored_edges": 2,
    "derived_edges": 2,
    "diagnostics": []
  }
}
```

JSON output uses `sort_keys=True` and `indent=2` for byte-identical reproducibility. Each entry is fully self-describing — consumers do not need to re-read markdown to interpret the result.

## What `validate` reports

Per SPEC-0018 REQ "Graph Validation", three classes of finding:

| Finding | Severity | Trigger |
|---------|----------|---------|
| Unresolved ID | error | An edge references an artifact ID that has no node in the graph |
| Cycle | error | A cycle exists in any acyclic edge type (`supersedes`, `extends`, `enables`, `governs`, `implements`, `requires`) |
| Status inconsistency | warning | An ADR/spec is `supersedes`-targeted but the target's status is not `superseded` (ADR) or `deprecated` (ADR/spec) |

The helper also reports authoring-time mistakes that are not in the canonical spec but are useful in practice:

| Finding | Severity | Trigger |
|---------|----------|---------|
| Authored derived field | warning | Frontmatter declares a derived field (`governed-by`, `implemented-by`, etc.) that should be computed, not authored |
| Schema misuse | warning | A spec declares an ADR-only field, or an ADR declares a spec-only field |
| Malformed edge list | error | An edge field is not a list, or contains a non-string entry |
| Duplicate ID | error | Two files declare the same ADR-XXXX or SPEC-XXXX |

## Architecture

```
+---------------------+      +---------------------+
| docs/adrs/*.md      |      | docs/openspec/...   |
| (frontmatter edges) |      |    /spec.md         |
+----------+----------+      +----------+----------+
           |                            |
           +----------+    +------------+
                      |    |
                      v    v
          +-----------------------------+
          | lib/graph.py                |
          |  - parse frontmatter (YAML  |
          |    subset; stdlib only)     |
          |  - parse governing comments |
          |  - build directed graph     |
          |  - validate (3 checks)      |
          |  - derive inverse edges     |
          +--------------+--------------+
                         |
              +----------+----------+
              | stdout (markdown    |
              | by default)         |
              +---------------------+
```

The helper is stdlib-only — no PyYAML dependency. The frontmatter parser is intentionally narrow: it handles scalars and inline-bracket lists, which is all the SPEC-0018 schema declares. Extending it to nested mappings or block-list YAML is future work that should not be undertaken speculatively.

**Python version.** Requires Python 3.10+ (uses PEP 604 union syntax `str | None` and `Path.is_relative_to`).

## Cross-references

- **Schema**: `references/shared-patterns.md` § "Graph Edge Resolution"
- **Author surfaces**: `skills/adr/SKILL.md` § "Graph Edge Frontmatter", `skills/spec/SKILL.md` § "Graph Edge Frontmatter"
- **Code-edge format**: `references/shared-patterns.md` § "Governing Comment Format"
- **Canonical spec**: `docs/openspec/specs/artifact-graph/spec.md` (SPEC-0018)
- **Canonical decision**: `docs/adrs/ADR-0023-frontmatter-dag-and-graph-skill.md`

## Rules

- Verb output is the helper's stdout — do not paraphrase it.
- Hard errors (exit 1) MUST be surfaced before any other action. Do not run other verbs against a graph that failed validation.
- The helper is the source of truth. If the helper output disagrees with this SKILL.md, fix the SKILL.md or the helper, not the user's expectations.
- Do not bypass the helper to "do graph work in markdown." Determinism and byte-identity require the script.
- When extending the helper (Stories 3-7), preserve the existing Python module structure: discovery → parsing → models → construction → validation. New verbs add new entry points but do not rewrite the core.
