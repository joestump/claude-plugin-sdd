/**
 * Graph Data
 *
 * Reads ADR/spec frontmatter and computes the artifact graph nodes,
 * authored edges, derived inverses, and orphan categories. Exposed for
 * use by generate-graph.js and any per-artifact mini-graph render in
 * transform-adrs.js / transform-openspecs.js.
 *
 * Authoritative implementation lives in `skills/graph/lib/graph.py`
 * (per ADR-0023 / SPEC-0018). This is a docs-side reflection used only
 * for static page rendering — it is intentionally narrow and stdlib-
 * only-equivalent (no PyYAML / no third-party JS YAML lib).
 */

const fs = require('fs');
const path = require('path');

const ADR_EDGE_FIELDS = ['supersedes', 'extends', 'enables', 'governs', 'related'];
const SPEC_EDGE_FIELDS = ['implements', 'requires', 'extends', 'supersedes'];
const INVERSE_OF = {
  supersedes: 'superseded-by',
  extends: 'extended-by',
  enables: 'enabled-by',
  governs: 'governed-by',
  implements: 'implemented-by',
  requires: 'depended-on-by',
  related: 'related',
};

/**
 * Parse YAML-ish frontmatter from a markdown body. Recognizes scalars
 * and inline-bracket lists with quoted scalars. Mirrors the narrow
 * grammar in `skills/graph/lib/graph.py`.
 */
function parseFrontmatter(text) {
  const m = text.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
  if (!m) return {};
  const result = {};
  for (const raw of m[1].split('\n')) {
    const line = raw.replace(/\s+$/, '');
    const stripped = line.replace(/^\s+/, '');
    if (!stripped || stripped.startsWith('#')) continue;
    const colonIdx = line.indexOf(':');
    if (colonIdx < 0) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = stripCommentOutsideQuotes(line.slice(colonIdx + 1).trim());
    if (value.startsWith('[') && value.endsWith(']')) {
      const inner = value.slice(1, -1).trim();
      result[key] = splitCsv(inner)
        .map((item) => unquote(item.trim()))
        .filter(Boolean);
    } else {
      result[key] = unquote(value);
    }
  }
  return result;
}

function stripCommentOutsideQuotes(value) {
  let inQuote = null;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (inQuote) {
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
      continue;
    }
    if (ch === '#' && (i === 0 || /\s/.test(value[i - 1]))) {
      return value.slice(0, i).replace(/\s+$/, '');
    }
  }
  return value;
}

function splitCsv(s) {
  const out = [];
  let buf = '';
  let inQuote = null;
  let depth = 0;
  for (const ch of s) {
    if (inQuote) {
      buf += ch;
      if (ch === inQuote) inQuote = null;
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
      buf += ch;
    } else if (ch === '[') {
      depth++;
      buf += ch;
    } else if (ch === ']') {
      depth--;
      buf += ch;
    } else if (ch === ',' && depth === 0) {
      out.push(buf);
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf) out.push(buf);
  return out;
}

function unquote(value) {
  if (value.length >= 2 && value[0] === value[value.length - 1] && (value[0] === '"' || value[0] === "'")) {
    return value.slice(1, -1);
  }
  return value;
}

function extractTitle(text) {
  const m = text.match(/^#\s+(.+?)\s*$/m);
  return m ? m[1] : '';
}

/**
 * Build the artifact graph from an ADR directory + spec directory.
 *
 * Returns:
 *   {
 *     nodes: { id: { id, kind, title, path } },
 *     edges: [ { source, target, type, derived } ],
 *     orphanAdrs: [id],
 *     orphanSpecs: [id],
 *   }
 */
function buildGraph({ adrsSource, specsSource }) {
  const nodes = {};
  const edges = [];

  const adrFileRe = /^ADR-(\d{4})/;
  if (fs.existsSync(adrsSource)) {
    for (const f of fs.readdirSync(adrsSource).sort()) {
      if (!f.endsWith('.md')) continue;
      const m = f.match(adrFileRe);
      if (!m) continue;
      const id = `ADR-${m[1]}`;
      const text = fs.readFileSync(path.join(adrsSource, f), 'utf-8');
      const fm = parseFrontmatter(text);
      const title = extractTitle(text);
      nodes[id] = { id, kind: 'adr', title, path: path.join(adrsSource, f) };
      ingestEdges(edges, id, fm, ADR_EDGE_FIELDS);
    }
  }

  if (fs.existsSync(specsSource)) {
    for (const dir of fs.readdirSync(specsSource).sort()) {
      const specPath = path.join(specsSource, dir, 'spec.md');
      if (!fs.existsSync(specPath)) continue;
      const text = fs.readFileSync(specPath, 'utf-8');
      // Match `# SPEC-XXXX:` or `# SPEC-XXXX Title` (no colon) for parity
      // with the Python helper's word-boundary regex.
      const titleMatch = text.match(/^#\s+(SPEC-\d{4})\b/m);
      if (!titleMatch) continue;
      const id = titleMatch[1];
      const fm = parseFrontmatter(text);
      const title = extractTitle(text);
      nodes[id] = { id, kind: 'spec', title, path: specPath, dir };
      ingestEdges(edges, id, fm, SPEC_EDGE_FIELDS);
    }
  }

  // Derive inverse edges for the same SPEC-0018 set; symmetric `related`
  // is added in both directions only when not already authored.
  const authoredPairs = new Set(edges.map((e) => `${e.source}|${e.target}|${e.type}`));
  const derived = [];
  for (const e of edges) {
    const inv = INVERSE_OF[e.type];
    if (!inv) continue;
    if (!nodes[e.target]) continue;
    if (e.type === 'related' && authoredPairs.has(`${e.target}|${e.source}|related`)) continue;
    derived.push({ source: e.target, target: e.source, type: inv, derived: true });
  }
  for (const e of edges) e.derived = false;
  edges.push(...derived);

  // Orphans (per SPEC-0018 categories b and c — no source-tree walk here)
  const orphanAdrs = [];
  const orphanSpecs = [];
  for (const id of Object.keys(nodes).sort()) {
    const n = nodes[id];
    if (n.kind === 'adr') {
      const hasSpecImpl = edges.some(
        (e) => e.target === id && e.type === 'implements' && !e.derived
      );
      if (!hasSpecImpl) orphanAdrs.push(id);
    }
    if (n.kind === 'spec') {
      // No source code in docs-data context, so every spec is an orphan
      // by definition for category (b). Skip surfacing this here — let
      // the orphans verb in /sdd:graph carry that detail.
      // We still surface ADR-orphan-specs (specs that no ADR governs) only
      // to give users a clean signal in docs context:
      // A spec is governed if any ADR points at it via authored `governs`
      // OR the spec's own `implements:` produces a derived `implemented-by`
      // edge from an ADR back to it. Both signal "this spec realizes some ADR."
      const hasGoverning = edges.some(
        (e) =>
          e.target === id &&
          ((e.type === 'governs' && !e.derived) || e.type === 'implemented-by')
      );
      if (!hasGoverning) orphanSpecs.push(id);
    }
  }

  return { nodes, edges, orphanAdrs, orphanSpecs };
}

function ingestEdges(edges, sourceId, fm, allowed) {
  for (const field of allowed) {
    const value = fm[field];
    if (!Array.isArray(value)) continue;
    for (const target of value) {
      const t = String(target).trim();
      if (!t) continue;
      edges.push({ source: sourceId, target: t, type: field });
    }
  }
}

/**
 * Render the entire authored graph as a Mermaid flowchart. Nodes are
 * ADR/spec IDs only; cross-module IDs ([module]/X) are sanitized to
 * Mermaid-safe identifiers.
 */
function renderFullMermaid({ nodes, edges }) {
  const lines = ['flowchart TB'];
  const seen = new Set();
  const nodeId = (id) => id.replace(/[^A-Za-z0-9_]/g, '_');
  const nodeLabel = (n) => (n.title || n.id).replace(/"/g, '\\"');

  for (const id of Object.keys(nodes).sort()) {
    const n = nodes[id];
    if (seen.has(id)) continue;
    seen.add(id);
    lines.push(`  ${nodeId(id)}["${nodeLabel(n)}"]`);
  }
  for (const e of edges) {
    if (e.derived) continue; // authored only — derived would double the diagram
    if (!nodes[e.source] || !nodes[e.target]) continue;
    const arrow = '-->';
    const label = e.type;
    lines.push(`  ${nodeId(e.source)} ${arrow}|"${label}"| ${nodeId(e.target)}`);
  }
  return lines.join('\n');
}

/**
 * Render the immediate-neighborhood mini-Mermaid for a single artifact:
 * the queried node plus its direct neighbors via authored edges
 * (outgoing) and authored inverses (incoming). Used in per-page
 * "Related artifacts" footers if the docs transforms opt in.
 */
function renderNeighborMermaid(targetId, { nodes, edges }) {
  if (!nodes[targetId]) return null;
  const lines = ['flowchart TB'];
  const nodeId = (id) => id.replace(/[^A-Za-z0-9_]/g, '_');
  const nodeLabel = (n) => (n.title || n.id).replace(/"/g, '\\"');
  const neighborhood = new Set([targetId]);
  for (const e of edges) {
    if (e.source === targetId || e.target === targetId) {
      neighborhood.add(e.source);
      neighborhood.add(e.target);
    }
  }
  if (neighborhood.size <= 1) return null;
  for (const id of [...neighborhood].sort()) {
    if (!nodes[id]) continue;
    lines.push(`  ${nodeId(id)}["${nodeLabel(nodes[id])}"]`);
  }
  for (const e of edges) {
    if (e.source !== targetId && e.target !== targetId) continue;
    if (!nodes[e.source] || !nodes[e.target]) continue;
    const arrow = e.derived ? '-.->' : '-->';
    const label = e.derived ? `${e.type} (derived)` : e.type;
    lines.push(`  ${nodeId(e.source)} ${arrow}|"${label}"| ${nodeId(e.target)}`);
  }
  return lines.join('\n');
}

/**
 * Render a "Related Artifacts" Markdown section with a Mermaid mini-DAG
 * of the artifact's direct neighbors. Returns the empty string when the
 * artifact has no neighborhood (e.g., a brand-new ADR/spec with no
 * edges authored or derived) so transforms can unconditionally append
 * the result. MUST be appended AFTER any MDX-escape pass so the Mermaid
 * fence stays raw.
 */
function buildMiniDagSection(artifactId, graph) {
  if (!artifactId) return '';
  const mermaid = renderNeighborMermaid(artifactId, graph);
  if (!mermaid) return '';
  return [
    '',
    '',
    '## Related Artifacts',
    '',
    `Direct relationships declared in YAML frontmatter (per [ADR-0023](/decisions/ADR-0023-frontmatter-dag-and-graph-skill) / [SPEC-0018](/specs/artifact-graph/spec)). Run \`/sdd:graph chain ${artifactId}\` for the transitive view.`,
    '',
    '```mermaid',
    mermaid,
    '```',
    '',
  ].join('\n');
}

module.exports = {
  buildGraph,
  parseFrontmatter,
  renderFullMermaid,
  renderNeighborMermaid,
  buildMiniDagSection,
};
