/**
 * Regression tests for Governing Artifacts cross-linking on generated skill
 * pages.
 *
 * renderGoverningSection() emits the pill line as
 *
 *   <div className="skill-governing">ADR-0029 &middot; SPEC-0021</div>
 *
 * and is documented on the assumption that transformAdrReferences and
 * transformSpecReferences rewrite the bare ids into anchors. Both transforms
 * skip any line that starts with an HTML tag unless it already carries an
 * rfc-keyword/rfc-ref class, and the pill line carries neither, so the line
 * sailed through both passes untouched and every generated skill page
 * rendered its Governing Artifacts as plain text (issue #279).
 *
 * These tests run the rendered section through the exact same pipeline a
 * generated page body passes through and assert that mapped ids come out as
 * real anchors, unmapped ids degrade to plain text, and no anchor is ever
 * nested.
 *
 * Run with `node --test`:
 *
 *   node --test docs-site/scripts/__tests__/governing-artifacts.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { renderGoverningSection, postProcessForMdx } = require('../transform-skills');

// The pipeline under test: render the section, then run it through the exact
// same transforms a generated page body passes through.
const pipeline = (refs) => postProcessForMdx(renderGoverningSection(refs));

const governingLine = (out) =>
  out.split('\n').find((l) => l.includes('skill-governing'));

const ADR_EMOJI = '\u{1F4DD}';

test('mapped ADR and spec ids render as anchors inside the pill div', () => {
  const out = pipeline({ adrs: ['ADR-0001'], specs: ['SPEC-0021'] });
  const line = governingLine(out);
  assert.ok(line, 'governing pill line present');
  assert.match(line, /^<div className="skill-governing">.*<\/div>$/);
  assert.match(line, /<a href="[^"]*decisions\/ADR-0001-[^"]*" className="rfc-ref">/);
  assert.match(line, /<a href="[^"]*specs\/docusaurus-skill-pages\/spec" className="rfc-ref">/);
  // Display text matches the transforms' own format: emoji-prefixed ADR,
  // bare spec id (spec-emojis.json is empty).
  assert.match(line, new RegExp(`${ADR_EMOJI} ADR-0001</a>`));
  assert.match(line, /SPEC-0021<\/a>/);
  // The &middot; separator survives between the anchors.
  assert.match(line, /<\/a> &middot; <a /);
});

test('the reference transforms do not double-link the emitted anchors', () => {
  const out = pipeline({ adrs: ['ADR-0001', 'ADR-0002'], specs: ['SPEC-0021'] });
  assert.doesNotMatch(out, /<a [^>]*><a /);
  // Each ADR resolves to its own decisions page, not a collapsed one.
  assert.match(governingLine(out), /decisions\/ADR-0001-[^"]*/);
  assert.match(governingLine(out), /decisions\/ADR-0002-[^"]*/);
});

test('unmapped ids degrade to plain text inside the pill', () => {
  const out = pipeline({ adrs: ['ADR-9999'], specs: [] });
  const line = governingLine(out);
  assert.match(line, /ADR-9999/);
  assert.doesNotMatch(line, /<a /);
});

test('a mapped and an unmapped spec share the pill line', () => {
  const out = pipeline({ adrs: [], specs: ['SPEC-0021', 'SPEC-9999'] });
  const line = governingLine(out);
  assert.match(line, /<a href="[^"]*specs\/docusaurus-skill-pages\/spec" className="rfc-ref">SPEC-0021<\/a>/);
  assert.match(line, /SPEC-9999/);
  assert.doesNotMatch(line, /<a [^>]*>SPEC-9999/);
});

test('no references still renders nothing', () => {
  assert.equal(renderGoverningSection({ adrs: [], specs: [] }), '');
});
