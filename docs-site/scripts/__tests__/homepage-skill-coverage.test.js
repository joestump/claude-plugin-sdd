/**
 * Unit tests for the homepage skill grid's coverage of skills/_index.json.
 *
 * The homepage used to carry its own hardcoded array of skills. Nothing kept
 * it in step with the manifest, so it silently fell three behind — `index`,
 * `respond`, and `prd` all shipped without ever appearing on the homepage,
 * and nothing failed, because a shorter array is still a valid array.
 *
 * The grid now derives its membership and order from the manifest, so a new
 * skill appears automatically. What can still drift is the blurb map that
 * supplies the wording, and a skill missing from it renders with its name
 * alone rather than disappearing — these tests make that gap loud anyway.
 *
 * Run with `node --test`:
 *
 *   node --test docs-site/scripts/__tests__/homepage-skill-coverage.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const HOMEPAGE = path.join(REPO_ROOT, 'docs-site/src/pages/index.tsx');
const MANIFEST = path.join(REPO_ROOT, 'skills/_index.json');

function manifestSkills() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf-8'));
  return Object.values(manifest).flat();
}

function blurbKeys() {
  const src = fs.readFileSync(HOMEPAGE, 'utf-8');
  const start = src.indexOf('const SKILL_BLURBS');
  assert.notEqual(start, -1, 'expected a SKILL_BLURBS map on the homepage');
  const body = src.slice(start, src.indexOf('};', start));
  return [...body.matchAll(/^\s*'?([a-z][a-z-]*)'?\s*:/gm)].map((m) => m[1]);
}

test('the grid derives its membership from the manifest, not a literal array', () => {
  const src = fs.readFileSync(HOMEPAGE, 'utf-8');
  assert.match(
    src,
    /import skillManifest from '@site\/\.\.\/skills\/_index\.json'/,
    'the homepage must read skills/_index.json',
  );
  assert.match(
    src,
    /Object\.values\(\s*skillManifest[\s\S]{0,60}\)\s*\.flat\(\)/,
    'the skill list must be flattened from the manifest',
  );
});

test('every skill in the manifest has a homepage blurb', () => {
  const missing = manifestSkills().filter((n) => !blurbKeys().includes(n));
  assert.deepEqual(
    missing,
    [],
    `skills missing from SKILL_BLURBS in docs-site/src/pages/index.tsx: ${missing.join(', ')}`,
  );
});

test('the blurb map has no entries for skills that no longer exist', () => {
  const names = manifestSkills();
  const stale = blurbKeys().filter((k) => !names.includes(k));
  assert.deepEqual(stale, [], `stale SKILL_BLURBS entries: ${stale.join(', ')}`);
});

test('the homepage applies the index-skill route remap', () => {
  // `/skills/index` is the overview's route; linking a skill card there sends
  // the visitor to the wrong page. Mirrors pageFileBase() in transform-skills.
  const src = fs.readFileSync(HOMEPAGE, 'utf-8');
  assert.match(src, /function skillHref\(name: string\): string/);
  assert.match(src, /name === 'index' \? 'index-skill' : name/);
  assert.match(src, /to=\{skillHref\(name\)\}/, 'skill cards must link via skillHref()');
});

test('the built homepage links every manifest skill', () => {
  const built = path.join(REPO_ROOT, 'docs-site/build/index.html');
  if (!fs.existsSync(built)) return; // build artifacts absent; static checks above still ran
  const html = fs.readFileSync(built, 'utf-8');
  const missing = manifestSkills()
    .map((n) => (n === 'index' ? 'index-skill' : n))
    .filter((n) => !html.includes(`/skills/${n}"`));
  assert.deepEqual(missing, [], `skills absent from the built homepage: ${missing.join(', ')}`);
});
