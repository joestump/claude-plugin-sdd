/**
 * Transform OpenSpecs for Docusaurus (Integration Mode)
 *
 * Reads markdown files from the project's docs/openspec/specs/ directory and
 * writes them to the integration output directory with Docusaurus frontmatter,
 * RFC 2119 keyword highlighting, and cross-references.
 *
 * Adapted for integration mode: all paths and config received via parameters.
 *
 * @param {Object} config
 * @param {string} config.specsSource - Absolute path to the specs source directory
 * @param {string} config.specsDest - Absolute path to the output directory for transformed specs
 * @param {string} config.adrsSource - Absolute path to the ADR source directory (for cross-refs)
 * @param {string} config.baseUrl - Docusaurus baseUrl (from context.siteConfig.baseUrl)
 * @param {string} config.pathPrefix - URL prefix for cross-references (e.g., '/architecture')
 * @param {Object} config.specMapping - Spec prefix to URL path mapping
 * @param {Object} config.specEmojis - Spec prefix to emoji mapping
 */

const fs = require('fs');
const path = require('path');
const { escapeMdxUnsafe } = require('./mdx-escape');
const {
  buildAdrMapping,
  transformRfc2119Keywords,
  transformSpecReferences,
  transformAdrReferences,
  fixMarkdownLinks,
} = require('./transform-utils');

const ADR_EMOJI = '\ud83d\udcdd';

/** Escape double quotes for YAML frontmatter values */
function escapeYaml(str) {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Escape special chars for JSX attribute values (double-quoted) */
function escapeJsxAttr(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Auto-discover domains and build config from directory structure.
 * Generates labels from directory names: "web-dashboard" -> "Web Dashboard"
 */
function buildDomainConfig(specsSource) {
  const config = {};
  if (!fs.existsSync(specsSource)) return config;

  const domains = fs.readdirSync(specsSource)
    .filter(d => fs.statSync(path.join(specsSource, d)).isDirectory())
    .sort();

  domains.forEach((domain, index) => {
    const specPath = path.join(specsSource, domain, 'spec.md');
    if (fs.existsSync(specPath)) {
      const content = fs.readFileSync(specPath, 'utf-8');
      const specMatch = content.match(/^#\s+SPEC-\d+:\s+(.+)$/m);
      if (specMatch) {
        const label = specMatch[1].trim();
        config[domain] = { order: index + 1, label: label };
        return;
      }
    }

    // Fallback: humanize the directory name
    const label = domain
      .split('-')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
    config[domain] = { order: index + 1, label: label };
  });

  return config;
}

function extractMetadata(content, fileType) {
  let status = null;
  let date = null;

  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const fm = fmMatch[1];
    const statusMatch = fm.match(/^status:\s*(.+)$/m);
    const dateMatch = fm.match(/^date:\s*(.+)$/m);
    if (statusMatch) status = statusMatch[1].trim();
    if (dateMatch) date = dateMatch[1].trim();
    content = content.slice(fmMatch[0].length).replace(/^\n+/, '');
  }

  if (!status) status = fileType === 'spec' ? 'active' : 'draft';
  if (!date) date = 'unknown';

  return { status, date, content };
}

function extractTitle(content) {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : 'Untitled';
}

function fixRelativePaths(content) {
  content = content.replace(/\]\(\.\.\/\.\.\/\.\.\/decisions\//g, '](../../decisions/');
  content = content.replace(/\]\(\.\.\/\.\.\/\.\.\/docs\//g, '](../../');
  return content;
}

function transformRequirementTables(content) {
  const tableRegex = /\| ID \| Requirement \|\n\|[-| ]+\|\n((?:\| [A-Z0-9-]+ \| .* \|\n)+)/g;

  return content.replace(tableRegex, (match, rows) => {
    const rowRegex = /\| ([A-Z0-9-]+) \| (.*) \|/g;
    let result = '';
    let rowMatch;

    while ((rowMatch = rowRegex.exec(rows)) !== null) {
      const id = rowMatch[1].trim();
      const text = rowMatch[2].trim();
      result += `<RequirementBox id="${id}">\n\n${text}\n\n</RequirementBox>\n\n`;
    }

    return result;
  });
}

function transformSpec(srcPath, destPath, domain, fileType, domainConfig, transformConfig, flat) {
  let content = fs.readFileSync(srcPath, 'utf-8');
  const { baseUrl, pathPrefix, specMapping, specEmojis, adrMapping } = transformConfig;
  const config = domainConfig[domain] || { order: 99, label: domain };

  const metadata = extractMetadata(content, fileType);
  content = metadata.content;
  const title = extractTitle(content);

  content = fixRelativePaths(content);
  content = fixMarkdownLinks(content);

  if (fileType === 'spec') {
    content = transformRequirementTables(content);
  }

  content = transformRfc2119Keywords(content);
  content = transformSpecReferences(content, { specMapping, specEmojis, baseUrl });
  content = transformAdrReferences(content, { adrMapping, adrEmoji: ADR_EMOJI, baseUrl });

  const sidebarLabel = flat ? config.label : (fileType === 'spec' ? 'Specification' : 'Design');
  const sidebarPosition = flat ? config.order : (fileType === 'spec' ? 1 : 2);

  const metadataHeader = `
<FieldGroup>
  <Field label="Status">
    <StatusBadge status="${escapeJsxAttr(metadata.status.toUpperCase())}" />
  </Field>
  <Field label="Date">
    <DateBadge date="${escapeJsxAttr(metadata.date)}" />
  </Field>
  <Field label="Domain">
    <DomainBadge domain="${escapeJsxAttr(config.label)}" />
  </Field>
</FieldGroup>
`;

  const frontmatter = `---
title: "${escapeYaml(title)}"
sidebar_label: "${escapeYaml(sidebarLabel)}"
sidebar_position: ${sidebarPosition}
---

${metadataHeader}

`;

  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, frontmatter + escapeMdxUnsafe(content));
}

function generateCategoryJson(destDir, domain, domainConfig) {
  const config = domainConfig[domain] || { order: 99, label: domain };

  const categoryData = {
    label: config.label,
    position: config.order,
    link: {
      type: 'generated-index',
      description: `${config.label} specifications and design documents.`
    }
  };

  const categoryPath = path.join(destDir, '_category_.json');
  fs.writeFileSync(categoryPath, JSON.stringify(categoryData, null, 2));
}

function transformOpenspecs(config) {
  const {
    specsSource,
    specsDest,
    adrsSource,
    baseUrl,
    pathPrefix = '',
    specMapping = {},
    specEmojis = {},
  } = config;

  console.log('  [sync-spec-docs] Transforming OpenSpecs...');

  if (!fs.existsSync(specsSource)) {
    console.log('    No specs directory found, skipping OpenSpec transform');
    return;
  }

  // Auto-discover domain config
  const domainConfig = buildDomainConfig(specsSource);

  if (fs.existsSync(specsDest)) {
    fs.rmSync(specsDest, { recursive: true });
  }
  fs.mkdirSync(specsDest, { recursive: true });

  fs.writeFileSync(path.join(specsDest, '_category_.json'), JSON.stringify({
    label: 'Specifications',
    position: 1,
  }, null, 2));

  const adrMapping = buildAdrMapping(adrsSource, pathPrefix);

  const transformConfig = { baseUrl, pathPrefix, specMapping, specEmojis, adrMapping };

  const domains = fs.readdirSync(specsSource);
  let fileCount = 0;

  for (const domain of domains) {
    const domainPath = path.join(specsSource, domain);
    if (!fs.statSync(domainPath).isDirectory()) continue;

    const hasSpec = fs.existsSync(path.join(domainPath, 'spec.md'));
    const hasDesign = fs.existsSync(path.join(domainPath, 'design.md'));

    if (!hasSpec && !hasDesign) continue;

    if (hasSpec && hasDesign) {
      // Both docs: create subdirectory with _category_.json
      const destDomainPath = path.join(specsDest, domain);
      fs.mkdirSync(destDomainPath, { recursive: true });
      generateCategoryJson(destDomainPath, domain, domainConfig);

      transformSpec(path.join(domainPath, 'spec.md'), path.join(destDomainPath, 'spec.mdx'), domain, 'spec', domainConfig, transformConfig, false);
      transformSpec(path.join(domainPath, 'design.md'), path.join(destDomainPath, 'design.mdx'), domain, 'design', domainConfig, transformConfig, false);
      fileCount += 2;
    } else {
      // Single doc: emit as flat file (leaf item in sidebar)
      const file = hasSpec ? 'spec.md' : 'design.md';
      const fileType = hasSpec ? 'spec' : 'design';
      const destPath = path.join(specsDest, `${domain}.mdx`);
      transformSpec(path.join(domainPath, file), destPath, domain, fileType, domainConfig, transformConfig, true);
      fileCount++;
    }
  }

  console.log(`    Transformed ${fileCount} spec files across ${Object.keys(domainConfig).length} domains`);
}

module.exports = { transformOpenspecs };
