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

3. **Write the ADR** to `{adr-dir}/ADR-XXXX-short-title.md`

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
