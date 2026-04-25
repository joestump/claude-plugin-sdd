# claude-plugin-sdd

A Claude Code plugin for architecture governance: ADRs, specifications, sprint planning, parallel implementation, code review, and documentation generation.

## Skills

| Skill | Invoke | Description |
|-------|--------|-------------|
| **ADR** | `/sdd:adr [description] [--review]` | Create an ADR using MADR format with Mermaid diagrams |
| **Spec** | `/sdd:spec [capability] [--review]` | Create spec.md + design.md with RFC 2119 requirements and Mermaid diagrams |
| **Init** | `/sdd:init` | Set up CLAUDE.md with architecture context for design-aware sessions |
| **Prime** | `/sdd:prime [topic]` | Load ADR and spec context into the session, optionally filtered by topic |
| **Check** | `/sdd:check [target]` | Quick-check code against ADRs and specs for drift |
| **Audit** | `/sdd:audit [scope] [--review] [--scrum]` | Comprehensive drift audit; use `--scrum` for team-triaged findings grouped into prioritized remediation themes |
| **Docs** | `/sdd:docs [project name]` | Generate docs with scaffold/integration modes and manifest-based upgrades |
| **List** | `/sdd:list [adr\|spec\|all]` | List all ADRs and specs with their status |
| **Discover** | `/sdd:discover [scope]` | Discover implicit architecture from an existing codebase |
| **Plan** | `/sdd:plan [spec-name or SPEC-XXXX] [--scrum] [--review] [--project <name>] [--no-projects] [--branch-prefix <prefix>] [--no-branches]` | Break a spec into trackable issues; use `--scrum` for a full team-groomed ceremony with spec audit, multi-agent grooming, and automatic organize + enrich |
| **Organize** | `/sdd:organize [SPEC-XXXX or spec-name] [--project <name>] [--dry-run]` | Retroactively group existing issues into tracker-native projects |
| **Enrich** | `/sdd:enrich [SPEC-XXXX or spec-name] [--branch-prefix <prefix>] [--dry-run]` | Add branch naming and PR conventions to existing issue bodies |
| **Work** | `/sdd:work [SPEC-XXXX \| issue numbers \| (empty = propose from backlog)] [--max-agents N] [--draft] [--dry-run] [--no-tests] [--module <name>]` | Pick up tracker issues and implement them in parallel using git worktrees |
| **Review** | `/sdd:review [SPEC-XXXX or PR numbers] [--pairs N] [--no-merge] [--dry-run] [--module <name>]` | Review and merge PRs using reviewer-responder agent pairs |
| **Status** | `/sdd:status [ID] [status]` | Change the status of an ADR or spec |

## Install

Add to your project's `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "claude-plugin-sdd": {
      "source": {
        "source": "github",
        "repo": "joestump/claude-plugin-sdd"
      }
    }
  },
  "enabledPlugins": {
    "sdd@claude-plugin-sdd": true
  }
}
```

Then restart Claude Code. The plugin's 15 skills will be available as `/sdd:init`, `/sdd:prime`, `/sdd:adr`, `/sdd:spec`, `/sdd:plan`, `/sdd:organize`, `/sdd:enrich`, `/sdd:work`, `/sdd:review`, `/sdd:check`, `/sdd:audit`, `/sdd:discover`, `/sdd:docs`, `/sdd:list`, and `/sdd:status`.

## Configuration

All configuration lives in your project's `CLAUDE.md` under a `### SDD Configuration` section. No separate JSON config files are needed -- skills read and write configuration as markdown, keeping everything in one place.

Run `/sdd:init` to set up the initial configuration, or add it manually:

```markdown
### SDD Configuration

#### Tracker
- **Type**: github
- **Owner**: your-org
- **Repo**: your-project

#### Branch Conventions
- **Enabled**: true
- **Prefix**: feature
- **Epic Prefix**: epic
- **Slug Max Length**: 50

#### PR Conventions
- **Enabled**: true
- **Close Keyword**: Closes
- **Ref Keyword**: Part of
- **Include Spec Reference**: true

#### Worktrees
- **Base Dir**: .claude/worktrees/
- **Max Agents**: 4
- **Auto Cleanup**: false
- **PR Mode**: ready

#### Review
- **Max Pairs**: 2
- **Merge Strategy**: squash
- **Auto Cleanup**: false

#### Projects
- **Default Mode**: per-epic
- **Views**: All Work, Board, Roadmap
- **Columns**: Todo, In Progress, In Review, Done
- **Iteration Weeks**: 2
```

All sections and keys are optional. Missing keys use sensible defaults. The tracker preference is saved automatically when you first use `/sdd:plan`.

### Parallel Agent Tuning

Two additional top-level keys control parallel agent behavior:

```markdown
## SDD Configuration

- **Max parallel agents**: 4
- **Hotspot threshold**: 50%
```

- **Max parallel agents**: Caps the number of concurrent worker agents in `/sdd:work` (CLI flag `--max-agents` overrides).
- **Hotspot threshold**: Percentage of recent PRs a file must appear in to be classified as a merge-conflict hotspot (used by `/sdd:plan` to serialize stories touching hot files).

## Development

Clone the repo and run Claude Code from the project directory:

```bash
git clone https://github.com/joestump/claude-plugin-sdd.git
cd claude-plugin-sdd
claude
```

The `.claude/settings.json` in this repo registers the local directory as a marketplace and enables the plugin automatically. Any changes to skills or templates are picked up on the next Claude Code launch.

## What It Does

### `/sdd:adr` -- Architecture Decision Records

Creates ADRs using [MADR](https://adr.github.io/madr/) format:
- Sequential numbering: `ADR-0001`, `ADR-0002`, etc.
- Stored in `docs/adrs/`
- Mermaid architecture diagrams included by default
- YAML frontmatter with status, date, decision-makers
- Single-agent by default; add `--review` for team-based drafting with architect review
- Offers to add an Architecture Context section to your CLAUDE.md on first use
- After writing, suggests formalizing the decision into a spec with `/sdd:spec`

### `/sdd:spec` -- Specifications

Creates paired spec.md + design.md using [OpenSpec](https://github.com/Fission-AI/OpenSpec):
- Spec numbering: `SPEC-0001`, `SPEC-0002`, etc.
- Requirements in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119) format (MUST, SHALL, MAY, etc.)
- Scenarios with `####` headings and WHEN/THEN format
- **Security by default**: Web-facing specs include mandatory security sections (authentication, authorization, input validation, CSRF protection). Auth is required unless explicitly opted out.
- **Frontend quality standards**: Specs for UI components include accessibility requirements (WCAG compliance, keyboard navigation, screen reader support) and test scaffolding expectations
- Mermaid architecture diagrams required in design.md
- Stored in `docs/openspec/specs/{capability-name}/`
- Single-agent by default; add `--review` for team-based drafting with architect review
- After writing the spec, suggests running `/sdd:plan SPEC-XXXX` to break requirements into trackable issues

### `/sdd:plan` -- Sprint Planning

Breaks an existing specification into trackable work items in your issue tracker:
- Accepts a spec name or SPEC number (e.g., `/sdd:plan web-dashboard` or `/sdd:plan SPEC-0003`)
- Lists available specs interactively if no argument provided
- Detects available issue trackers:
  - [Beads](https://github.com/steveyegge/beads), GitHub (MCP or `gh` CLI), GitLab (MCP or `glab` CLI), Gitea (MCP or `tea` CLI), Jira (MCP), Linear (MCP)
  - Saves tracker preference to CLAUDE.md so you're not re-prompted
- Groups requirements into 3-4 story-sized issues by functional area (targeting 200-500 line PRs) with task checklists for each requirement
- **Foundation story detection**: Analyzes requirements to identify shared types, packages, and helpers needed by 2+ stories. Extracts them into dedicated `foundation`-labeled stories that merge before feature work begins, preventing duplicate implementations
- **Hotspot analysis**: Scans recent git history to identify files modified by a high percentage of PRs. Stories touching hotspot files are serialized rather than parallelized to prevent merge conflicts
- Creates an epic for the spec and stories as children with acceptance criteria referencing spec/requirement numbers
- Sets up dependency relationships between stories (including foundation → feature dependencies)
- Project grouping: creates tracker-native projects for each epic (or a single combined project with `--project`). Projects are automatically linked to the repository so they appear in the repo's Projects tab. Skip with `--no-projects`.
- Workspace enrichment: GitHub Projects get descriptions, READMEs, Sprint iteration fields, and named views; Gitea gets milestones and board columns
- Branch naming: adds `### Branch` sections to issue bodies with `feature/{issue-number}-{slug}` naming convention. Customize prefix with `--branch-prefix`, skip with `--no-branches`.
- PR conventions: adds `### PR Convention` sections with tracker-specific close keywords (e.g., `Closes #N` for GitHub)
- Auto-creates labels with try-then-create pattern when missing
- Falls back to generating `tasks.md` when no tracker is available (per ADR-0007)
- Single-agent by default; add `--review` for team-based planning with reviewer

### `/sdd:organize` -- Organize and Enrich Project Workspaces

Retroactively organizes issues and enriches project workspaces with a three-tier intervention model:
- **Tier (a) Leave as-is**: Assess project state and report — no changes made
- **Tier (b) Restructure workspace**: Add/fix project structure (views, README, columns, iterations, milestones) without touching issues
- **Tier (c) Complete refactor**: All tier (b) changes plus re-group issues, fix labels, create dependency links, add branch/PR sections
- GitHub enrichment: project description, README, Sprint iteration field, named views (All Work, Board, Roadmap)
- Gitea enrichment: milestones for epics, board columns (Todo/In Progress/In Review/Done), native dependency links
- Auto-creates labels with try-then-create pattern when missing (epic=#6E40C9, story=#1D76DB, spec=#0E8A16)
- Graceful degradation: skips unsupported features and reports, never fails
- Use `--dry-run` to preview without modifying
- No `--review` support (utility skill)

### `/sdd:enrich` -- Enrich Issues with Workflow Conventions

Retroactively adds branch naming and PR convention sections to existing issue bodies:
- Finds issues referencing a spec in your tracker
- Appends `### Branch` sections with `feature/{issue-number}-{slug}` naming
- Appends `### PR Convention` sections with tracker-specific close keywords
- Skips issues that already have these sections (idempotent)
- Use `--dry-run` to preview without modifying
- Custom branch prefix via `--branch-prefix`
- No `--review` support (utility skill)

### `/sdd:work` -- Parallel Issue Implementation

Picks up tracker issues and implements them in parallel using git worktrees:
- **No spec required**: run `/sdd:work` with no arguments to analyze the backlog, get a proposed batch of issues (biased toward unblocking dependencies and feature work), and approve before starting
- Accepts a spec number (`SPEC-0003`) to work all open issues for that spec, or specific issue numbers (`42 43 47`)
- Reads spec.md, design.md, and referenced ADRs to give workers full architecture context when a spec is available; workers rely on issue body and codebase context alone when there is no spec
- Detects tracker using CLAUDE.md preference, then auto-detection
- Filters issues: skips epics and issues without `### Branch` sections (suggests `/sdd:enrich`)
- Extracts branch names and PR conventions from issue bodies
- Creates isolated git worktrees for each issue with deterministic branch names
- Uses `TeamCreate` to spawn coordinated parallel worker agents (default 4, configurable with `--max-agents` or CLAUDE.md `max-parallel-agents`). Excess stories are queued and started as active agents complete.
- **Issue lifecycle labels**: Tracks work through `queued` → `in-progress` → `in-review` → `merged` states with automatic label transitions and dependency enforcement (blocked issues wait until dependencies reach `merged`)
- **Pre-flight PR awareness**: Before dispatching workers, builds a sibling PR manifest showing files being modified and shared types available from other PRs. Workers broadcast live updates (file claims, type creations) via `SendMessage` to prevent duplicate code and file conflicts.
- **Design document isolation**: Workers are forbidden from modifying spec files, ADR files, or root CLAUDE.md in feature PRs. Deferred updates are batched into a single post-merge design docs PR.
- **Topological merge ordering**: After all PRs are ready, computes optimal merge order based on file overlap analysis. Isolated PRs merge first, dependent PRs rebase and merge in tier order. Offers PR stacking for direct dependencies and auto-rebases after each merge.
- Workers implement changes, leave file-level `// Governing:` comments (per ADR-0020) when spec context is available, run tests, commit, push, and create PRs
- Workers assess PR size before opening: comments-only or trivially small changes (<30 lines) are bundled with additional queued issues rather than opened as standalone PRs; the lead assigns more work to the same worktree until the PR is meaningful
- Regular (non-draft) PRs by default; use `--draft` for draft PRs
- `--dry-run` previews what would happen without doing anything
- `--no-tests` skips test execution in workers
- `--module <name>` resolves artifact paths for a specific module in workspace mode
- Failed issues preserve their worktrees for manual pickup
- Falls back to single-agent sequential mode if team creation fails
- Configurable via CLAUDE.md `### SDD Configuration` section (worktrees, parallelism, hotspot threshold)

### `/sdd:review` -- PR Review and Merge

Reviews and merges PRs produced by `/sdd:work` using reviewer-responder agent pairs:
- Discovers open PRs by spec number or explicit PR numbers
- Organizes agents into reviewer-responder pairs (default 2 pairs, configurable with `--pairs`)
- **Conflict-marker CI gate**: Before any review logic, scans all PR files for unresolved merge conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`). PRs with conflict markers are rejected immediately with file paths and line numbers — zero tolerance across all file types.
- Verifies all CI/CD status checks (GitHub Actions, Gitea Actions, GitLab CI) are green before reviewing — PRs with failing checks are skipped
- Reviewers check diffs against spec acceptance criteria and ADR compliance (not just style)
- Responders address feedback by pushing fix commits and replying to review comments
- Re-verifies CI after responder pushes fixes — never merges with failing checks
- Exactly one review-response round per PR to bound compute
- Approved PRs are merged automatically (squash by default); use `--no-merge` to skip
- Automatically closes parent epics when all child stories have been merged
- Reuses existing worktrees from `/sdd:work` when available
- Adaptive pair count: reduces to 1 pair for small batches
- `--dry-run` previews which PRs would be reviewed without taking action
- `--module <name>` resolves artifact paths for a specific module in workspace mode
- Configurable via CLAUDE.md `### SDD Configuration` section (max_pairs, merge_strategy, auto_cleanup)
- Falls back to single-agent sequential mode if team creation fails

### `/sdd:init` -- Initialize SDD Plugin

Sets up your project's `CLAUDE.md` with architecture context and configures permissions:
- Creates `CLAUDE.md` if it doesn't exist, or updates the existing one
- Adds an `## Architecture Context` section with references to `docs/adrs/` and `docs/openspec/specs/`
- Adds a `### SDD Configuration` section for CLAUDE.md-native configuration (tracker, branches, worktrees, review settings)
- **Permission auto-configuration**: Updates `.claude/settings.json` to allowlist the tools needed by each skill (Bash, Read, Write, Edit, etc.) so permission prompts don't interrupt automated workflows
- Detects workspace mode (multi-module projects, git submodules) and configures module declarations
- Includes a skills reference table and a note about `/sdd:prime`
- Idempotent -- safe to re-run without duplicating content

### `/sdd:prime` -- Prime Architecture Context

Loads existing ADRs and specs into the session for architecture-aware responses:
- Summarizes all ADRs (title, status, key decision) and specs (title, status, requirement counts)
- Optional topic argument for semantic filtering (e.g., `/sdd:prime security` surfaces auth, encryption, access control decisions)
- Suggests `/sdd:init` if CLAUDE.md hasn't been set up yet
- Read-only -- never modifies any files

### `/sdd:check` -- Quick Drift Check

Fast, focused drift check on a specific target:
- Target can be a file path, directory, `ADR-XXXX`, or `SPEC-XXXX`
- Checks 3 drift categories: code vs. spec, code vs. ADR, ADR vs. spec
- Produces a concise findings table with severity levels (critical, warning, info)
- Always single-agent (no `--review` support)
- Suggests `/sdd:audit` for deeper analysis when warranted

### `/sdd:audit` -- Comprehensive Design Audit

Deep audit of design artifact alignment across the project:
- Covers all 6 drift categories: code vs. spec, code vs. ADR, ADR vs. spec, coverage gaps, stale artifacts, policy violations
- Produces a structured report with categorized findings and summary matrix
- Prioritized recommended actions ordered by severity
- Single-agent by default; add `--review` for team-based auditing with auditor and reviewer agents

### `/sdd:discover` -- Codebase Discovery

Reverse-engineers implicit architectural decisions and spec-worthy subsystems from an existing codebase:
- Analyzes dependencies, architectural patterns, project structure, and infrastructure configuration
- Uses parallel exploration agents for fast analysis of large codebases
- Produces a suggestion report with confidence levels (High/Medium/Low) and evidence citations
- Includes ready-to-use `/sdd:adr` and `/sdd:spec` commands for each suggestion
- Reads existing ADRs and specs to avoid suggesting duplicates
- Optional scope argument to limit analysis to a subdirectory or domain
- Read-only -- never creates files; you choose what to formalize

### `/sdd:docs` -- Docusaurus Documentation Site

Transforms your ADRs and specs into a polished doc site with two modes:

**Scaffold mode** (default when no existing site): Creates a standalone `docs-site/` with its own Docusaurus installation.

**Integration mode** (when an existing Docusaurus site is detected): Generates a `sync-spec-docs` build-time plugin into the existing site's `plugins/` directory, copies React components and CSS, and registers everything automatically. The plugin runs the same transforms at build time and watches for source changes during development.

**Upgrade lifecycle**: Re-running `/sdd:docs` on an already-configured project triggers a safe upgrade flow:
- A `.sdd-docs.json` manifest tracks plugin version, mode, site directory, and SHA-256 checksums of all managed files
- Unchanged files are updated silently to the latest template version
- Modified files prompt you with a diff and three choices: accept new version, keep yours, or opt out of future upgrades for that file
- Missing files are re-created from templates
- Files marked `managed: false` are permanently skipped

Features (both modes):
- RFC 2119 keyword highlighting (color-coded MUST/SHALL/MAY)
- Cross-reference linking (ADR-0001 and SPEC-NNN become clickable links)
- Mermaid diagram rendering
- Status/Date/Domain badge components
- Requirement box components with anchor links
- Consequence keyword highlighting (Good/Bad/Neutral)
- Dark mode support
- Auto-generated sidebars
- Separate spec/design pages with expandable sidebar categories
- Specs overview index with linked table of all specifications

### `/sdd:list` -- List Decisions and Specs

Lists all ADRs and specs with their status, date, and title. Filter by type with `adr`, `spec`, or `all`.

### `/sdd:status` -- Update Status

Changes the status of an ADR or spec. Valid statuses:
- **ADR**: proposed, accepted, deprecated, superseded
- **Spec**: draft, review, approved, implemented, deprecated

## Project Structure

### Scaffold mode (new docs site)

```
your-project/
├── .sdd-docs.json            # Upgrade manifest (version, checksums)
├── docs/
│   ├── adrs/                    # ADRs (created by /sdd:adr)
│   │   ├── ADR-0001-short-title.md
│   │   └── ADR-0002-short-title.md
│   └── openspec/specs/          # Specs (created by /sdd:spec)
│       └── capability-name/
│           ├── spec.md
│           └── design.md
├── docs-site/                   # Docusaurus site (created by /sdd:docs)
│   ├── package.json
│   ├── docusaurus.config.ts
│   ├── scripts/                 # Build-time transforms
│   └── src/                     # Components, CSS, data
└── docs-generated/              # Build artifact (generated by docs-site build)
    ├── index.mdx
    ├── decisions/               # Transformed ADRs
    └── specs/                   # Transformed specs
        ├── index.mdx            # Overview table with links
        ├── capability-name/     # Expandable sidebar category
        │   ├── _category_.json
        │   ├── spec.mdx
        │   └── design.mdx
        └── single-doc-spec.mdx  # Leaf item (no design.md)
```

### Integration mode (existing Docusaurus site)

```
your-project/
├── .sdd-docs.json            # Upgrade manifest (version, checksums)
├── docs/
│   ├── adrs/                    # ADRs (canonical source)
│   └── openspec/specs/          # Specs (canonical source)
└── website/                     # Your existing Docusaurus site
    ├── docusaurus.config.ts     # Plugin registered here
    ├── plugins/
    │   └── sync-spec-docs/    # Generated by /sdd:docs
    │       ├── index.js         # Docusaurus plugin entry
    │       └── lib/             # Transform scripts
    ├── src/
    │   ├── components/
    │   │   └── design-docs/     # Badge and layout components
    │   ├── css/
    │   │   └── design-docs.css  # Design-specific styles
    │   └── theme/
    │       └── MDXComponents.tsx # Component registration (merged)
    └── docs/
        └── architecture/        # Generated at build time (gitignored)
            ├── index.mdx
            ├── decisions/       # Transformed ADRs
            └── specs/           # Transformed specs
                ├── index.mdx    # Overview table with links
                └── ...          # Same structure as scaffold
```

## Workflow

1. **Setup**: `/sdd:init` to configure CLAUDE.md with architecture context
2. **Discover**: `/sdd:discover` to find implicit decisions in an existing codebase
3. **Prime**: `/sdd:prime` at the start of each session (or `/sdd:prime security` for a focused topic)
4. **Decide**: `/sdd:adr We need to choose a web framework for the admin dashboard`
5. **Review**: `/sdd:list adr` to see all decisions, `/sdd:status ADR-0001 accepted` to approve
6. **Specify**: `/sdd:spec Convert ADR-0001 to a spec` — the agent writes requirements and offers to plan a sprint
7. **Plan**: `/sdd:plan SPEC-0001` — break the spec into epics, tasks, and sub-tasks in Beads, GitHub, GitLab, Gitea, Jira, or Linear with acceptance criteria referencing spec/requirement numbers
8. **Organize & Enrich** (retroactive): `/sdd:organize SPEC-0001` to group issues into projects, `/sdd:enrich SPEC-0001` to add branch and PR conventions
9. **Build**: `/sdd:work SPEC-0001` (spec-scoped) or `/sdd:work` (propose from backlog) to implement issues in parallel using git worktrees, or `/sdd:prime` then manually work through issues
10. **Review**: `/sdd:review SPEC-0001` to review and merge PRs with spec-aware feedback, or `--no-merge` for review-only
11. **Check**: `/sdd:check src/auth/` to quick-check for drift while coding
12. **Audit**: `/sdd:audit --review` for a comprehensive design review
13. **Document**: `/sdd:docs` to generate or upgrade the docs site

For thorough team review on critical decisions, add `--review`:
- `/sdd:adr Choose a database --review`
- `/sdd:spec authentication-service --review`
- `/sdd:audit --review`

## CLAUDE.md Integration

Run `/sdd:init` to set up your project's CLAUDE.md with architecture context. This adds references to `docs/adrs/` and `docs/openspec/specs/`, a plugin skills table, and a note about `/sdd:prime`:

```markdown
## Architecture Context
- Architecture Decision Records are in `docs/adrs/`
- Specifications are in `docs/openspec/specs/`
```

## License

MIT
