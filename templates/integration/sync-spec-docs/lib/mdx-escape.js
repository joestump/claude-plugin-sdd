/**
 * MDX v3 content escaping utilities
 *
 * Escapes characters that MDX v3 interprets as JSX but are intended as
 * literal text. Fenced code blocks are preserved unchanged.
 */

function escapeMdxUnsafe(content) {
  const lines = content.split('\n');
  const result = [];
  let inCodeBlock = false;
  let codeFencePattern = null;

  for (const line of lines) {
    const trimmed = line.trimStart();

    // Match opening/closing code fences: ``` (3+), ~~~ (3+)
    const fenceMatch = trimmed.match(/^(`{3,}|~{3,})/);
    if (fenceMatch) {
      const fence = fenceMatch[1];
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeFencePattern = fence[0]; // track whether ` or ~
        result.push(line);
        continue;
      } else if (fence[0] === codeFencePattern && trimmed.replace(/^[`~]+/, '').trim() === '') {
        inCodeBlock = false;
        codeFencePattern = null;
        result.push(line);
        continue;
      }
    }

    if (inCodeBlock) {
      result.push(line);
      continue;
    }

    result.push(escapeLineForMdx(line));
  }

  return result.join('\n');
}

function escapeLineForMdx(line) {
  if (isJsxLine(line)) {
    return line;
  }

  let result = '';
  let i = 0;

  while (i < line.length) {
    if (line[i] === '`') {
      const start = i;
      i++;
      while (i < line.length && line[i] !== '`') {
        i++;
      }
      if (i < line.length) i++;
      result += line.slice(start, i);
      continue;
    }

    if (line[i] === '{' && (i === 0 || line[i - 1] !== '\\')) {
      result += '\\{';
      i++;
      continue;
    }
    if (line[i] === '}' && (i === 0 || line[i - 1] !== '\\')) {
      result += '\\}';
      i++;
      continue;
    }

    if (line[i] === '<') {
      const remaining = line.slice(i);

      if (/^<[A-Za-z/!]/.test(remaining)) {
        const tagMatch = remaining.match(/^<\/?([A-Za-z][A-Za-z0-9_-]*)/);
        if (tagMatch) {
          const tagName = tagMatch[1];
          if (isKnownTag(tagName)) {
            result += line[i];
            i++;
            continue;
          }
        }
        result += '&lt;';
        i++;
        continue;
      }

      result += '&lt;';
      i++;
      continue;
    }

    result += line[i];
    i++;
  }

  return result;
}

function isJsxLine(line) {
  const trimmed = line.trim();
  // Only treat as JSX if the line starts with a JSX component tag or closing tag
  if (/^<[A-Z]/.test(trimmed)) return true;
  if (/^<\/[A-Z]/.test(trimmed)) return true;
  return false;
}

const HTML_TAGS = new Set([
  'a', 'abbr', 'address', 'area', 'article', 'aside', 'audio',
  'b', 'base', 'bdi', 'bdo', 'blockquote', 'body', 'br', 'button',
  'canvas', 'caption', 'cite', 'code', 'col', 'colgroup',
  'data', 'datalist', 'dd', 'del', 'details', 'dfn', 'dialog', 'div', 'dl', 'dt',
  'em', 'embed',
  'fieldset', 'figcaption', 'figure', 'footer', 'form',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header', 'hgroup', 'hr', 'html',
  'i', 'iframe', 'img', 'input', 'ins',
  'kbd',
  'label', 'legend', 'li', 'link',
  'main', 'map', 'mark', 'menu', 'meta', 'meter',
  'nav', 'noscript',
  'object', 'ol', 'optgroup', 'option', 'output',
  'p', 'param', 'picture', 'pre', 'progress',
  'q',
  'rp', 'rt', 'ruby',
  's', 'samp', 'script', 'section', 'select', 'slot', 'small', 'source',
  'span', 'strong', 'style', 'sub', 'summary', 'sup',
  'table', 'tbody', 'td', 'template', 'textarea', 'tfoot', 'th', 'thead',
  'time', 'title', 'tr', 'track',
  'u', 'ul',
  'var', 'video',
  'wbr',
]);

const JSX_COMPONENTS = new Set([
  'StatusBadge', 'DateBadge', 'DomainBadge', 'PriorityBadge', 'SeverityBadge',
  'RFCLevelBadge', 'RequirementBox', 'Field', 'FieldGroup',
  'Tabs', 'TabItem', 'Admonition',
]);

function isKnownTag(tagName) {
  if (HTML_TAGS.has(tagName.toLowerCase())) return true;
  if (JSX_COMPONENTS.has(tagName)) return true;
  return false;
}

module.exports = { escapeMdxUnsafe };
