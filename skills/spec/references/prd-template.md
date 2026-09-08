# PRD Template

<!-- Governing: ADR-0036 (PRD as Optional Pre-ADR Product-Intent Artifact) -->

When a capability is **client-facing**, produce a Product Requirements Document (PRD) from this template before the ADR and spec pair. The PRD captures product intent in the client's language; the ADR captures engineering tradeoffs; the spec captures the contract.

## Production process (grill-first)

Do not draft until the interrogation converges. Run the **Grill-First Interrogation** pattern from `references/shared-patterns.md` § "Grill-First Interrogation":

1. Map the request as a **design tree**.
2. Work the **frontier** in rounds — every question whose prerequisites are settled, numbered, each with a recommended answer.
3. **Facts are yours; decisions are theirs** — explore the codebase, never ask the user what you can look up.
4. **Convergence gate**: the frontier is empty AND every section below fills without a placeholder AND the blast radius is confirmed against the codebase.

The Q&A trail (clarification log) is deliverable — client-facing evidence of the interrogation behind the document.

## Template

```markdown
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
Written in [EARS](https://alistairmavin.com/ears/) syntax:
`While <precondition>, when <trigger>, the <system> shall <response>`.

- While the approval is pending, when the SLA window elapses without human
  response, the system shall escalate to the next approver in the chain.
- When a system retry attempts to resolve a pending approval, the system
  shall refuse with 409 and leave the gate untouched.

Each criterion becomes a completion gate for the execution run — write them
as checks an agent can run, not aspirations.

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

| Gate | Meaning | Enforced by |
| --- | --- | --- |
| `draft` | Grill converged; sections filled | The agent |
| `client-review` | Sent to the client/stakeholder | The agent or the user |
| `approved` | Client/stakeholder signed off; open questions closed | `/sdd:check` |
| `shipped` | Execution run(s) completed with EARS criteria verified | `/sdd:audit` |

## Graph edges

PRDs carry `governs:` edges into ADRs and specs that implement them. `/sdd:graph` includes PRD nodes so `impact`, `ancestors`, `chain`, and `orphans` surface the product-intent lineage.

## qmd collection

PRDs live in their own qmd collection (`prds`), separate from `specs` and `adrs`. `/sdd:index` indexes `docs/prds/**/*.md` into the `prds` collection.
