---
status: proposed
date: 2026-09-08
decision-makers: joestump, elirubel
extends: [ADR-0003]
related: [ADR-0023, ADR-0025]
---

# ADR-0036: PRD as an Optional Pre-ADR Product-Intent Artifact (`/sdd:prd`)

## Context and Problem Statement

ADR-0003 fixed the artifact formats: ADRs (engineering decisions) and specs
(requirements + design). Both are engineering-facing — written by and for the
people building the system. But client-facing capabilities often need a
**product-intent artifact** that precedes them: what the client asked for, in
the client's language, with scope boundaries and success criteria the client
can sign off on.

Today the pipeline starts at the ADR. Product intent is captured ad-hoc — in
Slack threads, meeting notes, or the ADR's own context section — and then
translated (or lost) when the ADR is drafted. For internal engineering
decisions this is fine. For client-facing capabilities it produces specs that
are technically correct but miss what the client actually asked for.

How should the plugin capture product intent for client-facing capabilities —
and should that artifact precede the ADR (and sometimes replace it for
pure-product changes that need no engineering tradeoff record)?

## Decision Drivers

* **Client-deliverable**: a signed-off product-intent document with an approval
  boundary is something `spec.md` genuinely cannot carry — spec.md is
  engineering-facing by design.
* **Collision detection**: features routinely collide with the existing product
  surface. The PRD's blast-radius section forces that question at planning
  time, where it's visible before approval.
* **Grill-first**: the interrogation process (design-tree frontier rounds) is
  the mechanism that surfaces scope, constraints, and collision points. It
  belongs in the artifact's production process, not in the spec skill.
* **Optional, not mandatory**: most ADRs in this plugin are pure engineering
  (ADR-0022 namespace rename, ADR-0026 index freshness, ADR-0032 qmd
  staleness). Requiring a PRD upstream would produce empty ceremony for ~30
  existing ADRs. The PRD is opt-in for client-facing capabilities only.
* **Own artifact, not a spec section**: a document that often spans several
  specs can't live under a single capability directory.

## Considered Options

* **Option 1**: A new standalone `/sdd:prd` skill producing a standalone
  `prd.md` in its own directory (`docs/prds/`), with its own qmd collection,
  own graph edges (`governs` into ADRs and specs), own ID scheme (`PRD-XXXX`),
  and status gates (`draft → client-review → approved → shipped`). Optional:
  produced only when the capability is client-facing.
* **Option 2**: Fold product intent into `spec.md` as a preamble section (the
  approach used by GitHub Spec Kit and AWS Kiro).
* **Option 3**: A lightweight product-brief section inside each ADR's context
  block.

## Decision Outcome

Chosen option: **Option 1 — a new standalone `/sdd:prd` skill and `prd.md`
artifact**, because product intent for client-facing capabilities is a
genuine, separable artifact with its own audience (the client), its own
approval boundary, and its own lifecycle. Folding it into `spec.md` conflates
product intent with engineering specification and loses the client-facing
approval boundary. Option 3 (ADR context section) is too small for anything
beyond a one-line summary.

### Consequences

* Good, because client-facing capabilities get a product-intent artifact the
  client can read and approve, with a clear approval boundary.
* Good, because the blast-radius section catches feature collisions at
  planning time.
* Good, because the artifact is optional — pure engineering work skips it
  without ceremony.
* Bad, because it adds a third artifact type to the pipeline (PRD → ADR →
  spec pair), increasing the artifact count per client-facing capability
  from two to three.
* Neutral, because the artifact is optional; internal-only work proceeds
  exactly as before.

## Validation

* Status gates enforced by `/sdd:check` and `/sdd:audit` (PRD must reach
  `approved` before its spec reaches `approved`; `shipped` PRD success
  criteria must be verifiable).
* Graph edges: `governs` from PRD into ADRs and specs; `implements` from
  specs into PRDs. /sdd:graph surfaces the lineage.
* qmd collection: `prds` (separate from `specs` and `adrs`).
* EARS (Easy Approach to Requirements Syntax) adopted for success criteria:
  `While <precondition>, when <trigger>, the <system> shall <response>` —
  giving "write them as checks an agent can run" an actual syntax standard.
