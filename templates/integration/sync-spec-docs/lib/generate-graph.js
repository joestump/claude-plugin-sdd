/**
 * Generate Graph Page (Integration Mode)
 *
 * Reads ADR and spec frontmatter (the artifact graph schema from
 * ADR-0023 / SPEC-0018), produces a Docusaurus-ready Graph page with
 * stats, full-graph Mermaid flowchart, and orphan tables.
 *
 * Adapted for integration mode: all paths received via parameters.
 *
 * @param {Object} config
 * @param {string} config.adrsSource - Absolute path to the ADR source directory
 * @param {string} config.specsSource - Absolute path to the specs source directory
 * @param {string} config.outputDir - Absolute path to the output directory
 * @param {string} [config.adrPathPrefix] - URL prefix for ADR cross-links (default `/decisions`)
 * @param {string} [config.specPathPrefix] - URL prefix for spec cross-links (default `/specs`)
 */

const fs = require('fs');
const path = require('path');
const { buildGraph, renderFullMermaid } = require('./graph-data');

function generateGraph(config) {
  const {
    adrsSource,
    specsSource,
    outputDir,
    adrPathPrefix = '/decisions',
    specPathPrefix = '/specs',
  } = config;

  const graph = buildGraph({ adrsSource, specsSource });
  const { nodes, edges, orphanAdrs, orphanSpecs } = graph;

  const adrCount = Object.values(nodes).filter((n) => n.kind === 'adr').length;
  const specCount = Object.values(nodes).filter((n) => n.kind === 'spec').length;
  const authoredEdges = edges.filter((e) => !e.derived);
  const derivedEdges = edges.filter((e) => e.derived);

  if (adrCount + specCount === 0) {
    console.log('[sync-spec-docs] Skipped graph page: no artifacts');
    return;
  }

  const mermaid = renderFullMermaid(graph);

  const stripIdPrefix = (title, id) =>
    (title || '').replace(new RegExp(`^${id}:\\s*`), '');
  const orphanAdrRows = orphanAdrs.length
    ? orphanAdrs.map((id) => `| ${id} | ${stripIdPrefix(nodes[id] && nodes[id].title, id)} |`).join('\n')
    : '_No orphan ADRs — every ADR has at least one implementing spec._';
  const orphanSpecRows = orphanSpecs.length
    ? orphanSpecs.map((id) => `| ${id} | ${stripIdPrefix(nodes[id] && nodes[id].title, id)} |`).join('\n')
    : '_No orphan specs — every spec is governed by at least one ADR._';

  const content = `---
title: "Architecture Graph"
sidebar_label: "Graph"
sidebar_position: 1
---

# Architecture Graph

The artifact graph captures explicit relationships between ADRs and specs declared in YAML frontmatter (per ADR-0023 / SPEC-0018). Edges describe \`supersedes\`, \`extends\`, \`enables\`, \`governs\`, \`implements\`, \`requires\`, and \`related\` relationships. The page below reflects the authored edges only; derived inverses (\`governed-by\`, \`implemented-by\`, etc.) are computed at query time by the \`/sdd:graph\` skill.

## Stats

| Metric | Count |
|--------|-------|
| ADRs | ${adrCount} |
| Specs | ${specCount} |
| Authored edges | ${authoredEdges.length} |
| Derived edges (computed) | ${derivedEdges.length} |
| Orphan ADRs (no implementing spec) | ${orphanAdrs.length} |
| Orphan specs (no governing ADR) | ${orphanSpecs.length} |

## Full graph

\`\`\`mermaid
${mermaid}
\`\`\`

## Orphan ADRs

ADRs that no spec declares \`implements:\` against. Add an \`implements: [ADR-XXXX]\` line to a spec's frontmatter (or run \`/sdd:graph backfill\`) to remove an ADR from this list.

| ADR | Title |
|-----|-------|
${orphanAdrRows}

## Orphan specs

Specs that no ADR declares \`governs:\` against.

| Spec | Title |
|------|-------|
${orphanSpecRows}

## Querying the graph

The static view above is generated at docs-build time. For interactive queries:

\`\`\`
/sdd:graph validate                  # full diagnostics
/sdd:graph impact ADR-XXXX           # what depends on this ADR
/sdd:graph ancestors SPEC-XXXX       # what this spec depends on
/sdd:graph chain SPEC-XXXX           # bidirectional view
/sdd:graph orphans                   # source files, specs, ADRs
/sdd:graph backfill                  # propose edges from prose
\`\`\`

JSON output (\`--json\`) is the stable contract for any future MCP, IDE plugin, or dashboard.
`;

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'graph.mdx'), content);
  console.log('[sync-spec-docs] Generated graph page');
}

module.exports = { generateGraph };
