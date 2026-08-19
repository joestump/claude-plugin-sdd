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

    const match = file.match(/^(?:ADR-)?(\d{4})-/i);
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

// Spans within a single line that must never be auto-linkified.
//
// The reference transforms below turn a bare `ADR-0006` / `SPEC-0004` mention
// into an <a>. Three places that is wrong:
//
//   `ADR-0006`                    inline code — a literal, not a reference
//   [ADR-0006](adr-0006-x.md)     already a link; wrapping the label yields
//                                 <a><a>…</a></a>, which is invalid HTML and
//                                 which some minifiers reject outright
//   <a href="/decisions/ADR-0006  an anchor an earlier pass already emitted —
//   -x">ADR-0006</a>              both the href and the label are off limits
//
// Markdown links are the common case: an author who writes
// `[ADR-0006](adr-0006-thing.md)` gets the label wrapped a second time, and the
// result is a nested anchor on every such reference in the body.
//
// Whole <a>…</a> elements are ranged separately from bare tags. `<[^>]+>` alone
// covers an ID sitting in an href but not one sitting in the link text, which
// is the half that actually nests.
function protectedRanges(line) {
  const ranges = [];
  for (const re of [/`[^`]*`/g, /\[[^\]]*\]\([^)]*\)/g, /<a\b[^>]*>.*?<\/a>/g, /<[^>]+>/g]) {
    let m;
    while ((m = re.exec(line)) !== null) ranges.push([m.index, m.index + m[0].length]);
  }
  return ranges;
}

// String.prototype.replace passes (match, ...groups, offset, whole), so the
// offset is always the second-to-last argument regardless of group count.
function matchOffset(args) {
  return args[args.length - 2];
}

function isProtected(ranges, start, end) {
  return ranges.some(([from, to]) => start >= from && end <= to);
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

    const ranges = protectedRanges(line);
    return line.replace(specPattern, (match, prefix, number, ...rest) => {
      const offset = matchOffset([match, prefix, number, ...rest]);
      if (isProtected(ranges, offset, offset + match.length)) return match;
      // Two kinds of key live in specMapping. A full artifact ID (SPEC-0008)
      // names one spec page; a bare prefix (ARCH) names the domain page that
      // hosts ARCH-NNN requirements, where each ID is a RequirementBox anchor.
      // Only the latter gets a fragment: a spec page's H1 anchor is derived
      // from the whole heading text, so `#spec-0008` never resolved.
      const artifactPath = specMapping[match];
      const specPath = artifactPath || specMapping[prefix];
      if (!specPath) return match;
      const emoji = specEmojis[prefix];
      const displayText = emoji ? `${emoji} ${match}` : match;
      const fragment = artifactPath ? '' : `#${match.toLowerCase()}`;
      return `<a href="${baseUrl}${specPath}${fragment}" className="rfc-ref">${displayText}</a>`;
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

    const ranges = protectedRanges(line);
    return line.replace(adrPattern, (match, number, ...rest) => {
      const offset = matchOffset([match, number, ...rest]);
      if (isProtected(ranges, offset, offset + match.length)) return match;
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
