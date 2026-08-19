/**
 * Spec Domain Layout
 *
 * A spec domain directory renders one of two ways, and every consumer of the
 * generated site has to agree on which. A domain holding both spec.md and
 * design.md becomes a category directory, so its pages live at
 * `/specs/<domain>/spec` and `/specs/<domain>/design`. A domain holding only
 * one of the two becomes a single flat page at `/specs/<domain>`.
 *
 * The transform decides the layout per domain while writing files; the spec-ID
 * mapping and the specs index have to link at whatever it decided. This module
 * is where that decision is made, so the others read it instead of re-deriving
 * it and disagreeing.
 *
 * @joestump-agent 08/19/2026 - Extracted from transform-openspecs.js. The
 * mapping hardcoded the nested `/specs/<domain>/spec` route for every domain,
 * so every cross-reference to a spec whose directory carries no design.md
 * resolved to a page the transform never wrote.
 */

const fs = require('fs');
const path = require('path');

/**
 * Describe how one spec domain directory renders.
 *
 * `specSlug` and `designSlug` are route segments relative to the specs root —
 * `auth/spec` when the domain is nested, `auth` when it is flat — and are null
 * when the corresponding source file is absent.
 *
 * @param {string} specsSource - Absolute path to the specs source directory
 * @param {string} domain - Domain directory name
 * @returns {{domainPath: string, hasSpec: boolean, hasDesign: boolean,
 *            nested: boolean, specSlug: string|null, designSlug: string|null}}
 */
function getSpecLayout(specsSource, domain) {
  const domainPath = path.join(specsSource, domain);
  const hasSpec = fs.existsSync(path.join(domainPath, 'spec.md'));
  const hasDesign = fs.existsSync(path.join(domainPath, 'design.md'));
  const nested = hasSpec && hasDesign;

  return {
    domainPath,
    hasSpec,
    hasDesign,
    nested,
    specSlug: hasSpec ? (nested ? `${domain}/spec` : domain) : null,
    designSlug: hasDesign ? (nested ? `${domain}/design` : domain) : null,
  };
}

module.exports = { getSpecLayout };
