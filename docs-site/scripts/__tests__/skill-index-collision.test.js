/**
 * Unit tests for the reserved `index.mdx` filename in generated skill pages.
 *
 * `transform-skills.js` writes one page per skill to
 * `docs-generated/skills/{name}.mdx`, then writes the hero-tile overview to
 * `docs-generated/skills/index.mdx` — after the loop. The plugin ships a
 * skill named `index` (`/sdd:index`, the qmd indexer), so its page was
 * written and then silently overwritten by the overview on every build.
 *
 * Nothing failed. The build stayed green because Docusaurus reports broken
 * links as warnings, and the two it reported — the sidebar entry and the
 * hero tile, both pointing at `/skills/index` — read as a routing quirk
 * rather than a missing page. The `/sdd:index` documentation had simply
 * never been published.
 *
 * Run with `node --test`:
 *
 *   node --test docs-site/scripts/__tests__/skill-index-collision.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const TRANSFORM = path.join(REPO_ROOT, 'docs-site/scripts/transform-skills.js');
const SIDEBARS = path.join(REPO_ROOT, 'docs-site/sidebars.ts');
const MANIFEST = path.join(REPO_ROOT, 'skills/_index.json');

test('the skill manifest still contains the colliding name', () => {
  // If `index` is ever renamed, this whole guard can go — but until then a
  // green suite must not be read as "the collision cannot happen".
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf-8'));
  const names = Object.values(manifest).flat();
  assert.ok(
    names.includes('index'),
    'expected a skill named `index`; if it was renamed, remove this test file',
  );
});

test('transform-skills.js does not write a skill page to the reserved index.mdx', () => {
  const src = fs.readFileSync(TRANSFORM, 'utf-8');
  assert.match(
    src,
    /function pageFileBase\(name\)/,
    'expected a pageFileBase() helper to remap reserved filenames',
  );
  assert.match(
    src,
    /const destPath = path\.join\(SKILLS_DEST, `\$\{pageFileBase\(name\)\}\.mdx`\)/,
    'per-skill pages must be written through pageFileBase(), not the raw name',
  );
});

test('pageFileBase remaps only `index`', () => {
  const src = fs.readFileSync(TRANSFORM, 'utf-8');
  const body = src.slice(src.indexOf('function pageFileBase(name)'));
  assert.match(body, /name === 'index' \? 'index-skill' : name/);
});

test('the generated index skill page keeps the /skills/index slug', () => {
  // The filename moves; the route must not, or the hero tile and the
  // quick-reference guide break in the other direction.
  const src = fs.readFileSync(TRANSFORM, 'utf-8');
  assert.match(
    src,
    /slug: \/skills\/\$\{name\}/,
    'the slug must still derive from the skill name, not the filename stem',
  );
});

test('sidebars.ts resolves the index skill to the remapped doc ID', () => {
  // Docusaurus doc IDs follow the file path, not the slug, so the sidebar
  // must apply the same remap or its entry 404s.
  const src = fs.readFileSync(SIDEBARS, 'utf-8');
  assert.match(
    src,
    /skills\/\$\{name === 'index' \? 'index-skill' : name\}/,
    'sidebar doc IDs must mirror pageFileBase()',
  );
  assert.match(
    src,
    /id: 'skills\/index', label: 'Overview'/,
    'the hero-tile overview must still own the skills/index doc ID',
  );
});

test('every manifest skill has a generated page when docs-generated exists', () => {
  const generated = path.join(REPO_ROOT, 'docs-generated/skills');
  if (!fs.existsSync(generated)) {
    return; // build artifacts absent — the static assertions above still ran
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf-8'));
  const missing = Object.values(manifest)
    .flat()
    .filter((name) => {
      const stem = name === 'index' ? 'index-skill' : name;
      return !fs.existsSync(path.join(generated, `${stem}.mdx`));
    });
  assert.deepEqual(missing, [], 'every skill in the manifest needs a page');
});
