#!/usr/bin/env node
/**
 * Generate Index Page
 *
 * Creates a landing page (index.mdx) for the docs site that links
 * to ADR and spec sections with counts.
 */

const fs = require('fs');
const path = require('path');
const { getGraph, renderFullMermaid } = require('./graph-data');

const ADRS_SOURCE = path.join(__dirname, '../../docs/adrs');
const SPECS_SOURCE = path.join(__dirname, '../../docs/openspec/specs');
const DOCS_DEST = path.join(__dirname, '../../docs-generated');

// Render a "Hierarchy" section showing the full artifact graph as a
// single Mermaid flowchart. Returned as a Markdown block ready to
// append to an index page; empty string when the graph has no nodes
// (e.g., a brand-new project with no ADRs or specs yet).
function renderHierarchySection() {
  const graph = getGraph();
  if (!graph.nodes || Object.keys(graph.nodes).length === 0) return '';
  const mermaid = renderFullMermaid(graph);
  return [
    '',
    '## Hierarchy',
    '',
    'Authored relationships across every ADR and spec in this project (per [ADR-0023](/decisions/ADR-0023-frontmatter-dag-and-graph-skill) / [SPEC-0018](/specs/artifact-graph/spec)). Derived inverses are computed on demand by `/sdd:graph` and omitted here to keep the diagram readable.',
    '',
    '```mermaid',
    mermaid,
    '```',
    '',
  ].join('\n');
}

// Read project title from docusaurus.config.ts
const configPath = path.join(__dirname, '../docusaurus.config.ts');
let projectTitle = 'Architecture Documentation';
if (fs.existsSync(configPath)) {
  const configContent = fs.readFileSync(configPath, 'utf-8');
  const titleMatch = configContent.match(/PROJECT_TITLE\s*=\s*['"]([^'"]+)['"]/);
  if (titleMatch) projectTitle = titleMatch[1];
}

function countAdrs() {
  if (!fs.existsSync(ADRS_SOURCE)) return 0;
  return fs.readdirSync(ADRS_SOURCE)
    .filter(f => f.endsWith('.md') && f !== '0000-template.md' && f !== 'README.md')
    .length;
}

function countSpecs() {
  if (!fs.existsSync(SPECS_SOURCE)) return 0;
  return fs.readdirSync(SPECS_SOURCE)
    .filter(d => {
      const dirPath = path.join(SPECS_SOURCE, d);
      return fs.statSync(dirPath).isDirectory() && fs.existsSync(path.join(dirPath, 'spec.md'));
    })
    .length;
}

function generateSpecsIndex() {
  if (!fs.existsSync(SPECS_SOURCE)) return;

  const specsDest = path.join(DOCS_DEST, 'specs');
  fs.mkdirSync(specsDest, { recursive: true });

  const domains = fs.readdirSync(SPECS_SOURCE)
    .filter(d => fs.statSync(path.join(SPECS_SOURCE, d)).isDirectory())
    .sort();

  const rows = [];
  for (const domain of domains) {
    const domainPath = path.join(SPECS_SOURCE, domain);
    const hasSpec = fs.existsSync(path.join(domainPath, 'spec.md'));
    const hasDesign = fs.existsSync(path.join(domainPath, 'design.md'));

    if (!hasSpec && !hasDesign) continue;

    // Extract title from spec.md H1 heading, stripping SPEC-XXXX: prefix
    let label = domain.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    if (hasSpec) {
      const content = fs.readFileSync(path.join(domainPath, 'spec.md'), 'utf-8');
      const titleMatch = content.match(/^#\s+SPEC-\d+:\s+(.+)$/m);
      if (titleMatch) label = titleMatch[1].trim();
    }

    let docs;
    if (hasSpec && hasDesign) {
      docs = `[Specification](./${domain}/spec) / [Design](./${domain}/design)`;
    } else if (hasSpec) {
      docs = `[Specification](./${domain})`;
    } else {
      docs = `[Design](./${domain})`;
    }

    rows.push(`| ${label} | ${docs} |`);
  }

  if (rows.length === 0) return;

  const content = `---
title: "Specifications"
sidebar_label: "Overview"
sidebar_position: 0
---

# Specifications

| Component | Documents |
|-----------|-----------|
${rows.join('\n')}
${renderHierarchySection()}`;

  fs.writeFileSync(path.join(specsDest, 'index.mdx'), content);
  console.log('  Generated specs index page');
}

function generateDecisionsIndex() {
  if (!fs.existsSync(ADRS_SOURCE)) return;

  const decisionsDest = path.join(DOCS_DEST, 'decisions');
  fs.mkdirSync(decisionsDest, { recursive: true });

  const files = fs.readdirSync(ADRS_SOURCE)
    .filter(f => f.endsWith('.md') && f !== '0000-template.md' && f !== 'README.md')
    .sort();

  // Strikethrough wrapper for stricken statuses, matching the
  // adr-struck sidebar treatment from transform-adrs.js -- consistent
  // visual signal for deprecated/superseded ADRs in both the sidebar
  // and the index table.
  const strike = (text, status) =>
    ['deprecated', 'superseded'].includes(status.toLowerCase()) ? `~~${text}~~` : text;

  const rows = [];
  for (const file of files) {
    const content = fs.readFileSync(path.join(ADRS_SOURCE, file), 'utf-8');

    // Pull the canonical id and short title from the H1 (e.g.,
    // `# ADR-0023: Frontmatter DAG and /sdd:graph Skill`).
    const idMatch = file.match(/^(ADR-\d{4})/);
    const id = idMatch ? idMatch[1] : file.replace(/\.md$/, '');
    const titleMatch = content.match(/^#\s+(?:ADR-\d+:\s*)?(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : id;

    // Status from frontmatter; default to 'unknown' so missing-field
    // ADRs still render a row instead of disappearing silently.
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    let status = 'unknown';
    if (fmMatch) {
      const statusMatch = fmMatch[1].match(/^status:\s*"?([^"\n]+)"?/m);
      if (statusMatch) status = statusMatch[1].trim();
    }

    const slug = file.replace(/\.md$/, '');
    rows.push(`| ${strike(id, status)} | ${strike(`[${title}](./${slug})`, status)} | \`${status}\` |`);
  }

  if (rows.length === 0) return;

  const content = `---
title: "Architecture Decisions"
sidebar_label: "Overview"
sidebar_position: 0
---

# Architecture Decisions

| ID | Title | Status |
|----|-------|--------|
${rows.join('\n')}
${renderHierarchySection()}`;

  fs.writeFileSync(path.join(decisionsDest, 'index.mdx'), content);
  console.log('  Generated decisions index page');
}

function generate() {
  const adrCount = countAdrs();
  const specCount = countSpecs();

  const safeTitle = projectTitle.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  // docs-site divergence from templates: this repo has a hand-written
  // homepage at `src/pages/index.tsx` that owns `/`, so the generated
  // overview lives at `/overview` (linked from the home page's hero
  // button). Keep this slug aligned with `src/pages/index.tsx`.
  const content = `---
title: "Overview"
sidebar_label: "Overview"
sidebar_position: 0
slug: /overview
---

# ${projectTitle}

${adrCount > 0 || specCount > 0
    ? 'Browse the architecture decisions and specifications for this project.'
    : 'No architecture artifacts found yet.'}

${adrCount > 0 ? `## Architecture Decisions

This project has **${adrCount}** ADR${adrCount !== 1 ? 's' : ''} documenting key architectural choices.

[Browse Architecture Decisions \u2192](/decisions)
` : ''}
${specCount > 0 ? `## Specifications

This project has **${specCount}** specification${specCount !== 1 ? 's' : ''} defining capability requirements and design.

[Browse Specifications \u2192](/specs)
` : ''}`;

  fs.mkdirSync(DOCS_DEST, { recursive: true });
  fs.writeFileSync(path.join(DOCS_DEST, 'index.mdx'), content);
  console.log('  Generated index page');

  generateSpecsIndex();
  generateDecisionsIndex();
}

console.log('Generating index page...');
generate();

module.exports = { generate };
