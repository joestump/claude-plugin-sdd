/**
 * Transform ADRs for Docusaurus (Integration Mode)
 *
 * Reads ADR files from the project's docs/adrs/ directory and writes them
 * to the integration output directory with Docusaurus frontmatter, RFC 2119
 * keyword highlighting, and cross-references.
 *
 * Adapted for integration mode: all paths and config received via parameters.
 *
 * @param {Object} config
 * @param {string} config.adrsSource - Absolute path to the ADR source directory
 * @param {string} config.adrsDest - Absolute path to the output directory for transformed ADRs
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

function extractTitle(content) {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : 'Untitled ADR';
}

function extractMetadata(content) {
  let status = null;
  let date = null;
  let dm = null;

  // Only parse within YAML frontmatter (between --- delimiters)
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const fm = fmMatch[1];
    const statusMatch = fm.match(/^status:\s*"?([^"\n]+)"?/m);
    const dateMatch = fm.match(/^date:\s*"?([^"\n]+)"?/m);
    const dmMatch = fm.match(/^decision-makers:\s*"?([^"\n]+)"?/m);
    if (statusMatch) status = statusMatch[1].trim();
    if (dateMatch) date = dateMatch[1].trim();
    if (dmMatch) dm = dmMatch[1].trim();
  }

  if (!status) status = 'unknown';
  if (!date) date = 'unknown';
  if (!dm) dm = 'unknown';

  return { status, date, dm };
}

function escapeBidirectionalArrows(content) {
  return content.replace(/<-+>/g, (match) => {
    return match.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  });
}

function transformConsequenceKeywords(content) {
  const lines = content.split('\n');
  let inCodeBlock = false;

  return lines.map(line => {
    const trimmed = line.trimStart();
    if (/^(`{3,}|~{3,})/.test(trimmed)) { inCodeBlock = !inCodeBlock; return line; }
    if (inCodeBlock) return line;
    return line.replace(/^(\s*[\*\-]\s+)(Good|Bad|Neutral|Meh|Okay)(,)/i, (match, prefix, keyword, comma) => {
      const normalizedKeyword = keyword.charAt(0).toUpperCase() + keyword.slice(1).toLowerCase();
      const cssClass = normalizedKeyword.toLowerCase();
      return `${prefix}<span className="consequence-keyword ${cssClass}">${normalizedKeyword}</span>${comma}`;
    });
  }).join('\n');
}

function fixCrossSectionPaths(content) {
  return content.replace(/\]\(\.\.\/openspec\/specs\//g, '](../specs/');
}

function transformAdr(srcPath, destPath, fileName, config) {
  let content = fs.readFileSync(srcPath, 'utf-8');
  const { baseUrl, pathPrefix, specMapping, specEmojis, adrMapping } = config;

  if (fileName === '0000-template.md' || fileName === 'README.md') return;

  const isNumberedAdr = /^(?:ADR-)?\d{4}-/.test(fileName);
  const title = extractTitle(content);
  const { status, date, dm } = extractMetadata(content);

  const contentWithoutFrontmatter = content.replace(/^---[\s\S]*?---/, '').trim();

  let escapedContent = fixMarkdownLinks(contentWithoutFrontmatter);
  escapedContent = fixCrossSectionPaths(escapedContent);
  escapedContent = escapeBidirectionalArrows(escapedContent);
  escapedContent = transformRfc2119Keywords(escapedContent);
  escapedContent = transformSpecReferences(escapedContent, { specMapping, specEmojis, baseUrl });
  escapedContent = transformAdrReferences(escapedContent, { adrMapping, adrEmoji: ADR_EMOJI, baseUrl });
  escapedContent = transformConsequenceKeywords(escapedContent);

  const slug = fileName.replace(/\.md$/, '');

  let sidebarLabel;
  if (isNumberedAdr) {
    const adrNum = fileName.match(/^(?:ADR-)?(\d{4})-/)[1];
    const titleWithoutAdr = title.replace(/^ADR-\d+:\s*/, '');
    sidebarLabel = `ADR-${adrNum}: ${titleWithoutAdr}`;
  } else {
    sidebarLabel = title;
  }

  const badgeHeader = isNumberedAdr ? `
<FieldGroup>
  <Field label="Status">
    <StatusBadge status="${escapeJsxAttr(status.toUpperCase())}" />
  </Field>
  <Field label="Date">
    <DateBadge date="${escapeJsxAttr(date)}" />
  </Field>
  <Field label="Decision Makers">${escapeJsxAttr(dm)}</Field>
</FieldGroup>
` : '';

  const isStricken = ['deprecated', 'superseded'].includes(status.toLowerCase());
  const sidebarClassName = isStricken ? '\nsidebar_class_name: adr-struck' : '';

  const frontmatter = `---\ntitle: "${escapeYaml(title)}"
sidebar_label: "${escapeYaml(sidebarLabel)}"
slug: ${pathPrefix}/decisions/${slug}${sidebarClassName}
---
${badgeHeader}
`;

  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, frontmatter + escapeMdxUnsafe(escapedContent));
}

function transformAdrs(config) {
  const { adrsSource, adrsDest, baseUrl, pathPrefix = '', specMapping = {}, specEmojis = {} } = config;

  console.log('  [sync-spec-docs] Transforming ADRs...');

  if (!fs.existsSync(adrsSource)) {
    console.log('    No ADR directory found, skipping ADR transform');
    return;
  }

  if (fs.existsSync(adrsDest)) {
    fs.rmSync(adrsDest, { recursive: true });
  }
  fs.mkdirSync(adrsDest, { recursive: true });

  fs.writeFileSync(path.join(adrsDest, '_category_.json'), JSON.stringify({
    label: 'Architecture Decisions',
    position: 2,
    link: {
      type: 'generated-index',
      description: 'Architecture Decision Records (ADRs).'
    }
  }, null, 2));

  const adrMapping = buildAdrMapping(adrsSource, pathPrefix);

  const files = fs.readdirSync(adrsSource);
  let fileCount = 0;

  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    if (file === '0000-template.md' || file === 'README.md') continue;

    const srcPath = path.join(adrsSource, file);
    const destPath = path.join(adrsDest, file.replace(/\.md$/, '.mdx'));
    transformAdr(srcPath, destPath, file, { baseUrl, pathPrefix, specMapping, specEmojis, adrMapping });
    fileCount++;
  }

  console.log(`    Transformed ${fileCount} ADR files`);
}

module.exports = { transformAdrs };
