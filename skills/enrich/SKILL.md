---
name: enrich
description: Retroactively add branch naming and PR convention sections to existing issue bodies. Use when the user says "add branch names to issues", "enrich issues", or wants to add developer workflow conventions to existing issues.
allowed-tools: Read, Glob, Grep, Bash, Write, Edit, ToolSearch, AskUserQuestion
argument-hint: [SPEC-XXXX or spec-name] [--branch-prefix <prefix>] [--dry-run] [--module <name>]
---

<!-- Governing: ADR-0015 (Markdown-Native Configuration), SPEC-0014 REQ "Config Resolution Pattern" -->

# Enrich Issues with Developer Workflow Conventions

You are retroactively adding `### Branch` and `### PR Convention` sections to existing tracker issues that were created by `/design:plan` (or manually) for a given spec.

## Process

<!-- Governing: ADR-0016 (Workspace Mode), SPEC-0014 REQ "Artifact Path Resolution" -->

0. **Resolve artifact paths**: Follow the **Artifact Path Resolution** pattern from `references/shared-patterns.md` to determine the spec directory. If `$ARGUMENTS` contains `--module <name>`, resolve paths relative to that module. The resolved spec directory is `{spec-dir}`.

1. **Parse arguments**: Extract from `$ARGUMENTS`:
   - Spec identifier: a SPEC number (e.g., `SPEC-0007`) or capability directory name
   - `--branch-prefix <prefix>`: Custom branch prefix instead of the default `feature`/`epic` prefixes
   - `--dry-run`: Preview what would be added without modifying any issues

   If no spec identifier is provided, list available specs by globbing `{spec-dir}/*/spec.md`, read the title from each, and use `AskUserQuestion` to ask which spec to enrich.

2. **Resolve spec**: Follow the plugin's `references/shared-patterns.md` § "Spec Resolution" (which uses `{spec-dir}` from the Artifact Path Resolution pattern).

3. **Read spec**: Read `{spec-dir}/{capability-name}/spec.md` to get the spec number and understand the requirements.

4. **Detect tracker**: Follow the "Tracker Detection" flow in the plugin's `references/shared-patterns.md`. If no tracker is found, error — enrichment requires a tracker.

5. **Read branch/PR config from CLAUDE.md**: Follow the "Config Resolution" pattern in the plugin's `references/shared-patterns.md`. Read the `### Design Plugin Configuration` section from CLAUDE.md, specifically the `#### Branch Conventions` and `#### PR Conventions` subsections:

   ```markdown
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
   ```

   - If `Enabled` under Branch Conventions is `false`, skip `### Branch` sections entirely
   - If `Enabled` under PR Conventions is `false`, skip `### PR Convention` sections entirely
   - Use `Prefix` from Branch Conventions as the default task prefix (overridden by `--branch-prefix`)
   - Use `Epic Prefix` from Branch Conventions for epic issues (default: `epic`)
   - Use `Slug Max Length` from Branch Conventions for slug truncation (default: 50)
   - Use `Close Keyword` from PR Conventions if set; otherwise use tracker-specific defaults
   - Use `Ref Keyword` from PR Conventions for epic/spec references (default: "Part of")

6. **Find existing issues**: Search the tracker for issues referencing the spec number.
   - **GitHub**: `gh issue list --search "SPEC-XXXX" --json number,title,body,labels --limit 100`
   - **Gitea**: Use MCP tools (discovered via `ToolSearch`)
   - **GitLab**: Use MCP tools or `glab issue list --search "SPEC-XXXX"`
   - **Jira**: Use MCP tools with JQL containing the spec number
   - **Linear**: Use MCP tools to search issues containing the spec number
   - **Beads**: Use `bd list` or similar to find tasks referencing the spec

7. **For each issue**:

   a. Read the current issue body (via tracker API or CLI).

   b. Check if a `### Branch` section already exists in the body. If yes, skip adding it (idempotent).

   c. Check if a `### PR Convention` section already exists in the body. If yes, skip adding it (idempotent).

   d. Determine the slug from the issue title:
      - Convert to kebab-case (lowercase, spaces and special characters replaced with hyphens)
      - Truncate to max 50 chars (or `Slug Max Length` from CLAUDE.md `Branch Conventions`)
      - Remove trailing hyphens after truncation

   e. Determine if the issue is an epic:
      - Title starts with "Implement " → epic
      - Has an `epic` label → epic
      - Otherwise → task

   f. If `### Branch` section is missing and `branches.enabled` is not `false`, append:
      ```
      ### Branch
      `{prefix}/{issue-number}-{slug}`
      ```
      Where `{prefix}` is:
      - For epics: `epic` (or CLAUDE.md `Branch Conventions > Epic Prefix` or `--branch-prefix`)
      - For tasks: `feature` (or CLAUDE.md `Branch Conventions > Prefix` or `--branch-prefix`)

   g. If `### PR Convention` section is missing and `pr_conventions.enabled` is not `false`, append:
      ```
      ### PR Convention
      {close-keyword} #{issue-number}
      {ref-keyword} #{epic-number} (SPEC-XXXX)
      ```
      Tracker-specific close keywords: see the plugin's `references/shared-patterns.md` § "PR Close Keywords".

   h. **Auto-create labels** (Governing: SPEC-0011 REQ "Auto-Create Labels"): When applying labels like `epic` or `story` during enrichment, use the **try-then-create pattern**: attempt to apply the label, and if the tracker returns a "label not found" error, create the label with a default color (epic=#6E40C9, story=#1D76DB, spec=#0E8A16, other=#CCCCCC) and retry.

   i. Update the issue body with the appended sections using the tracker API or CLI.

8. **`--dry-run` mode**: If `--dry-run` is set, show what sections would be added to which issues but don't modify anything:
   - For each issue: show the issue number, title, and which sections would be added
   - Show the exact content that would be appended
   - Indicate issues that would be skipped (already have the sections)

9. **Report results**: Provide a summary:
   - Number of issues enriched (had sections added)
   - Number of issues skipped (already had sections)
   - Any failures encountered (with issue numbers and error details)
   - Breakdown: how many got `### Branch`, how many got `### PR Convention`

## Config Reference

This skill reads the `Branch Conventions` and `PR Conventions` subsections of the `### Design Plugin Configuration` section in CLAUDE.md. See the plugin's `references/shared-patterns.md` § "Config Resolution" for the canonical format and defaults, and § "Branch Naming Conventions" and "PR Close Keywords" for conventions.

## Rules

- MUST NOT overwrite existing `### Branch` or `### PR Convention` sections (idempotent)
- Branch slug MUST be derived from issue title (kebab-case, max 50 chars), not invented
- PR close keywords MUST match the detected tracker
- MUST use `ToolSearch` for tracker tools at runtime
- Failures on individual issues MUST be reported but MUST NOT stop processing remaining issues
- MUST follow the Config Resolution pattern from `references/shared-patterns.md` to read configuration from CLAUDE.md
- MUST use try-then-create pattern for all label applications — never fail on missing labels (Governing: SPEC-0011 REQ "Auto-Create Labels")
- No `--review` support (utility skill)
