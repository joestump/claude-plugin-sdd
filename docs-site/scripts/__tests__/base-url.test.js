/**
 * Unit tests for baseUrl resolution.
 *
 * Cross-reference chips are emitted as raw `<a href>` attributes, which
 * Docusaurus does not rewrite — unlike markdown links, which it resolves
 * against baseUrl itself. So the chips have to carry the prefix already, and a
 * baseUrl that resolves to '' silently 404s every one of them on a site served
 * from a subpath. Nothing catches it: the dev server and `npm run serve` both
 * mount at baseUrl, and onBrokenLinks does not inspect raw href attributes.
 *
 * Run with `node --test`:
 *
 *   node --test docs-site/scripts/__tests__/base-url.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { readBaseUrl } = require('../transform-utils');

function withConfig(source, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-base-url-'));
  const configPath = path.join(dir, 'docusaurus.config.ts');
  fs.writeFileSync(configPath, source);
  try {
    return fn(configPath);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('a literal baseUrl is read verbatim, minus the trailing slash', () => {
  withConfig("const config = {\n  baseUrl: '/my-project/',\n};\n", (p) => {
    assert.equal(readBaseUrl(p), '/my-project');
  });
});

test('a baseUrl assigned from a const is followed to its declaration', () => {
  // The shape this repo and templates/docusaurus both ship: the value lives in
  // a const so CI can override it per host. The literal-only regex matched
  // nothing here and fell back to '', dropping the prefix from every chip.
  withConfig(
    "const BASE_URL = '/claude-plugin-sdd/';\n\nconst config = {\n  baseUrl: BASE_URL,\n};\n",
    (p) => assert.equal(readBaseUrl(p), '/claude-plugin-sdd')
  );
});

test('a site served from the root resolves to the empty string', () => {
  // Callers concatenate `${baseUrl}${path}`, so '/' must collapse to '' rather
  // than doubling the separator.
  withConfig("const config = { baseUrl: '/' };\n", (p) => assert.equal(readBaseUrl(p), ''));
  withConfig("const BASE_URL = '/';\nconst config = { baseUrl: BASE_URL };\n", (p) =>
    assert.equal(readBaseUrl(p), '')
  );
});

test('an unresolvable or missing config yields the empty string', () => {
  // A const declared in another module cannot be followed; root-relative is the
  // only safe guess.
  withConfig("import { BASE_URL } from './constants';\nconst config = { baseUrl: BASE_URL };\n", (p) =>
    assert.equal(readBaseUrl(p), '')
  );
  withConfig('const config = {};\n', (p) => assert.equal(readBaseUrl(p), ''));
  assert.equal(readBaseUrl('/nonexistent/docusaurus.config.ts'), '');
});
