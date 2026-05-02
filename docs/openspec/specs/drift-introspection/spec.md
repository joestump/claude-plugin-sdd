---
implements: [ADR-0001]
---

# SPEC-0001: Drift Introspection Skills

## Overview

Drift detection and introspection capabilities for validating alignment between design artifacts (ADRs, specs) and implementation code. Provides a layered approach with a fast `/sdd:check` for targeted checks and a deep `/sdd:audit` for comprehensive analysis. See ADR-0001.

## Requirements

### Requirement: Quick Check Skill

The `/sdd:check` skill SHALL provide fast, focused drift detection against a specific file, directory, ADR, or spec target. It MUST operate in single-agent mode only (no `--review` flag). It MUST complete analysis without requiring the full project to be scanned.

#### Scenario: Check a specific file against its governing spec

- **WHEN** a user runs `/sdd:check src/components/Auth.tsx`
- **THEN** the skill SHALL identify the governing ADRs and specs for that file and produce a findings table showing any drift between the implementation and the design artifacts

#### Scenario: Check with no design artifacts present

- **WHEN** a user runs `/sdd:check` in a project with no ADRs or specs
- **THEN** the skill SHALL report that no design artifacts were found and suggest creating some with `/sdd:adr` or `/sdd:spec`

#### Scenario: Check an ADR against code

- **WHEN** a user runs `/sdd:check ADR-0001`
- **THEN** the skill SHALL scan the codebase for implementations related to that ADR's decisions and report any drift

### Requirement: Comprehensive Audit Skill

The `/sdd:audit` skill SHALL provide deep, comprehensive analysis covering all forms of drift: code-vs-spec, code-vs-ADR, ADR-vs-spec inconsistencies, coverage gaps, stale artifact detection, and policy violations. It MUST produce a structured report with prioritized findings.

#### Scenario: Full project audit

- **WHEN** a user runs `/sdd:audit`
- **THEN** the skill SHALL examine the entire project and produce a comprehensive report covering all analysis types with severity levels (critical, warning, info)

#### Scenario: Audit with team review

- **WHEN** a user runs `/sdd:audit --review`
- **THEN** the skill SHALL spawn a team with an auditor agent and a reviewer agent following the established handoff protocol with a maximum of 2 revision rounds

#### Scenario: Audit with no code to analyze

- **WHEN** a user runs `/sdd:audit` in a project with ADRs and specs but no implementation code
- **THEN** the skill SHALL report coverage gaps (unimplemented specs) without producing false drift findings

### Requirement: Findings Output Format

Both skills MUST produce findings as structured markdown tables. Each finding MUST include a severity level (critical, warning, info), the affected file or artifact, and a concrete description of the mismatch. Findings MUST be specific enough for developers to act on, including file paths and line references where applicable.

#### Scenario: Findings table format

- **WHEN** either skill completes analysis and finds drift
- **THEN** the output SHALL include a markdown table with columns for Severity, Location, Finding, and Recommendation

#### Scenario: No drift found

- **WHEN** either skill completes analysis and finds no drift
- **THEN** the output SHALL confirm alignment and report the number of artifacts and files checked

### Requirement: Analysis Types

The `/sdd:audit` skill MUST support the following analysis types. The `/sdd:check` skill SHOULD support code-vs-spec drift, code-vs-ADR drift, and ADR-vs-spec inconsistency checks.

#### Scenario: Coverage gap detection

- **WHEN** `/sdd:audit` scans the project
- **THEN** it SHALL identify areas of the codebase that have no governing ADR or spec

#### Scenario: Stale artifact detection

- **WHEN** `/sdd:audit` scans the project
- **THEN** it SHALL identify ADRs and specs whose status or content no longer reflects the current state of the codebase

#### Scenario: Policy violation detection

- **WHEN** `/sdd:audit` scans the project
- **THEN** it SHALL identify code that violates MUST, MUST NOT, or SHALL NOT constraints stated in specs
