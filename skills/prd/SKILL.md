---
name: prd
description: Create a Product Requirements Document for a client-facing capability. Use when the user wants to capture product intent before engineering, produce a client-ready spec, or says "create a PRD" or "write a product requirements document".
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, WebFetch, WebSearch, AskUserQuestion
argument-hint: "[capability name or client name] [--review]"
---

# Create a Product Requirements Document

You are creating or updating a **Product Requirements Document (PRD)** — the
product-intent artifact that precedes the ADR and spec pair for client-facing
capabilities. Every PRD is a **client-ready deliverable**: the client reads it,
answers clarification questions, and signs off before engineering begins.

**Production process: grill-first.** Do not draft until the interrogation
converges. Run the Grill-First Interrogation pattern from
`${CLAUDE_PLUGIN_ROOT}/references/shared-patterns.md` § "Grill-First
Interrogation" to map the design tree, work the frontier in rounds, and
separate facts (yours to explore) from decisions (the user's). The
convergence gate — frontier empty, nothing silently assumed — must pass
before you write a single section.

## Artifact identity

- **Directory**: `docs/prds/` (own qmd collection: `prds`, separate from
  `specs` and `adrs`). Not the spec directory — PRDs often span several
  specs.
- **ID scheme**: zero-padded sequential `PRD-XXXX` (e.g., `PRD-0001`),
  matching `ADR-XXXX` and `SPEC-XXXX` conventions.
- **File**: `{prd-dir}/prd.md` (single file, not a pair).

## Status gates

| Gate | Meaning | Enforced by |
| --- | --- | --- |
| `draft` | Grill converged; sections filled | This skill |
| `client-review` | Sent to the client/stakeholder | The agent or the user |
| `approved` | Client/stakeholder signed off; open questions closed | `/sdd:check` |
| `shipped` | Execution run(s) completed with EARS success criteria verified | `/sdd:audit` |

A PRD cannot reach `approved` while any open question is unresolved. A PRD
cannot reach `shipped` while any success criterion is unverifiable.

## EARS success criteria

Success criteria MUST use [EARS](https://alistairmavin.com/ears/) (Easy
Approach to Requirements Syntax). The five patterns:

1. **Ubiquitous**: The <system> shall <response>.
2. **Event-driven**: When <trigger>, the <system> shall <response>.
3. **State-driven**: While <state>, the <system> shall <response>.
4. **Unwanted behavior**: When <trigger>, the <system> shall <response>.
5. **Optional feature**: Where <feature is included>, the <system> shall
   <response>.

The complex form combines precondition + trigger + response:
`While <state>, when <trigger>, the <system> shall <response>`.

## Blast radius / touch points

Every existing surface this capability touches. Each entry is a collision
question — what could this break, and who else depends on it? Confirm against
the actual codebase (grep the surfaces, don't assume). A PRD whose blast
radius section contains no confirmed entries has not been properly
investigated.

## Graph edges

PRDs carry `governs:` edges into ADRs and specs that implement them, per the
canonical edge schema (ADR-0023). The frontmatter field is `governs: [ADR-XXXX,
SPEC-XXXX]`.

## Relationship to the spec pair

The PRD is the product-intent half; `spec.md`/`design.md` are the
engineering-specification half. When writing the spec pair from an approved
PRD, the PRD's user stories become requirements, its blast radius becomes the
impact analysis, and its EARS success criteria become the spec's scenarios.
The ADRs in its decision log carry the engineering tradeoffs the spec's
design section will cite.

## Relationship to the ADR

Most ADRs have no PRD upstream. A PRD is required only when the capability is
client-facing and product intent must be captured before engineering
decisions. `/sdd:audit` flags a PRD-orphan ADR only when the ADR's context
explicitly references a client-facing capability (not for pure engineering
ADRs).

## Template

````markdown
---
title: <one-liner>
id: PRD-XXXX
status: draft | client-review | approved | shipped
client: <internal | customer name>
owner: <who>
created: YYYY-MM-DD
updated: YYYY-MM-DD
governs: []          # ADR-XXXX, SPEC-XXXX that implement this PRD
qmd_collection: prds
---

# <Title>

## Problem / opportunity
2–5 sentences in the user's words — what is broken or missing today, and the
cost of leaving it broken.

## User stories
- As a <role>, I want <capability>, so that <outcome>.

## Scope
### In
- ...

### Out
- ... (explicitly name what this is NOT — scope creep lives here)

## Success criteria (EARS)
- While <precondition>, when <trigger>, the <system> shall <response>.

## Blast radius / touch points
Every existing surface this capability touches. Each entry is a collision
question — what could this break, and who else depends on it?
- <surface / component / table / endpoint> — <what could break, who else uses it>
- <overlapping feature today> — <how they change or conflict>

## Clarification log
The grill rounds: question, answer, decision. Client-facing evidence of the
interrogation behind the document.

## Open questions
- ... (each blocks `approved` until answered or consciously deferred with an
  owner and a date)

## Decision log
Links to ADRs. The ADR holds the engineering decision; this PRD holds the
product intent. Neither replaces the other.
````

## Graph integration

PRDs carry `governs:` edges into ADRs and specs. `/sdd:graph` includes PRD
nodes (with `prd.md` in the glob) so `impact`, `ancestors`, `chain`, and
`orphans` surface the product-intent lineage alongside the engineering
lineage.

## qmd collection

PRDs live in their own qmd collection (`prds`), separate from `specs` and
`adrs`. `/sdd:index` indexes `docs/prds/**/*.md` into the `prds` collection.
