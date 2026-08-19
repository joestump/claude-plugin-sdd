/**
 * Stand-in for the `lib-artifact-transforms` package.
 *
 * templates/docusaurus/plugins/sdd-content requires that package, and it is
 * declared in templates/docusaurus/package.json — a consumer's docs-site
 * installs it, this repo's docs-site does not. Node resolves the request from
 * the plugin's own directory upward, so nothing installed under docs-site/
 * would satisfy it either.
 *
 * The frontmatter parsing itself is real: it delegates to graph-data.js, whose
 * parser mirrors the same YAML-ish grammar, and only reshapes the return value
 * to the `{ metadata }` form the plugin destructures.
 */

const { parseFrontmatter: parseMetadata } = require('../../graph-data');

function parseFrontmatter(text) {
  return { metadata: parseMetadata(text) || {} };
}

function extractStatus(text) {
  return (parseMetadata(text) || {}).status || null;
}

module.exports = { parseFrontmatter, extractStatus };
