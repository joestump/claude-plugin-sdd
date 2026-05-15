---
name: adr
description: Create a new Architecture Decision Record (ADR) using MADR format. Use when the user wants to document an architectural decision, says "create an ADR", "we need an ADR for", or discusses a decision that should be recorded.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Task, WebFetch, WebSearch, TeamCreate, TeamDelete, TaskCreate, TaskUpdate, TaskList, TaskGet, SendMessage, AskUserQuestion
argument-hint: [short description of the decision] [--review] [--module <name>]
---

# Create an Architecture Decision Record (ADR)

You are creating a new ADR using the MADR (Markdown Architectural Decision Records) format.

## Process

<!-- Governing: ADR-0016 (Workspace Mode), SPEC-0014 REQ "Artifact Path Resolution" -->

0. **Resolve artifact paths**: Follow the **Artifact Path Resolution** pattern from `references/shared-patterns.md` to determine the ADR directory. If `$ARGUMENTS` contains `--module <name>`, resolve paths relative to that module. The resolved ADR directory is referred to as `{adr-dir}` below.

1. **Determine the next ADR number**: Scan `{adr-dir}` for existing `ADR-XXXX-*.md` files and increment to the next number. Start at ADR-0001 if none exist. Create `{adr-dir}` if it does not exist. If `$ARGUMENTS` is empty (ignoring flags like `--review` and `--module`), use `AskUserQuestion` to ask the user what decision they want to document.

1a. **qmd-aware edge pre-search** (v5.0.0+):

   <!-- Governing: ADR-0024 (qmd as hard dependency), SPEC-0019 REQ "qmd-Smart Authoring Skills" -->

   Before drafting, qmd-search the existing ADR corpus to find related prior decisions whose IDs SHOULD appear in the new ADR's frontmatter as `supersedes`, `extends`, or `related` edges (per ADR-0023 / SPEC-0018 frontmatter DAG).

   1. Construct a hybrid query per `references/qmd-helpers.md` § "Hybrid Retrieval":
      - `lex`: the user's description from `$ARGUMENTS` (key technologies, named systems, decision verbs)
      - `vec`: a one-sentence framing of the decision the new ADR will make
      - `intent: "/sdd:adr — find related prior ADRs to suggest as frontmatter edges"`
      - `collections: ["{repo}-adrs"]` (or per-module variant in workspace mode per `qmd-helpers.md` § "This-Repo Collection Identification")
      - `limit: 6`, `minScore: 0.3`

   2. For each result above the threshold, classify the candidate edge:
      - **supersedes**: the new ADR's description includes "replace", "deprecate", "stop using", "switch from X to Y" and the matched ADR documents X
      - **extends**: the new ADR builds on the matched ADR's foundation without replacing it
      - **related**: weak association — same domain, named technology, or shared concern

   3. Surface the candidate edges to the user via `AskUserQuestion` BEFORE writing the file. Show each candidate with the matched ADR's ID, title, and proposed edge classification. Options for each candidate: "Include as `{edge}`", "Include as `related` instead", "Skip". The user can override the classification if the agent's guess is wrong.

   4. If qmd returns zero results above the threshold, proceed without surfacing edge suggestions and emit a one-line note: "No related ADRs found — drafting from scratch."

   5. On qmd unreachable / timeout per `qmd-helpers.md` § "Error Handling", surface the error and stop. Per ADR-0024, fallback paths were eliminated in v5; the failure mode is "fix qmd, retry."

2. **Choose drafting mode**: Check if `$ARGUMENTS` contains `--review`.

   **Default (no `--review`)**: Single-agent mode. Research the codebase (read relevant files, understand the current architecture), draft the ADR directly, self-review against the architect's checklist in the Rules section, then write the file.

   **With `--review`**: Team review mode.
   - Tell the user: "Creating a drafting team to write and review the ADR. This takes a minute or two."
   - Create a Claude Team with `TeamCreate` to draft and review the ADR:
     - Spawn a **drafter** agent (`general-purpose`) to write the ADR based on the user's description: `$ARGUMENTS`
     - Spawn an **architect** agent (`general-purpose`) to review the drafter's output for completeness, accuracy, and adherence to MADR format
     - The architect MUST review and approve the ADR before it is finalized
     - The drafter should research the codebase (read relevant files, understand the current architecture) before writing
     - If `TeamCreate` fails, fall back to single-agent mode: draft the ADR directly, then self-review against the architect's checklist in the Rules section before writing.

2b. **Optional call graph embedding** (opt-in, SPEC-0034):

   <!-- Governing: ADR-0033 (cgg call graph integration), SPEC-0034 REQ "Enhanced /sdd:adr" -->

   After the ADR body is fully drafted and before writing to disk, ask the user whether to include a call graph:

   Use `AskUserQuestion` with the prompt:

   > Include a call graph showing where this decision applies in the codebase? (yes / no / skip)

   **Default to "no"** when: the session is non-interactive (piped input), batch/CI mode is detected, or the question times out. In those cases, proceed directly to Step 3 as if the user answered "no" — no error, no deviation from existing behavior.

   **If the user answers "no" or "skip"**: Proceed to Step 3 with an empty `## Architecture Diagram` section (the template placeholder text is omitted; write the section header with no body, or omit the section entirely). No call graph is generated.

   **If the user answers "yes"**:

   1. **Availability check**: Run `which cgg >/dev/null 2>&1`. If cgg is not found, surface the exact unavailability notice from `references/cgg-integration.md` § "Availability Check" and proceed to Step 3 without a call graph.

   2. **Derive the filter**: Extract keywords from the ADR's `## Decision Outcome` section (the chosen option name, key technology names, system names, and any verbs describing the decision). Apply the **From requirement keywords** strategy from `references/cgg-integration.md` § "Filter Derivation Strategy" — lowercase, split on spaces/punctuation, strip stop words, compose a regex alternation. In workspace mode, use the module source directory as `<target-path>` per `references/cgg-integration.md` § "Workspace-Mode Scoping".

   3. **Invoke cgg** using the canonical invocation pattern from `references/cgg-integration.md` § "cgg Invocation Pattern":
      ```bash
      timeout 30 cgg <target-path> --filter "<filter-regex>" --format mermaid 2>/tmp/cgg-stderr-$$.txt
      CGG_EXIT=$?
      CGG_STDERR=$(cat /tmp/cgg-stderr-$$.txt)
      rm -f /tmp/cgg-stderr-$$.txt
      ```

   4. **Handle exit codes** per `references/cgg-integration.md` § "Exit code handling":
      - Exit 0: normalize the Mermaid output per § "Mermaid Output Normalization" (sort nodes, rewrite to `graph TD`, strip hash prefixes, apply 20-node cap, append legend footer).
      - Exit 1 or other non-zero: surface `"Call graph generation failed: "` + stderr; proceed to Step 3 without a call graph.
      - Exit 124 (timeout): surface the exact timeout message from § "Timeout Handling"; proceed to Step 3 without a call graph.

   5. **Handle unsupported-language warnings** per `references/cgg-integration.md` § "Unsupported Language Handling" — emit per-file skip notices; if all files were skipped, fall back to no call graph.

   6. **Embed in the ADR**: On success, replace the `## Architecture Diagram` section with the normalized Mermaid block wrapped per `references/cgg-integration.md` § "Embedding in markdown":
      ```markdown
      <!-- Call graph: <filter used>, generated <YYYY-MM-DD> -->
      ```mermaid
      graph TD
          ...
      ```
      ```
      The caption comment MUST record the exact filter regex used and today's date.

   In every degradation case (cgg missing, timeout, non-zero exit, all files skipped), the skill MUST complete and write the ADR without a call graph. Never surface a hard failure to the user when cgg is the only failing component.

3. **Write the ADR** to `{adr-dir}/ADR-XXXX-short-title.md`. Include the user-confirmed frontmatter edges from Step 1a in the YAML frontmatter (per the canonical edge schema in `references/shared-patterns.md` § "Graph Edge Resolution").

3a. **Tier 1 mutation update** (v5.0.0+):

   <!-- Governing: ADR-0026 (Tiered Index Freshness), SPEC-0019 REQ "Tier 1 Mutation-Aware Updates" -->

   After writing the new ADR file, trigger a narrow re-sync of `{repo}-adrs` so the qmd index reflects the new artifact. Use the canonical update pattern from `references/qmd-helpers.md` § "Update Patterns" → "Narrow update". The update is synchronous and silent on success. On failure, append a one-line warning to the report ("Index refresh failed for `{repo}-adrs` — run `/sdd:index update` manually") but report the ADR creation itself as successful.

4. **Clean up** the team when done (if `--review` was used).

5. **Summarize** what happened (files created, decision documented, review outcome).

6. **Suggest next steps**: After summarizing, tell the user:
   - "To formalize requirements from this decision, run: `/sdd:spec {suggested capability name}`"
   - "The spec skill can also break requirements into trackable issues (Beads, GitHub, or Gitea) for sprint planning."

7. **CLAUDE.md integration**: Check if this is the first ADR (i.e., `{adr-dir}` was just created or contains only this new file). If so:
   - Check if a `CLAUDE.md` exists at the module root (or project root for single-module projects)
   - If it exists, check if it already references the ADR directory
   - If no reference exists, ask the user: "I can add an Architecture Context section to your CLAUDE.md so future sessions know about your decisions. Shall I?"
   - If the user says yes, append an `## Architecture Context` section with `- Architecture Decision Records are in {adr-dir}`
   - If `CLAUDE.md` doesn't exist, suggest creating one

### Team Handoff Protocol (only for `--review` mode)

Follow the standard team handoff protocol from the plugin's `references/shared-patterns.md`. The drafter writes the ADR; the architect reviews against the Rules checklist below.

## MADR Template

```markdown
---
status: proposed
date: {YYYY-MM-DD}
decision-makers: {list}
# Optional graph edges (per ADR-0023 / SPEC-0018). All fields are lists of artifact IDs.
# Only include the fields that apply; omit unused fields entirely. Forward-only:
# inverse edges (superseded-by, governed-by, implemented-by, etc.) are derived by
# /sdd:graph at build time and MUST NOT be authored.
# supersedes: [ADR-XXXX]              # hard replacement; target moves to status: superseded
# extends: [ADR-XXXX]                 # builds on without replacing
# enables: [ADR-XXXX]                 # this decision unblocks another
# governs: [SPEC-XXXX]                # specs this decision governs
# related: [ADR-XXXX]                 # weak association, no semantic claim
---

# ADR-XXXX: {short title, representative of solved problem and found solution}

## Context and Problem Statement

{Describe the context and problem statement in 2-3 sentences. Articulate the problem as a question if possible.}

## Decision Drivers

* {driver 1, e.g., a force, facing concern}
* {driver 2}

## Considered Options

* {option 1}
* {option 2}
* {option 3}

## Decision Outcome

Chosen option: "{option}", because {justification}.

### Consequences

* Good, because {positive consequence}
* Bad, because {negative consequence}

### Confirmation

{How will compliance/implementation be confirmed?}

## Pros and Cons of the Options

### {Option 1}

{Description or pointer to more information.}

* Good, because {argument a}
* Good, because {argument b}
* Neutral, because {argument c}
* Bad, because {argument d}

### {Option 2}

{Description or pointer to more information.}

* Good, because {argument a}
* Bad, because {argument b}

## Architecture Diagram

```mermaid
{Mermaid diagram illustrating the architecture, decision flow, or component relationships.
Use flowchart, sequence, or C4 diagrams as appropriate.}
```

## More Information

{Additional context, links to related ADRs, references.}
```

## Rules

- ADR numbers MUST be sequential and zero-padded to 4 digits: ADR-0001, ADR-0002, etc.
- MUST include at least 2 considered options with substantive pros and cons for each
- Status starts as `proposed` -- the user decides when to mark `accepted`
- Self-review (default) or architect review (`--review`) MUST check for:
  - Completeness of all required sections (Context, Options, Outcome, Pros/Cons)
  - Realistic and balanced pros/cons (not just cheerleading the chosen option)
  - Clear decision rationale that explains "why this over alternatives"
  - Correct MADR structure and frontmatter
- Keep the title short and descriptive
- Focus on the "why" -- what problem does this solve and why this solution?
- Reference existing ADRs if this supersedes or relates to them
- Every ADR SHOULD include at least one Mermaid diagram illustrating the architecture or decision flow. Use flowchart, sequence, or C4 diagrams as appropriate.
- **v5.0.0+**: MUST run qmd-aware edge pre-search per Step 1a — surface candidate `supersedes`/`extends`/`related` edges to the user via AskUserQuestion before drafting. The user's confirmed edges land in the new ADR's frontmatter (Governing: ADR-0024, SPEC-0019 REQ "qmd-Smart Authoring Skills")
- **v5.0.0+**: MUST trigger Tier 1 `{repo}-adrs` re-sync after writing the new file per Step 3a — best-effort, silent on success, one-line warning on failure (Governing: ADR-0026, SPEC-0019 REQ "Tier 1 Mutation-Aware Updates")
- **v5.0.0+**: On qmd unreachable / timeout during the edge pre-search, MUST surface the error and stop — never fall back to "draft without edge suggestions" (per ADR-0024)
- **v5.0.0+**: MUST offer the call graph opt-in via `AskUserQuestion` per Step 2b — default to "no" in non-interactive/batch/CI mode; MUST degrade gracefully on cgg absence or failure and never block ADR creation (Governing: ADR-0033, SPEC-0034 REQ "Enhanced /sdd:adr")

## Graph Edge Frontmatter (per ADR-0023 / SPEC-0018)

<!-- Governing: ADR-0023 (Frontmatter DAG and /sdd:graph Skill), SPEC-0018 REQ "Frontmatter Edge Schema" -->

ADRs MAY declare relationships to other artifacts via optional frontmatter fields. All edge fields MUST be lists of artifact IDs (e.g., `[ADR-0008, ADR-0009]`). All edge fields are OPTIONAL — an ADR with no declared edges is valid.

| Field | Meaning | Example |
|-------|---------|---------|
| `supersedes` | Hard replacement — the referenced ADR moves to status `superseded` | `supersedes: [ADR-0003]` |
| `extends` | Builds on without replacing | `extends: [ADR-0008, ADR-0009]` |
| `enables` | Unblocks a downstream decision | `enables: [ADR-0016]` |
| `governs` | Names specs this decision governs | `governs: [SPEC-0007, SPEC-0010]` |
| `related` | Weak association, no semantic claim | `related: [ADR-0010]` |

**Forward-only convention.** Only forward edges are authored. Reverse edges (`superseded-by`, `governed-by`, `enabled-by`, `extended-by`) are derived by `/sdd:graph` at build time and MUST NOT appear in frontmatter — the graph builder will reject them with a warning. See `references/shared-patterns.md` § "Graph Edge Resolution" for the full forward→inverse derivation table.

**Cross-module edges (workspace mode).** When referencing artifacts in another module, use the quoted `[module]/ID` syntax: `governs: ["[api]/SPEC-0001"]`. The unquoted form `[[api]/SPEC-0001]` parses as YAML nested lists and will be rejected.

**When to add edges.** Add edges as the relationship becomes structurally meaningful — typically at the same time you would have written "Related: ADR-XXXX" in `## More Information`. Backfilling existing ADRs is supported via `/sdd:graph backfill`, which proposes edges parsed from prose for per-file review.
