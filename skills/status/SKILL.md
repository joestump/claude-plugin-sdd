---
name: status
description: Change the status of an ADR or spec (e.g., proposed to accepted, draft to review), or backfill YAML frontmatter onto legacy artifacts that carry status as inline bullets. Use when the user says "accept ADR", "approve the spec", "mark as accepted", "backfill frontmatter", or "migrate legacy status lines".
allowed-tools: Read, Write, Edit, Glob, Grep, AskUserQuestion, Bash
argument-hint: "[ADR-XXXX or SPEC-XXXX] [new status] [--module <name>] [--keep-refinement] | backfill [--dry-run] [--module <name>]"
disable-model-invocation: true
---

# Change ADR or Spec Status

> **Harness portability.** This skill runs on any agent harness that loads Agent Skills — Claude Code, Codex CLI, OpenCode, Crush. Tool names used below (`AskUserQuestion`, `Task`, `TeamCreate`, `SendMessage`, `TaskCreate`, `ToolSearch`, `mcp__*`, `${CLAUDE_PLUGIN_ROOT}`) denote *capabilities*, not hard requirements: map each to your harness's equivalent or use the documented fallback per `${CLAUDE_PLUGIN_ROOT}/references/harness-compat.md`. References to `CLAUDE.md` mean the project memory file (`CLAUDE.md`, `AGENTS.md`, or `CRUSH.md`) per harness-compat § "Project Memory File".

Update the status of an ADR or spec, **preserving the file's existing status format**. Two formats exist in the wild: YAML frontmatter (canonical SDD template) and inline `- **Status:** {value}` bullets (used by legacy / hand-authored repos that predate the template). This skill detects which format is in use and edits in place — it MUST NOT silently introduce a new format that creates two sources of truth in the same file.

## Process

<!-- Governing: ADR-0016 (Workspace Mode), SPEC-0014 REQ "Artifact Path Resolution" -->

0. **Resolve artifact paths**: Follow the **Artifact Path Resolution** pattern from `${CLAUDE_PLUGIN_ROOT}/references/shared-patterns.md` to determine the ADR and spec directories. If `$ARGUMENTS` contains `--module <name>`, resolve paths relative to that module; otherwise, in a workspace, aggregate across all modules. The resolved ADR directory is `{adr-dir}` and spec directory is `{spec-dir}`.

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

   After updating the status field, trigger a narrow re-sync of the qmd collection containing the artifact whose status changed — `{repo}-adrs` for ADRs, `{repo}-specs` for specs (or per-module variant in workspace mode per `${CLAUDE_PLUGIN_ROOT}/references/qmd-helpers.md` § "This-Repo Collection Identification"). Use the canonical update pattern from `${CLAUDE_PLUGIN_ROOT}/references/qmd-helpers.md` § "Update Patterns" → "Narrow update". Synchronous and silent on success. On failure, append a one-line warning to the report ("Index refresh failed for `{collection}` — run `/sdd:index update` manually") but report the status change itself as successful.

   Then check that collection's context blurb for drift per `${CLAUDE_PLUGIN_ROOT}/references/qmd-helpers.md` § "Update Patterns" → "The update maintains the index, not the context". This is the sharpest case: a context that groups the artifact under its *old* status now contradicts the artifact's own frontmatter, and qmd returns both in the same result. Warn in one line if it has drifted; do not rewrite it silently.

## Backfill mode (`backfill`)

When `$ARGUMENTS` starts with `backfill`, the skill does NOT update any status value — it migrates legacy-format artifacts to the canonical YAML frontmatter, in bulk, with a preview. This is the explicit, user-initiated inverse of the format-preservation rule: that rule keeps a repo's existing format stable during one-off status changes; backfill is how a repo deliberately moves to the canonical format once.

1. **Scan and classify**: walk every `*.md` in `{adr-dir}` and every `spec.md` in `{spec-dir}/*/`, running the Step 4a Format Detection algorithm on each: `yaml-frontmatter`, `inline-bullet`, or `none`. Exclude `0000-template.md` and `README.md` from `{adr-dir}` — they are not artifacts and have no lifecycle status, and stamping frontmatter onto the ADR template would seed a hardcoded `status:`/`date:` into every ADR authored from it afterwards. (Same two files `/sdd:docs` skips.) Files already in `yaml-frontmatter` format are skipped and counted. Files with BOTH formats are skipped and reported as corrupt (the Step 4a dual-source-of-truth error) — backfill must not extend existing corruption.

2. **Derive the frontmatter values** for each `inline-bullet` / `none` file:
   - **status**: from the inline `- **Status:** {value}` bullet when present, normalized to the artifact type's enum (e.g., `Accepted` → `accepted`; a parenthetical refinement note is preserved as a YAML comment line above `status:`). For `none`-format files, ask per file — there is nothing to derive from.
   - **date**: from an inline `- **Date:** {value}` bullet when present; otherwise from the file's first commit (`git log --diff-filter=A --format=%as -- <path>`); otherwise ask per file.
   - Existing frontmatter keys other than `status`/`date` (e.g., already-authored edge fields on a file that lacks `status:`) MUST be preserved verbatim — backfill adds the two lifecycle keys, it does not rewrite the block.

3. **Apply the migration per file**: prepend (or extend) the frontmatter block, then REMOVE the now-duplicated inline `Status` and `Date` bullets — specifically the bullet lines Step 2 read the values from, inside the same Step 4a scan window (the 20 lines following the first H1), never a whole-file search-and-delete. A `- **Status:** ...` line further down the body is prose or an example, not the artifact's own lifecycle field, and deleting it destroys content. Removing the bullets is what makes the migration safe — leaving them creates exactly the dual-source-of-truth corruption Step 4a refuses to touch. Nothing else in the file is modified.

4. **Preview before writing**: present the per-file plan (path, detected format, derived status/date, bullet lines to be removed). With `--dry-run`, print the plan and stop — no file is modified. Otherwise ask via `AskUserQuestion`: apply all, review file-by-file, or abort. In review mode each file gets its own accept/skip question showing the exact frontmatter that would be written.

5. **Report**: how many files migrated, skipped (already frontmatter), skipped (corrupt — needs manual repair), and asked-over; then run the Step 7 Tier 1 mutation update for each affected collection.

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
- In `backfill` mode: MUST exclude `{adr-dir}/0000-template.md` and `{adr-dir}/README.md` from the scan — neither is an artifact, and writing frontmatter into the template propagates a fixed status and date into every ADR seeded from it; MUST classify every artifact with the Format Detection algorithm first and MUST skip dual-format files as corrupt; MUST remove the inline Status/Date bullets when migrating (leaving them creates the dual-source-of-truth corruption); MUST preserve any existing frontmatter keys verbatim; MUST show the per-file plan before writing (or with `--dry-run`, instead of writing); MUST NOT change any status VALUE during backfill — a value change is a separate explicit `/sdd:status` run
- **v5.0.0+**: MUST trigger Tier 1 update of the affected collection (`{repo}-adrs` or `{repo}-specs`) per Step 7 — best-effort, silent on success, one-line warning on failure (Governing: ADR-0026, SPEC-0019 REQ "Tier 1 Mutation-Aware Updates")
- MUST check the affected collection's context blurb for drift after the Tier 1 update per Step 7 — a status grouping naming the artifact whose status just changed now contradicts its frontmatter
