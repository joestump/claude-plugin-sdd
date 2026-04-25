# SPEC-0003: Foundational Design Artifact Formats and Core Skills

## Overview

Standard formats for architectural decisions (MADR) and specifications (OpenSpec), along with core skills for creating, listing, and managing the lifecycle of these design artifacts. Forms the foundation on which all other plugin capabilities are built. See ADR-0003.

## Requirements

### Requirement: MADR ADR Format

The `/sdd:adr` skill SHALL create ADRs using the MADR (Markdown Architectural Decision Records) format. Each ADR MUST include YAML frontmatter with `status` and `date` fields. Each ADR MUST include sections for Context and Problem Statement, Decision Drivers, Considered Options, Decision Outcome (with Consequences and Confirmation), Pros and Cons of the Options, and Architecture Diagram.

#### Scenario: Create a new ADR

- **WHEN** a user runs `/sdd:adr` with a description
- **THEN** the skill SHALL create a new ADR file at `docs/adrs/ADR-XXXX-short-title.md` with all required MADR sections, YAML frontmatter with status "proposed", and the current date

#### Scenario: Sequential ADR numbering

- **WHEN** a user creates a new ADR and existing ADRs exist
- **THEN** the skill SHALL assign the next sequential number (zero-padded to 4 digits) after the highest existing ADR number

#### Scenario: ADR with team review

- **WHEN** a user runs `/sdd:adr --review`
- **THEN** the skill SHALL spawn a team with a drafter agent and an architect agent, with a maximum of 2 revision rounds before the architect approves

### Requirement: Architecture Diagrams

Every ADR MUST include an Architecture Diagram section containing at least one Mermaid diagram. The diagram SHOULD use C4 context/container diagrams for system-level decisions, sequence diagrams for flows, and ERDs for data models.

#### Scenario: Mermaid diagram inclusion

- **WHEN** an ADR is created
- **THEN** it SHALL contain at least one Mermaid diagram in the Architecture Diagram section

### Requirement: OpenSpec Specification Format

The `/sdd:spec` skill SHALL create specifications as paired files: `spec.md` for requirements and `design.md` for architecture and rationale. Both files MUST be created in `docs/openspec/specs/{capability-name}/`.

#### Scenario: Create a new spec

- **WHEN** a user runs `/sdd:spec` with a capability name
- **THEN** the skill SHALL create both `spec.md` and `design.md` in `docs/openspec/specs/{capability-name}/`

#### Scenario: Spec numbering

- **WHEN** a new spec is created
- **THEN** the spec.md SHALL use the next sequential SPEC-XXXX number (zero-padded to 4 digits)

#### Scenario: Both files required

- **WHEN** a spec is created
- **THEN** both spec.md and design.md MUST be created -- never one without the other

### Requirement: RFC 2119 Normative Language

All spec.md files MUST use RFC 2119 keywords (SHALL, MUST, MUST NOT, SHOULD, SHOULD NOT, MAY, REQUIRED, RECOMMENDED, OPTIONAL) for all normative requirements. Non-normative text MUST NOT use these keywords.

#### Scenario: RFC 2119 compliance

- **WHEN** a spec.md is created or reviewed
- **THEN** every normative statement SHALL use the appropriate RFC 2119 keyword

### Requirement: Scenario Format

Every requirement in a spec.md MUST have at least one scenario. Scenarios MUST use exactly `####` (4 hashtags) level headings. Each scenario MUST contain WHEN and THEN clauses.

#### Scenario: Correct heading level

- **WHEN** a scenario is written in a spec.md
- **THEN** it SHALL use exactly `####` level headings -- using `###` or bullet lists will cause silent failures in downstream tooling

### Requirement: Artifact Listing

The `/sdd:list` skill SHALL scan both `docs/adrs/` and `docs/openspec/specs/` and present results in a formatted table with columns for ID, Title, Status, and Date. It MUST be read-only with allowed-tools limited to Read, Glob, and Grep.

#### Scenario: List all artifacts

- **WHEN** a user runs `/sdd:list`
- **THEN** the skill SHALL display a table of all ADRs and specs with their ID, Title, Status, and Date

#### Scenario: Filter by type

- **WHEN** a user runs `/sdd:list adr` or `/sdd:list spec`
- **THEN** the skill SHALL display only the specified artifact type

### Requirement: Status Management

The `/sdd:status` skill SHALL update the YAML frontmatter status of ADRs and specs. It MUST support all valid status transitions: ADRs (proposed, accepted, deprecated, superseded) and specs (draft, review, approved, implemented, deprecated).

#### Scenario: Update ADR status

- **WHEN** a user runs `/sdd:status ADR-0001 accepted`
- **THEN** the skill SHALL update the YAML frontmatter status field to "accepted" without modifying any other content

#### Scenario: Invalid status

- **WHEN** a user provides an invalid status value
- **THEN** the skill SHALL report the error and list the valid statuses for that artifact type

### Requirement: SKILL.md Format

All skills MUST follow the established SKILL.md format with YAML frontmatter containing `name`, `description`, `allowed-tools`, and `argument-hint` fields.

#### Scenario: Consistent skill definition

- **WHEN** a new skill is added to the plugin
- **THEN** its SKILL.md MUST include all required YAML frontmatter fields
