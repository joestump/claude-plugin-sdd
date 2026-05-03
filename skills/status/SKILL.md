---
name: status
description: Change the status of an ADR or spec (e.g., proposed to accepted, draft to review). Use when the user says "accept ADR", "approve the spec", "mark as accepted", or wants to update decision status.
allowed-tools: Read, Write, Edit, Glob, Grep, AskUserQuestion
argument-hint: [ADR-XXXX or SPEC-XXXX] [new status] [--module <name>] [--keep-refinement]
disable-model-invocation: true
---

# Change ADR or Spec Status

Update the status of an ADR or spec, **preserving the file's existing status format**. Two formats exist in the wild: YAML frontmatter (canonical SDD template) and inline `- **Status:** {value}` bullets (used by legacy / hand-authored repos that predate the template). This skill detects which format is in use and edits in place — it MUST NOT silently introduce a new format that creates two sources of truth in the same file.

## Process

<!-- Governing: ADR-0016 (Workspace Mode), SPEC-0014 REQ "Artifact Path Resolution" -->

0. **Resolve artifact paths**: Follow the **Artifact Path Resolution** pattern from `references/shared-patterns.md` to determine the ADR and spec directories. If `$ARGUMENTS` contains `--module <name>`, resolve paths relative to that module; otherwise, in a workspace, aggregate across all modules. The resolved ADR directory is `{adr-dir}` and spec directory is `{spec-dir}`.

1. **Parse arguments**: Extract the identifier and new status from `$ARGUMENTS`.
   - Identifier: `ADR-XXXX` or `SPEC-XXXX` (or a capability name for specs)
   - Status: the new status value

2. **If identifier is missing**: Scan for available ADRs and specs (using `{adr-dir}` and `{spec-dir}`), present a list with current statuses (using the **Format Detection** algorithm in Step 4a so legacy-format files render their actual status, not blank), and use `AskUserQuestion` to ask which to update.

3. **If status is missing**: Show the current status and use `AskUserQuestion` to ask what to change it to. Show valid options:
   - ADR statuses: `proposed`, `accepted`, `deprecated`, `superseded`
   - Spec statuses: `draft`, `review`, `approved`, `implemented`, `deprecated`

4. **Locate the file**:
   - For ADRs: Glob `{adr-dir}/ADR-{number}-*.md` to find the matching file
   - For SPECs: Glob `{spec-dir}/*/spec.md` and search for the matching SPEC number in the heading

4a. **Format Detection algorithm** (read-only — no mutation in this step). Inspect the located file to determine which format owns the status field:

   | Format | Detection | Update strategy |
   |--------|-----------|-----------------|
   | `yaml-frontmatter` | File has a `---` … `---` frontmatter block at the top AND the block contains a `status:` key | Edit the YAML `status:` value in place |
   | `inline-bullet` | No frontmatter `status:` key, but the **20 lines following the first H1 heading** (`# `) contain a line matching `- **Status:** {value}` (case-insensitive on "Status"; tolerate `*`/`+` markers and `Status:` without bold). Anchoring on the H1 rather than file top makes the scan robust to long license headers, copyright comments, or other preamble some repos place before the title | Edit the bullet line in place, preserving any parenthetical refinement notes by default |
   | `none` | Neither format is present | Ask the user which format to add (Step 5c) — never silently default |

   If BOTH formats are present (a file already has the dual-source-of-truth pathology, perhaps from a prior buggy `/sdd:status` run), report this as an error: "File `{path}` has BOTH a YAML `status:` field AND an inline `- **Status:** {value}` bullet. These are out of sync — the canonical source is ambiguous. Resolve manually (delete one) and re-run." Do NOT proceed with the update; doing so would silently extend the corruption.

5. **Update the status, preserving the detected format**.

   5a. **`yaml-frontmatter`**: Edit the `status:` value in the frontmatter block. Do not touch any other frontmatter keys. Do not reorder keys. Do not insert blank lines.

   5b. **`inline-bullet`**: Edit the `- **Status:** {value}` line in place. Preserve the bullet marker (`-`, `*`, or `+`) exactly as written. Preserve the bold formatting exactly as written. **Refinement notes** (the parenthetical that some inline-bullet files carry, e.g., `accepted (refined by ADR-0010, 2026-05-03)`):

   - **Default**: drop the parenthetical when the status itself is changing (the old refinement note no longer describes the new status). Confirm via `AskUserQuestion` if a refinement note exists: "The current line has a refinement note: `(refined by ADR-0010, ...)`. Drop it now that status is changing? (Recommended yes — the note described the previous status.)"
   - **Override**: if the user passes `--keep-refinement` flag, preserve the parenthetical verbatim.

   5c. **`none`**: Use `AskUserQuestion` to ask which format to add. Two options:

   - "Add YAML frontmatter (canonical SDD template — `---\nstatus: {value}\n---\n` at file top). Recommended for repos using the current SDD template."
   - "Add inline bullet `- **Status:** {value}` immediately after the H1 heading. Recommended for repos that already use this format on their other artifacts."

   The default selection should be derived from the surrounding files: if other files in the same `{adr-dir}` (or `{spec-dir}`) use one format dominantly, suggest that one. If the repo is new with no other artifacts, default to YAML frontmatter. **Never silently default** — even with a clear preference, present the question so the user has the chance to override.

6. **Report the change**: Tell the user what changed AND which format was preserved/added, e.g.,
   - "Updated ADR-0003 status: proposed → accepted (yaml-frontmatter, in place)"
   - "Updated ADR-0001 status: accepted → superseded (inline-bullet, preserved format; refinement note dropped)"
   - "Added inline-bullet status to SPEC-0005: draft (file had no prior status field; inline format chosen to match sibling specs)"

7. **Tier 1 mutation update** (v5.0.0+):

   <!-- Governing: ADR-0026 (Tiered Index Freshness), SPEC-0019 REQ "Tier 1 Mutation-Aware Updates" -->

   After updating the status field, trigger a narrow re-sync of the qmd collection containing the artifact whose status changed — `{repo}-adrs` for ADRs, `{repo}-specs` for specs (or per-module variant in workspace mode per `references/qmd-helpers.md` § "This-Repo Collection Identification"). Use the canonical update pattern from `references/qmd-helpers.md` § "Update Patterns" → "Narrow update". Synchronous and silent on success. On failure, append a one-line warning to the report ("Index refresh failed for `{collection}` — run `/sdd:index update` manually") but report the status change itself as successful.

## Rules

- Valid ADR statuses: `proposed`, `accepted`, `deprecated`, `superseded`
- Valid spec statuses: `draft`, `review`, `approved`, `implemented`, `deprecated`
- If the user provides an invalid status, show the valid options and ask again
- MUST run the **Format Detection** algorithm in Step 4a before any mutation — never assume a file's status format
- MUST preserve the detected format when updating — `yaml-frontmatter` files stay YAML; `inline-bullet` files stay inline. The "if no frontmatter, add one" rule from prior versions of this skill was a real-world bug that silently created two sources of truth in legacy-format files
- MUST refuse to update a file that already contains BOTH formats — that is an existing corruption, and updating it would extend the damage. Report and halt
- MUST use `AskUserQuestion` when the file has no status field — never silently default to a format
- When the format is `inline-bullet` and a parenthetical refinement note exists, MUST ask whether to drop it (recommended) or preserve it via `--keep-refinement`
- MUST report which format was preserved or added in the success message — silent mutations are how the previous bug went undetected
- Do not modify any content outside the status field — neither YAML keys nor body content nor adjacent bullets
- Refinement note format is preserved in source files (per the prior `/sdd:prime` and `/sdd:list` updates that strip parentheticals from the table view) — this skill's job is to update the lifecycle word, not the refinement annotation, and only on explicit user direction
- **v5.0.0+**: MUST trigger Tier 1 update of the affected collection (`{repo}-adrs` or `{repo}-specs`) per Step 7 — best-effort, silent on success, one-line warning on failure (Governing: ADR-0026, SPEC-0019 REQ "Tier 1 Mutation-Aware Updates")
