---
name: discover
description: Discover implicit architectural decisions and spec-worthy subsystems in an existing codebase. Use when the user says "discover architecture", "what decisions exist in this code", "bootstrap ADRs", or wants to reverse-engineer design artifacts from code.
allowed-tools: Bash, Read, Glob, Grep, Task, AskUserQuestion
argument-hint: [scope] [--module <name>] [--with-graphs]
---

# Discover Implicit Architecture

Explore an existing codebase to discover implicit architectural decisions and specification-worthy subsystems. Produces a suggestion report -- does NOT create any files.

## Process

<!-- Governing: ADR-0016 (Workspace Mode), SPEC-0014 REQ "Artifact Path Resolution" -->

0. **Resolve artifact paths**: Follow the **Artifact Path Resolution** pattern from `references/shared-patterns.md` to determine the ADR and spec directories. If `$ARGUMENTS` contains `--module <name>`, resolve paths relative to that module; otherwise, in a workspace, aggregate across all modules. The resolved ADR directory is `{adr-dir}` and spec directory is `{spec-dir}`.

1. **Parse the scope**: Extract the optional scope from `$ARGUMENTS`.
   - A directory path: `src/auth/` -- limit analysis to that subtree
   - A domain keyword: `auth`, `api`, `data` -- limit by semantic relevance
   - If `$ARGUMENTS` is empty, analyze the entire project (or module if `--module` is set)

2. **Validate the scope** (if provided):
   - For directory paths: verify the path exists. If not, report: "Scope not found: `{scope}`. Provide a valid directory path or omit the scope to analyze the entire project."

2a. **Tier 3 staleness check** (v5.0.0+):

   <!-- Governing: ADR-0026 (Tiered Index Freshness), SPEC-0019 REQ "Tier 3 Staleness Threshold for Consumer Skills" -->

   On entry, check the qmd index's last-modified timestamp for this repo's collections (use the exact-prefix match algorithm from `references/qmd-helpers.md` § "This-Repo Collection Identification"). If older than the configured staleness threshold (default 120m, set in CLAUDE.md `### SDD Configuration` `#### Index Freshness` `**Staleness Threshold**`), trigger a silent `qmd update` first and emit a one-line note in the report header: `Index was {age} stale — refreshed before running.` On fresh, proceed silently.

3. **Load existing design artifacts**:
   - Glob `{adr-dir}/ADR-*.md` and read each file's title, context, and decision outcome
   - Glob `{spec-dir}/*/spec.md` and read each file's title and overview. Validate spec pairing per `references/shared-patterns.md` § "Spec Pairing Validation".
   - Build an exclusion list of already-documented decisions and subsystems
   - If neither directory exists, note that no existing artifacts were found (this is expected for first-time discovery)

4. **Analyze the codebase** across four categories. Use the Task tool to spawn parallel Explore agents for each category. Each agent should return a list of findings with evidence.

   **Agent 1 -- Dependency & Framework Analysis**:
   - Scan for project manifests (e.g., `package.json`, `requirements.txt`, `pyproject.toml`, `Cargo.toml`, `Gemfile`, `pom.xml`, `build.gradle`, `composer.json`, and other ecosystem-specific files).
   - Read dependency lists and identify major framework/library choices
   - Look for lock files to confirm actively used dependencies
   - Identify technology choices that represent architectural decisions (e.g., "chose Next.js over Remix", "chose PostgreSQL over MongoDB", "chose REST over GraphQL")

   **Agent 2 -- Architectural Pattern Analysis**:
   - Examine code structure for API patterns (REST controllers, GraphQL resolvers, gRPC services)
   - Look for data access patterns (ORM usage, repository pattern, direct queries)
   - Identify authentication/authorization patterns (JWT, sessions, OAuth)
   - Detect state management patterns (Redux, Context, Zustand, etc.)
   - Look for messaging/event patterns (queues, pub/sub, event emitters)
   - Identify error handling and logging patterns

   **Agent 3 -- Project Structure & Boundary Analysis**:
   - Examine top-level directory layout and module organization
   - Identify subsystem boundaries (directories with cohesive responsibility)
   - Look for monorepo patterns (workspaces, packages/)
   - Identify API surface boundaries (routes, endpoints, public interfaces)
   - Detect data model boundaries (schema files, migration directories, model definitions)
   - Look for clear module interfaces that suggest spec-worthy subsystems

   **Agent 4 -- Configuration & Infrastructure Analysis**:
   - Scan for Docker/container configuration (Dockerfile, docker-compose.yml, .containerignore)
   - Look for CI/CD configuration (.github/workflows/, .gitlab-ci.yml, Jenkinsfile)
   - Check for infrastructure-as-code (Terraform, CloudFormation, Pulumi)
   - Examine environment configuration (.env.example, config files)
   - Identify deployment targets and hosting decisions
   - Look for monitoring/observability configuration

5. **Merge and deduplicate findings**:
   - Combine results from all four agents
   - Group related findings (e.g., "chose Express" and "REST API pattern" both relate to the API layer)
   - Remove findings that overlap with existing ADRs or specs from step 3
   - For partial overlaps, note what the existing artifact covers and what remains undocumented

5a. **qmd-aware duplicate suppression** (v5.0.0+):

   <!-- Governing: ADR-0024 (qmd as hard dependency), SPEC-0019 REQ "qmd-Smart Drift Skills" -->

   Step 5 already removes findings that overlap with existing ADRs/specs from step 3 (which read the corpus directly). v5.0.0 adds a second-pass qmd-based check to catch near-duplicates that the prose-level overlap check missed. For each remaining suggestion:

   1. Construct a qmd query per `references/qmd-helpers.md` § "Hybrid Retrieval" using the suggestion text:
      - `lex`: the candidate suggestion's title + key technologies/concepts
      - `vec`: the candidate suggestion's one-sentence rationale
      - `intent: "/sdd:discover — rule out near-duplicates of existing decisions"`
      - `collections: ["{repo}-adrs"]` (or per-module variant in workspace mode)
      - `limit: 5`, `minScore: 0.3`

   2. If the top result has `score >= 0.7` (semantic near-match threshold; configurable via `--similarity-threshold` flag, defaults to 0.7), suppress the suggestion. The matched ADR likely already covers it — surfacing the suggestion would be noise.

   3. Log every suppressed suggestion in the report's "Skipped (already documented)" section with the matched ADR ID, score, and a one-line note explaining the match. The user can review the suppressions to verify they were correct; if a suppression is wrong, they can re-run with `--similarity-threshold 0.85` (or higher) to be more conservative.

   On qmd unreachable / timeout per `qmd-helpers.md` § "Error Handling", surface the error and stop. Per ADR-0024, the pre-v5 fallback ("just use the prose-overlap check") is gone in v5; the failure mode is "fix qmd, retry."

6. **Assign confidence levels** to each suggestion:
   - **High**: Explicit evidence in declarations or configuration (e.g., dependency in package.json, Dockerfile present)
   - **Medium**: Inferred from consistent code patterns across multiple files (e.g., repository pattern used in 5+ files)
   - **Low**: Inferred from limited evidence or indirect signals (e.g., a single config value suggesting a deployment target)

7. **Classify suggestions** into two categories:
   - **Suggested ADRs**: Implicit decisions where an alternative existed (technology choices, pattern choices, architectural trade-offs)
   - **Suggested Specs**: Subsystem boundaries with enough complexity to warrant formal specification (3+ files, clear interface, distinct responsibility)

7b. **Optional call graph enrichment** (v5.1.0+, `--with-graphs` flag):

   <!-- Governing: ADR-0033 (cgg call graph integration), SPEC-0034 REQ "cgg Skill Integration With /sdd:discover" -->

   This step only runs when `$ARGUMENTS` contains `--with-graphs`. Without the flag, skip directly to Step 8 — existing behavior is fully preserved.

   For each proposed ADR from Step 7, enrich it with a call graph via `/sdd:search`:

   1. **Extract query keywords**: From the ADR suggestion's decision title and evidence (technology names, subsystem names, pattern names), derive 2–4 key search terms. For example, a "Chose JWT for authentication" suggestion yields keywords `"JWT authentication"`.

   2. **Determine scope**: If discovery is scoped to a specific directory (from Step 1) or `--module <name>` was passed, derive the `--module` argument for `/sdd:search` accordingly so qmd and cgg target only that subtree per `references/cgg-integration.md` § "Workspace-Mode Scoping".

   3. **Invoke /sdd:search**: Run `/sdd:search "<keywords>" --output json` (with `--module <name>` appended when scoped). Parse the JSON response's `call_graphs[]` array.

   4. **Embed if available**: If `call_graphs[0].mermaid` is non-null, embed the normalized Mermaid diagram in the ADR suggestion's `## Architecture Diagram` section in the discovery report, using the embedding format from `references/cgg-integration.md` § "Embedding in markdown":

      ```markdown
      <!-- Call graph: <filter used>, generated <YYYY-MM-DD> -->
      ```mermaid
      graph TD
          ...
      %% Showing entry points + main flow; internal helpers omitted
      ```
      ```

   5. **Graceful degradation**: If `/sdd:search` is unavailable, errors, or returns `call_graphs[0].mermaid: null` (cgg degraded), record the failure and continue. After enriching all ADRs, if any call graphs could not be generated, add a single notice line at the top of the discovery report:

      ```
      Call graph enrichment unavailable for {N} of {total} suggested ADRs — cgg may not be installed or the codebase is too large. Install cgg with: cargo install cgg
      ```

      Never fail discovery because of cgg or `/sdd:search` unavailability.

8. **Produce the discovery report** using the output format below.

## Output Format

```
## Discovery Report

Analyzed {scope or "entire project"}: {N} files across {M} directories.
Found {X} suggested ADRs and {Y} suggested specs.
Existing artifacts: {A} ADRs, {B} specs (excluded from suggestions).

### Suggested ADRs

| # | Confidence | Decision | Evidence | Command |
|---|------------|----------|----------|---------|
| 1 | High | {short decision title} | {key evidence: files, deps, config} | `/sdd:adr {description}` |
| 2 | Medium | {short decision title} | {key evidence} | `/sdd:adr {description}` |

{For each suggestion, add a brief paragraph below the table:}

**1. {Decision title}**
{2-3 sentences explaining what was found, what the implicit decision is, and what alternatives likely existed.}
Evidence: `{file1}`, `{file2}`, `{config entry}`

### Suggested Specs

| # | Confidence | Subsystem | Boundary | Command |
|---|------------|-----------|----------|---------|
| 1 | High | {subsystem name} | {files/dirs that define it} | `/sdd:spec {capability}` |
| 2 | Medium | {subsystem name} | {files/dirs} | `/sdd:spec {capability}` |

{For each suggestion, add a brief paragraph below the table:}

**1. {Subsystem name}**
{2-3 sentences explaining the subsystem's responsibility, its boundaries, and why it warrants a formal spec.}
Boundary: `{dir1}/`, `{dir2}/`, `{key files}`

### Already Documented

{List existing ADRs and specs that cover areas found in the codebase, confirming they are accounted for. Omit this section if no existing artifacts.}

- ADR-XXXX: {title} -- covers {what area}
- SPEC-XXXX: {title} -- covers {what area}

### Next Steps

Pick the suggestions you want to formalize:

{For each high-confidence suggestion, repeat the command:}
```
/sdd:adr {description}
/sdd:spec {capability}
```

Or prime your session with existing context first: `/sdd:prime`
```

### Empty Results

If no suggestions are found:

```
## Discovery Report

Analyzed {scope or "entire project"}: {N} files across {M} directories.
No implicit architectural decisions or spec-worthy subsystems were identified.

This may indicate:
- The project is very small or early-stage
- The codebase uses highly conventional patterns that don't require explicit documentation
- A narrower scope might reveal more specific patterns: `/sdd:discover src/`

### Next Steps
- Create your first ADR manually: `/sdd:adr [description]`
- Create your first spec manually: `/sdd:spec [capability]`
```

## Rules

- This skill is READ-ONLY -- it MUST NOT create, modify, or delete any files
- This skill is always single-agent at the top level, but MUST use Task tool to spawn parallel Explore agents for the four analysis categories
- Every suggestion MUST cite specific evidence from the codebase -- file paths, dependency declarations, configuration entries, or code patterns
- Suggestions MUST NOT be based on speculation or assumptions about code that was not read
- MUST read existing ADRs and specs before producing suggestions to avoid duplicating already-documented decisions
- MUST include a confidence level (High, Medium, Low) for every suggestion
- MUST include a ready-to-use `/sdd:adr` or `/sdd:spec` command for every suggestion
- The Command column MUST contain a complete, copy-paste-ready command with a descriptive argument
- Sort suggestions by confidence (High first, then Medium, then Low) within each section
- If the scope argument points to a nonexistent path, report the error and stop -- do NOT fall back to full-project analysis
- Do NOT suggest ADRs for trivial decisions (e.g., "chose npm over yarn" when only one package manager file exists with no evidence of evaluation)
- Do NOT suggest specs for directories with fewer than 3 files unless they represent a critical subsystem boundary
- Keep the report concise -- prefer fewer high-quality suggestions over many low-confidence ones
- Use `##` for the top-level heading and `###` for sections within the report
- **v5.0.0+**: MUST run Tier 3 staleness check on entry per Step 3a — `qmd update` if older than configured threshold (default 120m) (Governing: ADR-0026, SPEC-0019 REQ "Tier 3 Staleness Threshold for Consumer Skills")
- **v5.0.0+**: MUST run qmd-aware duplicate suppression per Step 5a — for each candidate suggestion, qmd-search `{repo}-adrs` for near-matches; if score ≥ 0.7 (configurable via `--similarity-threshold`), suppress and log to "Skipped (already documented)" section. The pre-v5 prose-overlap-only check is now first-pass; qmd is the second-pass net (Governing: ADR-0024, SPEC-0019 REQ "qmd-Smart Drift Skills")
- **v5.0.0+**: On qmd unreachable / timeout, MUST surface the error and stop. NEVER fall back to "just use the prose-overlap check" (per ADR-0024 — fallback paths were eliminated in v5)
- **v5.1.0+ (`--with-graphs`)**: When `--with-graphs` is set, MUST invoke `/sdd:search "<keywords>" --output json` for each proposed ADR after Step 7 (Step 7b); MUST embed `call_graphs[0].mermaid` in the ADR's `## Architecture Diagram` when non-null; MUST degrade gracefully when `/sdd:search` or cgg is unavailable — surface a one-line count notice and continue; MUST NOT fail discovery because of cgg unavailability (Governing: ADR-0033, SPEC-0034 REQ "cgg Skill Integration With /sdd:discover")
- **v5.1.0+ (`--with-graphs`)**: Without `--with-graphs`, Step 7b MUST be skipped entirely — existing `/sdd:discover` behavior is unchanged (Governing: SPEC-0034 REQ "Must Not Break Existing Workflows")
