# Scaffold Mode (Step 3A)

Creates a standalone Docusaurus site at `docs-site/`.

1. **Check for existing docs-site**: Look for `docs-site/` in the project root. If it exists, ask the user before overwriting.

2. **Copy the plugin's Docusaurus templates** using `cp -r` from the plugin's `templates/docusaurus/` directory to `docs-site/` in the project root.

3. **Customize for the project** by reading and modifying only these files:
   - `docs-site/package.json` -- update the project name from `$ARGUMENTS` or inferred from the repo
   - `docs-site/docusaurus.config.ts` -- update title, baseUrl, and GitHub URL for this project
   - **Optionally** customize the `sdd-content` plugin options if your ADRs/specs are in non-standard locations:
     - `adrsDir` (default: `../docs/adrs`)
     - `specsDir` (default: `../docs/openspec/specs`)
     - `outputDir` (default: `../docs-generated`)

4. **Run `npm install`** in the docs-site directory.

5. **Update `.claudeignore`**: Check if `.claudeignore` exists at the project root. If not, create it. Add entries to ignore:
   ```
   docs-site/node_modules/
   docs-site/build/
   docs-site/.docusaurus/
   ```
   If `.claudeignore` already exists, append any missing entries.

6. **Report and offer to start**: Tell the user what was created, then ask: "Docs site created! Want me to start the dev server? (`cd docs-site && npm run start`)"

After completion, proceed to **Step 4: Create Manifest** (back in SKILL.md).
