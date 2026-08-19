/**
 * Build Spec ID Mapping
 *
 * Scans all OpenSpec files and generates the mapping the reference
 * transforms resolve against: one entry per spec artifact ID (SPEC-0008), plus
 * one per domain-scoped requirement prefix (ARCH).
 *
 * Adapted for integration mode: accepts specsSource and pathPrefix as
 * parameters and returns mapping data instead of writing to files.
 *
 * @param {Object} config
 * @param {string} config.specsSource - Absolute path to the specs source directory
 * @param {string} [config.pathPrefix=''] - URL prefix for namespaced output (e.g., '/architecture')
 * @returns {{ specMapping: Object, specEmojis: Object }}
 */

const fs = require('fs');
const path = require('path');
const { getSpecLayout } = require('./spec-layout');

function buildSpecMapping({ specsSource, pathPrefix = '' }) {
  const specMapping = {};
  const specEmojis = {};

  if (!fs.existsSync(specsSource)) {
    return { specMapping, specEmojis };
  }

  const domains = fs.readdirSync(specsSource);

  for (const domain of domains) {
    const domainPath = path.join(specsSource, domain);
    if (!fs.statSync(domainPath).isDirectory()) continue;

    // Both keys registered below point at this domain's spec page, whose route
    // depends on the layout transform-openspecs.js emits for the domain.
    const layout = getSpecLayout(specsSource, domain);
    if (!layout.hasSpec) continue;
    const specRoute = `${pathPrefix}/specs/${layout.specSlug}`;

    const content = fs.readFileSync(path.join(domainPath, 'spec.md'), 'utf-8');

    const prefixes = new Set();

    // The H1 declares the spec's own artifact ID — `# SPEC-0008: {Title}`.
    // That ID is unique across the whole project, so it is keyed by the full
    // ID. The requirement IDs collected below really are domain-scoped, so
    // those stay keyed by their prefix; keying the artifact ID the same way
    // gave every domain the identical "SPEC" key, and whichever domain was
    // read last then owned every SPEC-NNNN cross-reference on the site.
    const h1Match = content.match(/^#\s+([A-Z]+-\d{4}):/m);
    // Not `ADR-NNNN`: a spec.md whose H1 still carries an ADR number -- a
    // conversion that was never renumbered -- would register that ID here, and
    // transformSpecReferences runs before transformAdrReferences, so every
    // ADR-NNNN mention on the site would resolve to this spec page. Same
    // reason `prefixes.delete('ADR')` exists below; the full-ID key bypasses
    // the prefix set, so it needs the guard too.
    if (h1Match && !h1Match[1].startsWith('ADR-')) {
      specMapping[h1Match[1]] = specRoute;
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
      specMapping[prefix] = specRoute;
    }
  }

  return { specMapping, specEmojis };
}

module.exports = { buildSpecMapping };
