# PRD Template

<!-- Governing: ADR-0036 (PRD as an Optional, Pre-ADR, Client-Facing Product-Intent Artifact), SPEC-0037 REQ "PRD Artifact Location and Identification" -->

The template `/sdd:prd` drafts from. Produce a PRD **before** the ADR and spec pair, and only for client-facing capabilities — the PRD captures product intent in the client's language, the ADR captures the engineering tradeoff, the spec captures the contract.

The file is `{prd-dir}/PRD-XXXX-{slug}.md` (default `docs/prds/`), with a sequential zero-padded ID allocated by scan-highest-and-increment.

## Frontmatter

Per ADR-0003, and kept to the SPEC-0018 edge vocabulary. An `adrs:` field is **not** accepted — use `governs:`. Reverse edges (`governed-by`) are derived by `/sdd:graph` and MUST NOT be authored.

```yaml
---
title: <one-liner>
id: PRD-XXXX
status: draft | client-review | approved | shipped
client: <internal | customer name>
created: YYYY-MM-DD
updated: YYYY-MM-DD
governs: []          # ADR-XXXX / SPEC-XXXX implementing this PRD; empty while draft
related: []          # weak association, no semantic claim
---
```

## Body

```markdown
# <Title>

## Problem / opportunity

2–5 sentences in the client's own words — what is broken or missing today, and
the cost of leaving it broken.

## User stories

- As a <role>, I want <capability>, so that <outcome>.

## Scope

### In

- ...

### Out

- ... (explicitly name what this is NOT — scope creep lives here)

## Success criteria (EARS)

Every criterion is a completion gate an execution agent can run, written in
[EARS](https://alistairmavin.com/ears/) syntax. A criterion matching no EARS
pattern is a validation error.

- While the approval is pending, when the SLA window elapses without a human
  response, the system shall escalate to the next approver in the chain.
- If a system retry attempts to resolve a pending approval, then the system
  shall refuse with 409 and leave the gate untouched.

## Blast radius / touch points

Every existing surface this capability touches, confirmed against the codebase
rather than assumed. Each entry is a collision question — what could this
break, and who else depends on it?

- <surface / component / table / endpoint> — <what could break, who else uses it>
- <overlapping feature today> — <how the two change or conflict>

## Clarification log

The grill rounds: question, answer, decision. Client-facing evidence of the
interrogation behind the document.

## Open questions

- ... (each blocks `approved` until answered, or waived with an owner and a date)

## Decision log

Links to the ADRs carrying the engineering tradeoffs. The ADR holds the
decision; this PRD holds the product intent. Neither replaces the other.
```

## Status gates

| Gate | Meaning | Enforced by |
| --- | --- | --- |
| `draft` | Grill converged; every section filled without placeholders | `/sdd:prd` |
| `client-review` | Sent to the client or stakeholder for sign-off | The user |
| `approved` | Signed off; open questions closed or waived | `/sdd:check`, `/sdd:audit` |
| `shipped` | Governed work delivered; criteria carry met evidence or a waiver | `/sdd:audit` |

An `approved` or `shipped` PRD that governs nothing is a `[WARNING]`; a `shipped` PRD with unmet, unwaived criteria is a `[CRITICAL]`. A `draft` PRD with an empty `governs:` list is neither — and the **absence** of a PRD is never a finding.

## Production process

Do not draft until the interrogation converges. Run the **Grill-First Interrogation Pattern** from `${CLAUDE_PLUGIN_ROOT}/references/shared-patterns.md` § "Grill-First Interrogation Pattern":

1. Map the request as a **design tree**.
2. Work the **frontier** in rounds — every question whose prerequisites are settled, numbered, each with a recommended answer.
3. **Facts are yours; decisions are theirs** — explore the codebase, never ask the user what you can look up.
4. **Convergence gate**: the frontier is empty, every section above fills without a placeholder, and the blast radius is confirmed against the actual codebase.

The clarification log is deliverable, not scratch work.
