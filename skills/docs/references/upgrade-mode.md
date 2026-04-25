# Upgrade Mode (Step 3C)

Entered when `.sdd-docs.json` exists and the referenced `siteDir` is present on disk. Updates an existing docs installation to the latest plugin templates while preserving user customizations.

Read the manifest from `.sdd-docs.json`. Let `{mode}` be the manifest's `mode` field (`"scaffold"` or `"integration"`), and `{site}` be the resolved `siteDir`.

## 3C.1: Determine template source paths

Based on the manifest's `mode`:

- **Scaffold**: template root is `{plugin-path}/templates/docusaurus/`
- **Integration**: template root is `{plugin-path}/templates/integration/sync-spec-docs/` for plugin files, and `{plugin-path}/templates/docusaurus/src/components/` for shared components

## 3C.2: Process each managed file

For each entry in the manifest's `files` object where `managed` is `true`:

1. **Compute the current SHA-256** of the file on disk
2. **Compare** against the manifest's stored `checksum`:
   - **Checksums match** (file unmodified by user) → replace silently with the new template version
   - **Checksums differ** (user has modified the file) → use `AskUserQuestion`:
     - "Accept new version" → overwrite with the template version
     - "Keep current" → leave as-is, update manifest checksum to current hash
     - "Opt out of management" → set `managed: false` in manifest (skip in future upgrades)
   - **File missing from disk** → re-create from the template

For entries where `managed` is `false`, skip entirely.

## 3C.3: Detect new template files

Check for files in the current plugin templates that are NOT listed in the manifest:

- For **scaffold**: scan `templates/docusaurus/scripts/`, `templates/docusaurus/src/components/`, `templates/docusaurus/src/css/`, `templates/docusaurus/src/theme/`
- For **integration**: scan `templates/integration/sync-spec-docs/`, `templates/docusaurus/src/components/`

For each new file: install it to the appropriate location and add to the manifest with `managed: true` and its SHA-256 checksum.

## 3C.4: Update the manifest

Write the updated `.sdd-docs.json`:
- Set `version` to the current plugin version from `.claude-plugin/plugin.json`
- Set `updatedAt` to the current ISO timestamp
- Update all `checksum` values to reflect the current on-disk state
- Preserve `createdAt` and `mode` from the original manifest

## 3C.5: Ensure `.claudeignore` exists

Check if `.claudeignore` includes ignore entries for `{site}/node_modules/`, `{site}/build/`, and `{site}/.docusaurus/`. If any are missing, append them.

## 3C.6: Run build and verify

- For **scaffold**: run `npm install` in `{site}` if `package.json` changed, then offer to start the dev server
- For **integration**: run a Docusaurus build to verify the plugin still works

## 3C.7: Report results

Tell the user:
- Files updated silently (checksum matched)
- Files with conflicts and what the user chose for each
- New files added
- Files skipped (managed: false)
- New plugin version recorded in the manifest
