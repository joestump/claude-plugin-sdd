/**
 * Build Spec ID Mapping
 *
 * Scans all OpenSpec files to extract spec ID prefixes and generates
 * a mapping from prefix to spec URL path.
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

    const specPath = path.join(domainPath, 'spec.md');
    if (!fs.existsSync(specPath)) continue;

    const content = fs.readFileSync(specPath, 'utf-8');

    const prefixes = new Set();

    // Match spec number from H1 heading: # SPEC-XXXX: {Title}
    const h1Match = content.match(/^#\s+([A-Z]+)-\d{4}:/m);
    if (h1Match) {
      prefixes.add(h1Match[1]);
    }

    // Also match spec IDs in table format: | ARCH-001 | ... |
    const tableMatches = content.matchAll(/\|\s*([A-Z]+)-\d{3,4}\s*\|/g);
    for (const match of tableMatches) {
      prefixes.add(match[1]);
    }

    // Also match spec IDs in requirement headings: ### Requirement: ARCH-001
    const headingMatches = content.matchAll(/###\s+Requirement:.*?([A-Z]+)-\d{3,4}/g);
    for (const match of headingMatches) {
      prefixes.add(match[1]);
    }

    for (const prefix of prefixes) {
      specMapping[prefix] = `${pathPrefix}/specs/${domain}/spec`;
    }
  }

  return { specMapping, specEmojis };
}

module.exports = { buildSpecMapping };
