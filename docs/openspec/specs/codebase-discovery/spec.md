---
implements: [ADR-0005]
---

# SPEC-0005: Codebase Discovery

## Overview

A read-only analysis skill that explores an existing codebase to discover implicit architectural decisions and specification-worthy subsystems, producing a structured suggestion report. The skill bridges the gap between installing the SDD plugin and having a useful set of design artifacts by reverse-engineering what the code already implies. See ADR-0005.

## Requirements

### Requirement: Discovery Report Output

The `/sdd:discover` skill SHALL produce a structured report containing two sections: Suggested ADRs and Suggested Specs. The report MUST NOT create any files -- it SHALL only output suggestions for the user to act on. Each suggestion MUST include a title, evidence from the codebase, and a ready-to-use description that can be passed directly to `/sdd:adr` or `/sdd:spec`.

#### Scenario: Discover on a project with no existing artifacts

- **WHEN** a user runs `/sdd:discover` on a project with code but no ADRs or specs
- **THEN** the skill SHALL analyze the codebase and produce a report with suggested ADRs for implicit decisions and suggested specs for subsystem boundaries

#### Scenario: Discover on a project with existing artifacts

- **WHEN** a user runs `/sdd:discover` on a project that already has ADRs and specs
- **THEN** the skill SHALL read existing artifacts, avoid duplicating already-documented decisions, and only suggest new ADRs and specs for undocumented areas

#### Scenario: Discover produces actionable suggestions

- **WHEN** the skill produces a suggestion
- **THEN** each suggestion SHALL include a ready-to-use command (e.g., `/sdd:adr Chose PostgreSQL over MongoDB for user data persistence`) that the user can copy and run directly

### Requirement: Codebase Analysis Categories

The skill MUST analyze the codebase across the following categories to identify implicit decisions and spec boundaries. The skill SHOULD use parallel exploration agents via the Task tool to analyze categories concurrently when the codebase is large.

#### Scenario: Dependency and framework analysis

- **WHEN** the skill analyzes the codebase
- **THEN** it SHALL examine package manifests (package.json, requirements.txt, go.mod, Cargo.toml, etc.), configuration files, and import patterns to identify technology choices (e.g., "chose React over Vue", "chose PostgreSQL over MongoDB")

#### Scenario: Architectural pattern analysis

- **WHEN** the skill analyzes the codebase
- **THEN** it SHALL examine code structure, API definitions, data access patterns, and module organization to identify architectural patterns (e.g., "REST API with controller/service/repository layers", "event-driven with message queues")

#### Scenario: Project structure analysis

- **WHEN** the skill analyzes the codebase
- **THEN** it SHALL examine directory layout, module boundaries, and package organization to identify subsystems that warrant formal specifications (e.g., "auth subsystem", "payment processing pipeline")

#### Scenario: Configuration and infrastructure analysis

- **WHEN** the skill analyzes the codebase
- **THEN** it SHALL examine configuration files, environment variables, CI/CD pipelines, and infrastructure-as-code to identify deployment and operational decisions (e.g., "containerized with Docker Compose", "deployed to AWS Lambda")

### Requirement: Scope Control

The skill MUST accept an optional scope argument to limit analysis to a subdirectory, domain, or technology area. When no scope is provided, the skill SHALL analyze the entire project.

#### Scenario: Scoped discovery

- **WHEN** a user runs `/sdd:discover src/auth`
- **THEN** the skill SHALL limit analysis to the `src/auth` directory and its relationships to the rest of the codebase, producing suggestions relevant only to that scope

#### Scenario: Unscoped discovery

- **WHEN** a user runs `/sdd:discover` with no arguments
- **THEN** the skill SHALL analyze the entire project

### Requirement: Duplicate Avoidance

The skill MUST read existing ADRs in `docs/adrs/` and existing specs in `docs/openspec/specs/` before producing suggestions. It MUST NOT suggest an ADR or spec that substantially overlaps with an existing artifact. When a potential suggestion overlaps with an existing artifact, it SHOULD note the existing artifact and explain what additional aspects remain undocumented, if any.

#### Scenario: Existing ADR covers a discovered decision

- **WHEN** the codebase uses JWT authentication and an ADR already documents this choice
- **THEN** the skill SHALL NOT suggest a new ADR for JWT authentication, and MAY note the existing ADR covers this area

#### Scenario: Partial coverage by existing artifact

- **WHEN** an existing ADR documents the choice of PostgreSQL but does not cover the decision to use a specific ORM
- **THEN** the skill MAY suggest a new ADR for the ORM choice, noting that the database choice itself is already documented in the existing ADR

### Requirement: Read-Only Operation

The skill MUST NOT create, modify, or delete any files. Its allowed tools SHALL be limited to Read, Glob, Grep, and Task (for parallel exploration). The skill MUST NOT use Write, Edit, or Bash tools.

#### Scenario: Skill tool restrictions

- **WHEN** the skill executes
- **THEN** it SHALL only use Read, Glob, Grep, and Task tools -- no file mutations

### Requirement: Report Format

The discovery report MUST follow a structured format with clear sections for suggested ADRs, suggested specs, and a summary. Each suggestion MUST include a confidence indicator (high, medium, low) based on the strength of evidence found in the codebase.

#### Scenario: Report structure

- **WHEN** the skill completes analysis
- **THEN** the report SHALL include: a summary of what was analyzed, a Suggested ADRs section with a table, a Suggested Specs section with a table, and a next steps section with copy-paste commands

#### Scenario: Empty results

- **WHEN** the skill finds no implicit decisions or spec boundaries (e.g., an empty or trivial project)
- **THEN** the skill SHALL report that no suggestions were found and recommend the user create initial design artifacts manually

### Requirement: Evidence-Based Suggestions

Each suggestion MUST cite specific evidence from the codebase -- file paths, dependency declarations, configuration entries, or code patterns -- that support the suggestion. Suggestions MUST NOT be based on speculation or assumptions about code that was not read.

#### Scenario: ADR suggestion with evidence

- **WHEN** the skill suggests an ADR for a technology choice
- **THEN** the suggestion SHALL cite the specific files or declarations that reveal the choice (e.g., "package.json declares `next: ^14.0.0`; app directory uses App Router with `src/app/layout.tsx`")

#### Scenario: Spec suggestion with evidence

- **WHEN** the skill suggests a spec for a subsystem
- **THEN** the suggestion SHALL cite the files and boundaries that define the subsystem (e.g., "Authentication subsystem spans `src/auth/`, `src/middleware/auth.ts`, and `src/api/auth/` with 12 files and 3 API routes")
