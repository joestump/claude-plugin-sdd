# SPEC-0013: Scrum Mode Audit Triage

## Overview

A `--scrum` flag for `/sdd:audit` that adds a team-based triage ceremony on top of the standard six-category drift analysis. After completing the standard audit, a six-role scrum team groups raw findings into functional themes, applies prioritization (P1/P2/P3) and effort estimation (XS–XL), challenges false positives, distinguishes code-fix findings from artifact-update findings, and produces a prioritized remediation roadmap. ADRs and OpenSpecs are the source of truth; code that deviates is presumed wrong unless the triage team explicitly argues the artifact has become stale. See ADR-0014.

## Requirements

### Requirement: Scrum Flag and Mode Activation

The `/sdd:audit` skill MUST accept a `--scrum` flag. When set, the skill SHALL first complete the full standard audit analysis (all six drift categories, severity assignments, findings table) and then execute the triage ceremony phases. The `--scrum` flag MUST compose with scope arguments: `/sdd:audit auth --scrum` SHALL limit both the standard audit and the triage ceremony to the auth domain. The `--scrum` flag MUST be mutually exclusive with `--review`; if both are provided, `--scrum` MUST take precedence.

#### Scenario: Scoped scrum audit

- **WHEN** the user runs `/sdd:audit security --scrum`
- **THEN** the standard audit analyzes only security-domain artifacts and code, and the triage team triages only the security-domain findings

#### Scenario: Full-project scrum audit

- **WHEN** the user runs `/sdd:audit --scrum` with no scope
- **THEN** the standard audit runs against the full project and the triage team triages all findings

#### Scenario: Flag precedence

- **WHEN** the user provides both `--scrum` and `--review`
- **THEN** `--scrum` takes precedence, `--review` is silently ignored, and the scrum ceremony runs

### Requirement: Triage Team Composition

The skill MUST spawn exactly five specialist agents to triage raw findings alongside the orchestrating lead. Agent personas MUST be defined verbatim in the SKILL.md with the following role-specific mandates:

| Role | Audit-Specific Mandate |
|------|------------------------|
| Product Owner | Prioritize findings by business impact and user exposure; decide which findings are "accept for now" vs. "must fix before next release"; document priority decisions with reasoning |
| Scrum Master | Estimate remediation effort per theme (XS/S/M/L/XL); flag themes that are too large for one sprint and propose splits; ensure themes are sprint-actionable |
| Engineer A | Assess technical complexity and implementation risk of fixes; identify themes that require large refactors vs. targeted patches |
| Engineer B (Grumpy) | Challenge whether each finding is genuine drift or intentional architectural evolution; hold a high bar for accepting "this is fine actually"; explicitly call out when the PO wants to defer a MUST/SHALL violation |
| Architect | Validate that ADRs and specs are still the correct source of truth; identify findings where the correct resolution is an artifact update (via `/sdd:adr` or `/sdd:spec`) rather than a code fix |

#### Scenario: Engineer B disputes a finding

- **WHEN** Engineer B argues a finding reflects intentional evolution, not drift
- **THEN** the Architect evaluates the argument and decides: code fix required, or artifact update needed

#### Scenario: Architect recommends artifact update

- **WHEN** the Architect determines the code reflects a better architectural decision than the current spec or ADR
- **THEN** the finding MUST be flagged as "ARTIFACT UPDATE NEEDED" with a suggestion to run `/sdd:adr` or `/sdd:spec` to capture the evolution, rather than being added to the code-fix remediation backlog

#### Scenario: PO wants to defer a MUST violation

- **WHEN** the PO proposes accepting a finding that violates a MUST or SHALL requirement
- **THEN** Engineer B MUST object, and the Scrum Master MUST note the objection in the triage report; MUST violations MAY only be deferred if both Engineer B's objection is documented and the PO provides a written justification

### Requirement: Source of Truth Principle

ADRs with status `accepted` and specs with status `approved` or `implemented` SHALL be treated as the authoritative source of truth. When code deviates from these artifacts, the code MUST be presumed incorrect unless the triage team's Architect explicitly reclassifies the finding as an artifact update. The skill MUST NOT treat all drift as equivalent — findings against `accepted` ADRs and `approved`/`implemented` specs carry higher authority than findings against `proposed` ADRs or `draft` specs.

#### Scenario: Code deviates from accepted ADR

- **WHEN** a finding shows code contradicting an accepted ADR decision
- **THEN** the finding is presumed a code error unless the Architect reclassifies it as an artifact update

#### Scenario: Code deviates from proposed ADR

- **WHEN** a finding shows code contradicting a proposed (not yet accepted) ADR
- **THEN** the finding SHOULD be flagged as lower-authority drift; the PO MAY choose to accept this as "not yet binding" without Engineer B objecting

### Requirement: Functional Theme Grouping

After the standard audit completes, the lead MUST group all findings into 4–8 functional themes before the triage team is spawned. Themes MUST be named for the affected part of the system (e.g., "Authentication & Authorization", "Billing API Contracts", "Data Model Coverage") rather than for the drift category (e.g., "Code vs. Spec findings"). Each finding MUST appear in exactly one theme. Themes that contain only INFO-severity findings SHOULD be grouped into a single "Technical Debt & Coverage Gaps" theme unless the INFO findings are functionally heterogeneous.

#### Scenario: Cross-category findings for same domain

- **WHEN** an authentication-domain CRITICAL from "Code vs. Spec" and an authentication-domain WARNING from "Code vs. ADR" both exist
- **THEN** they MUST be grouped into the same "Authentication" theme, not split across category tables

#### Scenario: Too many themes

- **WHEN** naive grouping would produce more than 8 themes
- **THEN** the lead MUST merge the smallest or most closely related themes until the count is 8 or fewer

#### Scenario: No findings

- **WHEN** the standard audit finds zero drift
- **THEN** the triage ceremony is skipped and the clean audit result is reported directly, with no scrum team spawned

### Requirement: Priority and Effort Assignment

Each finalized theme MUST have a priority tier and a remediation effort estimate assigned by the triage team:

- **Priority tiers**: P1 (must fix before next release), P2 (fix within 2 sprints), P3 (technical debt, schedule when convenient)
- **Effort sizes**: XS (< 1 day), S (1–2 days), M (3–4 days), L (1 week), XL (> 1 week)

The Product Owner SHALL assign priority based on business impact and user exposure. The Scrum Master SHALL assign effort based on remediation complexity. The priority and effort for each theme MUST be documented in the triage report with one-sentence reasoning from the assigning agent.

#### Scenario: High-severity, low-exposure finding

- **WHEN** a CRITICAL finding exists in a rarely-used internal admin path
- **THEN** the PO MAY assign P2 or P3 despite the CRITICAL severity, with documented reasoning

#### Scenario: Theme too large to sprint

- **WHEN** the Scrum Master estimates a theme as XL
- **THEN** the Scrum Master MUST propose splitting it into two or more sub-themes that each fit within L or smaller

### Requirement: Triage Report

The skill MUST emit a triage report at the end of the ceremony. The report SHALL include:

- **Theme summary table**: theme name, finding count, highest severity, priority tier, effort estimate
- **Per-theme details**: findings list, PO priority reasoning, SM effort reasoning, any Engineer B disputes and their resolution, any Architect artifact-update recommendations
- **Artifact update queue**: list of findings reclassified as artifact updates, with suggested commands (`/sdd:adr [description]` or `/sdd:spec [capability]`)
- **Accepted-for-now list**: MUST/SHALL violations the PO proposed to defer, with Engineer B's objection and PO's written justification documented

After the triage report, the skill MUST offer to create tracker issues for P1 and P2 themes using `AskUserQuestion`.

#### Scenario: Triage report with all theme categories

- **WHEN** the ceremony completes with a mix of P1, P2, and P3 themes plus artifact updates
- **THEN** the report includes the theme summary table, all per-theme details, the artifact update queue, and the accepted-for-now list (if any)

#### Scenario: Issue creation offer

- **WHEN** the triage report is complete and at least one P1 or P2 theme exists
- **THEN** the skill offers to create tracker issues for P1 and P2 themes, following the standard tracker detection flow from the plan skill

#### Scenario: Empty triage result after disputes

- **WHEN** all findings are reclassified as artifact updates by the Architect
- **THEN** the triage report still emits the artifact update queue, and no code-fix tracker issues are created
