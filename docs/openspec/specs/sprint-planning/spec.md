---
implements: [ADR-0008]
---

# SPEC-0007: Sprint Planning

## Overview

A standalone skill that resolves an existing specification, detects the user's issue tracker, and decomposes spec requirements into trackable work items (epics, tasks, sub-tasks). Supports six trackers (Beads, GitHub, GitLab, Gitea, Jira, Linear), persists tracker preferences to `.claude-plugin-design.json`, and falls back to `tasks.md` generation when no tracker is available. See ADR-0008.

## Requirements

### Requirement: Spec Resolution

The `/sdd:plan` skill SHALL accept a spec identifier as its primary argument. The identifier MAY be a SPEC number (e.g., `SPEC-0003`) or a capability directory name (e.g., `web-dashboard`). The skill MUST resolve the identifier to the corresponding spec directory under `docs/openspec/specs/`.

#### Scenario: Resolution by SPEC number

- **WHEN** a user runs `/sdd:plan SPEC-0003`
- **THEN** the skill SHALL scan `docs/openspec/specs/*/spec.md` for a file whose title contains `SPEC-0003` and use the containing directory

#### Scenario: Resolution by capability name

- **WHEN** a user runs `/sdd:plan web-dashboard`
- **THEN** the skill SHALL look for `docs/openspec/specs/web-dashboard/spec.md` and use that directory

#### Scenario: No argument provided

- **WHEN** a user runs `/sdd:plan` with no spec identifier (ignoring flags)
- **THEN** the skill SHALL list all available specs by globbing `docs/openspec/specs/*/spec.md`, reading each title, and using `AskUserQuestion` to let the user choose

#### Scenario: Spec not found

- **WHEN** the provided identifier does not match any existing spec
- **THEN** the skill SHALL inform the user and suggest running `/sdd:spec` to create one

### Requirement: Spec Reading

The skill MUST read both `spec.md` and `design.md` from the resolved spec directory before creating any issues. The skill MUST NOT create issues based on partial information.

#### Scenario: Both files read

- **WHEN** the skill resolves a spec directory
- **THEN** it SHALL read both `docs/openspec/specs/{capability-name}/spec.md` and `docs/openspec/specs/{capability-name}/design.md` to understand the full scope of requirements, scenarios, and architecture

### Requirement: Tracker Detection

The skill SHALL detect the issue tracker following this strict precedence order, where each step short-circuits the next when it produces an unambiguous answer: (1) saved preference, (2) git-remote inference, (3) tooling probe, (4) `tasks.md` fallback. Step 1 is covered by the **Preference Persistence** requirement and step 4 by the **tasks.md fallback** requirement; this requirement specifies steps 2 and 3.

When step 1 finds a saved preference whose tooling is no longer available, the skill MUST skip directly to step 3 — it MUST NOT fall through to step 2. A saved Jira/Linear/Beads preference must not be silently replaced by whatever the git remote happens to point to.

**Step 2 — Git-remote inference.** When the project is a git repository, the skill SHALL run `git remote get-url origin`, parse the URL, normalize the host, and match against the host-pattern table below. A unique match MUST be used directly without prompting.

**URL parsing.** The skill MUST handle URL-style remotes (`https://`, `ssh://`, `git://`) and SSH scp-form remotes (`git@host:owner/repo.git`) with form-specific host extraction:

- **URL-style:** After the scheme `://`, strip any userinfo (everything up to and including the first `@`) — this prevents auth tokens from leaking into matches or logs. The host is the next segment up to `/` or `:`. Discard any `:port` suffix.
- **SSH scp-form:** The portion before `@` is the SSH login user (typically `git`), NOT auth credentials — discard it but do not treat it as a token. The host is between `@` and the first `:`. The path follows the first `:`.

After host extraction, the skill MUST: (a) lowercase the host and strip any trailing dot; (b) strip any trailing `.git` from the path; (c) extract `owner` and `repo` from the path. Both `owner/repo` (after the first `:` for scp form) and `/owner/repo` (after the first `/` for URL form) MUST be supported. These populate tracker-specific configuration without a follow-up prompt.

**Host matching rule.** Match the normalized host against patterns using exact-FQDN or leading-label matching, NOT substring or unanchored matching:

| Pattern | Matches | Tracker |
|---------|---------|---------|
| Host equals `github.com` | `github.com` only | GitHub |
| Host equals `gitlab.com` OR FQDN leading label is `gitlab` | `gitlab.com`, `gitlab.example.com` | GitLab |
| FQDN leading label is `gitea` | `gitea.com`, `gitea.stump.rocks`, etc. | Gitea |

**"FQDN leading label is `X`" is defined as:** split the normalized host on `.` to obtain a list of labels; match if and only if (a) the first label exactly equals `X`, and (b) the host has at least two labels (i.e., not bare `X` alone). This rule MUST be implemented by label-list comparison, NOT by regex against the full host string. Examples: `gitlab.example.com` matches; `gitlab` (single label) does not; `notgitlab.example.com` does not. A host like `gitlab.com.malicious.example` does technically match the leading-label rule — this is acceptable because (a) a developer whose `origin` points to such a host configured it themselves, (b) the tracker pick does not transmit credentials, and (c) attackers cannot register `gitlab.com` itself.

Hosts that fall through to step 3 include but are not limited to: GitHub Enterprise on a custom domain, `codeberg.org`, `git.sr.ht`, corporate forges, and any host not matching the table above. The table is a conservative whitelist — growth happens via explicit additions, not regex laxity.

Inference SHALL also fall through to step 3 when: the project is not a git repository; the project has multiple remotes pointing to different platforms and `origin`'s host does not match a known pattern (the skill MUST NOT silently use a non-`origin` remote); the project uses a non-VCS-derivable tracker (Jira, Linear, Beads).

**Step 3 — Tooling probe.** When inference does not yield an unambiguous tracker, the skill SHALL probe for available trackers via `ToolSearch` and CLI availability checks. The six supported trackers are:

1. **Beads**: Detect via `.beads/` directory in the project root or `bd --version` CLI check
2. **GitHub**: Detect via `ToolSearch` for `mcp__*github*` tools or `gh --version` CLI check
3. **GitLab**: Detect via `ToolSearch` for `mcp__*gitlab*` tools or `glab --version` CLI check
4. **Gitea**: Detect via `ToolSearch` for `mcp__*gitea*` tools
5. **Jira**: Detect via `ToolSearch` for `mcp__*jira*` tools
6. **Linear**: Detect via `ToolSearch` for `mcp__*linear*` tools

The full precedence flow is documented in `references/shared-patterns.md` § "Tracker Detection".

#### Scenario: Inferred from HTTPS GitHub origin

- **WHEN** the project's `origin` remote URL is `https://github.com/joestump/example.git` and no saved preference exists
- **THEN** the skill SHALL use GitHub as the tracker without prompting, and SHALL pre-populate `owner=joestump` and `repo=example` in the tracker configuration

#### Scenario: SSH scp-form URL parsed

- **WHEN** the project's `origin` remote URL is `git@gitea.example.com:team/repo.git`
- **THEN** the skill SHALL infer Gitea as the tracker, extract `owner=team` and `repo=repo`, and strip the trailing `.git`

#### Scenario: SSH URL form with port

- **WHEN** the project's `origin` remote URL is `ssh://git@gitlab.example.com:2222/team/repo.git`
- **THEN** the skill SHALL infer GitLab via the leading-label rule, extract `owner=team` and `repo=repo`, and ignore the port

#### Scenario: HTTPS URL with auth token stripped

- **WHEN** the project's `origin` remote URL is `https://x-access-token:TOKEN@github.com/owner/repo.git` (CI environment)
- **THEN** the skill SHALL strip the userinfo before host matching, infer GitHub from the bare host, and SHALL NOT log or save the token

#### Scenario: Substring match rejected

- **WHEN** the project's `origin` remote URL is `https://notgitlab.example.com/owner/repo.git`
- **THEN** the host matching rule SHALL reject this — the first label is `notgitlab`, not `gitlab` — and the skill SHALL fall through to step 3

#### Scenario: Remote host unknown — fall through to probe

- **WHEN** the project's `origin` remote URL is `https://corporate-forge.example.com/team/repo.git` (no host pattern match)
- **THEN** the skill SHALL fall through to step 3 (tooling probe) and detect available trackers there

#### Scenario: Codeberg falls through

- **WHEN** the project's `origin` remote URL is `https://codeberg.org/owner/repo.git`
- **THEN** the skill SHALL fall through to step 3 — codeberg.org is a Gitea-based forge but its hostname does not match the conservative whitelist

#### Scenario: Not a git repository

- **WHEN** the project root has no `.git/` directory
- **THEN** the skill SHALL skip step 2 entirely and proceed directly to step 3

#### Scenario: Multiple remotes — origin matches

- **WHEN** the project has `origin → github.com/...` and `mirror → gitea.example.com/...`
- **THEN** the skill SHALL use `origin` for inference and pick GitHub, treating `mirror` as informational only

#### Scenario: Multiple remotes — origin does not match

- **WHEN** the project has `origin → corporate-forge.example.com/...` and `mirror → github.com/...`
- **THEN** the skill SHALL fall through to step 3 — it MUST NOT silently use the `mirror` remote's GitHub host

#### Scenario: Saved tracker tooling vanished — skip step 2

- **WHEN** a saved preference names `linear` but the Linear MCP server is no longer available, and the project's `origin` remote points to `github.com`
- **THEN** the skill SHALL warn the user and skip directly to step 3 (tooling probe), NOT to step 2 — silently switching from Linear to GitHub via remote inference is not permitted

#### Scenario: Multiple trackers detected (probe step)

- **WHEN** step 2 does not produce a unique tracker and the probe in step 3 detects more than one
- **THEN** the skill SHALL use `AskUserQuestion` to let the user pick one and SHALL include an option to save the choice as the default

#### Scenario: Exactly one tracker detected (probe step)

- **WHEN** step 2 does not produce a unique tracker and the probe in step 3 detects exactly one
- **THEN** the skill SHALL use it and ask the user if they want to save it as the default

#### Scenario: No tracker detected

- **WHEN** no tracker is detected after both steps 2 and 3
- **THEN** the skill SHALL fall back to generating `tasks.md` per the tasks.md fallback requirement

### Requirement: Preference Persistence

The skill SHALL persist tracker preferences to `.claude-plugin-design.json` in the project root when the user opts in. On subsequent invocations, the skill MUST check for a saved preference before running tracker detection.

#### Scenario: Saved preference exists and tracker is available

- **WHEN** `.claude-plugin-design.json` exists with a `"tracker"` key and the saved tracker's tools are still available
- **THEN** the skill SHALL use the saved tracker and configuration directly without prompting

#### Scenario: Saved preference exists but tracker is unavailable

- **WHEN** `.claude-plugin-design.json` exists with a `"tracker"` key but the saved tracker's tools are no longer available
- **THEN** the skill SHALL warn the user ("Your saved tracker '{name}' is no longer available. Detecting other trackers...") and fall through to tracker detection

#### Scenario: Saving preference

- **WHEN** the user agrees to save their tracker choice
- **THEN** the skill SHALL write or merge into `.claude-plugin-design.json`:
  ```json
  {
    "tracker": "{tracker-name}",
    "tracker_config": {}
  }
  ```
  The `tracker_config` object SHALL store tracker-specific settings:
  - GitHub/Gitea/GitLab: `{ "owner": "...", "repo": "..." }`
  - Jira: `{ "project_key": "..." }`
  - Linear: `{ "team_id": "..." }`
  - Beads: `{}` (no extra config needed)

#### Scenario: Merging with existing .claude-plugin-design.json

- **WHEN** `.claude-plugin-design.json` already exists with other keys
- **THEN** the skill SHALL merge the tracker keys without overwriting the entire file

### Requirement: Issue Creation Flow

The skill SHALL create issues following an epic-to-task-to-sub-task hierarchy derived from the spec's requirements.

#### Scenario: Epic creation

- **WHEN** the skill begins creating issues for a spec
- **THEN** it SHALL first create an epic (or tracker equivalent) titled "Implement {Capability Title}" with a body referencing the spec number and linking to the spec and design files

#### Scenario: Task creation from requirements

- **WHEN** the spec contains `### Requirement:` sections
- **THEN** the skill SHALL create one task per requirement as a child of the epic, with the requirement name as the title

#### Scenario: Acceptance criteria

- **WHEN** a task is created for a requirement
- **THEN** the task body MUST include acceptance criteria derived from the requirement's WHEN/THEN scenarios in the format:
  ```
  ## Acceptance Criteria
  - [ ] Per SPEC-XXXX REQ "Requirement Name": {normative statement}
  - [ ] Per SPEC-XXXX Scenario "Scenario Name": WHEN {trigger} THEN {outcome}
  - [ ] Governing: ADR-XXXX ({decision title})
  ```

#### Scenario: Sub-task creation for complex requirements

- **WHEN** a requirement has three or more scenarios
- **THEN** the skill MAY create sub-tasks for individual scenarios as children of the requirement task

#### Scenario: Dependency ordering

- **WHEN** requirements have logical ordering (setup before implementation, core before extensions)
- **THEN** the skill SHALL set up dependency relationships using the tracker's native features

### Requirement: Project Grouping

The `/sdd:plan` skill SHALL organize created issues into tracker-native projects. The default behavior SHALL be one project per epic. The user MAY override this behavior with flags or `.claude-plugin-design.json` configuration. See ADR-0009.

#### Scenario: Default project grouping (one project per epic)

- **WHEN** the skill creates an epic and its associated tasks
- **THEN** the skill SHALL create a tracker-native project named after the epic title and SHALL add the epic and all child tasks to that project

#### Scenario: Single combined project via `--project` flag

- **WHEN** the user runs `/sdd:plan SPEC-XXXX --project "Q1 Sprint"`
- **THEN** the skill SHALL create or locate a project with the specified name and SHALL add all created issues (epics, tasks, sub-tasks) to that single project

#### Scenario: Skip project creation via `--no-projects` flag

- **WHEN** the user runs `/sdd:plan SPEC-XXXX --no-projects`
- **THEN** the skill SHALL skip project creation entirely and SHALL NOT attempt to group issues into any project

#### Scenario: Tracker without project support

- **WHEN** the detected tracker does not support native projects (or the project API is unavailable)
- **THEN** the skill SHALL skip project creation, log a note in the planning report ("Project grouping skipped: {tracker} does not support projects"), and continue with issue creation

### Requirement: Branch Naming Conventions

The `/sdd:plan` skill SHALL include a "Branch" section in each created issue's body with a recommended branch name. Branch names SHALL follow a deterministic pattern derived from the issue number and a slug. See ADR-0009.

#### Scenario: Default branch names for tasks and epics

- **WHEN** the skill creates a task issue with number `{N}` for a requirement named `{name}`
- **THEN** the issue body SHALL include a Branch section with `feature/{N}-{slug}` where `{slug}` is the kebab-case form of `{name}`
- **AND WHEN** the skill creates an epic issue with number `{N}` for a capability named `{name}`
- **THEN** the issue body SHALL include a Branch section with `epic/{N}-{slug}`

#### Scenario: Custom branch prefix via `--branch-prefix` or `.claude-plugin-design.json`

- **WHEN** the user provides `--branch-prefix work/` on the command line or has `"branches": { "prefix": "work/" }` in `.claude-plugin-design.json`
- **THEN** the skill SHALL use the custom prefix instead of `feature/` for tasks (epics SHALL still use `epic/`)
- **AND** command-line flags SHALL take precedence over `.claude-plugin-design.json` values

#### Scenario: Omit branch sections via `--no-branches`

- **WHEN** the user runs `/sdd:plan SPEC-XXXX --no-branches`
- **THEN** the skill SHALL omit the Branch section and the PR Convention section from all created issue bodies

#### Scenario: Slug derivation

- **WHEN** deriving a slug from a requirement or epic name
- **THEN** the skill SHALL convert the name to lowercase, replace non-alphanumeric characters with hyphens, collapse consecutive hyphens, trim to a maximum of 50 characters, and strip trailing hyphens

#### Scenario: Issue number required for branch names (two-pass creation)

- **WHEN** the skill creates an issue that needs a branch name in its body
- **THEN** the skill SHALL first create the issue with core content (title, acceptance criteria), obtain the issue number from the tracker's response, and then update the issue body to add the Branch and PR Convention sections referencing that number

### Requirement: PR Conventions

The `/sdd:plan` skill SHALL include a "PR Convention" section in each created issue's body with tracker-specific close keywords. The close keywords SHALL automatically resolve the issue when the PR/MR is merged. See ADR-0009.

#### Scenario: GitHub and Gitea PR conventions

- **WHEN** the detected tracker is GitHub or Gitea
- **THEN** the PR Convention section SHALL contain `Closes #{issue-number}` and SHALL reference the parent epic and governing spec (e.g., "Part of #{epic-number} | SPEC-XXXX")

#### Scenario: GitLab MR conventions

- **WHEN** the detected tracker is GitLab
- **THEN** the PR Convention section SHALL contain `Closes #{issue-number}` formatted for inclusion in the MR description

#### Scenario: Beads conventions

- **WHEN** the detected tracker is Beads
- **THEN** the PR Convention section SHALL contain `bd resolve` as the close command

#### Scenario: Jira and Linear conventions

- **WHEN** the detected tracker is Jira or Linear
- **THEN** the PR Convention section SHALL contain the tracker-native key reference format (e.g., Jira issue key `PROJ-123`, Linear issue identifier) for auto-linking and resolution

### Requirement: Tasks.md Fallback

When no issue tracker is detected, the skill SHALL generate a `tasks.md` file at `docs/openspec/specs/{capability-name}/tasks.md`, co-located with `spec.md` and `design.md`. The file MUST follow the format specified in SPEC-0006.

#### Scenario: Fallback file generation

- **WHEN** no tracker is detected and the skill falls back to `tasks.md`
- **THEN** the skill SHALL generate `docs/openspec/specs/{capability-name}/tasks.md` with tasks derived from spec requirements, using numbered section headings and checkbox format

#### Scenario: Fallback task format

- **WHEN** `tasks.md` is generated
- **THEN** every task SHALL be a checkbox item matching `- [ ] X.Y Task description` and SHALL reference the governing requirement

### Requirement: Review Mode

When the `--review` flag is present, the skill SHALL spawn a planning team for peer review of the issue breakdown.

#### Scenario: Team creation

- **WHEN** the user runs `/sdd:plan SPEC-XXXX --review`
- **THEN** the skill SHALL create a team with a planner agent and a reviewer agent using `TeamCreate`

#### Scenario: Reviewer validation

- **WHEN** the reviewer receives the issue breakdown
- **THEN** the reviewer SHALL verify that every spec requirement has at least one corresponding issue, acceptance criteria correctly reference WHEN/THEN scenarios, dependency ordering is logical, and issue scope is session-sized

#### Scenario: Revision rounds

- **WHEN** the reviewer requests revisions
- **THEN** a maximum of 2 revision rounds SHALL be allowed, after which the reviewer approves with noted concerns

#### Scenario: TeamCreate failure

- **WHEN** `TeamCreate` fails
- **THEN** the skill SHALL fall back to single-agent mode and proceed without review

### Requirement: Planning Report

After creating issues (or generating `tasks.md`), the skill SHALL present a summary to the user.

#### Scenario: Report contents

- **WHEN** planning is complete
- **THEN** the skill SHALL report: which tracker was used (or tasks.md fallback), the number of epics, tasks, and sub-tasks created, where the user can find them, and a suggestion to run `/sdd:prime` before starting implementation

### Requirement: Tracker-Specific Configuration

When a tracker requires configuration not already saved in `.claude-plugin-design.json` (e.g., repo owner/name for GitHub, project key for Jira), the skill SHALL use `AskUserQuestion` to gather it. The skill SHALL offer to save the configuration to `.claude-plugin-design.json`.

#### Scenario: GitHub/GitLab/Gitea config needed

- **WHEN** GitHub, GitLab, or Gitea is selected and no `owner`/`repo` config is saved
- **THEN** the skill SHALL ask the user for the repository owner and name

#### Scenario: Jira config needed

- **WHEN** Jira is selected and no `project_key` config is saved
- **THEN** the skill SHALL ask the user for the Jira project key

#### Scenario: Linear config needed

- **WHEN** Linear is selected and no `team_id` config is saved
- **THEN** the skill SHALL ask the user for the Linear team ID

### Requirement: Gap Analysis Mode (Proposed)

This requirement is OPTIONAL and describes a future capability.

When invoked as `/sdd:plan SPEC-XXXX --gaps`, the skill MAY read the spec's requirements, scan the codebase for implementation, and identify requirements that are unimplemented or partially implemented. The skill MAY then create issues for the gaps found.

#### Scenario: Gap analysis invocation

- **WHEN** a user runs `/sdd:plan SPEC-0003 --gaps`
- **THEN** the skill MAY read the spec requirements, scan the codebase for implementations matching each requirement, and report which requirements lack implementation

#### Scenario: Gap issue creation

- **WHEN** gaps are identified
- **THEN** the skill MAY create issues only for unimplemented or partially implemented requirements, rather than for all requirements

### Requirement: Code Quality Analysis Mode (Proposed)

This requirement is OPTIONAL and describes a future capability.

When invoked as `/sdd:plan --analyze` (no spec argument required), the skill MAY scan the codebase for DRY violations, dead code, untested code paths, and security issues, and create issues for findings.

#### Scenario: Code quality invocation

- **WHEN** a user runs `/sdd:plan --analyze`
- **THEN** the skill MAY scan the codebase without requiring a spec argument and identify DRY violations, dead code, untested paths, and security issues

#### Scenario: Code quality issue creation

- **WHEN** code quality issues are identified
- **THEN** the skill MAY create issues categorized by type (DRY, dead code, untested, security) with evidence from the codebase
