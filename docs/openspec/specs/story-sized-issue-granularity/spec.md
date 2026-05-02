---
implements: [ADR-0011]
---

# SPEC-0010: Story-Sized Issue Granularity

## Overview

Changes the `/sdd:plan` skill from creating one tracker issue per `### Requirement:` section to grouping related requirements into 3-4 story-sized issues per spec. Each story contains a task checklist mapping individual requirements to their acceptance criteria, targeting PRs in the 200-500 line range. This preserves full requirement traceability while producing issues that are large enough for meaningful code review and small enough to review in one sitting. See ADR-0011.

## Requirements

### Requirement: Requirement Grouping

The `/sdd:plan` skill SHALL group spec requirements into 3-4 story-sized issues by functional area instead of creating one issue per requirement. The grouping SHALL use AI judgement to cluster requirements by the area of the system they affect (e.g., data model, API endpoints, validation, configuration). The target number of stories depends on the total number of requirements in the spec.

#### Scenario: Typical spec with 10-15 requirements

- **WHEN** a spec contains 10-15 `### Requirement:` sections
- **THEN** the skill SHALL group them into 3-4 story-sized issues, with each story containing 3-5 requirements clustered by functional area
- **AND** every requirement in the spec SHALL appear in exactly one story's task checklist

#### Scenario: Small spec with 4 or fewer requirements

- **WHEN** a spec contains 4 or fewer `### Requirement:` sections
- **THEN** the skill SHALL create 1-2 story-sized issues
- **AND** if only 1-2 requirements exist, the skill MAY create a single story containing all requirements

#### Scenario: Single requirement spec

- **WHEN** a spec contains exactly one `### Requirement:` section
- **THEN** the skill SHALL create one story issue containing that single requirement in its task checklist

### Requirement: Task Checklists

Each story issue body SHALL contain a task checklist where each item maps to one spec requirement with its acceptance criteria. The checklist format SHALL vary by tracker to use native features where available.

#### Scenario: GitHub, Gitea, and GitLab markdown checklists

- **WHEN** the detected tracker is GitHub, Gitea, or GitLab
- **THEN** each story issue body SHALL contain a `## Requirements` section with a markdown task checklist where each item is a checkbox referencing one spec requirement, its normative statement, and its key WHEN/THEN scenarios

#### Scenario: Beads subtasks

- **WHEN** the detected tracker is Beads
- **THEN** the skill SHALL create subtasks for each requirement using `bd subtask add`, linking each subtask to the parent story
- **AND** each subtask SHALL include the requirement's normative statement and key WHEN/THEN scenarios in its body

#### Scenario: Jira and Linear markdown checklists

- **WHEN** the detected tracker is Jira or Linear
- **THEN** each story issue body SHALL contain a `## Requirements` section with a markdown task checklist, following the same format as GitHub/Gitea/GitLab

### Requirement: PR Size Target

Story groupings SHOULD target 200-500 lines of code per resulting PR. This is a heuristic guideline that informs grouping decisions, not a hard constraint. Functional cohesion SHALL take priority over line-count targets when the two conflict.

#### Scenario: Typical grouping produces target-sized PRs

- **WHEN** requirements are grouped into stories
- **THEN** each story SHOULD contain enough requirements to produce a PR in the 200-500 line range
- **AND** the skill SHALL NOT split functionally cohesive requirements across stories solely to meet the line-count target

#### Scenario: Small spec may produce smaller PRs

- **WHEN** a spec contains 4 or fewer requirements
- **THEN** the resulting stories MAY produce PRs smaller than 200 lines
- **AND** this is acceptable because the spec itself is small

#### Scenario: Large single requirement

- **WHEN** a single requirement is expected to produce more than 500 lines of code
- **THEN** the skill SHALL keep that requirement in a single story rather than artificially splitting it
- **AND** the skill MAY note in the story body that the PR may exceed the typical size target

### Requirement: Grouping Heuristics

The `/sdd:plan` skill SHALL apply the following heuristics when grouping requirements into stories. These are guiding principles for AI judgement, not a deterministic algorithm.

#### Scenario: Functional area cohesion

- **WHEN** grouping requirements into stories
- **THEN** the skill SHALL cluster requirements that affect the same functional area of the system (e.g., "data model", "API endpoints", "validation and error handling", "configuration and setup")
- **AND** each story SHOULD have a clear, descriptive title reflecting its functional area

#### Scenario: Coupled requirements stay together

- **WHEN** two or more requirements modify the same files, share data structures, or have tight implementation dependencies
- **THEN** the skill SHALL place those requirements in the same story to avoid merge conflicts between parallel workers

#### Scenario: Dependency chain ordering

- **WHEN** requirements have logical dependencies (e.g., a "setup" requirement must be implemented before "core logic" requirements)
- **THEN** the skill SHALL place prerequisite requirements in earlier stories and dependent requirements in later stories
- **AND** the skill SHALL set up dependency relationships between stories using the tracker's native features so that workers process them in the correct order

### Requirement: Branch Naming

Branch naming SHALL apply per story, not per requirement. Each story SHALL have one branch following the existing naming convention from SPEC-0007 and ADR-0009.

#### Scenario: Story branch creation

- **WHEN** the skill creates a story issue and the `--no-branches` flag is not set
- **THEN** the issue body SHALL include a `### Branch` section with `feature/{issue-number}-{story-slug}` where `{story-slug}` is derived from the story title using the existing slug derivation rules (kebab-case, max 50 chars)

#### Scenario: Branch naming format unchanged

- **WHEN** deriving a branch name for a story
- **THEN** the skill SHALL use the same slug derivation algorithm as SPEC-0007: lowercase, replace non-alphanumeric characters with hyphens, collapse consecutive hyphens, trim to 50 characters, strip trailing hyphens
- **AND** the same `--branch-prefix` and `--no-branches` flags from SPEC-0007 SHALL apply to story branches

### Requirement: Backward Compatibility

The `/sdd:plan` skill SHALL preserve all existing behavior for tracker detection, preference persistence, project grouping, and PR conventions. Only the issue granularity changes from per-requirement to per-story.

#### Scenario: Tracker detection unchanged

- **WHEN** the skill detects available trackers
- **THEN** the detection logic SHALL remain identical to SPEC-0007: check `.claude-plugin-design.json` for saved preference, probe for MCP tools via `ToolSearch`, check CLI availability, and follow the same selection flow

#### Scenario: Project grouping unchanged

- **WHEN** the skill creates stories and organizes them into projects
- **THEN** the project grouping behavior SHALL remain identical to SPEC-0007: one project per epic by default, `--project <name>` for a single combined project, `--no-projects` to skip
- **AND** story issues SHALL be added to the project alongside the epic, replacing the per-requirement task issues

#### Scenario: PR convention sections still present

- **WHEN** the skill creates story issue bodies (and `--no-branches` is not set)
- **THEN** the `### PR Convention` section SHALL still be included with tracker-specific close keywords referencing the story issue number
- **AND** the format SHALL match SPEC-0007 (e.g., `Closes #{story-issue-number}` for GitHub/Gitea)

#### Scenario: Preference persistence unchanged

- **WHEN** the skill reads or writes `.claude-plugin-design.json`
- **THEN** the schema and merge behavior SHALL remain identical to SPEC-0007
- **AND** no new keys are required in `.claude-plugin-design.json` for story-sized issue support

#### Scenario: Review mode unchanged

- **WHEN** the user runs `/sdd:plan SPEC-XXXX --review`
- **THEN** the team review flow SHALL remain identical to SPEC-0007, but the reviewer SHALL verify that story groupings are functionally cohesive and that every requirement appears in exactly one story's task checklist

#### Scenario: tasks.md fallback unchanged

- **WHEN** no tracker is detected
- **THEN** the `tasks.md` fallback SHALL still be generated following the format from SPEC-0007
- **AND** the fallback MAY group tasks by functional area to mirror the story-sized approach, but this is not required

### Requirement: Task Checklist Format

The task checklist format SHALL include structured information about each requirement to maintain traceability from story to spec.

#### Scenario: Checklist item format for markdown-based trackers

- **WHEN** generating a task checklist item for GitHub, Gitea, GitLab, Jira, or Linear
- **THEN** each item SHALL follow this format:
  ```markdown
  - [ ] **REQ "{Requirement Name}"** (SPEC-XXXX): {normative statement from the requirement}
    - WHEN {trigger from key scenario} THEN {expected outcome}
    - WHEN {trigger from another scenario} THEN {expected outcome}
  ```
- **AND** the requirement name SHALL match the `### Requirement:` heading in the spec exactly
- **AND** the SPEC reference SHALL use the spec's number (e.g., `SPEC-0010`)
- **AND** WHEN/THEN pairs SHALL be derived from the requirement's scenarios, not invented

#### Scenario: Checklist item format for Beads subtasks

- **WHEN** generating subtasks for a Beads story
- **THEN** each subtask SHALL be titled with the requirement name and its body SHALL include the normative statement and WHEN/THEN scenarios
- **AND** the subtask body SHALL reference the spec number

### Requirement: Epic Preservation

The `/sdd:plan` skill SHALL continue creating one epic per spec. Stories are children of the epic, replacing the per-requirement tasks that were previously children of the epic.

#### Scenario: Epic creation unchanged

- **WHEN** the skill begins creating issues for a spec
- **THEN** it SHALL first create an epic titled "Implement {Capability Title}" with a body referencing the spec number and linking to the spec and design files
- **AND** the epic format SHALL be identical to SPEC-0007

#### Scenario: Stories as epic children

- **WHEN** the skill creates story issues
- **THEN** each story SHALL be created as a child of the epic, using the same parent-child mechanism as SPEC-0007 used for per-requirement tasks
- **AND** the story title SHALL reflect the functional area (e.g., "Setup & Configuration", "Core Auth Flow", "Validation & Error Handling")

### Requirement: Downstream Compatibility

Story-sized issues SHALL be consumable by `/sdd:work` and `/sdd:review` without requiring modifications to those skills' core logic.

#### Scenario: Work skill consumption

- **WHEN** `/sdd:work` picks up a story issue
- **THEN** the worker SHALL implement all requirements listed in the story's task checklist within a single worktree
- **AND** the worker SHALL create one PR per story, using the branch name from the `### Branch` section
- **AND** the worker SHALL leave `// Governing: SPEC-XXXX REQ "{Requirement Name}"` comments for each requirement it implements
- **AND** the existing `/sdd:work` filtering rules (skip epics, require `### Branch` sections, extract PR conventions) SHALL continue to work because story issues have the same structural sections as the per-requirement issues they replace

#### Scenario: Review skill consumption

- **WHEN** `/sdd:review` processes a PR created from a story issue
- **THEN** the reviewer SHALL evaluate whether the PR satisfies all requirements listed in the story's task checklist
- **AND** the existing PR discovery and review flow SHALL work without modification because story PRs use the same branch naming convention and PR format as per-requirement PRs
