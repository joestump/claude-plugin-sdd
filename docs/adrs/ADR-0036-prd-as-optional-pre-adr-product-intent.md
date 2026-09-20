---
status: proposed
date: 2026-09-19
decision-makers: Joe Stump
related: [ADR-0003, ADR-0023, ADR-0025]
---

# ADR-0036: PRD as an Optional, Pre-ADR, Client-Facing Product-Intent Artifact

## Context and Problem Statement

Client-facing requests often arrive vague — "add a dashboard", "support SSO" — and the gap between that ask and a rigorous spec is the interrogation that precedes it. A PRD (Product Requirements Document) captures the product intent in the customer's terms, carries a signed-off approval boundary, and precedes engineering specification.

GitHub Spec Kit and Kiro both fold product intent into `spec.md` / `requirements.md` rather than splitting a PRD out. Adopting a PRD is therefore a **deliberate unbundling**: a client-deliverable with a sign-off boundary is something `spec.md` genuinely cannot carry. The spec pair is an engineering contract; the PRD is the commercial one.

A community contribution (PR #238 by @surveygate) proposed a PRD template but packaged it as a reference drop inside `/sdd:spec`. The review held the content and prescribed this ADR's shape: a fourth authored artifact type needs an ADR before the code.

## Decision Drivers

* **Decide-then-specify discipline** — ADR-0003 fixed the artifact formats, ADR-0023 the graph edge schema, ADR-0025 the issues collection; every new artifact type has landed the same way.
* **Graph visibility** — a PRD claims to sit upstream of ADRs and specs; `/sdd:graph` must see it or `impact` / `ancestors` / `chain` / `orphans` report nonsense for client-facing work.
* **Index isolation** — the specs qmd collection masks `**/*.md`; a PRD co-located in the spec dir would be indexed as a spec.
* **ID consistency** — every skill assumes scan-highest-and-increment `ADR-XXXX` / `SPEC-XXXX`.
* **Optionality** — most ADRs are pure engineering (ADR-0022, ADR-0026, ADR-0032) with no product-intent upstream; they must not become second-class.

## Considered Options

* **Option A — First-class optional PRD artifact**: own directory, sequential IDs, `governs:` edges, own qmd collection, produced by a new `/sdd:prd` skill, gates enforced by `check` / `audit`.
* **Option B — Fold product intent into spec.md** (the Spec Kit / Kiro shape): no new artifact, but no client sign-off boundary and spec bloat.
* **Option C — Reference template only** (the original PR's shape): no graph, no index, no enforcement; gates decay into decoration.
* **Option D — Do nothing**: client-facing work keeps ad-hoc docs outside the SDD lifecycle.

## Decision Outcome

Chosen option: **Option A — first-class optional PRD artifact**. A client-deliverable with a signed-off approval boundary cannot live inside `spec.md`, and un-enforced status gates are decoration. The commitments:

1. **Optional and client-facing-only — load-bearing, not implied.** A PRD exists only when the requester wants a client-ready document or the requirements must be interrogated out of a stakeholder. Pure-engineering ADRs have no PRD upstream, and `/sdd:audit` MUST NOT flag an ADR as missing a PRD. Absence of a PRD is never a finding.
2. **Own directory: `docs/prds/`.** Not the spec dir — a PRD often spawns several specs, so co-locating under `{spec-dir}/{capability}/` breaks the first time one PRD produces two. The path is declared in `CLAUDE.md` § Architecture Context like the ADR and spec paths (`- Product Requirements Documents are in {path}`), defaulting to `docs/prds/`.
3. **Sequential ID scheme: `PRD-XXXX`** (`PRD-0001`, scan-highest-and-increment), matching `ADR-XXXX` / `SPEC-XXXX`. The `PRD-<YYYYMMDD>-<slug>` scheme from the original template was rejected: it breaks the increment convention every skill assumes.
4. **Lineage: PRD → ADR → spec pair → plan → work.** The PRD precedes the ADR. Its user stories become requirements, its blast radius becomes the impact analysis, its success criteria become the spec's scenarios. One PRD MAY govern several ADRs and specs.
5. **Graph edges: `governs:` into ADRs and specs** (`related:` also valid), within the ADR-0023 / SPEC-0018 frontmatter vocabulary. PRDs are first-class graph nodes with their own ID namespace; reverse edges (`governed-by`) are derived, never authored.
6. **Own qmd collection** (`{repo}-prds`, mask `docs/prds/*.md`), the way ADR-0025 gave tracker issues theirs. PRDs MUST NOT be co-located where the specs collection mask would swallow them.
7. **Success criteria use EARS syntax** — `While <precondition>, when <trigger>, the <system> shall <response>` — giving "write them as checks an execution agent can run" an enforceable syntax instead of an exhortation.
8. **Status gates `draft → client-review → approved → shipped`, enforced** by `/sdd:check` and `/sdd:audit` the way they already validate `spec.md`/`design.md` pairing: an `approved` PRD without a governed spec is a finding; a `shipped` PRD's success criteria must have met evidence.
9. **Produced by a new `/sdd:prd` skill**, a sibling of `/sdd:adr` and `/sdd:spec` — not a section inside `/sdd:spec`, because a document that precedes the spec pair cannot be produced by the spec skill.

### Consequences

* Good, because `/sdd:graph` walks PRD → ADR → spec → implementation, so `impact` answers for client requests too.
* Good, because the ID scheme needs no new increment logic.
* Good, because the optionality rule keeps the ~30 existing pure-engineering ADRs clean.
* Good, because EARS-shaped criteria make the `shipped` gate checkable.
* Bad, because surface area grows: a fourth artifact type, a third node type in the graph, another qmd collection, another skill to maintain.
* Neutral, because PRDs spanning multiple specs reference them via `governs:` edges rather than directory placement.

### Confirmation

This ADR settles the shape decided in the PR #238 review (owner review 2026-09-08, second review 2026-09-16). The template content itself originated in that PR; the `/sdd:prd` implementation credits the contributor.

## Pros and Cons of the Options

### Option B — fold into spec.md

The Spec Kit / Kiro shape. Reuses everything, adds nothing. But a spec is an engineering contract consumed by implementers; a PRD is a commercial document consumed by a client, with different lifecycle gates (client-review, approval) that `spec.md`'s status vocabulary cannot express. Folding them means either bloating every spec or having unenforceable client gates.

### Option C — reference template only

The original PR's shape. Cheapest, but PRDs stay invisible to graph/index/audit, the ID scheme and frontmatter drift from the conventions, and the status gates are asserted nowhere — precisely the findings that held PR #238.

### Option D — do nothing

Client-facing work keeps producing ad-hoc documents outside the lifecycle, with no graph lineage and no drift detection between what was promised and what was built.

## More Information

* PR #238 and its reviews — the contribution and the prescribed split this ADR executes.
* EARS (Easy Approach to Requirements Syntax): https://alistairmavin.com/ears/
* GitHub Spec Kit: https://github.com/github/spec-kit
* Kiro feature specs: https://kiro.dev/docs/specs/feature-specs/
