---
name: prime
description: Load ADR and spec context into the session for architecture-aware responses. Use when the user says "prime context", "load architecture", starts a new session, or wants Claude to know about existing decisions.
allowed-tools: Read, Glob, Grep
argument-hint: [topic] [--module <name>]
---

# Prime Architecture Context

Load existing ADRs and specs into the session so Claude can give architecture-aware responses.

## Process

<!-- Governing: ADR-0016 (Workspace Mode), SPEC-0014 REQ "Artifact Path Resolution" -->

0. **Resolve artifact paths**: Follow the **Artifact Path Resolution** pattern from `references/shared-patterns.md` to determine the ADR and spec directories. If `$ARGUMENTS` contains `--module <name>`, resolve paths relative to that module; otherwise, in a workspace, aggregate across all modules. The resolved ADR directory is `{adr-dir}` and spec directory is `{spec-dir}`.

   <!-- Governing: ADR-0016 (Workspace Mode), SPEC-0014 REQ "Cross-Module Aggregation" -->

   **Cross-module aggregation**: When in aggregate mode (no `--module`, workspace detected), iterate over all discovered modules. For each module, resolve its artifact paths independently. Prefix every artifact reference in the output with the module name in square brackets: `[api] ADR-0001`, `[worker] SPEC-0003`. When `--module` is provided, scope to that single module — no prefix needed. When in single-module mode (no workspace), operate normally without prefixes.

1. **Check if init has been run**: Read `CLAUDE.md` at the project root (or module root if `--module` is set) and check if it contains references to an ADR or spec directory. If CLAUDE.md does not exist or lacks SDD plugin references, output:

   ```
   CLAUDE.md does not have SDD plugin references. Run `/sdd:init` first to set up your project, then re-run `/sdd:prime`.
   ```

   Then stop. Do NOT proceed with scanning.

2. **Scan for ADRs**: Glob for `{adr-dir}/ADR-*.md` files (in aggregate mode, glob per-module). For each file:
   - Extract `status` and `date` per the **Status Field Extraction** algorithm below
   - Extract the title from the first `# ` heading
   - Read the `## Context and Problem Statement` section
   - Read the `## Decision Outcome` section to extract the key decision
   - Sort by ADR number

3. **Scan for specs**: Glob for `{spec-dir}/*/spec.md` files (in aggregate mode, glob per-module). Validate spec pairing per `references/shared-patterns.md` § "Spec Pairing Validation". For each file:
   - Extract `status` per the **Status Field Extraction** algorithm below
   - Extract the title from the first `# ` heading (e.g., `SPEC-0001: Web Dashboard`)
   - Read the `## Overview` section
   - Count the number of `### Requirement:` headings
   - Count the number of `#### Scenario:` headings
   - Sort by SPEC number

3a. **Status Field Extraction algorithm** (used by both ADR and spec scans). Two formats are supported because legacy SDD-using repos predate YAML frontmatter:

   1. **YAML frontmatter** (canonical, current SDD template): look for a `status:` key inside the `---` … `---` frontmatter block at the top of the file.
   2. **Inline bullet** (legacy / hand-authored): if no YAML frontmatter exists OR YAML has no `status:` field, scan the first 30 lines for a line matching `- **Status:** {value}` (case-insensitive on "Status"; tolerate `*` or `+` as the bullet marker; tolerate `Status:` without the bold).
   3. **Strip refinement notes**: the inline-bullet form sometimes carries a parenthetical refinement note: `- **Status:** accepted (refined by ADR-0010, 2026-05-03)`. Split on the first `(`, trim trailing whitespace, and use only the leading word ("accepted"). The parenthetical content is preserved in the source file but is not rendered in prime tables — it would blow out column width for a corner case better surfaced by `/sdd:graph` or by reading the artifact directly.
   4. **No status found**: if neither form yields a value, record the artifact as having no parseable status. Render as `—` in the table when other artifacts in the same corpus have status; drop the Status column entirely when *zero* artifacts in the corpus have status (see Step 6 rendering rule).

4. **Apply topic filter** (if `$ARGUMENTS` is not empty):
   - The topic argument is a free-text string for semantic matching
   - For each ADR, read the title, context/problem statement, and decision outcome
   - For each spec, read the title and overview
   - Determine relevance based on semantic similarity to the topic -- an artifact is relevant if the topic relates to any of its key concepts, technologies, domains, or concerns
   - For example: topic "security" should match ADRs about authentication, authorization, encryption, or access control
   - If no artifacts match the topic, output:
     ```
     No ADRs or specs matched the topic "{topic}". Try a broader term, or run `/sdd:prime` without a topic to see all artifacts.
     ```

5. **Handle edge cases**:
   - If `{adr-dir}` does not exist: "The `{adr-dir}` directory does not exist. Run `/sdd:adr [description]` to create your first ADR."
   - If `{spec-dir}` does not exist: "The `{spec-dir}` directory does not exist. Run `/sdd:spec [capability]` to create your first spec."
   - If neither directory has any artifacts: "No design artifacts found. Create an ADR with `/sdd:adr` or a spec with `/sdd:spec` first."
   - If ADRs exist but no specs (or vice versa), present whichever exists and note the other is empty

6. **Present results** using the appropriate output format below.

## Output

### Without topic filter (`/sdd:prime`):

```
## Architecture Context Loaded

Primed session with {N} ADRs and {M} specs.

### Architecture Decision Records

| ID | Title | Status | Key Decision |
|----|-------|--------|--------------|
| ADR-0001 | {title} | {status} | {one-sentence summary of decision outcome} |

### Specifications

| ID | Title | Status | Requirements |
|----|-------|--------|--------------|
| SPEC-0001 | {title} | {status} | {N} requirements, {M} scenarios |

### Quick Reference
- Check for drift: `/sdd:check [target]`
- Full audit: `/sdd:audit [scope]`
- List all artifacts: `/sdd:list`
```

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

### Matching Specs

| ID | Title | Status | Relevance |
|----|-------|--------|-----------|
| SPEC-XXXX | {title} | {status} | {why this matched the topic} |

### Summaries

**ADR-XXXX: {title}**
{2-3 sentence summary of context, decision, and rationale.}

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
