# PRD Template (Client-Facing Capabilities)

<!-- Governing: paired-artifact lineage with skills/adr (ADRs record engineering
decisions; the PRD records product intent). Produced grill-first, before
spec.md/design.md. Client-ready at the `client-review` status gate. -->

When a capability is **client-facing** — the requester wants a document they can
put in front of a client, or the feature's requirements must be interrogated out
of a stakeholder before engineering begins — produce a Product Requirements
Document (PRD) from this template. The PRD precedes the spec pair: grill first,
produce the PRD, get it approved, then write `spec.md`/`design.md` from it.

## Production process (grill-first)

The PRD is only as good as the interrogation that precedes it. Do not draft
until the grill converges:

1. **Map the design tree** of the request: every decision branches into the
   decisions that hang off it.
2. **Work the frontier in rounds.** The frontier is every question whose
   prerequisites are already settled. Ask the whole frontier in one round —
   numbered, each with your recommended answer — and wait for responses before
   recomputing. A question that depends on an unanswered one belongs to a later
   round.
3. **Facts are yours; decisions are theirs.** When a frontier question needs a
   fact (codebase behavior, existing surface, prior decisions), explore the
   repository or dispatch a sub-agent — never ask the user for something you
   can look up yourself. Only the *decisions* go to the user.
4. **Convergence gate.** The grill is done when the frontier is empty AND every
   section below can be filled without a placeholder AND the blast radius has
   been confirmed against the actual codebase (grep the surfaces, don't
   assume). Ask in batches; stop when a round yields no new information.
5. **The Q&A trail is deliverable.** Record the rounds in the PRD's
   *Clarification log* — for client-facing work, the questions themselves
   demonstrate the thoroughness the client is paying for.

Produce `prd.md` in the capability's spec directory alongside the eventual
`spec.md`/`design.md`. The PRD's **Success criteria** section becomes the
execution order's completion gate — vacuous criteria produce vacuous runs.

## Template

```markdown
---
title: <one-liner>
id: PRD-<YYYYMMDD>-<slug>
status: draft | client-review | approved | shipped
client: <internal | customer name>
owner: <who>
created: YYYY-MM-DD
updated: YYYY-MM-DD
adrs: []            # linked ADRs (engineering decisions), filled during planning
qmd_refs: []        # indexed paths this PRD references
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

## Success criteria
- [ ] Observable and verifiable. Each becomes a completion gate for the
      execution run — write them as checks an agent can run, not aspirations.

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
```

## Status gates

| Gate | Meaning | Who |
| --- | --- | --- |
| `draft` | Grill converged; sections filled | The agent |
| `client-review` | Sent to the client/stakeholder for review | The agent |
| `approved` | Client/stakeholder signed off; open questions closed | The client or owner |
| `shipped` | Execution run(s) completed with the success criteria as completion gates | The executing agent |

## Relationship to the spec pair

The PRD is the product-intent half; `spec.md`/`design.md` are the
engineering-specification half. When writing the spec pair from an approved
PRD, the PRD's user stories become requirements, its blast radius becomes the
impact analysis, and its success criteria become the spec's scenarios. The ADRs
in its decision log carry the engineering tradeoffs the spec's design section
will cite.
