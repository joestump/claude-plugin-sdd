/**
 * Generate Index Page (Integration Mode)
 *
 * Creates a landing page (index.mdx) for the architecture docs section
 * that links to ADR and spec sections with counts.
 *
 * Adapted for integration mode: all paths received via parameters.
 *
 * @param {Object} config
 * @param {string} config.adrsSource - Absolute path to the ADR source directory
 * @param {string} config.specsSource - Absolute path to the specs source directory
 * @param {string} config.outputDir - Absolute path to the output directory
 * @param {string} config.projectTitle - Title for the landing page
 */

const fs = require('fs');
const path = require('path');

function countAdrs(adrsSource) {
  if (!fs.existsSync(adrsSource)) return 0;
  return fs.readdirSync(adrsSource)
    .filter(f => f.endsWith('.md') && f !== '0000-template.md' && f !== 'README.md')
    .length;
}

function countSpecs(specsSource) {
  if (!fs.existsSync(specsSource)) return 0;
  return fs.readdirSync(specsSource)
    .filter(d => {
      const dirPath = path.join(specsSource, d);
      return fs.statSync(dirPath).isDirectory() && fs.existsSync(path.join(dirPath, 'spec.md'));
    })
    .length;
}

function generateSpecsIndex(specsSource, outputDir) {
  if (!fs.existsSync(specsSource)) return;

  const specsDest = path.join(outputDir, 'specs');
  fs.mkdirSync(specsDest, { recursive: true });

  const domains = fs.readdirSync(specsSource)
    .filter(d => fs.statSync(path.join(specsSource, d)).isDirectory())
    .sort();

  const rows = [];
  for (const domain of domains) {
    const domainPath = path.join(specsSource, domain);
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
`;

  fs.writeFileSync(path.join(specsDest, 'index.mdx'), content);
  console.log('    Generated specs index page');
}

function generateIndex(config) {
  const { adrsSource, specsSource, outputDir, projectTitle = 'Architecture Documentation' } = config;

  console.log('  [sync-spec-docs] Generating index page...');

  const adrCount = countAdrs(adrsSource);
  const specCount = countSpecs(specsSource);

  const safeTitle = `${projectTitle} - Architecture`.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const content = `---
title: "${safeTitle}"
sidebar_label: Overview
sidebar_position: 0
---

# Architecture Documentation

${adrCount > 0 || specCount > 0
    ? 'Browse the architecture decisions and specifications for this project.'
    : 'No architecture artifacts found yet.'}

${adrCount > 0 ? `## Architecture Decisions

This project has **${adrCount}** ADR${adrCount !== 1 ? 's' : ''} documenting key architectural choices.

[Browse Architecture Decisions \u2192](decisions)
` : ''}
${specCount > 0 ? `## Specifications

This project has **${specCount}** specification${specCount !== 1 ? 's' : ''} defining capability requirements and design.

[Browse Specifications \u2192](specs)
` : ''}`;

  fs.mkdirSync(outputDir, { recursive: true });

  // Write _category_.json for the architecture section
  fs.writeFileSync(path.join(outputDir, '_category_.json'), JSON.stringify({
    label: 'Architecture',
    position: 99,
    link: {
      type: 'doc',
      id: 'architecture/index',
    }
  }, null, 2));

  fs.writeFileSync(path.join(outputDir, 'index.mdx'), content);
  console.log('    Generated index page');

  generateSpecsIndex(specsSource, outputDir);
}

module.exports = { generateIndex };
