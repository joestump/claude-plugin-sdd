/**
 * Unit tests for ADR filename casing and non-string frontmatter.
 *
 * Two defects that only surface together. Repos name their ADR files either
 * `ADR-0001-thing.md` or `adr-0001-thing.md`; the generators matched only the
 * uppercase form, so a lowercase-naming repo got:
 *
 *   - no graph nodes, hence no edges, no per-artifact mini-DAG, no graph page
 *   - no badge header on any ADR page (isNumberedAdr was false)
 *   - no entry in the ADR link mapping, so every ADR-NNNN mention stayed plain
 *
 * That second one masked the third defect: the badge header renders
 * `decision-makers`, which YAML gives back as an array for the MADR-standard
 * `decision-makers: [Alice, Bob]`. Fixing the casing alone turns a silent
 * omission into "str.replace is not a function" at build time.
 *
 * Run with `node --test`:
 *
 *   node --test docs-site/scripts/__tests__/adr-filenames.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../../..');

// `lib-artifact-transforms` is a package only a consumer's docs-site installs
// (see templates/docusaurus/package.json). Both the plugin template and the
// integration lib require it, and Node resolves the request from their own
// directories upward, so no install under this repo could satisfy it — point
// the request at the stub, which delegates the parsing to graph-data.js.
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

const { buildAdrMapping } = require('../transform-utils');
const { buildGraph } = require('../graph-data');
const {
  buildAdrMapping: buildAdrMappingIntegration,
} = require(path.join(REPO_ROOT, 'templates/integration/sync-spec-docs/lib/transform-utils'));
const { buildGraph: buildGraphIntegration } = withArtifactTransformsStub(() =>
  require(path.join(REPO_ROOT, 'templates/integration/sync-spec-docs/lib/graph-data'))
);

// A repo that names its ADRs in lowercase, with a list-valued decision-makers.
function writeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-adr-case-'));
  const site = path.join(root, 'site');
  fs.mkdirSync(site, { recursive: true });

  const adrs = path.join(root, 'docs/adrs');
  fs.mkdirSync(adrs, { recursive: true });
  fs.writeFileSync(
    path.join(adrs, 'adr-0001-lowercase.md'),
    '---\nstatus: accepted\ndate: 2026-01-01\ndecision-makers: [Alice, Bob]\n---\n\n' +
      '# ADR-0001: Lowercase\n\n## Context\n\nSomething.\n'
  );

  const specs = path.join(root, 'docs/openspec/specs/alpha');
  fs.mkdirSync(specs, { recursive: true });
  fs.writeFileSync(
    path.join(specs, 'spec.md'),
    '---\nstatus: active\ndate: 2026-01-01\nimplements: [ADR-0001]\n---\n\n' +
      '# SPEC-0001: Alpha\n\n## Overview\n\nAlpha realizes ADR-0001.\n'
  );

  return { root, site, adrs, specsSource: path.join(root, 'docs/openspec/specs') };
}

const MAPPING_COPIES = [
  ['docs-site/scripts', buildAdrMapping],
  ['templates/integration/sync-spec-docs/lib', buildAdrMappingIntegration],
];

for (const [label, build] of MAPPING_COPIES) {
  test(`${label}: a lowercase ADR filename still gets a link mapping`, () => {
    const { root, adrs } = writeFixture();
    // Keyed by the bare number, so an ADR-0001 mention in prose resolves
    // regardless of how the file on disk is spelled.
    assert.deepEqual(build(adrs), { '0001': '/decisions/adr-0001-lowercase' });
    fs.rmSync(root, { recursive: true, force: true });
  });
}

const GRAPH_COPIES = [
  ['docs-site/scripts', buildGraph],
  ['templates/integration/sync-spec-docs/lib', buildGraphIntegration],
];

for (const [label, build] of GRAPH_COPIES) {
  test(`${label}: a lowercase ADR filename still becomes a graph node`, () => {
    const { root, adrs, specsSource } = writeFixture();
    const graph = build({ adrsSource: adrs, specsSource });

    // Normalized to the uppercase ID the rest of the graph keys by, so the
    // spec's `implements: [ADR-0001]` edge finds a target.
    assert.ok(graph.nodes['ADR-0001'], 'expected an ADR-0001 node');
    assert.equal(graph.nodes['ADR-0001'].kind, 'adr');
    assert.ok(
      graph.edges.some((e) => e.source === 'SPEC-0001' && e.target === 'ADR-0001'),
      'expected the spec to link to the ADR'
    );

    fs.rmSync(root, { recursive: true, force: true });
  });
}

// --- The vendored Docusaurus plugin, end to end ----------------------------

test('plugin template: a lowercase ADR gets its badge header, mini-DAG and graph page', async () => {
  const { root, site } = writeFixture();
  const plugin = withArtifactTransformsStub(() =>
    require(path.join(REPO_ROOT, 'templates/docusaurus/plugins/sdd-content'))
  );

  await plugin({ siteDir: site, siteConfig: { baseUrl: '/', title: 'Fixture' } }, {}).loadContent();

  const generated = path.join(root, 'docs-generated');
  const adr = fs.readFileSync(path.join(generated, 'decisions/adr-0001-lowercase.mdx'), 'utf-8');

  // The badge header was suppressed entirely, silently, on every ADR page.
  assert.match(adr, /<StatusBadge status="ACCEPTED"/);
  assert.match(adr, /<DateBadge date="2026-01-01"/);
  // A list-valued decision-makers renders joined, not as "[object Object]" and
  // not as a crash.
  assert.match(adr, /Alice, Bob/);
  assert.doesNotMatch(adr, /\[object/);

  assert.match(adr, /## Related Artifacts/);
  assert.ok(fs.existsSync(path.join(generated, 'graph.mdx')), 'expected a graph page');

  fs.rmSync(root, { recursive: true, force: true });
});
