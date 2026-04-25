# SPEC-0006: Tasks.md Fallback for Trackerless Projects

## Overview

When no external issue tracker (Beads, GitHub, Gitea, GitLab, Jira, Linear) is available during sprint planning, the `/sdd:plan` skill SHALL generate a `tasks.md` file as an openspec artifact co-located with `spec.md` and `design.md`. This provides durable, machine-parseable task tracking without requiring external tooling. See ADR-0007 and ADR-0008.

## Requirements

### Requirement: Tracker Detection Fallback

The `/sdd:plan` skill MUST detect available issue trackers (see `references/shared-patterns.md` § "Tracker Detection"). When no tracker is detected, the skill SHALL generate a `tasks.md` file instead of printing an ephemeral markdown table to the conversation.

#### Scenario: No tracker available

- **WHEN** sprint planning runs and no issue tracker (Beads, GitHub, Gitea) is detected
- **THEN** the skill SHALL generate `docs/openspec/specs/{capability-name}/tasks.md` with implementation tasks derived from the spec requirements

#### Scenario: Tracker is available

- **WHEN** sprint planning runs and at least one issue tracker is detected
- **THEN** the skill SHALL use the detected tracker as before and MUST NOT generate a `tasks.md` file

### Requirement: Tasks.md File Location

The generated `tasks.md` MUST be placed in the same directory as the spec's `spec.md` and `design.md` files, at `docs/openspec/specs/{capability-name}/tasks.md`.

#### Scenario: Co-location with spec artifacts

- **WHEN** `tasks.md` is generated for a spec in `docs/openspec/specs/web-dashboard/`
- **THEN** the file SHALL be written to `docs/openspec/specs/web-dashboard/tasks.md`

### Requirement: Checkbox Task Format

Every task in `tasks.md` MUST use the markdown checkbox format `- [ ] X.Y Task description` where `X` is the section number and `Y` is the task number within that section. Tasks not using `- [ ]` format MUST NOT be considered trackable.

#### Scenario: Parseable checkbox format

- **WHEN** `tasks.md` is generated
- **THEN** every implementation task SHALL be a checkbox item matching the pattern `- [ ] X.Y Task description`

#### Scenario: Completed task marking

- **WHEN** a task is completed by an agent or user
- **THEN** the checkbox SHALL be updated from `- [ ]` to `- [x]`

### Requirement: Section-Grouped Task Structure

Tasks in `tasks.md` MUST be grouped under numbered `##` headings (e.g., `## 1. Setup`, `## 2. Core Implementation`). Tasks within each section MUST be numbered sequentially using the section prefix (e.g., `1.1`, `1.2`, `2.1`).

#### Scenario: Numbered section headings

- **WHEN** `tasks.md` is generated
- **THEN** tasks SHALL be organized under `## N. Section Title` headings with sequentially numbered tasks

#### Scenario: Dependency ordering

- **WHEN** tasks have dependencies on each other
- **THEN** sections SHOULD be ordered so that prerequisite tasks appear in earlier sections

### Requirement: Spec-Derived Task Content

Tasks MUST be derived from the spec's `### Requirement:` sections and their scenarios. Each requirement SHOULD produce at least one task. Complex requirements with multiple scenarios MAY produce multiple tasks or a dedicated section.

#### Scenario: Requirement traceability

- **WHEN** tasks are generated from a spec
- **THEN** each task SHOULD reference the governing requirement or scenario it implements

#### Scenario: Task granularity

- **WHEN** tasks are generated
- **THEN** each task SHALL be small enough to complete in one coding session and SHALL have a verifiable completion criterion

### Requirement: Progress Tracking Parseability

An apply phase or downstream tooling MUST be able to parse `tasks.md` to determine completion status. The parsing rules SHALL be: count lines matching `- [x]` as completed, count lines matching `- [ ]` as pending, and compute completion percentage as `completed / total * 100`.

#### Scenario: Progress calculation

- **WHEN** a `tasks.md` contains 8 total checkbox items and 3 are marked `- [x]`
- **THEN** a parser SHALL report 3 completed, 5 pending, and 37.5% completion

#### Scenario: Non-checkbox lines ignored

- **WHEN** a `tasks.md` contains section headings, blank lines, or descriptive text
- **THEN** a parser SHALL ignore those lines and only count `- [ ]` and `- [x]` patterns
