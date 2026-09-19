---
status: draft
date: 2026-09-19
implements: [ADR-0036]
requires: [SPEC-0018, SPEC-0014]
---

# SPEC-0037: PRD Skill

## Overview

A new `/sdd:prd` skill produces Product Requirements Documents as a first-class, optional, client-facing artifact per ADR-0036: PRDs live in `docs/prds/` with sequential `PRD-XXXX` IDs, are produced grill-first, carry EARS-shaped success criteria and `governs:` edges into ADRs and specs, and move through enforced status gates `draft → client-review → approved → shipped`. Enforcement lives in `/sdd:check` and `/sdd:audit`, mirroring the existing `spec.md`/`design.md` pairing validation. PRDs are optional and client-facing-only; their absence is never a finding.

## Requirements

### Requirement: PRD Artifact Location and Identification

PRD files MUST be written to the PRD directory resolved per `shared-patterns.md` § "Artifact Path Resolution" (default `docs/prds/`), named `PRD-XXXX-slug.md`. The ID MUST be sequential — scan the PRD directory for the highest existing `PRD-XXXX` and increment. PRDs MUST NOT be written inside the spec directory.

#### Scenario: Sequential ID allocation

- **WHEN** `/sdd:prd` runs and `docs/prds/` contains `PRD-0001` and `PRD-0003`
- **THEN** the new PRD SHALL be `PRD-0004`

#### Scenario: First PRD in a repository

- **WHEN** `/sdd:prd` runs and no PRD directory exists
- **THEN** the skill SHALL create `docs/prds/` and allocate `PRD-0001`

### Requirement: Grill-First Production

The `/sdd:prd` skill MUST run the interrogation defined in `shared-patterns.md` § "Grill-First Interrogation Pattern" before drafting: map the design tree, work the question frontier in rounds with recommended answers, explore facts via the repository, reserve decisions for the user, and gate drafting on convergence. The Q&A rounds MUST be recorded in the PRD's clarification log.

#### Scenario: Convergence gate blocks drafting

- **WHEN** a frontier question remains unanswered or a template section cannot be filled without a placeholder
- **THEN** the skill MUST NOT write the PRD file and SHALL present the open frontier to the user

#### Scenario: Facts are never asked of the user

- **WHEN** a frontier question can be answered by reading the repository
- **THEN** the skill SHALL answer it from the codebase and record the evidence in the clarification log

### Requirement: EARS-Shaped Success Criteria

Every success criterion in a PRD MUST be written in EARS syntax — `While <precondition>, when <trigger>, the <system> shall <response>` (including the four further EARS patterns: ubiquitous, state-driven, event-driven, optional-feature). A criterion not matching an EARS pattern is a validation error.

#### Scenario: EARS validation failure

- **WHEN** `/sdd:check` or `/sdd:audit` examines a PRD whose success criteria are aspirations ("the dashboard should be fast")
- **THEN** the criterion SHALL be reported as a violation

### Requirement: Status Gates and Their Enforcement

PRD frontmatter MUST carry `status:` with exactly one of `draft`, `client-review`, `approved`, `shipped`. `/sdd:check` and `/sdd:audit` MUST validate the gate pairings, mirroring `spec.md`/`design.md` pairing validation:

- A PRD with status `approved` or `shipped` MUST govern at least one ADR or spec that exists in the repository.
- A PRD with status `shipped` MUST have at least one governed spec, and its success criteria MUST carry met evidence (a test, run, or verification reference) or an explicit waiver recorded in the PRD.

#### Scenario: Approved PRD without a governed artifact

- **WHEN** `/sdd:audit` finds a PRD with status `approved` whose `governs:` list references no existing ADR or spec
- **THEN** audit SHALL report a `[WARNING]` finding naming the PRD and the missing targets

#### Scenario: Shipped PRD with unmet criteria

- **WHEN** `/sdd:audit` finds a PRD with status `shipped` with a success criterion carrying no met evidence and no waiver
- **THEN** audit SHALL report a `[CRITICAL]` finding

#### Scenario: Absence of a PRD is never a finding

- **WHEN** `/sdd:audit` examines an ADR with no upstream PRD
- **THEN** audit SHALL NOT report anything about PRDs for that ADR

### Requirement: Graph Edges and Node Visibility

PRD frontmatter MUST declare relationships using `governs:` (and optionally `related:`) within the SPEC-0018 vocabulary. `/sdd:graph` MUST scan the PRD directory as its own node type with the `PRD-XXXX` ID namespace, so `impact`, `ancestors`, `chain`, and `orphans` cover PRDs. A PRD with status `approved` or `shipped` and no governed downstream artifact MUST be reported by `orphans`; a `draft` or `client-review` PRD MUST NOT be.

#### Scenario: Impact from a PRD

- **WHEN** `/sdd:graph impact PRD-0002` runs and the PRD governs ADR-0018 and SPEC-0012
- **THEN** the impact set SHALL include the transitive closure through those artifacts

#### Scenario: Draft PRD is not an orphan

- **WHEN** `/sdd:graph orphans` runs and `PRD-0001` has status `draft` with an empty `governs:` list
- **THEN** `PRD-0001` SHALL NOT be reported as an orphan

### Requirement: qmd Collection Isolation

`/sdd:index` MUST index PRDs into their own collection (`{repo}-prds`, mask over the PRD directory) and MUST NOT index PRDs into the specs collection. `/sdd:prime` MUST load PRDs when relevant to the session topic.

#### Scenario: PRD never lands in the specs collection

- **WHEN** `/sdd:index` runs in a repository with PRDs
- **THEN** the specs collection SHALL contain no PRD content and the prds collection SHALL contain all of it

### Requirement: Wiring Into Existing Skills

`/sdd:list` MUST show PRDs in their own section with status. `/sdd:status` MUST update PRD frontmatter status using the same gates. `/sdd:docs` MUST generate a PRD page per the docs-site schema. The `/sdd:adr` and `/sdd:spec` skills MUST accept a `--from-prd PRD-XXXX` style continuation that reads the approved PRD as input to the downstream artifact.

#### Scenario: List shows PRDs

- **WHEN** `/sdd:list` runs in a repository with two PRDs
- **THEN** output SHALL include a PRDs section listing both with their statuses

#### Scenario: Spec from an approved PRD

- **WHEN** `/sdd:spec --from-prd PRD-0002` runs and `PRD-0002` is approved
- **THEN** the new spec SHALL carry `implements:`-style lineage back to the PRD (via the PRD's `governs:` edge) and derive its scenarios from the PRD's success criteria
