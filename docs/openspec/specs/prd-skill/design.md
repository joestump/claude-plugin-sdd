---
status: draft
date: 2026-09-19
---

# design.md: PRD Skill

## Context

ADR-0036 mandates a new `/sdd:prd` skill producing a first-class optional artifact. This document sketches the implementation and wiring surface.

## Goals / Non-Goals

### Goals

- Author a PRD using the grill-first interrogation pattern.
- Validate EARS-shaped success criteria.
- Enforce status gates via `/sdd:check` and `/sdd:audit`.
- Register PRDs as graph nodes with `governs:` edges.
- Isolate PRDs into their own qmd collection.

### Non-Goals

- Fine-tuning / weight distillation (out of scope for PRD itself; may be future work).
- Non-client-facing PRDs (the optionality rule is enforced by `check`/`audit`, not by the skill gating who can call it).

## Decisions

### Frontmatter shape

YAML frontmatter per ADR-0003:

```yaml
---
title: Short description
id: PRD-0001
status: draft | client-review | approved | shipped
client: Internal | Customer
created: YYYY-MM-DD
updated: YYYY-MM-DD
governs: [ADR-XXXX, SPEC-YYYY]
related: [ADR-ZZZZ]
---
```

`adrs:` is NOT accepted — kept to the SPEC-0018 vocabulary. Unknown fields are silently dropped by graph.py (pre-existing behavior).

### Template outline

The PRD template (to be placed in `references/prd-template.md`) mirrors the contributor's structure:

- Problem / opportunity
- User stories
- Scope (in/out)
- Success criteria (EARS)
- Blast radius / touch points
- Clarification log (grill rounds)
- Open questions (blocks `approved` until resolved or waived)
- Decision log (links to ADRs)

### Enforcement locations

- `scripts/check-structure.sh` — structural checks only (existing function).
- `skills/graph/lib/graph.py` — `_scan_prds()` and `_extract_prd_id()`, node type `prd`, edge fields `governs` / `related`.
- `skills/audit/SKILL.md` — orchestration layer, calls gate validation functions.
- `skills/check/SKILL.md` — quick-check, validates PRD frontmatter and EARS shape.

### Skill outline for `/sdd:prd`

Mirrors `/sdd:adr` structure:

1. Resolve PRD directory per Artifact Path Resolution.
2. Determine the next PRD number (scan-highest-and-increment).
3. Run grill-first interrogation per `shared-patterns.md` § "Grill-First Interrogation Pattern".
4. qmd-aware edge pre-search (find related ADRs/specs to cite as `governs:`).
5. Draft frontmatter and body.
6. Write file.

### Graph integration

Add `_scan_prds` (parallel to `_scan_adrs`/`_scan_specs` in graph.py). Glob `docs/prds/PRD-*.md`. Extract ID via regex. Parse frontmatter; harvest `governs` / `related`. Add to nodes with type `prd`. Status field is respected by `orphans` (shipped PRD with no spec = orphan; draft PRD = not).

### Index integration

`/sdd:index` reads the plugin's `collections:` setting (ADR-0023) — if PRDs exist, ensure a `{repo}-prds` collection with mask PRD-dir-based. Never overlap with specs collection mask.

## Risks / Trade-offs

- **Surface area**: a new artifact type adds skill, graph, and index wiring; cost amortized over client-facing work.
- **Optionality drift**: if `audit` does not enforce the optionality rule strictly, future auditors may start flagging pure engineering ADRs. The rule is explicit in audit checks.

## Migration Plan

None for existing repos; PRDs are opt-in. A repo adding the first PRD creates the directory and qmd collection ad hoc.

## Open Questions

None (resolved by ADR-0036).
