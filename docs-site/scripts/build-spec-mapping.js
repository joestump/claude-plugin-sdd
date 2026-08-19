#!/usr/bin/env node
/**
 * Build Spec ID Mapping
 *
 * Scans all OpenSpec files and generates the mapping the reference
 * transforms resolve against: one entry per spec artifact ID (SPEC-0008), plus
 * one per domain-scoped requirement prefix (ARCH).
 *
 * Output: src/data/spec-mapping.json
 */

const fs = require('fs');
const path = require('path');

const SPECS_SOURCE = path.join(__dirname, '../../docs/openspec/specs');
const MAPPING_DEST = path.join(__dirname, '../src/data/spec-mapping.json');
const EMOJIS_DEST = path.join(__dirname, '../src/data/spec-emojis.json');

function buildMapping() {
  const mapping = {};

  if (!fs.existsSync(SPECS_SOURCE)) {
    console.log('  No specs directory found, skipping spec mapping');
    fs.mkdirSync(path.dirname(MAPPING_DEST), { recursive: true });
    fs.writeFileSync(MAPPING_DEST, JSON.stringify(mapping, null, 2));
    return mapping;
  }

  const domains = fs.readdirSync(SPECS_SOURCE);

  for (const domain of domains) {
    const domainPath = path.join(SPECS_SOURCE, domain);
    if (!fs.statSync(domainPath).isDirectory()) continue;

    const specPath = path.join(domainPath, 'spec.md');
    if (!fs.existsSync(specPath)) continue;

    const content = fs.readFileSync(specPath, 'utf-8');

    const prefixes = new Set();

    // The H1 declares the spec's own artifact ID — `# SPEC-0008: {Title}`.
    // That ID is unique across the whole project, so it is keyed by the full
    // ID. The requirement IDs collected below really are domain-scoped, so
    // those stay keyed by their prefix; keying the artifact ID the same way
    // gave every domain the identical "SPEC" key, and whichever domain was
    // read last then owned every SPEC-NNNN cross-reference on the site.
    const h1Match = content.match(/^#\s+([A-Z]+-\d{4}):/m);
    if (h1Match) {
      mapping[h1Match[1]] = `/specs/${domain}/spec`;
    }

    // Also match spec IDs in table format: | ARCH-001 | ... |
    const tableMatches = content.matchAll(/\|\s*([A-Z]+)-\d{3,4}\s*\|/g);
    for (const match of tableMatches) {
      prefixes.add(match[1]);
    }

    // Also match spec IDs in requirement headings: ### Requirement: ARCH-001
// /gm and the ^ anchor: unanchored, this matched a paragraph that merely
    // mentioned `### Requirement:` and went on to cite an ADR later in the same
    // line, adding "ADR" as a spec prefix. transformSpecReferences runs before
    // transformAdrReferences, so that one stray key sent every ADR-NNNN link on
    // the site to a spec page.
    const headingMatches = content.matchAll(/^###\s+Requirement:.*?([A-Z]+)-\d{3,4}/gm);
    for (const match of headingMatches) {
      prefixes.add(match[1]);
    }

    // ADR-NNNN belongs to transformAdrReferences. A spec that tabulates ADR
    // numbers must not claim the prefix out from under it.
    prefixes.delete('ADR');

    for (const prefix of prefixes) {
      mapping[prefix] = `/specs/${domain}/spec`;
    }
  }

  fs.mkdirSync(path.dirname(MAPPING_DEST), { recursive: true });
  fs.writeFileSync(MAPPING_DEST, JSON.stringify(mapping, null, 2));

  // Also ensure emojis file exists (user can customize)
  if (!fs.existsSync(EMOJIS_DEST)) {
    fs.writeFileSync(EMOJIS_DEST, JSON.stringify({}, null, 2));
  }

  console.log(`  Generated spec mapping with ${Object.keys(mapping).length} entries`);
  return mapping;
}

if (require.main === module) {
  console.log('Building spec mapping...');
  buildMapping();
}

module.exports = { buildMapping };
