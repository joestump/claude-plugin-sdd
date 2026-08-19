/**
 * Unit tests for spec cross-reference resolution.
 *
 * A `SPEC-0008` mention in an ADR or spec body is linkified by
 * transformSpecReferences() against a mapping built from the specs tree. The
 * mapping holds two kinds of key, and conflating them is the regression these
 * tests pin:
 *
 *   "SPEC-0008"  a spec's own artifact ID  -> that spec's page, no fragment
 *   "ARCH"       a domain requirement prefix -> the domain page + #arch-001
 *
 * Keying the artifact ID by its prefix ("SPEC") gave every domain the same key,
 * so the last domain read owned every SPEC-NNNN reference site-wide.
 *
 * Three copies of the transform ship from this repo — the docs-site scripts,
 * the vendored Docusaurus plugin under templates/, and the sync-spec-docs
 * integration lib — so all three are exercised here.
 *
 * Run with `node --test`:
 *
 *   node --test docs-site/scripts/__tests__/spec-references.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../../..');

// The two library copies expose transformSpecReferences directly; the plugin
// template only exports the Docusaurus plugin factory and is driven end-to-end
// below.
const TRANSFORM_COPIES = [
  ['docs-site/scripts', require('../transform-utils')],
  [
    'templates/integration/sync-spec-docs/lib',
    require(path.join(REPO_ROOT, 'templates/integration/sync-spec-docs/lib/transform-utils')),
  ],
];

// One entry per artifact ID, plus a domain-scoped requirement prefix.
const MAPPING = {
  'SPEC-0001': '/specs/alpha/spec',
  'SPEC-0002': '/specs/beta/spec',
  ARCH: '/specs/alpha/spec',
};

// buildAdrMapping keys by the bare four-digit number, not the full ID.
const ADR_MAPPING = { '0001': '/decisions/ADR-0001-example' };

for (const [label, lib] of TRANSFORM_COPIES) {
  const { transformSpecReferences, transformAdrReferences } = lib;
  const transform = (content, specEmojis = {}) =>
    transformSpecReferences(content, { specMapping: MAPPING, specEmojis, baseUrl: '' });
  const transformAdr = (content) =>
    transformAdrReferences(content, { adrMapping: ADR_MAPPING, adrEmoji: '\u{1F3DB}', baseUrl: '' });

  test(`${label}: each artifact ID resolves to its own spec page`, () => {
    assert.match(transform('See SPEC-0001.'), /href="\/specs\/alpha\/spec"/);
    assert.match(transform('See SPEC-0002.'), /href="\/specs\/beta\/spec"/);
  });

  test(`${label}: artifact IDs in one line do not collapse onto one page`, () => {
    const out = transform('SPEC-0001 is extended by SPEC-0002.');
    assert.match(out, /href="\/specs\/alpha\/spec"[^>]*>SPEC-0001</);
    assert.match(out, /href="\/specs\/beta\/spec"[^>]*>SPEC-0002</);
  });

  test(`${label}: artifact IDs get no fragment`, () => {
    // A spec page's H1 anchor is derived from the whole heading text
    // ("spec-0001-alpha"), so `#spec-0001` pointed at nothing.
    assert.doesNotMatch(transform('See SPEC-0001.'), /#spec-0001/);
  });

  test(`${label}: requirement IDs still resolve to their prefix's page anchor`, () => {
    assert.match(transform('See ARCH-001.'), /href="\/specs\/alpha\/spec#arch-001"/);
  });

  test(`${label}: unmapped IDs are left as plain text`, () => {
    assert.equal(transform('See SPEC-9999 and NOPE-001.'), 'See SPEC-9999 and NOPE-001.');
  });

  test(`${label}: emoji overrides are keyed by prefix, for both kinds`, () => {
    assert.match(transform('See SPEC-0001.', { SPEC: '📘' }), />📘 SPEC-0001</);
    assert.match(transform('See ARCH-001.', { ARCH: '🏛' }), />🏛 ARCH-001</);
  });

  test(`${label}: baseUrl prefixes both kinds`, () => {
    const out = transformSpecReferences('SPEC-0002 and ARCH-001.', {
      specMapping: MAPPING,
      specEmojis: {},
      baseUrl: '/docs',
    });
    assert.match(out, /href="\/docs\/specs\/beta\/spec"/);
    assert.match(out, /href="\/docs\/specs\/alpha\/spec#arch-001"/);
  });

  test(`${label}: code fences and inline code are left alone`, () => {
    assert.equal(transform('```\nSPEC-0001\n```'), '```\nSPEC-0001\n```');
  });

  // --- Already-linked references stay untouched --------------------------
  //
  // Linkifying a reference that is already inside inline code, a markdown
  // link, or an emitted anchor produces `<a><a>...</a></a>`. That is invalid
  // HTML, and some minifiers reject it outright rather than repairing it.

  test(`${label}: a reference inside inline code is left alone`, () => {
    assert.equal(transform('The literal `SPEC-0001` is not a reference.'),
      'The literal `SPEC-0001` is not a reference.');
    assert.equal(transformAdr('The literal `ADR-0001` is not a reference.'),
      'The literal `ADR-0001` is not a reference.');
  });

  test(`${label}: a reference inside a markdown link is left alone`, () => {
    const spec = 'See [SPEC-0001](/specs/alpha/spec) for the rules.';
    assert.equal(transform(spec), spec);
    const adr = 'See [ADR-0001](adr-0001-example.md) for the rationale.';
    assert.equal(transformAdr(adr), adr);
  });

  test(`${label}: a reference inside an emitted anchor is left alone`, () => {
    // Both halves matter: the ID in the href and the ID in the link text.
    const spec = 'Prior art: <a href="/specs/alpha/spec" className="rfc-ref">SPEC-0001</a> covers it.';
    assert.equal(transform(spec), spec);
    const adr = 'Prior art: <a href="/decisions/ADR-0001-example" className="rfc-ref">ADR-0001</a> covers it.';
    assert.equal(transformAdr(adr), adr);
  });

  test(`${label}: no anchor is ever nested inside another`, () => {
    const line = 'Both [SPEC-0001](/specs/alpha/spec) and [ADR-0001](adr-0001-example.md) apply.';
    const out = transformAdr(transform(line));
    assert.doesNotMatch(out, /<a [^>]*><a /);
  });

  test(`${label}: an unprotected reference on the same line still linkifies`, () => {
    // The guard must be span-scoped, not line-scoped — one protected span
    // must not suppress a bare mention elsewhere on the line.
    const out = transform('Compare `SPEC-0001` against SPEC-0002.');
    assert.match(out, /`SPEC-0001`/);
    assert.match(out, /href="\/specs\/beta\/spec"[^>]*>SPEC-0002</);
  });
}

// --- The vendored Docusaurus plugin, end to end ----------------------------

function writeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-spec-refs-'));
  const site = path.join(root, 'site');
  fs.mkdirSync(site, { recursive: true });
  const adrs = path.join(root, 'docs/adrs');
  fs.mkdirSync(adrs, { recursive: true });
  fs.writeFileSync(
    path.join(adrs, 'ADR-0001-example.md'),
    '---\nstatus: accepted\ndate: 2026-01-01\n---\n\n# ADR-0001: Example\n\n## Context\n\nSomething.\n'
  );

  const spec = (id, title, body) =>
    `---\nstatus: active\ndate: 2026-01-01\n---\n\n# ${id}: ${title}\n\n## Overview\n\n${body}\n`;

  // `design: false` leaves the domain with a spec.md only, which the transform
  // emits as a flat page rather than a category directory.
  const domain = (name, id, title, body, { design = true } = {}) => {
    const dir = path.join(root, 'docs/openspec/specs', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'spec.md'), spec(id, title, body));
    if (design) fs.writeFileSync(path.join(dir, 'design.md'), spec(id, `${title} Design`, body));
  };

  domain('alpha', 'SPEC-0001', 'Alpha', 'Alpha stands alone.');
  // A spec.md converted from an ADR whose H1 was never renumbered. Its ID must
  // not be registered in the spec mapping: transformSpecReferences runs first,
  // so it would capture every ADR-0001 mention on the site.
  domain('stale', 'ADR-0001', 'Stale Conversion', 'Converted, never renumbered.');
  domain('beta', 'SPEC-0002', 'Beta', 'Beta builds on SPEC-0001.');
  // The prose here mentions `### Requirement:` and then cites an ADR on the
  // same line — the shape that used to register "ADR" as a spec prefix.
  domain(
    'gamma',
    'SPEC-0003',
    'Gamma',
    'Gamma needs SPEC-0001, SPEC-0002 and SPEC-0004.\n\nOne issue per ### Requirement: section, per ADR-0001.'
  );
  // Only a spec.md, no design.md — this domain renders as the flat page
  // /specs/delta, so references to SPEC-0004 must not be sent to
  // /specs/delta/spec, which nothing writes.
  domain('delta', 'SPEC-0004', 'Delta', 'Delta stands alone.', { design: false });
  // Every shape the linkifier must leave alone, alongside bare mentions of the
  // same IDs that it must still resolve. Nested (it keeps its design.md) so the
  // assertions below read the page at /specs/epsilon/spec.
  domain(
    'epsilon',
    'SPEC-0005',
    'Epsilon',
    [
      'Epsilon cites [SPEC-0002](/specs/beta/spec) and [ADR-0001](../../adrs/ADR-0001-example.md).',
      '',
      'The literals `SPEC-0002` and `ADR-0001` are prose, not references.',
      '',
      'Bare SPEC-0002 and bare ADR-0001 still resolve.',
    ].join('\n')
  );

  return { root, site };
}

// The plugin template requires `lib-artifact-transforms`, which only a
// consumer's docs-site installs (see templates/docusaurus/package.json).
// Resolution runs from the plugin's own directory upward, so no install under
// this repo's docs-site can satisfy it — point the request at the stub, which
// delegates the actual parsing to graph-data.js.
function withArtifactTransformsStub(fn) {
  const Module = require('node:module');
  const original = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    if (request === 'lib-artifact-transforms') {
      return require.resolve('./stubs/lib-artifact-transforms');
    }
    return original.call(this, request, ...rest);
  };
  try {
    return fn();
  } finally {
    Module._resolveFilename = original;
  }
}

test('plugin template: every SPEC reference resolves to its own spec directory', async () => {
  const { root, site } = writeFixture();
  const plugin = withArtifactTransformsStub(() =>
    require(path.join(REPO_ROOT, 'templates/docusaurus/plugins/sdd-content'))
  );

  await plugin({ siteDir: site }, {}).loadContent();

  const generated = path.join(root, 'docs-generated');
  const beta = fs.readFileSync(path.join(generated, 'specs/beta/spec.mdx'), 'utf-8');
  assert.match(beta, /href="\/specs\/alpha\/spec"/);

  const gamma = fs.readFileSync(path.join(generated, 'specs/gamma/spec.mdx'), 'utf-8');
  assert.match(gamma, /href="\/specs\/alpha\/spec"/);
  assert.match(gamma, /href="\/specs\/beta\/spec"/);

  // The regression: with the artifact ID keyed by prefix, every one of these
  // pointed at whichever domain was read last.
  assert.doesNotMatch(gamma, /href="\/specs\/gamma\/spec[^"]*"[^>]*>SPEC-000[12]</);

  fs.rmSync(root, { recursive: true, force: true });
});

test('plugin template: a spec H1 carrying an ADR number does not claim that ID', async () => {
  const { root, site } = writeFixture();
  const plugin = withArtifactTransformsStub(() =>
    require(path.join(REPO_ROOT, 'templates/docusaurus/plugins/sdd-content'))
  );

  await plugin({ siteDir: site }, {}).loadContent();

  const gamma = fs.readFileSync(
    path.join(root, 'docs-generated/specs/gamma/spec.mdx'),
    'utf-8'
  );
  // Still the ADR page, and no spec route claims the ID. Registering it
  // produced `<a href="/specs/stale/spec"><a href="/decisions/...">ADR-0001</a></a>`,
  // so the nested-anchor shape is the assertion that actually bites.
  assert.match(gamma, /href="\/decisions\/ADR-0001-example"/);
  assert.doesNotMatch(gamma, /href="\/specs\/stale/);
  assert.doesNotMatch(gamma, /<a [^>]*><a /);

  fs.rmSync(root, { recursive: true, force: true });
});

test('plugin template: a spec citing an ADR does not claim the ADR prefix', async () => {
  const { root, site } = writeFixture();
  const plugin = withArtifactTransformsStub(() =>
    require(path.join(REPO_ROOT, 'templates/docusaurus/plugins/sdd-content'))
  );

  await plugin({ siteDir: site }, {}).loadContent();

  const gamma = fs.readFileSync(
    path.join(root, 'docs-generated/specs/gamma/spec.mdx'),
    'utf-8'
  );
  assert.match(gamma, /href="\/decisions\/ADR-0001-example"/);
  // With "ADR" registered as a spec prefix the spec transform got there first
  // and wrapped the ADR link in a second anchor pointing at a spec page.
  assert.doesNotMatch(gamma, /href="[^"]*#adr-0001"/);
  assert.doesNotMatch(gamma, /<a [^>]*><a /);

  fs.rmSync(root, { recursive: true, force: true });
});

test('plugin template: a design-less domain is referenced at its flat page', async () => {
  const { root, site } = writeFixture();
  const plugin = withArtifactTransformsStub(() =>
    require(path.join(REPO_ROOT, 'templates/docusaurus/plugins/sdd-content'))
  );

  await plugin({ siteDir: site }, {}).loadContent();

  const generated = path.join(root, 'docs-generated');

  // What the transform actually emits for a spec.md-only domain.
  assert.ok(fs.existsSync(path.join(generated, 'specs/delta.mdx')));
  assert.ok(!fs.existsSync(path.join(generated, 'specs/delta/spec.mdx')));

  // The regression: the mapping assumed every domain was nested, so this
  // cross-reference pointed at /specs/delta/spec — a route with no page.
  const gamma = fs.readFileSync(path.join(generated, 'specs/gamma/spec.mdx'), 'utf-8');
  assert.match(gamma, /href="\/specs\/delta"[^>]*>SPEC-0004</);
  assert.doesNotMatch(gamma, /href="\/specs\/delta\/spec"/);

  // The specs index links the same page the transform wrote.
  const index = fs.readFileSync(path.join(generated, 'specs/index.mdx'), 'utf-8');
  assert.match(index, /\[Specification\]\(\.\/delta\)/);
  assert.doesNotMatch(index, /\(\.\/delta\/spec\)/);

  fs.rmSync(root, { recursive: true, force: true });
});

test('plugin template: a reference already inside code, a link, or an anchor is left alone', async () => {
  const { root, site } = writeFixture();
  const plugin = withArtifactTransformsStub(() =>
    require(path.join(REPO_ROOT, 'templates/docusaurus/plugins/sdd-content'))
  );

  await plugin({ siteDir: site }, {}).loadContent();

  const epsilon = fs.readFileSync(
    path.join(root, 'docs-generated/specs/epsilon/spec.mdx'),
    'utf-8'
  );

  // The defect: `<a href="..."><a href="...">ADR-0001</a></a>`. Invalid HTML,
  // and some minifiers reject it rather than repairing it.
  assert.doesNotMatch(epsilon, /<a [^>]*><a /);

  // Inline code stays literal.
  assert.match(epsilon, /`SPEC-0002`/);
  assert.match(epsilon, /`ADR-0001`/);

  // Markdown links keep their original label, unwrapped.
  assert.match(epsilon, /\[SPEC-0002\]\(\/specs\/beta\/spec\)/);
  assert.match(epsilon, /\[ADR-0001\]\(\.\.\/\.\.\/adrs\/ADR-0001-example\)/);

  // ...and the bare mentions on the last line still linkify, so the guard is
  // span-scoped rather than a blunt line-level opt-out.
  assert.match(epsilon, /href="\/specs\/beta\/spec"[^>]*>SPEC-0002</);
  assert.match(epsilon, /href="\/decisions\/ADR-0001-example"[^>]*>[^<]*ADR-0001</);

  fs.rmSync(root, { recursive: true, force: true });
});
