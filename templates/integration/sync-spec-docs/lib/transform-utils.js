/**
 * Shared transform utilities for ADR and OpenSpec transforms
 *
 * Contains common functions used by both transform-adrs.js and
 * transform-openspecs.js: RFC 2119 keyword highlighting, spec/ADR
 * cross-references, markdown link fixing.
 *
 * Adapted for integration mode: buildAdrMapping accepts an optional
 * pathPrefix for namespaced output directories.
 */

const fs = require('fs');

/**
 * Test if a line is a code fence opener/closer (```, ~~~~, etc.)
 */
function isCodeFence(line) {
  const trimmed = line.trimStart();
  return /^(`{3,}|~{3,})/.test(trimmed);
}

/**
 * Build a mapping of ADR numbers to their URL paths.
 * @param {string} adrsSource - Path to the ADR source directory
 * @param {string} [pathPrefix=''] - URL prefix for namespaced output (e.g., '/architecture')
 */
function buildAdrMapping(adrsSource, pathPrefix = '') {
  const mapping = {};
  if (!fs.existsSync(adrsSource)) return mapping;

  const files = fs.readdirSync(adrsSource);
  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    if (file === '0000-template.md' || file === 'README.md') continue;

    const match = file.match(/^(?:ADR-)?(\d{4})-/);
    if (match) {
      const number = match[1];
      const slug = file.replace(/\.md$/, '');
      mapping[number] = `${pathPrefix}/decisions/${slug}`;
    }
  }
  return mapping;
}

/**
 * Transform RFC 2119 keywords (MUST, SHALL, MAY, etc.) into highlighted spans.
 * Skips code blocks, headings, indented lines, and inline code spans.
 */
function transformRfc2119Keywords(content) {
  const keywordPattern = /\b(MUST NOT|SHALL NOT|SHOULD NOT|MUST|SHALL|REQUIRED|SHOULD|RECOMMENDED|MAY|OPTIONAL)\b/g;
  const keywordClasses = {
    'MUST NOT': 'must', 'SHALL NOT': 'shall', 'SHOULD NOT': 'should',
    'MUST': 'must', 'SHALL': 'shall', 'REQUIRED': 'required',
    'SHOULD': 'should', 'RECOMMENDED': 'recommended',
    'MAY': 'may', 'OPTIONAL': 'optional',
  };

  const lines = content.split('\n');
  let inCodeBlock = false;

  return lines.map(line => {
    if (isCodeFence(line)) { inCodeBlock = !inCodeBlock; return line; }
    if (inCodeBlock || line.startsWith('#') || line.startsWith('    ')) return line;
    if (line.match(/^`[^`]+`$/)) return line;

    // Process segments outside of inline code spans
    const parts = line.split(/(`[^`]+`)/);
    return parts.map(part => {
      if (part.startsWith('`') && part.endsWith('`')) return part;
      return part.replace(keywordPattern, (match) => {
        const cls = keywordClasses[match];
        return `<span className="rfc-keyword ${cls}">${match}</span>`;
      });
    }).join('');
  }).join('\n');
}

/**
 * Transform spec ID references (e.g., ARCH-001) into linked spans.
 */
function transformSpecReferences(content, { specMapping, specEmojis, baseUrl }) {
  const specPattern = /\b([A-Z]+)-(\d{3,4})\b/g;
  const lines = content.split('\n');
  let inCodeBlock = false;

  return lines.map(line => {
    if (isCodeFence(line)) { inCodeBlock = !inCodeBlock; return line; }
    if (inCodeBlock || line.startsWith('#')) return line;
    if (line.trim().startsWith('<') && !line.includes('className="rfc-keyword')) return line;

    return line.replace(specPattern, (match, prefix, number) => {
      const specPath = specMapping[prefix];
      const emoji = specEmojis[prefix];
      if (!specPath) return match;
      const displayText = emoji ? `${emoji} ${match}` : match;
      const anchorId = match.toLowerCase();
      return `<a href="${baseUrl}${specPath}#${anchorId}" className="rfc-ref">${displayText}</a>`;
    });
  }).join('\n');
}

/**
 * Transform ADR references (e.g., ADR-0001) into linked spans.
 */
function transformAdrReferences(content, { adrMapping, adrEmoji, baseUrl }) {
  const adrPattern = /\bADR-(\d{4})\b/g;
  const lines = content.split('\n');
  let inCodeBlock = false;

  return lines.map(line => {
    if (isCodeFence(line)) { inCodeBlock = !inCodeBlock; return line; }
    if (inCodeBlock || line.startsWith('#')) return line;
    if (line.trim().startsWith('<') && !line.includes('className="rfc-keyword') && !line.includes('className="rfc-ref')) return line;

    return line.replace(adrPattern, (match, number) => {
      const adrPath = adrMapping[number];
      if (!adrPath) return match;
      const displayText = `${adrEmoji} ${match}`;
      return `<a href="${baseUrl}${adrPath}" className="rfc-ref">${displayText}</a>`;
    });
  }).join('\n');
}

/**
 * Strip .md extensions from markdown links (Docusaurus uses extensionless routes).
 */
function fixMarkdownLinks(content) {
  return content.replace(/\]\(((?!https?:\/\/)[^)]*?)\.md(#[^)]*?)?\)/g, ']($1$2)');
}

module.exports = {
  buildAdrMapping,
  transformRfc2119Keywords,
  transformSpecReferences,
  transformAdrReferences,
  fixMarkdownLinks,
};
