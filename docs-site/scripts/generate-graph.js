#!/usr/bin/env node
/**
 * Generate Graph Page
 *
 * Reads ADR and spec frontmatter (the artifact graph schema from
 * ADR-0023 / SPEC-0018), produces a Docusaurus-ready Graph page with:
 *   - graph stats (counts of nodes, authored edges, orphans)
 *   - full-graph Mermaid flowchart
 *   - orphan tables (ADRs without implementing spec, specs without
 *     governing ADR)
 *
 * The authoritative graph implementation is `skills/graph/lib/graph.py`
 * — this script is a static-page reflection that runs at docs-build
 * time without bringing Python into the build pipeline.
 */

const fs = require('fs');
const path = require('path');
const { buildGraph, renderFullMermaid } = require('./graph-data');

const ADRS_SOURCE = path.join(__dirname, '../../docs/adrs');
const SPECS_SOURCE = path.join(__dirname, '../../docs/openspec/specs');
const DOCS_DEST = path.join(__dirname, '../../docs-generated');

function generate() {
  const graph = buildGraph({ adrsSource: ADRS_SOURCE, specsSource: SPECS_SOURCE });
  const { nodes, edges, orphanAdrs, orphanSpecs } = graph;

  const adrCount = Object.values(nodes).filter((n) => n.kind === 'adr').length;
  const specCount = Object.values(nodes).filter((n) => n.kind === 'spec').length;
  const authoredEdges = edges.filter((e) => !e.derived);
  const derivedEdges = edges.filter((e) => e.derived);

  if (adrCount + specCount === 0) {
    console.log('  Skipped graph page: no artifacts');
    return;
  }

  const mermaid = renderFullMermaid(graph);

  const stripIdPrefix = (title, id) =>
    (title || '').replace(new RegExp(`^${id}:\\s*`), '');
  const orphanAdrSection = orphanAdrs.length
    ? `| ADR | Title |\n|-----|-------|\n${orphanAdrs
        .map((id) => `| ${id} | ${stripIdPrefix(nodes[id] && nodes[id].title, id)} |`)
        .join('\n')}`
    : '_No orphan ADRs — every ADR has at least one implementing spec._';
  const orphanSpecSection = orphanSpecs.length
    ? `| Spec | Title |\n|------|-------|\n${orphanSpecs
        .map((id) => `| ${id} | ${stripIdPrefix(nodes[id] && nodes[id].title, id)} |`)
        .join('\n')}`
    : '_No orphan specs — every spec is governed by at least one ADR._';

  const content = `---
title: "Architecture Graph"
sidebar_label: "Graph"
sidebar_position: 1
---

# Architecture Graph

The artifact graph captures explicit relationships between ADRs and specs declared in YAML frontmatter (per [ADR-0023](/decisions/ADR-0023-frontmatter-dag-and-graph-skill) and [SPEC-0018](/specs/artifact-graph/spec)). Edges describe \`supersedes\`, \`extends\`, \`enables\`, \`governs\`, \`implements\`, \`requires\`, and \`related\` relationships between artifacts. The page below reflects the authored edges only; derived inverses (\`governed-by\`, \`implemented-by\`, etc.) are computed at query time by the \`/sdd:graph\` skill.

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

${orphanAdrSection}

## Orphan specs

Specs that no ADR declares \`governs:\` against. (For specs whose source-code coverage is the relevant orphan signal, use \`/sdd:graph orphans\` directly — that walks source files for governing comments and is not reflected in this static page.)

${orphanSpecSection}

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

  fs.mkdirSync(DOCS_DEST, { recursive: true });
  fs.writeFileSync(path.join(DOCS_DEST, 'graph.mdx'), content);
  console.log('  Generated graph page');
}

console.log('Generating graph page...');
generate();

module.exports = { generate };
