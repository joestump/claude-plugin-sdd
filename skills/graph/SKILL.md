<!-- Governing: ADR-0023 (Frontmatter DAG and /sdd:graph Skill), SPEC-0018 REQ "Graph Construction", SPEC-0018 REQ "Graph Validation" -->

---
name: graph
description: Build and query the SDD artifact graph. Use when the user wants to validate frontmatter edges, find impact/ancestors/chain for an ADR or spec, detect orphans or cycles, or backfill edges from prose. Story 2 ships the `validate` verb; traversal verbs land in subsequent stories.
allowed-tools: Bash, Read, Glob, Grep, Task
argument-hint: validate
---

# /sdd:graph — Artifact Graph Skill

You are running `/sdd:graph`. This skill builds an in-memory directed graph of the project's ADRs, specs, and governed source files, then answers queries against it.

This skill differs from other SDD skills: instead of orchestrating Claude through markdown instructions, it delegates the deterministic build/validate/traverse work to a Python helper at `lib/graph.py` in this skill's directory. The output of the helper is the contract — JSON output (Story 6) is the stable shape any future MCP would consume. Markdown is reserved for orchestration and review UX (e.g., the `backfill` mode's accept/edit/reject in Story 7).

## Process

<!-- Governing: ADR-0016 (Workspace Mode), SPEC-0014 REQ "Artifact Path Resolution" -->

0. **Resolve artifact paths**: Follow the **Artifact Path Resolution** pattern from `references/shared-patterns.md` to determine the ADR and spec directories. The resolved ADR directory is `{adr-dir}` and spec directory is `{spec-dir}`.

   In Story 2 the helper accepts a single root and a single ADR/spec dir per invocation. Workspace-mode aggregation (multiple modules, `[module]/ID` prefixes) lands in Story 5.

1. **Parse the verb and flags from `$ARGUMENTS`**.

   Currently supported: `validate`. Other v1 verbs (`impact`, `ancestors`, `chain`, `orphans`, `cycles`, `backfill`) are recognized at the argparse layer and return a clear "not yet implemented (planned for Story N)" message with exit code 2 if invoked now. They land in Stories 3-7.

   The `--module <name>` flag for workspace-mode aggregation is not yet wired through the helper — it lands in Story 5 along with cross-module ID prefixing. Until then, the helper operates on a single `--root`. If the user passes `--module`, surface that this flag is Story 5 work and proceed without it.

2. **Locate the helper script**.

   The helper lives at `{skill-dir}/lib/graph.py`, where `{skill-dir}` is the absolute path to this skill's directory (the `Base directory for this skill` line in the skill invocation header). The helper is invoked via `python3` and reads from the project root passed via `--root`.

3. **Invoke the helper**.

   For `validate`:

   ```bash
   python3 {skill-dir}/lib/graph.py validate --root {project-root} --adr-dir {adr-dir} --spec-dir {spec-dir}
   ```

   - `{project-root}` is the working directory (typically `.`).
   - `{adr-dir}` and `{spec-dir}` are passed only if Step 0 resolved a non-default location (e.g., a workspace module). For a single-module project, omit them and the helper defaults to `docs/adrs/` and `docs/openspec/specs/` under the root.

4. **Present the helper's stdout to the user verbatim**.

   The helper emits markdown directly. Do not reformat or summarize unless the user asks.

5. **Surface the helper's exit code**.

   - Exit `0`: graph validates clean (no hard errors). Warnings, if any, are visible in the output.
   - Exit `1`: hard errors. The graph is not queryable until they are fixed. Do not proceed to other verbs.
   - Exit `2`: invocation error (bad arguments, missing root). This is a skill bug — surface it as such.

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
