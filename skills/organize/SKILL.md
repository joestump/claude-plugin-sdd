---
name: organize
description: Retroactively group existing issues into tracker-native projects. Use when the user says "organize issues", "group issues into projects", or wants to create project boards for existing sprint issues.
allowed-tools: Read, Glob, Grep, Bash, Write, Edit, ToolSearch, AskUserQuestion
argument-hint: [SPEC-XXXX or spec-name] [--project <name>] [--dry-run] [--module <name>]
---

<!-- Governing: ADR-0015 (Markdown-Native Configuration), SPEC-0014 REQ "Config Resolution Pattern" -->

# Organize Issues into Projects

You are retroactively grouping existing tracker issues into tracker-native projects and enriching project workspaces. You use a three-tier intervention model that lets the operator control how invasive the changes are. See ADR-0012 and SPEC-0011.

## Process

<!-- Governing: ADR-0016 (Workspace Mode), SPEC-0014 REQ "Artifact Path Resolution" -->

0. **Resolve artifact paths**: Follow the **Artifact Path Resolution** pattern from `references/shared-patterns.md` to determine the spec directory. If `$ARGUMENTS` contains `--module <name>`, resolve paths relative to that module. The resolved spec directory is `{spec-dir}`.

1. **Parse arguments**: Extract from `$ARGUMENTS`:
   - Spec identifier: a SPEC number (e.g., `SPEC-0007`) or capability directory name
   - `--project <name>`: Use a single combined project with this name for all issues
   - `--dry-run`: Preview what would be created without making changes

   If no spec identifier is provided, list available specs by globbing `{spec-dir}/*/spec.md`, read the title from each, and use `AskUserQuestion` to ask which spec to organize.

2. **Resolve spec**: Follow the plugin's `references/shared-patterns.md` § "Spec Resolution" (which uses `{spec-dir}` from the Artifact Path Resolution pattern).

3. **Read spec**: Read `{spec-dir}/{capability-name}/spec.md` and `design.md` to understand the spec number, requirement names, and architecture.

4. **Detect tracker**: Follow the "Config Resolution" and "Tracker Detection" flows in the plugin's `references/shared-patterns.md`. Also read `Projects` settings from the `### Design Plugin Configuration` section in CLAUDE.md for cached project IDs and enrichment config (Views, Columns, Iteration Weeks). If no tracker is found, error — projects require a tracker.

5. **Find existing issues**: Search the tracker for issues whose body references the spec number.
   - **GitHub**: `gh issue list --search "SPEC-XXXX" --json number,title,body,labels --limit 100`
   - **Gitea**: Use MCP tools (use `ToolSearch` to discover `list_repo_issues` or similar)
   - **GitLab**: Use MCP tools or `glab issue list --search "SPEC-XXXX"`
   - **Jira**: Use MCP tools to search issues with JQL containing the spec number
   - **Linear**: Use MCP tools to search issues containing the spec number
   - **Beads**: No-op — Beads epics ARE the grouping, so inform the user and exit

6. **Identify epics vs stories**: Classify each found issue:
   - **Epics**: Issues with titles starting with "Implement " or that have an `epic` label
   - **Stories**: All other issues referencing the spec

7. **Assess project state** (Governing: SPEC-0011 REQ "Organize Three-Tier Intervention"):

   For each project (existing or to-be-created), assess its current state:
   - Does the project exist? Is it linked to the repository?
   - Does it have a description? A README?
   - Does it have named views (GitHub: All Work, Board, Roadmap)?
   - Does it have an iteration/Sprint field (GitHub)?
   - Does it have board columns (Gitea: Todo, In Progress, In Review, Done)?
   - Does it have milestones for epics (Gitea)?
   - Are native dependency links set (Gitea)?
   - Are all issues correctly grouped and labeled?
   - Are `### Branch` and `### PR Convention` sections present in issue bodies?

   Present findings to the operator and offer **three intervention tiers** via `AskUserQuestion`:

   **(a) Leave as-is**: Report the current state and exit. No changes made.

   **(b) Restructure workspace only**: Add/fix project-level structure without touching any issues:
   - Create project if missing, link to repository
   - Add/update project description and README
   - Create/rename named views (GitHub)
   - Add iteration field (GitHub)
   - Create board columns (Gitea)
   - Create milestones (Gitea)
   - Add all issues to the project (if not already)

   **(c) Complete refactor**: All tier (b) changes PLUS:
   - Re-group issues across epics (move misplaced stories)
   - Fix/add labels using try-then-create pattern (epic=#6E40C9, story=#1D76DB, spec=#0E8A16)
   - Create native dependency links (Gitea)
   - Update issue bodies with `### Branch` and `### PR Convention` sections (if missing)

8. **Execute chosen tier**: Carry out the selected intervention. All enrichment steps use **graceful degradation**: if a feature is unavailable for the tracker, skip and log "Skipped {step}: {tracker} does not support {feature}".

   **GitHub workspace enrichment (tier b/c):**
   - Set project description referencing the spec
   - Write project README via GraphQL (agent-navigable context with spec refs, ADR links, story index, dependencies)
   - Create "Sprint" iteration field via GraphQL with cycle length from CLAUDE.md `Projects > Iteration Weeks` (default: 2 weeks)
   - Create named views via GraphQL using CLAUDE.md `Projects > Views` (default: "All Work" table, "Board" board, "Roadmap" roadmap)

   **Gitea workspace enrichment (tier b/c):**
   - Create milestones (one per epic), assign stories to milestones
   - Configure board columns from CLAUDE.md `Projects > Columns` (default: Todo, In Progress, In Review, Done)

   **Tier (c) additional steps:**
   - Re-label issues using try-then-create pattern
   - Create Gitea native dependency links
   - Add `### Branch` / `### PR Convention` to issue bodies that lack them (same logic as `/design:enrich`)

9. **`--dry-run` mode**: If `--dry-run` is set, report the assessment and what WOULD be done at each tier, but don't modify anything.

10. **Report results**: Provide a summary:
    - Tier selected and actions taken
    - Number of projects created, enriched, or reused
    - Number of issues organized/updated
    - Skipped enrichments (graceful degradation)
    - Any failures encountered (with issue numbers)
    - Whether CLAUDE.md `Projects` section was updated with project IDs

## Config Reference

This skill reads and writes the `Projects` subsection of the `### Design Plugin Configuration` section in CLAUDE.md. See the plugin's `references/shared-patterns.md` § "Config Resolution" for the canonical format and defaults. All keys are optional with sensible defaults. When writing, merge — do not overwrite.

## Rules

- Tier (a) MUST NOT modify anything — report only
- Tier (b) MUST NOT modify issue content — only project-level structure (views, README, columns, iterations, milestones)
- Tier (c) MAY modify issue content (labels, body sections, grouping)
- MUST present the three-tier choice to the operator before making changes (Governing: SPEC-0011 REQ "Organize Three-Tier Intervention")
- MUST skip projects that already exist (idempotent)
- MUST use `ToolSearch` for project tools at runtime
- Failures MUST be reported but MUST NOT stop processing remaining issues
- MUST follow the Config Resolution pattern from `references/shared-patterns.md` to read configuration from CLAUDE.md
- MUST check CLAUDE.md `Projects` for cached project IDs before creating
- When writing config to CLAUDE.md, preserve existing keys
- MUST link created projects to the repository for trackers that support project-repository associations (e.g., GitHub Projects V2 via `gh project link`, Gitea)
- MUST use try-then-create pattern for all label applications in tier (c) (Governing: SPEC-0011 REQ "Auto-Create Labels")
- MUST degrade gracefully when tracker features are unavailable — skip and report, never fail (Governing: SPEC-0011 REQ "Graceful Degradation")
- No `--review` support (utility skill)
