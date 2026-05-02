---
implements: [ADR-0011, ADR-0012]
---

# SPEC-0011: Project Workspace Enrichment

## Overview

Enriches tracker-native projects created by `/sdd:plan` and `/sdd:organize` with navigational context, structured views, iteration fields, and sane defaults so that both LLM agents and human developers can effectively navigate and manage planned work. Formalizes ADR-0012 (Project Workspace Enrichment), which extends the project grouping capabilities of ADR-0009 and the story-sized issue granularity of ADR-0011.

## Requirements

### Requirement: GitHub Project Description and README

Projects created or managed by `/sdd:plan` and `/sdd:organize` SHALL have a short description and a README. The description SHALL be a one-liner summarizing the project scope (e.g., "Implementation of SPEC-0003: JWT Authentication"). The README SHALL be a structured navigational document written as a GitHub Project README field (not a repository file) containing spec references, governing ADRs, key files with line-number references, a story index, and dependency ordering. The README serves as project-scoped agent context, analogous to `/sdd:prime` output but limited to the project's scope.

#### Scenario: Plan creates project with README

- **WHEN** `/sdd:plan` creates a new GitHub Project for an epic
- **THEN** the project SHALL have a description set to "Implementation of {SPEC-XXXX}: {Capability Title}"
- **AND** the project SHALL have a README containing:
  - Paths to `spec.md` and `design.md` with brief summaries
  - A list of governing ADRs with titles and file paths
  - Key source files, modules, and directories relevant to the project scope
  - A story index listing all story issue numbers, titles, and branch names
  - Dependency ordering showing logical story sequencing

#### Scenario: Organize adds README to existing project

- **WHEN** `/sdd:organize` restructures an existing GitHub Project (tier b or c)
- **THEN** the skill SHALL add or replace the project README with the same structure as above, derived from the spec and its current stories

#### Scenario: README content structure

- **WHEN** the README is generated for any project
- **THEN** the README SHALL follow this template:
  ```markdown
  # {Project Title}

  ## Spec
  - **spec.md**: `docs/openspec/specs/{name}/spec.md` -- {one-line summary}
  - **design.md**: `docs/openspec/specs/{name}/design.md` -- {one-line summary}

  ## Governing ADRs
  - ADR-XXXX: {title} (`docs/adrs/ADR-XXXX-{slug}.md`)

  ## Key Files
  - `src/{path}:{line}` -- {symbol or description}

  ## Stories
  | # | Title | Branch | Status |
  |---|-------|--------|--------|
  | {number} | {title} | `feature/{number}-{slug}` | Open |

  ## Dependencies
  {number} -> {number} -> {number}
  ```

### Requirement: GitHub Project Iteration Fields

Projects created by `/sdd:plan` SHALL have an iteration field named "Sprint" with a default cycle length of 2 weeks. The cycle length SHALL be configurable via `.claude-plugin-design.json` key `projects.iteration_weeks`. Stories SHALL be assigned to iterations based on their dependency ordering: foundation stories go into Sprint 1, dependent stories into Sprint 2, and so on. The iteration field MUST be created via the GitHub Projects V2 GraphQL API (`gh api graphql`).

#### Scenario: Iteration field creation

- **WHEN** `/sdd:plan` creates a GitHub Project
- **THEN** the skill SHALL add an iteration field named "Sprint" to the project with a cycle length equal to `projects.iteration_weeks` (default: 2 weeks)
- **AND** the iteration field SHALL be created using `gh api graphql -f query='...'` with the `createProjectV2Field` mutation

#### Scenario: Story assignment to sprints

- **WHEN** stories have been created and assigned to a project with an iteration field
- **THEN** foundation stories (no dependencies) SHALL be assigned to Sprint 1
- **AND** stories that depend on Sprint 1 stories SHALL be assigned to Sprint 2
- **AND** subsequent dependency layers SHALL be assigned to incrementally later sprints

#### Scenario: Custom iteration duration

- **WHEN** `.claude-plugin-design.json` contains `"projects": { "iteration_weeks": 3 }`
- **THEN** the iteration field SHALL use a 3-week cycle length instead of the default 2-week cycle

### Requirement: GitHub Project Named Views

Projects created by `/sdd:plan` SHALL have three named views configured. The views SHALL replace the default unnamed "Table" view that GitHub creates automatically. The view names and types SHALL be configurable via `.claude-plugin-design.json` key `projects.views`. Views MUST be created via the GitHub Projects V2 GraphQL API.

#### Scenario: View creation

- **WHEN** `/sdd:plan` creates a GitHub Project
- **THEN** the skill SHALL create three named views:

| View Name | Type | Purpose |
|-----------|------|---------|
| All Work | Table/List | Default list view showing all items with status, assignee, and sprint fields |
| Board | Board | Kanban board grouped by status |
| Roadmap | Roadmap | Timeline view using the Sprint iteration field |

#### Scenario: Custom view configuration

- **WHEN** `.claude-plugin-design.json` contains `"projects": { "views": ["Backlog", "Sprint Board", "Timeline"] }`
- **THEN** the skill SHALL create views with the custom names instead of the defaults
- **AND** the view types SHALL map positionally: first = Table, second = Board, third = Roadmap

#### Scenario: Replacing default view

- **WHEN** the project has a default unnamed "Table" view created by GitHub
- **THEN** the skill SHALL rename or replace it with the first configured view (default: "All Work")

### Requirement: Gitea Project Structure

For Gitea trackers, projects created by `/sdd:plan` SHALL use milestones as epic buckets, board columns for workflow stages, and task checklists (per ADR-0011) for requirement tracking within stories. The board columns SHALL be configurable via `.claude-plugin-design.json` key `projects.columns`.

#### Scenario: Milestone creation

- **WHEN** `/sdd:plan` creates issues for a spec using the Gitea tracker
- **THEN** the skill SHALL create one Gitea milestone per epic, titled with the epic name
- **AND** all stories belonging to that epic SHALL be assigned to the corresponding milestone

#### Scenario: Column configuration

- **WHEN** `/sdd:plan` creates a Gitea project board
- **THEN** the board SHALL have four default columns: Todo, In Progress, In Review, Done
- **AND** newly created stories SHALL be placed in the "Todo" column

#### Scenario: Custom column configuration

- **WHEN** `.claude-plugin-design.json` contains `"projects": { "columns": ["Backlog", "Doing", "Review", "Shipped"] }`
- **THEN** the board SHALL use the custom column names instead of the defaults

#### Scenario: Story assignment to milestones

- **WHEN** stories are created as children of an epic
- **THEN** each story SHALL be assigned to the milestone corresponding to its parent epic
- **AND** the milestone's progress percentage SHALL reflect the ratio of closed to total stories

### Requirement: Auto-Create Labels

When any skill (`/sdd:plan`, `/sdd:organize`, `/sdd:enrich`, `/sdd:work`) attempts to apply a label to an issue that does not exist in the repository, the skill SHALL create the label with a default color before applying it. The implementation SHALL follow a try-then-create pattern to minimize API calls and avoid race conditions.

#### Scenario: Label exists

- **WHEN** a skill applies a label (e.g., `story`) that already exists in the repository
- **THEN** the label SHALL be applied directly with no additional API calls

#### Scenario: Label missing

- **WHEN** a skill applies a label that does not exist in the repository
- **AND** the tracker API returns a 404, "label not found", or equivalent error
- **THEN** the skill SHALL create the label with its default color
- **AND** the skill SHALL retry applying the label to the issue

#### Scenario: Default label colors

- **WHEN** a label is auto-created
- **THEN** the following default colors SHALL be used:

| Label | Color | Hex |
|-------|-------|-----|
| `epic` | Purple | `#6E40C9` |
| `story` | Blue | `#1D76DB` |
| `spec` | Green | `#0E8A16` |

- **AND** labels not in the default color table SHALL be created with a neutral gray (`#CCCCCC`)

#### Scenario: Cross-tracker compatibility

- **WHEN** auto-label creation is triggered on any supported tracker (GitHub, Gitea, GitLab, Jira, Linear)
- **THEN** the skill SHALL use the tracker's native label creation API
- **AND** for trackers that do not support label colors (e.g., some Jira configurations), the color SHALL be silently ignored

### Requirement: Gitea Native Dependencies

For Gitea trackers, `/sdd:plan` SHALL use Gitea's native issue dependency API (`POST /repos/{owner}/{repo}/issues/{index}/dependencies`) to express story ordering. Dependencies are directional: story A blocks story B.

#### Scenario: Dependency creation

- **WHEN** `/sdd:plan` determines that story B depends on story A (dependency ordering)
- **AND** the tracker is Gitea
- **THEN** the skill SHALL create a native dependency link where story A blocks story B using the Gitea dependency API

#### Scenario: Dependency query by /sdd:work

- **WHEN** `/sdd:work` picks up stories from a Gitea tracker
- **THEN** it SHALL be able to query dependencies via the Gitea API to determine which stories are unblocked
- **AND** it SHALL prefer stories with no unresolved dependencies

### Requirement: Organize Three-Tier Intervention

`/sdd:organize` SHALL gauge the current state of a project (missing views, no README, unstructured columns, missing dependencies) and present the operator with exactly three intervention options. The skill SHALL execute only the chosen tier.

#### Scenario: Messiness assessment

- **WHEN** `/sdd:organize` is invoked on an existing project
- **THEN** the skill SHALL assess the project for:
  - Missing or default-only views
  - Missing README
  - Missing or incomplete board columns
  - Missing iteration fields
  - Missing dependency links between stories
  - Inconsistent or missing labels
- **AND** the skill SHALL present a summary of findings before offering tier options

#### Scenario: Tier (a) -- Leave as-is

- **WHEN** the operator selects tier (a)
- **THEN** the skill SHALL report the current project state and exit without making any changes

#### Scenario: Tier (b) -- Restructure workspace

- **WHEN** the operator selects tier (b)
- **THEN** the skill SHALL add or fix views, columns, README, and iteration fields
- **AND** the skill SHALL NOT move, relabel, regroup, or modify any existing issues
- **AND** the skill SHALL report what workspace changes were made

#### Scenario: Tier (c) -- Complete refactor

- **WHEN** the operator selects tier (c)
- **THEN** the skill SHALL perform all tier (b) changes
- **AND** the skill SHALL re-group issues across epics, add or fix labels, create missing dependency links, and update issue bodies with missing sections (e.g., `### Branch`, `### PR Convention`)
- **AND** the skill SHALL report all changes made, including per-issue modifications

### Requirement: Configuration Persistence

The `.claude-plugin-design.json` file SHALL support new keys under the `projects` object for workspace enrichment configuration. All new keys SHALL be optional and backward-compatible with existing `.claude-plugin-design.json` files.

#### Scenario: Custom configuration

- **WHEN** `.claude-plugin-design.json` contains:
  ```json
  {
    "projects": {
      "views": ["Backlog", "Sprint Board", "Timeline"],
      "columns": ["Backlog", "Doing", "Review", "Shipped"],
      "iteration_weeks": 3
    }
  }
  ```
- **THEN** `/sdd:plan` SHALL use these values instead of the defaults when creating project workspaces

#### Scenario: Default values

- **WHEN** `.claude-plugin-design.json` exists but does not contain `projects.views`, `projects.columns`, or `projects.iteration_weeks`
- **THEN** the skill SHALL use the following defaults:

| Key | Default Value |
|-----|---------------|
| `projects.views` | `["All Work", "Board", "Roadmap"]` |
| `projects.columns` | `["Todo", "In Progress", "In Review", "Done"]` |
| `projects.iteration_weeks` | `2` |

#### Scenario: Backward compatibility

- **WHEN** an existing `.claude-plugin-design.json` file contains only `tracker` and `tracker_config` keys (pre-SPEC-0011 format)
- **THEN** the skill SHALL continue to function correctly, using defaults for all workspace enrichment keys
- **AND** the skill SHALL NOT overwrite or remove existing keys when merging new configuration

### Requirement: Graceful Degradation

When a tracker lacks a feature required by a workspace enrichment step (e.g., no iteration field support, no native dependencies, no project README field), the skill SHALL skip that enrichment step and report it to the user. The skill SHALL NOT fail the entire operation due to a missing tracker feature.

#### Scenario: Missing feature skipped

- **WHEN** the skill attempts to configure an iteration field on a tracker that does not support iterations (e.g., Gitea)
- **THEN** the skill SHALL skip the iteration field step
- **AND** the skill SHALL log a note: "Skipped iteration field: {tracker} does not support project iterations"
- **AND** the skill SHALL proceed with the remaining enrichment steps

#### Scenario: Partial enrichment reported

- **WHEN** one or more enrichment steps are skipped due to missing tracker features
- **THEN** the planning report SHALL include a "Skipped Enrichments" section listing each skipped step with the reason
- **AND** the report SHALL clearly distinguish between skipped (feature unavailable) and failed (error occurred) steps

#### Scenario: GraphQL API unavailable

- **WHEN** the GitHub Projects V2 GraphQL API is unavailable or returns errors
- **THEN** the skill SHALL skip view creation, iteration field creation, and README configuration
- **AND** the skill SHALL warn the user and proceed with issue creation
- **AND** project creation via `gh project create` (CLI) SHALL still be attempted
