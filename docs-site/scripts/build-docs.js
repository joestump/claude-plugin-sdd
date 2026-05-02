#!/usr/bin/env node
/**
 * Build documentation content
 *
 * Orchestrates the transformation of OpenSpecs and ADRs
 * into Docusaurus-compatible MDX files, and copies static
 * content from content/ into docs-generated/.
 */

const fs = require('fs');
const path = require('path');

console.log('Building documentation content...\n');

// Build spec mapping first (needed by transforms)
require('./build-spec-mapping');

// Transform OpenSpecs
require('./transform-openspecs');

// Transform ADRs
require('./transform-adrs');

// Generate index page
require('./generate-index');

// Generate graph page (artifact DAG from frontmatter, per ADR-0023 / SPEC-0018)
require('./generate-graph');

// Copy static content from content/ to docs-generated/
const contentDir = path.join(__dirname, '../content');
const docsDir = path.join(__dirname, '../../docs-generated');

function copyRecursive(src, dest) {
  let count = 0;
  if (!fs.existsSync(src)) return count;
  const entries = fs.readdirSync(src, { withFileTypes: true });
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      count += copyRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
      count++;
    }
  }
  return count;
}

if (fs.existsSync(contentDir)) {
  console.log('Copying static content...');
  const copied = copyRecursive(contentDir, docsDir);
  console.log(`  Copied ${copied} static content file${copied !== 1 ? 's' : ''}`);
}

console.log('\nDocumentation content build complete!');
