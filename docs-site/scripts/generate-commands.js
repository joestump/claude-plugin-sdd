#!/usr/bin/env node
/**
 * Generate command tiles for the docs-site.
 *
 * Thin wrapper over plugin-content-claude-plugin-commands — the plugin owns
 * the implementation; this script just wires up the docs-site's fixed paths
 * so it integrates with the existing build-docs.js pipeline.
 *
 * Governing: ADR-0029 (Auto-Generate Docusaurus Skill Pages),
 *            SPEC-0021 REQ "Hero-Tile Index Page".
 */

const { loadManifest, loadCommandGroups, renderCommandsMdx } = require('plugin-content-claude-plugin-commands');
const { writeFileSync, mkdirSync } = require('fs');
const { join, dirname } = require('path');

const REPO_ROOT = join(__dirname, '../..');
const MANIFEST_PATH = join(REPO_ROOT, 'skills/_index.json');
const SKILLS_DIR = join(REPO_ROOT, 'skills');
const OUTPUT_PATH = join(REPO_ROOT, 'docs-generated/guides/commands-quick-reference.mdx');

// Routes that the upstream renderer derives as `/skills/{name}` but which this
// site does not serve there.
//
// `index` is the only one, and the reason is structural rather than a naming
// accident: Docusaurus emits `<slug>/index.html`, so the hero-tile overview
// (slug `/skills/`) owns the FILE `skills/index.html`. A static host matches
// that file before any `skills/index/` directory, so no page slugged
// `/skills/index` is reachable by a cold request no matter what generates it.
// transform-skills.js therefore serves the skill at `/skills/index-skill`
// (see pageSlug() there), and this map keeps the quick-reference tiles
// pointing at the route that exists.
const ROUTE_OVERRIDES = { index: '/skills/index-skill' };

function applyRouteOverrides(mdx) {
  let out = mdx;
  for (const [name, href] of Object.entries(ROUTE_OVERRIDES)) {
    const from = ` href={${JSON.stringify(`/skills/${name}`)}}`;
    const to = ` href={${JSON.stringify(href)}}`;
    if (!out.includes(from)) {
      throw new Error(
        `generate-commands: expected a tile for "${name}" at /skills/${name} to rewrite. ` +
          'Either the upstream renderer changed its href format, or the skill was renamed — ' +
          'check ROUTE_OVERRIDES against transform-skills.js pageSlug().',
      );
    }
    out = out.split(from).join(to);
  }
  return out;
}

function main() {
  const manifest = loadManifest(MANIFEST_PATH);
  if (!manifest) {
    console.log('  Skipped: skills/_index.json not found or invalid');
    return;
  }
  const groups = loadCommandGroups(manifest, SKILLS_DIR);
  const mdx = applyRouteOverrides(renderCommandsMdx(groups, 'sdd'));
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, mdx);
  console.log('  Generated command tiles → docs-generated/guides/commands-quick-reference.mdx');
}

if (require.main === module) main();
module.exports = { main, applyRouteOverrides, ROUTE_OVERRIDES };
