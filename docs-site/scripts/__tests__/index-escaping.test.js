/**
 * Unit tests for MDX-escaping artifact titles in the generated index pages
 * and the graph page's orphan tables.
 *
 * The per-page transforms push every file through escapeMdxUnsafe, but the
 * index rows and the orphan tables embed the raw H1 title straight into a
 * Markdown table cell. A title with `{` or `<` (for example "Use Result<T,
 * E> for errors") makes the generated .mdx fail to parse even though the
 * ADR page itself compiles, and a `|` in a title splits the table row into
 * extra columns.
 *
 * Run with `node --test`:
 *
 *   node --test docs-site/scripts/__tests__/index-escaping.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../../..');

// See mermaid-labels.test.js: `lib-artifact-transforms` is only installed by a
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

// One title carrying every hazard at once: angle brackets, curly braces and
// a pipe. `>` is left alone by escapeMdxUnsafe (it is only dangerous paired
// with an unescaped `<`), and `|` needs the table-cell-specific backslash
// that escapeMdxUnsafe never adds.
const ADR_TITLE = 'Use Result<T, E> for {reasons} | errors';
const ADR_TITLE_ESCAPED = 'Use Result&lt;T, E> for \\{reasons\\} \\| errors';
const SPEC_TITLE = 'Handle A | B in <mode> {x}';
const SPEC_TITLE_ESCAPED = 'Handle A \\| B in &lt;mode> \\{x\\}';

function writeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-index-escaping-'));
  const site = path.join(root, 'site');
  fs.mkdirSync(site, { recursive: true });

  const adrs = path.join(root, 'docs/adrs');
  fs.mkdirSync(adrs, { recursive: true });
  fs.writeFileSync(
    path.join(adrs, 'ADR-0001-escapes.md'),
    '---\nstatus: accepted\ndate: 2026-01-01\n---\n\n' +
      `# ADR-0001: ${ADR_TITLE}\n\n## Context\n\nSomething.\n`
  );

  // spec.md only (no design.md), so the domain renders as the flat page
  // /specs/handle-mode and the specs index links to ./handle-mode. Neither
  // artifact declares an edge to the other, so both land in the graph page's
  // orphan tables.
  const domain = path.join(root, 'docs/openspec/specs/handle-mode');
  fs.mkdirSync(domain, { recursive: true });
  fs.writeFileSync(
    path.join(domain, 'spec.md'),
    '---\nstatus: active\ndate: 2026-01-01\n---\n\n' +
      `# SPEC-0001: ${SPEC_TITLE}\n\n## Overview\n\nSomething.\n`
  );

  return { root, site };
}

// A GFM cell boundary is a | not preceded by a backslash; counting those is
// what catches a raw pipe in a title widening the row instead of escaping it.
function unescapedPipes(line) {
  return (line.match(/(?<!\\)\|/g) || []).length;
}

// Markdown table rows of a generated page. The Hierarchy mermaid block is
// deliberately excluded: its quoted labels have their own escaping contract
// (#257, covered by mermaid-labels.test.js) and keep the raw title.
function tableRows(body) {
  return body.split('\n').filter((line) => line.startsWith('|'));
}

test('plugin template: index rows and orphan tables escape MDX-unsafe titles', async () => {
  const { root, site } = writeFixture();
  const plugin = withArtifactTransformsStub(() =>
    require(path.join(REPO_ROOT, 'templates/docusaurus/plugins/sdd-content'))
  );

  await plugin({ siteDir: site, siteConfig: { baseUrl: '/', title: 'Fixture' } }, {}).loadContent();

  const generated = path.join(root, 'docs-generated');

  const decisions = fs.readFileSync(path.join(generated, 'decisions/index.mdx'), 'utf-8');
  const adrLine = decisions.split('\n').find((line) => line.startsWith('| ADR-0001 '));
  assert.ok(adrLine, 'decisions index must list ADR-0001');
  assert.equal(adrLine, `| ADR-0001 | [${ADR_TITLE_ESCAPED}](./ADR-0001-escapes) | \`accepted\` |`);
  assert.equal(unescapedPipes(adrLine), 4, 'the title pipe must not split the row');
  assert.ok(
    !tableRows(decisions).some((line) => line.includes(ADR_TITLE)),
    'raw ADR title must not reach an index table row'
  );

  const specs = fs.readFileSync(path.join(generated, 'specs/index.mdx'), 'utf-8');
  const specLine = specs.split('\n').find((line) => line.includes(SPEC_TITLE_ESCAPED));
  assert.ok(specLine, 'specs index must list the escaped spec label');
  assert.equal(specLine, `| ${SPEC_TITLE_ESCAPED} | [Specification](./handle-mode) |`);
  assert.equal(unescapedPipes(specLine), 3, 'the title pipe must not split the row');
  assert.ok(
    !tableRows(specs).some((line) => line.includes(SPEC_TITLE)),
    'raw spec title must not reach an index table row'
  );

  const graph = fs.readFileSync(path.join(generated, 'graph.mdx'), 'utf-8');
  const orphanAdrLine = graph.split('\n').find((line) => line.startsWith('| ADR-0001 '));
  assert.ok(orphanAdrLine, 'graph page must list the orphan ADR');
  assert.equal(orphanAdrLine, `| ADR-0001 | ${ADR_TITLE_ESCAPED} |`);
  const orphanSpecLine = graph.split('\n').find((line) => line.startsWith('| SPEC-0001 '));
  assert.ok(orphanSpecLine, 'graph page must list the orphan spec');
  assert.equal(orphanSpecLine, `| SPEC-0001 | ${SPEC_TITLE_ESCAPED} |`);
  assert.ok(
    !tableRows(graph).some((line) => line.includes(ADR_TITLE)),
    'raw ADR title must not reach the orphan table'
  );
  assert.ok(
    !tableRows(graph).some((line) => line.includes(SPEC_TITLE)),
    'raw spec title must not reach the orphan table'
  );

  fs.rmSync(root, { recursive: true, force: true });
});
