---
implements: [ADR-0009]
---

# SPEC-0008: Retroactive Issue Management

## Overview

Two standalone skills for retroactively applying developer workflow conventions to existing tracker issues. `/sdd:organize` groups issues into tracker-native projects; `/sdd:enrich` appends branch naming and PR close-keyword sections to issue bodies. Both operate on issues previously created by `/sdd:plan` (or manually) for a given spec, without re-creating them. See ADR-0009.

## Requirements

### Requirement: Spec Resolution

Both `/sdd:organize` and `/sdd:enrich` SHALL accept a spec identifier as their primary argument. The identifier MAY be a SPEC number (e.g., `SPEC-0003`) or a capability directory name (e.g., `web-dashboard`). Resolution MUST follow the same flow as `/sdd:plan` (SPEC-0007).

#### Scenario: Resolution by SPEC number

- **WHEN** a user runs `/sdd:organize SPEC-0003` or `/sdd:enrich SPEC-0003`
- **THEN** the skill SHALL scan `docs/openspec/specs/*/spec.md` for a file whose title contains `SPEC-0003` and use the containing directory

#### Scenario: Resolution by capability name

- **WHEN** a user runs `/sdd:organize web-dashboard` or `/sdd:enrich web-dashboard`
- **THEN** the skill SHALL look for `docs/openspec/specs/web-dashboard/spec.md` and use that directory

#### Scenario: No argument provided

- **WHEN** a user runs `/sdd:organize` or `/sdd:enrich` with no spec identifier (ignoring flags)
- **THEN** the skill SHALL list all available specs by globbing `docs/openspec/specs/*/spec.md`, reading each title, and using `AskUserQuestion` to let the user choose

#### Scenario: Spec not found

- **WHEN** the provided identifier does not match any existing spec
- **THEN** the skill SHALL inform the user and suggest running `/sdd:spec` to create one

### Requirement: Tracker Detection

Both skills SHALL detect the user's issue tracker using the same detection flow as `/sdd:plan` (SPEC-0007, Requirement: Tracker Detection). Both skills MUST check `.claude-plugin-design.json` for a saved tracker preference before running detection.

#### Scenario: Saved preference available

- **WHEN** `.claude-plugin-design.json` exists with a `"tracker"` key and the tracker is still available
- **THEN** the skill SHALL use the saved tracker and configuration directly without prompting

#### Scenario: No tracker detected

- **WHEN** no tracker is detected
- **THEN** the skill SHALL inform the user that a tracker is required for retroactive management and suggest running `/sdd:plan` with `tasks.md` fallback instead

### Requirement: Issue Discovery

Both skills SHALL search the detected tracker for existing issues that reference the target spec number in their body text.

#### Scenario: GitHub issue search

- **WHEN** the tracker is GitHub
- **THEN** the skill SHALL search using `gh issue list --search "SPEC-XXXX"` with JSON output to retrieve issue number, title, body, and labels

#### Scenario: MCP-based trackers

- **WHEN** the tracker is Gitea, GitLab, Jira, or Linear
- **THEN** the skill SHALL use `ToolSearch` to discover the appropriate MCP issue-listing tools and search for issues containing the spec number

#### Scenario: Beads tracker

- **WHEN** the tracker is Beads and the skill is `/sdd:organize`
- **THEN** the skill SHALL inform the user that Beads epics are the native grouping mechanism and no project creation is needed, then exit gracefully

#### Scenario: No issues found

- **WHEN** no issues referencing the spec are found in the tracker
- **THEN** the skill SHALL inform the user and suggest running `/sdd:plan` first to create issues

### Requirement: Epic vs. Task Classification

Both skills SHALL classify discovered issues as either epics or tasks based on issue metadata.

#### Scenario: Epic by title

- **WHEN** an issue's title starts with "Implement "
- **THEN** the skill SHALL classify it as an epic

#### Scenario: Epic by label

- **WHEN** an issue has an `epic` label
- **THEN** the skill SHALL classify it as an epic

#### Scenario: Default to task

- **WHEN** an issue does not match any epic classification criteria
- **THEN** the skill SHALL classify it as a task

### Requirement: Project Grouping (organize)

The `/sdd:organize` skill SHALL create tracker-native projects and add discovered issues to them. The skill MUST NOT modify issue content -- it SHALL only create projects and manage project membership.

#### Scenario: Default per-epic grouping

- **WHEN** a user runs `/sdd:organize SPEC-XXXX` without `--project`
- **THEN** the skill SHALL create one tracker-native project per discovered epic, named after the epic, and add the epic and its associated tasks to that project

#### Scenario: Single combined project

- **WHEN** a user runs `/sdd:organize SPEC-XXXX --project "Q1 Sprint"`
- **THEN** the skill SHALL create a single project named "Q1 Sprint" and add all discovered issues (epics and tasks) to it

#### Scenario: Cached project IDs

- **WHEN** `.claude-plugin-design.json` contains a `projects.project_ids` entry for the target spec
- **THEN** the skill SHALL reuse the existing project instead of creating a new one and SHALL add any newly discovered issues to it

#### Scenario: Tracker without project support

- **WHEN** the tracker does not support projects (e.g., Beads)
- **THEN** the skill SHALL inform the user that project creation is not applicable for this tracker and exit gracefully

#### Scenario: Project creation failure

- **WHEN** project creation fails for a specific epic (e.g., API error, rate limit)
- **THEN** the skill SHALL warn the user, report the failure, and continue processing remaining epics

#### Scenario: Idempotent execution

- **WHEN** `/sdd:organize` is run multiple times for the same spec
- **THEN** the skill SHALL skip creating projects that already exist and SHALL only add issues not yet in the project

### Requirement: Branch Enrichment (enrich)

The `/sdd:enrich` skill SHALL append a `### Branch` section to issue bodies that do not already have one. The branch name MUST follow the pattern `{prefix}/{issue-number}-{slug}`.

#### Scenario: Task branch naming

- **WHEN** a task issue does not have a `### Branch` section
- **THEN** the skill SHALL append a `### Branch` section with the branch name `feature/{issue-number}-{slug}`, where the slug is derived from the issue title in kebab-case, truncated to 50 characters

#### Scenario: Epic branch naming

- **WHEN** an epic issue does not have a `### Branch` section
- **THEN** the skill SHALL append a `### Branch` section with the branch name `epic/{issue-number}-{slug}`

#### Scenario: Custom branch prefix

- **WHEN** the user passes `--branch-prefix hotfix` or `.claude-plugin-design.json` contains `branches.prefix: "hotfix"`
- **THEN** the skill SHALL use `hotfix` as the prefix instead of `feature` for task branches

#### Scenario: Branch section already exists

- **WHEN** an issue body already contains a `### Branch` section
- **THEN** the skill SHALL skip that issue's branch enrichment without modification (idempotent)

#### Scenario: Branches disabled in config

- **WHEN** `.claude-plugin-design.json` contains `branches.enabled: false`
- **THEN** the skill SHALL skip `### Branch` sections entirely and inform the user

### Requirement: PR Convention Enrichment (enrich)

The `/sdd:enrich` skill SHALL append a `### PR Convention` section to issue bodies that do not already have one. The section MUST contain the tracker-specific close keyword.

#### Scenario: GitHub/Gitea PR convention

- **WHEN** the tracker is GitHub or Gitea and the issue does not have a `### PR Convention` section
- **THEN** the skill SHALL append `Closes #{issue-number}` as the close keyword, with a reference to the parent epic and governing spec

#### Scenario: GitLab MR convention

- **WHEN** the tracker is GitLab and the issue does not have a `### PR Convention` section
- **THEN** the skill SHALL append `Closes #{issue-number}` with a note that it belongs in the MR description

#### Scenario: Beads convention

- **WHEN** the tracker is Beads and the issue does not have a `### PR Convention` section
- **THEN** the skill SHALL append `bd resolve` as the close keyword

#### Scenario: Jira/Linear convention

- **WHEN** the tracker is Jira or Linear and the issue does not have a `### PR Convention` section
- **THEN** the skill SHALL append the tracker-native key reference format as the close keyword

#### Scenario: PR convention section already exists

- **WHEN** an issue body already contains a `### PR Convention` section
- **THEN** the skill SHALL skip that issue's PR convention enrichment without modification (idempotent)

#### Scenario: PR conventions disabled in config

- **WHEN** `.claude-plugin-design.json` contains `pr_conventions.enabled: false`
- **THEN** the skill SHALL skip `### PR Convention` sections entirely and inform the user

### Requirement: Slug Derivation

Both skills SHALL derive branch slugs from issue titles using a deterministic kebab-case conversion.

#### Scenario: Standard slug conversion

- **WHEN** an issue title is "JWT Token Generation"
- **THEN** the slug SHALL be `jwt-token-generation`

#### Scenario: Special characters

- **WHEN** an issue title contains non-alphanumeric characters (e.g., "OAuth 2.0 / OIDC Integration")
- **THEN** the slug SHALL replace all non-alphanumeric characters with hyphens and collapse consecutive hyphens, producing `oauth-2-0-oidc-integration`

#### Scenario: Long titles

- **WHEN** an issue title produces a slug longer than 50 characters (or `branches.slug_max_length` from `.claude-plugin-design.json`)
- **THEN** the slug SHALL be truncated to the maximum length and trailing hyphens SHALL be stripped

### Requirement: Dry Run Mode

Both skills SHALL support a `--dry-run` flag that previews changes without modifying any tracker state.

#### Scenario: Organize dry run

- **WHEN** a user runs `/sdd:organize SPEC-XXXX --dry-run`
- **THEN** the skill SHALL list the projects that would be created, which issues would be added to each project, and whether any cached project IDs would be reused, without creating or modifying anything

#### Scenario: Enrich dry run

- **WHEN** a user runs `/sdd:enrich SPEC-XXXX --dry-run`
- **THEN** the skill SHALL show the exact `### Branch` and `### PR Convention` content that would be appended to each issue, indicate which issues would be skipped (already enriched), without modifying any issue bodies

### Requirement: Configuration Persistence

Both skills SHALL read from `.claude-plugin-design.json` for saved configuration. The `/sdd:organize` skill SHALL offer to save project IDs after successful creation. Neither skill SHALL overwrite existing `.claude-plugin-design.json` keys when writing.

#### Scenario: Organize saves project IDs

- **WHEN** `/sdd:organize` creates new projects
- **THEN** the skill SHALL offer to save the project IDs to `.claude-plugin-design.json` under `projects.project_ids` keyed by spec number

#### Scenario: Enrich reads branch config

- **WHEN** `/sdd:enrich` runs
- **THEN** the skill SHALL read `.claude-plugin-design.json` sections `branches` and `pr_conventions` for saved preferences (prefix, slug_max_length, close_keyword, ref_keyword) and apply them

#### Scenario: Merging with existing .claude-plugin-design.json

- **WHEN** `.claude-plugin-design.json` already exists with other keys
- **THEN** the skill SHALL merge without overwriting the entire file

### Requirement: Error Handling and Resilience

Both skills SHALL handle individual issue failures gracefully without stopping the entire operation.

#### Scenario: Single issue failure

- **WHEN** a tracker API call fails for a specific issue (e.g., rate limit, permission error)
- **THEN** the skill SHALL log the failure with the issue number and error details, skip that issue, and continue processing remaining issues

#### Scenario: Tracker API unavailable

- **WHEN** the tracker API becomes completely unavailable during processing
- **THEN** the skill SHALL report which issues were successfully processed and which were not, then exit with a clear error message

### Requirement: Reporting

Both skills SHALL produce a summary report after execution.

#### Scenario: Organize report

- **WHEN** `/sdd:organize` completes
- **THEN** the skill SHALL report: number of projects created (or reused), number of issues organized into projects, any failures with issue numbers, and whether `.claude-plugin-design.json` was updated

#### Scenario: Enrich report

- **WHEN** `/sdd:enrich` completes
- **THEN** the skill SHALL report: number of issues enriched (with breakdown of `### Branch` vs `### PR Convention`), number of issues skipped (already had sections), and any failures with issue numbers and error details
