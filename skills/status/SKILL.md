---
name: status
description: Change the status of an ADR or spec (e.g., proposed to accepted, draft to review). Use when the user says "accept ADR", "approve the spec", "mark as accepted", or wants to update decision status.
allowed-tools: Read, Write, Edit, Glob, Grep, AskUserQuestion
argument-hint: [ADR-XXXX or SPEC-XXXX] [new status] [--module <name>]
disable-model-invocation: true
---

# Change ADR or Spec Status

Update the status field in the YAML frontmatter of an ADR or spec file.

## Process

<!-- Governing: ADR-0016 (Workspace Mode), SPEC-0014 REQ "Artifact Path Resolution" -->

0. **Resolve artifact paths**: Follow the **Artifact Path Resolution** pattern from `references/shared-patterns.md` to determine the ADR and spec directories. If `$ARGUMENTS` contains `--module <name>`, resolve paths relative to that module; otherwise, in a workspace, aggregate across all modules. The resolved ADR directory is `{adr-dir}` and spec directory is `{spec-dir}`.

1. **Parse arguments**: Extract the identifier and new status from `$ARGUMENTS`.
   - Identifier: `ADR-XXXX` or `SPEC-XXXX` (or a capability name for specs)
   - Status: the new status value

2. **If identifier is missing**: Scan for available ADRs and specs (using `{adr-dir}` and `{spec-dir}`), present a list with current statuses, and use `AskUserQuestion` to ask which to update.

3. **If status is missing**: Show the current status and use `AskUserQuestion` to ask what to change it to. Show valid options:
   - ADR statuses: `proposed`, `accepted`, `deprecated`, `superseded`
   - Spec statuses: `draft`, `review`, `approved`, `implemented`, `deprecated`

4. **Locate the file**:
   - For ADRs: Glob `{adr-dir}/ADR-{number}-*.md` to find the matching file
   - For SPECs: Glob `{spec-dir}/*/spec.md` and search for the matching SPEC number in the heading

5. **Update the frontmatter**: Edit the `status:` field in the YAML frontmatter to the new value. If no frontmatter exists, add one with the status field.

6. **Report the change**: Tell the user what changed, e.g., "Updated ADR-0003 status: proposed -> accepted"

## Rules

- Valid ADR statuses: `proposed`, `accepted`, `deprecated`, `superseded`
- Valid spec statuses: `draft`, `review`, `approved`, `implemented`, `deprecated`
- If the user provides an invalid status, show the valid options and ask again
- Do not modify any content outside the YAML frontmatter
- If the file has no YAML frontmatter, add `---\nstatus: {value}\n---\n` at the top
