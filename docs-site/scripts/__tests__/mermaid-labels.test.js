/**
 * Unit tests for Mermaid node-label escaping in the artifact graph.
 *
 * Every graph node renders as `ID["<label>"]`. Mermaid lexes that quoted
 * label as a STR token (`"[^"]*"`) with no backslash escape, so the old
 * `\"` escaping ended the string at the first quote in a title and the whole
 * diagram failed with "Parse error ... Expecting 'SQE', got 'STR'". A label
 * that starts with a backtick fails differently: `"\`` opens a Mermaid
 * markdown string, which is a "Lexical error ... Unrecognized text". One bad
 * title took out the full graph page and every mini-DAG that included it.
 *
 * The fix writes those characters as Mermaid's own `#name;` entities, which
 * mermaid.render() decodes back to the literal character in the SVG. `#` is
 * escaped first, so a title that already contains `#42;` renders as typed
 * rather than decoding to `*`.
 *
 * Run with `node --test`:
 *
 *   node --test docs-site/scripts/__tests__/mermaid-labels.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../../..');

// See adr-filenames.test.js: `lib-artifact-transforms` is only installed by a
// consumer's docs-site, so point the request at the stub.
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

const docsSite = require('../graph-data');
const integration = withArtifactTransformsStub(() =>
  require(path.join(REPO_ROOT, 'templates/integration/sync-spec-docs/lib/graph-data'))
);

// One title with double quotes, one whose post-prefix title opens with a
// backtick and already contains something shaped like an entity.
function writeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-mermaid-labels-'));
  const site = path.join(root, 'site');
  fs.mkdirSync(site, { recursive: true });

  const adrs = path.join(root, 'docs/adrs');
  fs.mkdirSync(adrs, { recursive: true });
  fs.writeFileSync(
    path.join(adrs, 'ADR-0001-quoted.md'),
    '---\nstatus: accepted\ndate: 2026-01-01\n---\n\n' +
      '# ADR-0001: Use "quoted" titles\n\n## Context\n\nSomething.\n'
  );
  fs.writeFileSync(
    path.join(adrs, 'ADR-0002-backtick.md'),
    '---\nstatus: accepted\ndate: 2026-01-01\nrelated: [ADR-0001]\n---\n\n' +
      '# ADR-0002: `prompt_file` — literal #42; stays\n\n## Context\n\nSomething.\n'
  );

  const specsSource = path.join(root, 'docs/openspec/specs');
  fs.mkdirSync(specsSource, { recursive: true });

  return { root, site, adrs, specsSource };
}

// `ADR_0001["..."]` lines, keyed by node id. The label capture runs to the
// line's final `"]`, so a label with a stray raw quote is captured whole
// rather than silently truncated.
function nodeLabels(mermaid) {
  const labels = {};
  for (const line of mermaid.split('\n')) {
    const m = line.match(/^\s+([A-Za-z0-9_]+)\["(.*)"\]$/);
    if (m) labels[m[1]] = m[2];
  }
  return labels;
}

function assertLabels(mermaid, expected) {
  const labels = nodeLabels(mermaid);
  for (const [id, label] of Object.entries(expected)) {
    assert.equal(labels[id], label, `label for ${id}`);
    assert.doesNotMatch(labels[id], /["`]/, `${id} label must not carry a raw " or backtick`);
  }
}

// docs-site strips the redundant `ADR-NNNN:` prefix; the integration lib
// never has, so its labels keep it.
const STRIPPED = {
  ADR_0001: 'Use #quot;quoted#quot; titles',
  ADR_0002: '#96;prompt_file#96; — literal #35;42; stays',
};
const UNSTRIPPED = {
  ADR_0001: 'ADR-0001: Use #quot;quoted#quot; titles',
  ADR_0002: 'ADR-0002: #96;prompt_file#96; — literal #35;42; stays',
};

const COPIES = [
  ['docs-site/scripts', docsSite, STRIPPED],
  ['templates/integration/sync-spec-docs/lib', integration, UNSTRIPPED],
];

for (const [label, lib, expected] of COPIES) {
  test(`${label}: full graph node labels are entity-escaped`, () => {
    const { root, adrs, specsSource } = writeFixture();
    const graph = lib.buildGraph({ adrsSource: adrs, specsSource });
    assertLabels(lib.renderFullMermaid(graph), expected);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test(`${label}: neighbor mini-DAG node labels are entity-escaped`, () => {
    const { root, adrs, specsSource } = writeFixture();
    const graph = lib.buildGraph({ adrsSource: adrs, specsSource });
    assertLabels(lib.renderNeighborMermaid('ADR-0002', graph), expected);
    fs.rmSync(root, { recursive: true, force: true });
  });
}

// --- The vendored Docusaurus plugin, end to end ----------------------------

test('plugin template: every generated mermaid block carries entity-escaped labels', async () => {
  const { root, site } = writeFixture();
  const plugin = withArtifactTransformsStub(() =>
    require(path.join(REPO_ROOT, 'templates/docusaurus/plugins/sdd-content'))
  );

  await plugin({ siteDir: site, siteConfig: { baseUrl: '/', title: 'Fixture' } }, {}).loadContent();

  const generated = path.join(root, 'docs-generated');
  const pages = [
    'graph.mdx',
    'decisions/adr-0001-quoted.mdx',
    'decisions/adr-0002-backtick.mdx',
  ];
  for (const page of pages) {
    const body = fs.readFileSync(path.join(generated, page), 'utf-8');
    const blocks = [...body.matchAll(/```mermaid\n([\s\S]*?)\n```/g)].map((m) => m[1]);
    assert.ok(blocks.length > 0, `expected a mermaid block in ${page}`);
    for (const block of blocks) assertLabels(block, STRIPPED);
  }

  fs.rmSync(root, { recursive: true, force: true });
});
