/**
 * Unit tests for spec domain layout resolution.
 *
 * transform-openspecs.js emits a domain directory one of two ways — nested
 * under the domain when it holds both spec.md and design.md, flat at the
 * domain itself when it holds only one of them — and build-spec-mapping.js
 * and generate-index.js have to link at whichever it emitted. Both now read
 * the layout from spec-layout.js instead of assuming; these tests pin the
 * shared answer, and the mapping value that falls out of it.
 *
 * Run with `node --test`:
 *
 *   node --test docs-site/scripts/__tests__/spec-layout.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const INTEGRATION_LIB = path.join(REPO_ROOT, 'templates/integration/sync-spec-docs/lib');

const LAYOUT_COPIES = [
  ['docs-site/scripts', require('../spec-layout')],
  ['templates/integration/sync-spec-docs/lib', require(path.join(INTEGRATION_LIB, 'spec-layout'))],
];

function writeSpecsTree() {
  const specsSource = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-spec-layout-'));
  const spec = (id, title) =>
    `---\nstatus: active\ndate: 2026-01-01\n---\n\n# ${id}: ${title}\n\n## Overview\n\nBody.\n`;

  const write = (domain, files) => {
    const dir = path.join(specsSource, domain);
    fs.mkdirSync(dir, { recursive: true });
    for (const [file, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, file), content);
    }
  };

  write('both', { 'spec.md': spec('SPEC-0001', 'Both'), 'design.md': spec('SPEC-0001', 'Both Design') });
  write('spec-only', { 'spec.md': spec('SPEC-0002', 'Spec Only') });
  write('design-only', { 'design.md': spec('SPEC-0003', 'Design Only') });
  write('empty', { 'README.md': 'Not a spec.\n' });

  return specsSource;
}

for (const [label, { getSpecLayout }] of LAYOUT_COPIES) {
  test(`${label}: a domain with both files is nested`, () => {
    const specsSource = writeSpecsTree();
    const layout = getSpecLayout(specsSource, 'both');
    assert.equal(layout.nested, true);
    assert.equal(layout.specSlug, 'both/spec');
    assert.equal(layout.designSlug, 'both/design');
    fs.rmSync(specsSource, { recursive: true, force: true });
  });

  test(`${label}: a spec.md-only domain is flat`, () => {
    const specsSource = writeSpecsTree();
    const layout = getSpecLayout(specsSource, 'spec-only');
    assert.equal(layout.nested, false);
    assert.equal(layout.specSlug, 'spec-only');
    assert.equal(layout.designSlug, null);
    fs.rmSync(specsSource, { recursive: true, force: true });
  });

  test(`${label}: a design.md-only domain is flat`, () => {
    const specsSource = writeSpecsTree();
    const layout = getSpecLayout(specsSource, 'design-only');
    assert.equal(layout.nested, false);
    assert.equal(layout.specSlug, null);
    assert.equal(layout.designSlug, 'design-only');
    fs.rmSync(specsSource, { recursive: true, force: true });
  });

  test(`${label}: a domain with neither file has no slugs`, () => {
    const specsSource = writeSpecsTree();
    const layout = getSpecLayout(specsSource, 'empty');
    assert.deepEqual(
      { hasSpec: layout.hasSpec, hasDesign: layout.hasDesign, specSlug: layout.specSlug, designSlug: layout.designSlug },
      { hasSpec: false, hasDesign: false, specSlug: null, designSlug: null }
    );
    fs.rmSync(specsSource, { recursive: true, force: true });
  });
}

test('integration lib: the mapping routes each domain at the page it renders as', () => {
  const specsSource = writeSpecsTree();
  const { buildSpecMapping } = require(path.join(INTEGRATION_LIB, 'build-spec-mapping'));

  const { specMapping } = buildSpecMapping({ specsSource, pathPrefix: '/architecture' });

  assert.equal(specMapping['SPEC-0001'], '/architecture/specs/both/spec');
  // The regression: this was '/architecture/specs/spec-only/spec', which the
  // transform never writes for a domain carrying no design.md.
  assert.equal(specMapping['SPEC-0002'], '/architecture/specs/spec-only');
  // A design.md-only domain contributes no spec entry at all.
  assert.equal(specMapping['SPEC-0003'], undefined);

  fs.rmSync(specsSource, { recursive: true, force: true });
});
