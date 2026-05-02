---
status: approved
date: 2026-05-01
implements: [ADR-0023]
requires: [SPEC-0014]
---

# SPEC-0018: Artifact Graph

## Overview

Formalizes the artifact-to-artifact relationship graph that underlies impact analysis, lineage queries, orphan detection, and any future graph/RAG MCP for the SDD plugin. Defines the frontmatter edge schema for ADRs and specs, the graph builder behavior (parsing, inverse derivation, validation), the `/sdd:graph` skill verbs and output formats, and the assisted backfill workflow for migrating existing prose-encoded relationships. See ADR-0023.

This spec is intentionally narrow: it defines the artifact-level graph layer. It does not specify a local MCP — that is a future decision whose consumer contract is the JSON output format defined here. This spec is also the first artifact in the SDD repo to use the new frontmatter edge schema (`implements: [ADR-0023]`, `requires: [SPEC-0014]`), demonstrating the format end-to-end.

## Requirements

### Requirement: Frontmatter Edge Schema

ADRs and specs SHALL declare relationships to other artifacts via optional fields in their YAML frontmatter. All edge fields MUST be lists of artifact IDs (e.g., `[ADR-0008, ADR-0009]`). All edge fields are OPTIONAL — an artifact with no declared edges is valid. Edges MUST be forward-only as defined in the schema below; reverse-direction fields (e.g., `governed-by:`, `implemented-by:`) MUST NOT be authored — they are derived per Requirement: Inverse Edge Derivation.

**ADR edge fields:**

| Field | Meaning | Example |
|-------|---------|---------|
| `supersedes` | Hard replacement — the referenced ADR moves to status `superseded` | `supersedes: [ADR-0003]` |
| `extends` | Builds on without replacing | `extends: [ADR-0008, ADR-0009]` |
| `enables` | Unblocks a downstream decision | `enables: [ADR-0016]` |
| `governs` | Names specs this decision governs | `governs: [SPEC-0007, SPEC-0010]` |
| `related` | Weak association, no semantic claim | `related: [ADR-0010]` |

**Spec edge fields:**

| Field | Meaning | Example |
|-------|---------|---------|
| `implements` | ADRs this spec realizes | `implements: [ADR-0009, ADR-0011]` |
| `requires` | Capability dependency on another spec | `requires: [SPEC-0007]` |
| `extends` | Behavioral extension of another spec | `extends: [SPEC-0007]` |
| `supersedes` | Hard replacement — referenced spec moves to status `deprecated` (the spec status enum has no `superseded`; per `/sdd:status`) | `supersedes: [SPEC-0XXX]` |

The schema MUST be artifact-level only in v1. Requirement-level edges (e.g., a `SPEC-0014 REQ "Cross-Module Aggregation"` declaring it is governed by `ADR-0016`) are explicitly out of scope for this spec.

#### Scenario: ADR with multiple edge types

- **WHEN** an ADR has frontmatter containing `supersedes: [ADR-0003]`, `extends: [ADR-0008]`, and `governs: [SPEC-0007]`
- **THEN** the graph builder SHALL record three forward edges from this ADR plus the corresponding derived inverses on ADR-0003, ADR-0008, and SPEC-0007

#### Scenario: Spec implements an ADR

- **WHEN** a spec has frontmatter `implements: [ADR-0023]`
- **THEN** the graph builder SHALL record a forward edge `SPEC-XXXX --implements--> ADR-0023` and a derived inverse `ADR-0023 --governed-by--> SPEC-XXXX`

#### Scenario: Artifact with no declared edges

- **WHEN** an artifact has no edge fields in its frontmatter
- **THEN** the graph builder SHALL record the artifact as a node with no outgoing edges and SHALL NOT raise an error

#### Scenario: Reverse-direction field rejected

- **WHEN** an artifact's frontmatter contains a derived field name (e.g., `governed-by:`, `implemented-by:`, `superseded-by:`)
- **THEN** the graph builder MUST emit a warning identifying the file and field, and MUST NOT process it as an edge

### Requirement: Graph Construction

The `/sdd:graph` skill SHALL build an in-memory directed graph at query time from two sources: (a) artifact frontmatter edges per Requirement: Frontmatter Edge Schema, and (b) file-level governing comment blocks per ADR-0020 / SPEC-0016 REQ "Governing Comment Format". The graph MUST NOT be persisted between invocations in v1 — each invocation rebuilds from current files. Caching MAY be added in a future revision when query latency becomes a concern.

#### Scenario: Build from frontmatter only

- **WHEN** the skill is invoked in a project with N ADRs and M specs but no source code
- **THEN** the graph SHALL contain N + M nodes and edges derived solely from frontmatter

#### Scenario: Build from frontmatter and governing comments

- **WHEN** the skill is invoked in a project with ADRs, specs, and source files containing `// Governing: ADR-XXXX` and `// Implements: SPEC-XXXX REQ "..."` blocks
- **THEN** the graph SHALL contain artifact nodes plus file nodes, with edges from each file to its governing artifacts

#### Scenario: Files without governing comments

- **WHEN** a source file lacks a governing comment block
- **THEN** the file MUST NOT be added as a node in the graph — it remains invisible to traversal queries and surfaces only via the `orphans` verb

### Requirement: Inverse Edge Derivation

For every forward edge declared in frontmatter, the graph builder SHALL derive a corresponding reverse edge at build time. Derived edges MUST NOT be authored in frontmatter. The complete derivation table:

| Forward edge | Derived inverse |
|--------------|-----------------|
| `supersedes` (ADR → ADR, spec → spec) | `superseded-by` |
| `extends` (ADR → ADR, spec → spec) | `extended-by` |
| `enables` (ADR → ADR) | `enabled-by` |
| `governs` (ADR → spec) | `governed-by` |
| `related` (ADR ↔ ADR) | `related` (symmetric) |
| `implements` (spec → ADR) | `implemented-by` |
| `requires` (spec → spec) | `depended-on-by` |

Derived edges MUST be queryable via the same skill verbs as authored edges. Output formats MUST distinguish derived edges from authored edges (e.g., a `derived: true` field in JSON output, an "(derived)" annotation in markdown output).

#### Scenario: Derived inverse from governs

- **WHEN** ADR-0009 declares `governs: [SPEC-0007]`
- **THEN** querying ancestors of SPEC-0007 SHALL return ADR-0009 with edge type `governed-by` marked as derived

#### Scenario: Symmetric related edge

- **WHEN** ADR-0010 declares `related: [ADR-0001]` and ADR-0001 does NOT declare `related: [ADR-0010]`
- **THEN** the graph SHALL contain a `related` edge in both directions; the ADR-0010 → ADR-0001 direction SHALL be marked as authored, and the reverse SHALL be marked as derived

### Requirement: Graph Validation

The graph builder MUST validate the graph immediately after construction and before answering any query. Validation MUST cover three checks:

1. **ID resolution**: Every artifact ID referenced in a frontmatter edge MUST exist as a node in the graph. Unresolved references MUST be reported as a hard error including the source artifact, the offending field, and the missing target ID.
2. **Cycle detection**: The graph MUST be a DAG except for symmetric `related` edges. A cycle in any other edge type (`supersedes`, `extends`, `enables`, `governs`, `implements`, `requires`) MUST be reported as a hard error including the full cycle path.
3. **Status consistency**: When ADR A declares `supersedes: [ADR B]`, ADR B's frontmatter status MUST be `superseded` (or `deprecated` if explicitly chosen by the author). The same applies to `supersedes` between specs, where the target's spec status MUST be `deprecated`. The graph builder MUST detect any deviation from this rule and emit a warning identifying the source artifact, the target artifact, and the actual status. Warnings MUST NOT block queries — the graph remains queryable while the inconsistency is resolved.

Hard errors MUST cause the skill to refuse to answer query verbs and exit with a non-zero status. Warnings MUST be reported to the user but MUST NOT block queries.

#### Scenario: Unresolved ID

- **WHEN** an ADR declares `governs: [SPEC-9999]` but no SPEC-9999 exists in the graph
- **THEN** the skill SHALL report a hard error of the form "ADR-XXXX governs unknown spec SPEC-9999" and exit without answering queries

#### Scenario: Cycle in supersedes

- **WHEN** ADR-A declares `supersedes: [ADR-B]` and ADR-B declares `supersedes: [ADR-A]`
- **THEN** the skill SHALL report a hard error identifying the cycle path and exit without answering queries

#### Scenario: Status inconsistency

- **WHEN** ADR-0023 declares `supersedes: [ADR-0003]` but ADR-0003's frontmatter status is `accepted` (not `superseded`)
- **THEN** the skill SHALL emit a warning identifying the inconsistency and SHALL proceed to answer queries

#### Scenario: Symmetric related is not a cycle

- **WHEN** ADR-A declares `related: [ADR-B]` and ADR-B declares `related: [ADR-A]`
- **THEN** the skill SHALL record both authored edges and SHALL NOT report a cycle

### Requirement: Traversal Query Verbs

The `/sdd:graph` skill SHALL support three traversal query verbs that take an artifact ID as their argument:

| Verb | Behavior |
|------|----------|
| `impact <id>` | Returns all artifacts and code files reachable from `<id>` via inverse-edge traversal — everything that depends on `<id>` and would be affected if it changes |
| `ancestors <id>` | Returns all artifacts reachable from `<id>` via forward-edge traversal — everything `<id>` depends on, transitively |
| `chain <id>` | Returns the full lineage of `<id>` in both directions: ADR ↔ spec ↔ requirement ↔ code |

Each verb MUST traverse transitively (multi-hop, not just direct neighbors). Each verb MUST clearly distinguish authored edges from derived edges in its output. Each verb MUST handle the case where `<id>` is not a known artifact by reporting an error with available artifact IDs or close matches.

#### Scenario: Impact of an ADR change

- **WHEN** the user runs `/sdd:graph impact ADR-0008`
- **THEN** the output SHALL list every spec governed by ADR-0008, every ADR that extends or is enabled by ADR-0008, every spec that transitively depends on those specs, and every source file with a governing comment referencing ADR-0008

#### Scenario: Ancestors of a spec

- **WHEN** the user runs `/sdd:graph ancestors SPEC-0010`
- **THEN** the output SHALL list ADRs the spec implements, specs the spec requires or extends transitively, and the upstream ADRs reached through those chains

#### Scenario: Chain of an artifact

- **WHEN** the user runs `/sdd:graph chain SPEC-0007`
- **THEN** the output SHALL present the full bidirectional lineage: ADRs that govern SPEC-0007 (upstream), and source files that implement requirements from SPEC-0007 (downstream)

#### Scenario: Unknown ID

- **WHEN** the user runs `/sdd:graph impact SPEC-9999` and SPEC-9999 does not exist
- **THEN** the skill SHALL report an error and SHOULD list the closest matches by ID prefix or name similarity

### Requirement: Diagnostic Query Verbs

The `/sdd:graph` skill SHALL support two diagnostic query verbs that operate over the entire graph and take no ID argument:

| Verb | Behavior |
|------|----------|
| `orphans` | Returns three categories: (a) source files with no governing comment block, (b) specs with no implementing source files, (c) ADRs with no implementing spec |
| `cycles` | Returns all cycles detected during validation. If validation passed, returns an empty result. |

Diagnostic verbs MUST tolerate large outputs by supporting an optional scope filter (e.g., `--scope src/auth/` to limit `orphans` detection to a subtree).

#### Scenario: Orphan source files

- **WHEN** the user runs `/sdd:graph orphans` and 5 source files lack governing comment blocks
- **THEN** the output SHALL list those files under "Source files without governing artifacts"

#### Scenario: Orphan spec

- **WHEN** SPEC-0017 has no source files referencing it via governing comments
- **THEN** the `orphans` output SHALL include SPEC-0017 under "Specs with no implementing code"

#### Scenario: No cycles detected

- **WHEN** validation passed and the graph contains no cycles
- **THEN** `cycles` SHALL return "No cycles detected."

### Requirement: Backfill Mode

The `/sdd:graph backfill` mode SHALL parse existing prose in ADRs and specs to propose frontmatter edges, then present the proposals to the user for per-file accept / edit / reject before any file is modified. The mode MUST NOT write any file without explicit user consent for that file.

Sources of prose-encoded edges that the parser MUST recognize:

- `## Related` and `## More Information` sections
- "Supersedes" / "Extends" / "Related" / "Builds on" prefixes followed by ADR-XXXX or SPEC-XXXX references
- Inline `ADR-XXXX` and `SPEC-XXXX` references in `## Overview` sections of specs (treated as implicit `implements:` candidates for ADRs and `requires:` candidates for other specs)
- The `## Decision Outcome` and `## Consequences` sections of ADRs (treated as implicit `governs:` candidates when they reference SPEC-XXXX)

The mode MUST present proposals as a per-file diff showing the frontmatter that would be added. The mode MUST allow the user to accept the diff, edit the diff before accepting, or reject the diff outright. Rejected proposals MUST NOT be re-proposed in subsequent backfill runs unless the user opts in via a `--reset` flag.

#### Scenario: Backfill proposes edges from prose

- **WHEN** the user runs `/sdd:graph backfill` and ADR-0009 ends with "Related: ADR-0008 (standalone sprint planning skill), SPEC-0007 (sprint planning requirements)"
- **THEN** the mode SHALL propose adding `extends: [ADR-0008]` and `governs: [SPEC-0007]` to ADR-0009's frontmatter and present the diff for user review

#### Scenario: User accepts a proposal

- **WHEN** the user accepts the proposed diff for ADR-0009
- **THEN** the mode SHALL write the updated frontmatter to ADR-0009 only, leaving all other artifacts unchanged

#### Scenario: User rejects a proposal

- **WHEN** the user rejects the proposed diff for ADR-0009
- **THEN** the mode SHALL skip ADR-0009 without modification, proceed to the next artifact, and MUST NOT re-propose the same edges for ADR-0009 in subsequent runs unless `--reset` is passed

#### Scenario: User edits a proposal

- **WHEN** the user accepts the proposed diff after editing it (e.g., removing one of three proposed edges)
- **THEN** the mode SHALL write only the edited subset to ADR-0009's frontmatter

### Requirement: Output Formats

The `/sdd:graph` skill SHALL support four output formats. The default format MUST depend on the shape of the result: ASCII DAG for hierarchical results, markdown table for flat results. Format selection MUST be via flags applied to any query verb.

| Flag | Format | Use case |
|------|--------|----------|
| (none, hierarchical result) | ASCII DAG | Default for `chain`, `impact`, `ancestors` — terminal viewing of multi-hop traversals where parent/child structure carries meaning |
| (none, flat result) | Markdown table | Default for `orphans`, `cycles` — flat lists with no inherent hierarchy |
| `--table` | Markdown table | Force tabular output even when the result is hierarchical |
| `--mermaid` | Mermaid graph diagram | Visual inspection; embedding in artifacts and PR descriptions |
| `--json` | JSON (schema below) | Machine consumption — the contract for any future MCP, IDE plugin, or dashboard |

**Hierarchical vs flat classification:**

- `chain`, `impact`, `ancestors` produce hierarchical results — multi-hop traversals where parent/child structure carries meaning.
- `orphans`, `cycles` produce flat results — independent items that share no parent/child relationship.

**ASCII DAG layout rules:**

- MUST use Unicode box-drawing characters from the `U+2500–U+257F` block. The minimum set the renderer MUST handle is `──►`, `┬`, `├`, `└`, `┐`, `┌`, `┴`, `┤`, and `│`. Additional characters from the same Unicode block MAY be used.
- Derived edges MUST be visually distinguished from authored edges. The skill SHALL use a dashed arrow (`─ ─►`) for derived edges and a solid arrow (`───►`) for authored edges. Edge-type labels MUST be inlined on every edge except where the edge type is the *default for the source/target pair*: unlabeled forward arrows mean `governs` for ADR→spec edges, `requires` for spec→spec edges, and `extends` for ADR→ADR edges. All other edge types (e.g., `supersedes`, `enables`, `implements`, `related`) MUST carry a label of the form `─[supersedes]►`.
- Node labels MUST include the artifact ID and a one-line title. Title truncation MUST be deterministic — truncate to a configured maximum (default 60 characters) with a trailing single-character ellipsis (`…`) when exceeded. Titles MUST be normalized before truncation: collapse runs of whitespace to a single space, strip leading/trailing whitespace, do not strip punctuation.
- Layout direction MUST be:
  - `ancestors`: top-to-bottom, queried artifact at the bottom, transitive ancestors flowing down toward it.
  - `impact`: top-to-bottom, queried artifact at the top, dependents flowing down.
  - `chain`: bidirectional, queried artifact in the middle of a single contiguous diagram. Ancestors render above; dependents render below. The two regions are visually separated by a single `│` continuation through the queried node — NOT by `▼`. The `▼` glyph is reserved for the diagnostic-output case of "descent into a separate subgraph" (used by `orphans` when grouping by category in DAG view, not used by traversal verbs).
- The DAG MUST be reproducible — given the same input graph, the skill MUST emit byte-identical output. To make byte-identity precise, the skill MUST also pin: (a) line ending = LF only, (b) encoding = UTF-8 with no BOM, (c) exactly one trailing newline at the end of output, (d) exactly two spaces of indentation per nesting level, (e) sibling branches sorted by artifact ID ascending. Tie-breaking for any other ordering decision MUST also use artifact ID ascending.

The JSON output schema MUST be stable and versioned. The top-level object MUST include a `schema_version` field. Breaking changes to the JSON schema MUST require a new schema version and MUST be documented in this spec via a versioned addendum.

The minimum JSON schema fields per response:

```json
{
  "schema_version": "1",
  "query": { "verb": "impact", "id": "ADR-0008" },
  "results": [
    {
      "id": "SPEC-0007",
      "type": "spec",
      "module": null,
      "edges": [
        { "type": "governed-by", "target": "ADR-0008", "derived": true },
        { "type": "implements", "target": "ADR-0008", "derived": false }
      ]
    }
  ]
}
```

The `derived` field MUST be present on every edge object — `true` for inverse edges computed by the graph builder, `false` for edges authored in frontmatter or governing comment blocks. Omitting the field is not permitted; consumers MUST be able to filter authored vs. derived edges without inferring from absence.

#### Scenario: Default ASCII DAG for hierarchical result

- **WHEN** the user runs `/sdd:graph chain SPEC-0007` with no format flag
- **THEN** the output SHALL be an ASCII DAG with SPEC-0007 as the central node, governing ADRs above, and implementing source files below — using the box-drawing characters and layout rules defined above

#### Scenario: Default markdown table for flat result

- **WHEN** the user runs `/sdd:graph orphans` with no format flag
- **THEN** the output SHALL be a markdown table — `orphans` is a flat list with no inherent hierarchy

#### Scenario: --table override on hierarchical result

- **WHEN** the user runs `/sdd:graph impact ADR-0008 --table`
- **THEN** the output SHALL be a markdown table even though `impact` produces a hierarchical result, with columns for ID, type, edge type to the queried artifact, and authored/derived indicator

#### Scenario: Authored vs derived in ASCII DAG

- **WHEN** the user runs `/sdd:graph ancestors SPEC-0010` and the path includes both an authored `implements` edge and a derived `governed-by` edge
- **THEN** the ASCII DAG SHALL render the authored edge with a solid arrow and the derived edge with a dashed arrow, with edge-type labels visible when the edge type is non-default

#### Scenario: ASCII DAG reproducibility

- **WHEN** the user runs `/sdd:graph chain SPEC-0007` twice in a row against the same artifact files
- **THEN** the output SHALL be byte-identical between the two runs

#### Scenario: Mermaid output

- **WHEN** the user runs `/sdd:graph chain SPEC-0007 --mermaid`
- **THEN** the output SHALL be a Mermaid `flowchart` block depicting the bidirectional lineage with nodes for ADRs, specs, and source files

#### Scenario: JSON output schema stability

- **WHEN** the user runs `/sdd:graph ancestors SPEC-0010 --json`
- **THEN** the output SHALL include a top-level `schema_version` field and SHALL conform to the documented schema for that version

### Requirement: Workspace Mode Aggregation

In workspace mode (per ADR-0016 / SPEC-0014), the `/sdd:graph` skill SHALL aggregate the graph across all discovered modules. Artifact IDs in cross-module output MUST be prefixed with the module name in square brackets (e.g., `[api] SPEC-0001`, `[worker] ADR-0003`) to disambiguate independently numbered artifacts.

When the `--module <name>` flag is provided, the skill MUST scope queries to a single module and MUST NOT prefix IDs in output. Cross-module edges (e.g., a spec in module `api` that requires a spec in module `shared-lib`) MUST be supported by allowing edge fields to reference module-prefixed IDs. Authoring syntax MUST quote the prefixed ID as a YAML scalar to avoid YAML's nested-list parse: `requires: ["[shared-lib]/SPEC-0001"]`. Display syntax in tool output uses the same `[module]/SPEC-XXXX` form without quotes (since output is not YAML).

#### Scenario: Aggregate query in workspace

- **WHEN** the user runs `/sdd:graph orphans` in a workspace with modules `api` and `worker`
- **THEN** the output SHALL list orphan files and specs from both modules, each prefixed with its module name

#### Scenario: Module-scoped query

- **WHEN** the user runs `/sdd:graph impact ADR-0001 --module api`
- **THEN** the output SHALL be scoped to `api`-module artifacts only, and IDs SHALL NOT be prefixed

#### Scenario: Cross-module edge

- **WHEN** a spec in module `api` declares `requires: ["[shared-lib]/SPEC-0001"]` (quoted YAML scalar)
- **THEN** the graph builder SHALL record an edge from `[api]/SPEC-XXXX` to `[shared-lib]/SPEC-0001` and SHALL treat it as a normal forward edge for traversal queries

#### Scenario: Cross-module edge with unquoted YAML rejected

- **WHEN** an authoring frontmatter contains `requires: [[shared-lib]/SPEC-0001]` (unquoted, parses as YAML nested list)
- **THEN** the graph builder MUST emit a hard error identifying the file and field with guidance to quote module-prefixed IDs as scalars

#### Scenario: Single-module project

- **WHEN** the project is not a workspace (no `.gitmodules` and no `### Workspace Modules` table in CLAUDE.md)
- **THEN** all output IDs SHALL be unprefixed and the `--module` flag SHALL be silently ignored if provided
