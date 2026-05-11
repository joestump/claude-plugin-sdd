#!/usr/bin/env node
/**
 * Transform Skills for Docusaurus
 *
 * Reads each skills/{name}/SKILL.md and emits one MDX page at
 * docs-generated/skills/{name}.mdx, plus a hero-tile index at
 * docs-generated/skills/index.mdx.
 *
 * Governing: ADR-0029 (Auto-Generate Docusaurus Skill Pages),
 *            SPEC-0021 REQ "Per-Skill Page Generation",
 *            SPEC-0021 REQ "Source-File Schema Mapping",
 *            SPEC-0021 REQ "Section Ordering",
 *            SPEC-0021 REQ "Hero-Tile Index Page",
 *            SPEC-0021 REQ "Manifest Schema and Validation",
 *            SPEC-0021 REQ "Bidirectional Manifest Consistency",
 *            SPEC-0021 REQ "Governing-Comment Aggregation and Cross-Linking",
 *            SPEC-0021 REQ "Example Invocations from Eval Triggers",
 *            SPEC-0021 REQ "Pipeline Integration",
 *            SPEC-0021 REQ "MDX Safety",
 *            SPEC-0021 REQ "Override File Format and Pin" (override hatch
 *            implemented as a pass-through; full pin enforcement lands in
 *            Story #141).
 *
 * Pipeline order is fixed by build-docs.js: this transform runs after
 * transform-openspecs.js (so SPEC_MAPPING/SPEC_EMOJIS are populated by
 * build-spec-mapping.js's prior side effects) and before generate-graph.js.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const Ajv = require('ajv');

const { escapeMdxUnsafe } = require('./mdx-escape');
const {
  buildAdrMapping,
  isCodeFence,
  transformAdrReferences,
  transformSpecReferences,
} = require('./transform-utils');

const REPO_ROOT = path.join(__dirname, '../..');
const SKILLS_SOURCE = path.join(REPO_ROOT, 'skills');
const SKILLS_DEST = path.join(REPO_ROOT, 'docs-generated/skills');
const MANIFEST_PATH = path.join(SKILLS_SOURCE, '_index.json');
const SCHEMA_PATH = path.join(__dirname, 'schemas/skills-index.schema.json');
const ADRS_SOURCE = path.join(REPO_ROOT, 'docs/adrs');
const TRIGGERS_SOURCE = path.join(REPO_ROOT, 'evals/triggers');

const ADR_EMOJI = '📝';

// Read baseUrl from docusaurus.config.ts (mirrors transform-adrs.js).
const configPath = path.join(__dirname, '../docusaurus.config.ts');
let BASE_URL = '';
if (fs.existsSync(configPath)) {
  const configContent = fs.readFileSync(configPath, 'utf-8');
  const baseUrlMatch = configContent.match(/baseUrl:\s*['"]([^'"]+)['"]/);
  BASE_URL = baseUrlMatch ? baseUrlMatch[1].replace(/\/$/, '') : '';
}

let SPEC_MAPPING = {};
let SPEC_EMOJIS = {};
try {
  SPEC_MAPPING = require('../src/data/spec-mapping.json');
  SPEC_EMOJIS = require('../src/data/spec-emojis.json');
} catch (e) {
  // Mapping files not yet generated — governing-comment cross-links degrade
  // gracefully to plain SPEC-XXXX text in that case.
}

const ADR_MAPPING = buildAdrMapping(ADRS_SOURCE);

// ---------------------------------------------------------------------------
// Manifest validation
// ---------------------------------------------------------------------------

/**
 * Load and Ajv-validate skills/_index.json. Throws on schema violations or
 * cross-group duplicates with the spec-mandated error message.
 *
 * Governing: SPEC-0021 REQ "Manifest Schema and Validation".
 */
function loadManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(`skills/_index.json: manifest not found at ${MANIFEST_PATH}`);
  }
  if (!fs.existsSync(SCHEMA_PATH)) {
    throw new Error(`skills-index.schema.json: schema not found at ${SCHEMA_PATH}`);
  }

  const raw = fs.readFileSync(MANIFEST_PATH, 'utf-8');
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (err) {
    throw new Error(`skills/_index.json: invalid JSON — ${err.message}`);
  }

  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf-8'));
  const ajv = new Ajv({ allErrors: true });
  const validate = ajv.compile(schema);
  if (!validate(manifest)) {
    const detail = validate.errors
      .map((e) => `  ${e.instancePath || '/'} ${e.message}`)
      .join('\n');
    throw new Error(`skills/_index.json: manifest fails schema validation:\n${detail}`);
  }

  // Cross-group duplicate check (the schema's per-array uniqueItems doesn't
  // catch the same name appearing in two different groups).
  const seen = new Map(); // skillName -> first group it appeared in
  for (const [group, names] of Object.entries(manifest)) {
    for (const name of names) {
      if (seen.has(name)) {
        throw new Error(
          `skills/_index.json: duplicate skill "${name}" in groups "${seen.get(name)}" and "${group}"`,
        );
      }
      seen.set(name, group);
    }
  }

  return manifest;
}

/**
 * Verify every SKILL.md on disk appears in the manifest, and every manifest
 * entry resolves to a SKILL.md on disk. Either failure mode aborts the build.
 *
 * Governing: SPEC-0021 REQ "Bidirectional Manifest Consistency".
 */
function checkBidirectionalConsistency(manifest) {
  const onDisk = new Set();
  if (fs.existsSync(SKILLS_SOURCE)) {
    for (const entry of fs.readdirSync(SKILLS_SOURCE, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillMd = path.join(SKILLS_SOURCE, entry.name, 'SKILL.md');
      if (fs.existsSync(skillMd)) onDisk.add(entry.name);
    }
  }

  const inManifest = new Set();
  for (const names of Object.values(manifest)) {
    for (const name of names) inManifest.add(name);
  }

  for (const name of onDisk) {
    if (!inManifest.has(name)) {
      throw new Error(
        `skills/${name}: not registered in skills/_index.json — add it to a group or remove the directory`,
      );
    }
  }
  for (const name of inManifest) {
    if (!onDisk.has(name)) {
      throw new Error(
        `skills/_index.json references "${name}" but skills/${name}/SKILL.md does not exist`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// SKILL.md parsing
// ---------------------------------------------------------------------------

/**
 * Parse YAML frontmatter into a flat object. Supports the limited YAML used
 * by SKILL.md files: scalar strings, scalar booleans, and inline arrays
 * `[a, b, c]`. We deliberately avoid pulling in a full YAML dependency.
 */
function parseFrontmatter(content) {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!fmMatch) return { frontmatter: {}, body: content };

  const fm = {};
  for (const line of fmMatch[1].split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    const [, key, rawValue] = m;
    let value = rawValue.trim();
    // Inline YAML array: `[a, b, c]` — must have commas. A bare `[topic]` or
    // `[a] [b]` is a string usage hint (e.g. `argument-hint: [topic] [--module]`),
    // not an array. We treat as array only if there's at least one top-level comma
    // and no unmatched bracket pairs after the first `[`.
    const isFlowArray =
      value.startsWith('[') &&
      value.endsWith(']') &&
      value.indexOf(',') !== -1 &&
      // Reject if a `[` appears after position 0 (multi-bracket usage hints).
      value.indexOf('[', 1) === -1;
    if (isFlowArray) {
      value = value
        .slice(1, -1)
        .split(',')
        .map((v) => v.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
    } else if (/^(true|false)$/i.test(value)) {
      value = /^true$/i.test(value);
    } else {
      value = value.replace(/^['"]|['"]$/g, '');
    }
    fm[key] = value;
  }

  const body = content.slice(fmMatch[0].length);
  return { frontmatter: fm, body };
}

/**
 * Split a SKILL.md body into the H1 intro paragraph plus a list of H2
 * sections. Fence-aware: H2 lines inside fenced code blocks are NOT treated
 * as section boundaries (they belong to the enclosing fence's content).
 *
 * Governing: SPEC-0021 REQ "Source-File Schema Mapping" (fence-aware H2
 * extraction). Reuses isCodeFence from transform-utils.js.
 */
function splitSections(body) {
  const lines = body.split('\n');
  let h1Title = null;
  const sections = []; // {title, body[]}
  let preamble = []; // lines after H1 before the first H2 (the "Overview")
  let current = null; // active H2 section
  let inCodeBlock = false;
  let seenH1 = false;

  for (const line of lines) {
    if (isCodeFence(line)) {
      inCodeBlock = !inCodeBlock;
      if (current) current.body.push(line);
      else preamble.push(line);
      continue;
    }

    if (!inCodeBlock) {
      const h1Match = line.match(/^#\s+(.+)$/);
      if (h1Match && !seenH1) {
        seenH1 = true;
        h1Title = h1Match[1].trim();
        continue;
      }
      const h2Match = line.match(/^##\s+(.+)$/);
      if (h2Match) {
        const title = h2Match[1].trim();
        current = { title, body: [] };
        sections.push(current);
        continue;
      }
    }

    if (current) current.body.push(line);
    else if (seenH1) preamble.push(line);
  }

  // Trim leading/trailing blank lines on preamble + each section body.
  const trim = (arr) => {
    while (arr.length && !arr[0].trim()) arr.shift();
    while (arr.length && !arr[arr.length - 1].trim()) arr.pop();
    return arr;
  };
  preamble = trim(preamble);
  for (const s of sections) s.body = trim(s.body);

  return { h1Title, preamble, sections };
}

/**
 * Demote header levels by one (H2->H3, H3->H4, etc.) within a body. Skips
 * fenced code blocks.
 *
 * Governing: SPEC-0021 REQ "Source-File Schema Mapping" — generated pages
 * MUST have exactly one H1.
 */
function demoteHeaders(bodyLines) {
  let inCodeBlock = false;
  return bodyLines.map((line) => {
    if (isCodeFence(line)) {
      inCodeBlock = !inCodeBlock;
      return line;
    }
    if (inCodeBlock) return line;
    const m = line.match(/^(#{1,5})\s+(.*)$/);
    if (m) return `${m[1]}#${m[2] ? ' ' + m[2] : ''}`;
    return line;
  });
}

/**
 * Aggregate all <!-- Governing: ... --> and <!-- Implements: ... --> comments
 * from a SKILL.md body. Returns deduped, sorted ADR-XXXX and SPEC-YYYY ids.
 *
 * Governing: SPEC-0021 REQ "Governing-Comment Aggregation and Cross-Linking".
 */
function extractGoverningRefs(body) {
  const adrs = new Set();
  const specs = new Set();
  const re = /<!--\s*(?:Governing|Implements):\s*([^]*?)-->/gi;
  let m;
  while ((m = re.exec(body)) !== null) {
    const inner = m[1];
    const adrRe = /\bADR-(\d{4})\b/g;
    const specRe = /\b([A-Z]+)-(\d{3,4})\b/g;
    let am;
    while ((am = adrRe.exec(inner)) !== null) {
      adrs.add(`ADR-${am[1]}`);
    }
    let sm;
    while ((sm = specRe.exec(inner)) !== null) {
      if (sm[1] === 'ADR') continue;
      specs.add(`${sm[1]}-${sm[2]}`);
    }
  }

  const sortedAdrs = [...adrs].sort();
  const sortedSpecs = [...specs].sort();
  return { adrs: sortedAdrs, specs: sortedSpecs };
}

// ---------------------------------------------------------------------------
// Page rendering
// ---------------------------------------------------------------------------

const CANONICAL_TITLES = new Set(['Process', 'Rules']);

/**
 * Render the Governing Artifacts pill list as a single line of inline ADR
 * and SPEC references that transformAdrReferences/transformSpecReferences
 * will rewrite into anchor tags.
 *
 * Returns an empty string when there are no references (silent omission per
 * SPEC-0021 REQ "Governing-Comment Aggregation").
 */
function renderGoverningSection({ adrs, specs }) {
  if (adrs.length === 0 && specs.length === 0) return '';
  const tokens = [...adrs, ...specs].join(' &middot; ');
  return [
    '## Governing Artifacts',
    '',
    `<div className="skill-governing">${tokens}</div>`,
    '',
  ].join('\n');
}

function normalizeArgumentHint(argumentHint) {
  if (argumentHint == null) return '';
  if (Array.isArray(argumentHint)) {
    return argumentHint.map((p) => String(p)).join(' ').trim();
  }
  return String(argumentHint).trim();
}

function renderUsageSection(name, argumentHint) {
  const hint = normalizeArgumentHint(argumentHint);
  const slashCommand = hint ? `/sdd:${name} ${hint}` : `/sdd:${name}`;
  return ['## Usage', '', '```', slashCommand, '```', ''].join('\n');
}

function renderRequiredToolsSection(allowedTools) {
  if (!allowedTools) return '';
  const list = Array.isArray(allowedTools)
    ? allowedTools
    : String(allowedTools)
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
  if (list.length === 0) return '';
  return [
    '<details>',
    '<summary>Required Tools</summary>',
    '',
    list.map((t) => `- \`${t}\``).join('\n'),
    '',
    '</details>',
    '',
  ].join('\n');
}

function renderManualBadge() {
  return '<span className="skill-badge skill-badge--manual">Manual-Invocation Only</span>\n\n';
}

function renderSection(title, bodyLines) {
  if (!bodyLines || bodyLines.length === 0) return '';
  const demoted = demoteHeaders(bodyLines);
  return [`## ${title}`, '', demoted.join('\n'), ''].join('\n');
}

/**
 * Render the Reference appendix from sibling references/*.md files.
 * Filename-sorted, one collapsible <details> per file.
 *
 * Governing: SPEC-0021 REQ "Source-File Schema Mapping".
 */
function renderReferenceSection(skillDir) {
  const refDir = path.join(skillDir, 'references');
  if (!fs.existsSync(refDir)) return '';
  const files = fs
    .readdirSync(refDir)
    .filter((f) => f.endsWith('.md'))
    .sort();
  if (files.length === 0) return '';

  const parts = ['## Reference', ''];
  for (const f of files) {
    const refContent = fs.readFileSync(path.join(refDir, f), 'utf-8');
    // Drop the file's own H1 (if present) since we render the filename as our subheading.
    const stripped = refContent.replace(/^#\s+[^\n]*\n+/, '');
    parts.push(`### ${f}`);
    parts.push('');
    parts.push(stripped);
    parts.push('');
  }
  return parts.join('\n');
}

/**
 * Render up to the first 5 should_trigger: true entries from
 * evals/triggers/{name}.json as an Example Invocations code block. Silent
 * omission when the file is missing or contains zero matches.
 *
 * Governing: SPEC-0021 REQ "Example Invocations from Eval Triggers".
 */
function renderExampleInvocations(name) {
  const triggerPath = path.join(TRIGGERS_SOURCE, `${name}.json`);
  if (!fs.existsSync(triggerPath)) return '';
  let entries;
  try {
    entries = JSON.parse(fs.readFileSync(triggerPath, 'utf-8'));
  } catch (e) {
    return ''; // malformed JSON degrades to silent omission
  }
  if (!Array.isArray(entries)) return '';
  const positives = entries.filter((e) => e && e.should_trigger === true).slice(0, 5);
  if (positives.length === 0) return '';
  const lines = positives.map((e) => e.query).filter(Boolean);
  return ['## Example Invocations', '', '```', lines.join('\n'), '```', ''].join('\n');
}

/**
 * Apply ADR/SPEC cross-link transforms to the rendered page body and run it
 * through mdx-escape.js. Override files take a different path.
 *
 * Governing: SPEC-0021 REQ "Governing-Comment Aggregation" (cross-link
 * transforms reuse the existing helpers), SPEC-0021 REQ "MDX Safety".
 */
function postProcessForMdx(body) {
  let out = transformAdrReferences(body, {
    adrMapping: ADR_MAPPING,
    adrEmoji: ADR_EMOJI,
    baseUrl: BASE_URL,
  });
  out = transformSpecReferences(out, {
    specMapping: SPEC_MAPPING,
    specEmojis: SPEC_EMOJIS,
    baseUrl: BASE_URL,
  });
  out = escapeMdxUnsafe(out);
  return out;
}

/**
 * Truncate a description at a word boundary near 140 chars.
 *
 * Governing: SPEC-0021 REQ "Hero-Tile Index Page" (tile description
 * truncation).
 */
function truncateDescription(description, max = 140) {
  if (!description) return '';
  if (description.length <= max) return description;
  const slice = description.slice(0, max);
  const lastSpace = slice.lastIndexOf(' ');
  return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice).trimEnd() + '…';
}

/**
 * Generate the full per-skill MDX content from a parsed SKILL.md.
 */
function generateSkillPage(skill) {
  const { name, frontmatter, sections, preamble, refs } = skill;

  const title = frontmatter.name || name;
  const description = (frontmatter.description || '').trim();
  const argHint = frontmatter['argument-hint'] || '';

  // Frontmatter for Docusaurus.
  const fm = [
    '---',
    `title: "${title.replace(/"/g, '\\"')}"`,
    `sidebar_label: "${name.replace(/"/g, '\\"')}"`,
    `slug: /skills/${name}`,
    `description: ${JSON.stringify(description)}`,
    '---',
    '',
  ].join('\n');

  // Subtitle line (full description, untruncated).
  const subtitle = description
    ? `<p className="skill-subtitle">${description}</p>\n\n`
    : '';

  // Manual-invocation badge (if requested).
  const badge = frontmatter['disable-model-invocation'] ? renderManualBadge() : '';

  // Governing Artifacts pill list (above Overview, below Subtitle).
  const governing = renderGoverningSection(refs);

  // Usage code block (always emitted).
  const usage = renderUsageSection(name, argHint);

  // Required tools collapsed details.
  const tools = renderRequiredToolsSection(frontmatter['allowed-tools']);

  // Overview = everything between H1 and the first H2.
  const overview = preamble.length
    ? ['## Overview', '', preamble.join('\n'), ''].join('\n')
    : '';

  // Canonical Process and Rules (if present), then non-canonical H2s in
  // source order, then Reference, then Example Invocations.
  const processSection = sections.find((s) => s.title === 'Process');
  const rulesSection = sections.find((s) => s.title === 'Rules');
  const nonCanonical = sections.filter((s) => !CANONICAL_TITLES.has(s.title));

  const processBlock = processSection
    ? renderSection('Process', processSection.body)
    : '';
  const rulesBlock = rulesSection
    ? renderSection('Rules', rulesSection.body)
    : '';

  const nonCanonicalBlocks = nonCanonical
    .map((s) => renderSection(s.title, s.body))
    .filter(Boolean)
    .join('\n');

  const referenceBlock = renderReferenceSection(skill.dir);
  const examplesBlock = renderExampleInvocations(name);

  // Heading for the page (single H1, derived from frontmatter name).
  const h1 = `# ${title}\n\n`;

  // Assemble in the spec-mandated fixed order:
  // (1) H1 Title (in fm + h1 line)
  // (2) Subtitle
  // (3) Governing Artifacts (if any)
  // (4) Usage
  // (5) Required Tools
  // (6) Overview
  // (7) Process
  // (8) Rules
  // (9) Non-canonical H2 sections in source order
  // (10) Reference
  // (11) Example Invocations
  const ordered = [
    h1,
    badge,
    subtitle,
    governing,
    usage,
    tools,
    overview,
    processBlock,
    rulesBlock,
    nonCanonicalBlocks,
    referenceBlock,
    examplesBlock,
  ]
    .filter((part) => part && part.length > 0)
    .join('\n');

  return fm + postProcessForMdx(ordered);
}

// ---------------------------------------------------------------------------
// Hero-tile index page
// ---------------------------------------------------------------------------

function generateIndexPage(manifest, skillsByName) {
  const fm = [
    '---',
    'title: "Skills"',
    'sidebar_label: "Overview"',
    'slug: /skills/',
    'description: "All SDD plugin skills, grouped by lifecycle stage."',
    '---',
    '',
  ].join('\n');

  const parts = [fm, '# Skills\n'];

  for (const [groupName, names] of Object.entries(manifest)) {
    parts.push(`## ${groupName}`);
    parts.push('');
    parts.push('<div className="skill-tiles">');
    for (const name of names) {
      const skill = skillsByName.get(name);
      if (!skill) continue;
      const description = (skill.frontmatter.description || '').trim();
      const truncated = truncateDescription(description);
      const argHint = normalizeArgumentHint(skill.frontmatter['argument-hint']);
      // Use JSX expression form `{"..."}` for string attributes so embedded
      // double quotes are JS-string-escaped (\\") rather than left as raw `\"`
      // inside a JSX double-quoted attribute (which MDX rejects).
      const safeName = `{${JSON.stringify(name)}}`;
      const safeDesc = `{${JSON.stringify(truncated)}}`;
      const safeHint = `{${JSON.stringify(argHint)}}`;
      const safeHref = `{${JSON.stringify(`/skills/${name}`)}}`;
      parts.push(
        `  <SkillTile name=${safeName} description=${safeDesc} argumentHint=${safeHint} href=${safeHref} />`,
      );
    }
    parts.push('</div>');
    parts.push('');
  }

  // Index page contains JSX directly; do NOT run through mdx-escape (would
  // break the JSX tags). The author of this generator owns its safety.
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Override hatch (foundation pass-through; full pin enforcement in #141)
// ---------------------------------------------------------------------------

/**
 * If skills/{name}/page.override.mdx exists, copy it verbatim and skip
 * auto-generation for that skill. Story #141 layers SHA-256 pin enforcement
 * on top of this; the foundation story exposes the hatch so authors can
 * stage overrides during the migration window.
 *
 * Governing: SPEC-0021 REQ "Override File Format and Pin".
 */
function loadOverride(skillDir) {
  const overridePath = path.join(skillDir, 'page.override.mdx');
  if (!fs.existsSync(overridePath)) return null;
  return {
    path: overridePath,
    content: fs.readFileSync(overridePath, 'utf-8'),
  };
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

function loadSkill(name) {
  const dir = path.join(SKILLS_SOURCE, name);
  const skillMd = path.join(dir, 'SKILL.md');
  const raw = fs.readFileSync(skillMd, 'utf-8');
  const { frontmatter, body } = parseFrontmatter(raw);
  const { h1Title, preamble, sections } = splitSections(body);
  const refs = extractGoverningRefs(body);
  return {
    name,
    dir,
    skillMd,
    rawBody: raw,
    frontmatter,
    h1Title,
    preamble,
    sections,
    refs,
  };
}

function ensureCleanDest() {
  if (fs.existsSync(SKILLS_DEST)) {
    fs.rmSync(SKILLS_DEST, { recursive: true });
  }
  fs.mkdirSync(SKILLS_DEST, { recursive: true });
  // Establish the sidebar category for /skills/.
  fs.writeFileSync(
    path.join(SKILLS_DEST, '_category_.json'),
    JSON.stringify({ label: 'Skills', position: 3 }, null, 2),
  );
}

function main() {
  console.log('Transforming skills...');

  if (!fs.existsSync(SKILLS_SOURCE)) {
    console.log('  No skills directory found, skipping skill transform');
    return;
  }

  const manifest = loadManifest();
  checkBidirectionalConsistency(manifest);

  ensureCleanDest();

  const skillsByName = new Map();
  let pageCount = 0;
  let overrideCount = 0;

  for (const names of Object.values(manifest)) {
    for (const name of names) {
      const skill = loadSkill(name);
      skillsByName.set(name, skill);

      const destPath = path.join(SKILLS_DEST, `${name}.mdx`);
      const override = loadOverride(skill.dir);
      if (override) {
        // Foundation: pass-through. Story #141 adds the SHA-256 pin check.
        fs.writeFileSync(destPath, override.content);
        overrideCount++;
        continue;
      }

      const mdx = generateSkillPage(skill);
      fs.writeFileSync(destPath, mdx);
      pageCount++;
    }
  }

  // Hero-tile index.
  fs.writeFileSync(
    path.join(SKILLS_DEST, 'index.mdx'),
    generateIndexPage(manifest, skillsByName),
  );

  console.log(
    `  Generated ${pageCount} skill page${pageCount !== 1 ? 's' : ''}` +
      (overrideCount > 0 ? ` (${overrideCount} override${overrideCount !== 1 ? 's' : ''})` : '') +
      ' + 1 hero-tile index',
  );
}

// Exported helpers for testing and for the override-pin helper script in
// Story #141. Importing transform-skills.js does NOT run main().
module.exports = {
  loadManifest,
  checkBidirectionalConsistency,
  parseFrontmatter,
  splitSections,
  demoteHeaders,
  extractGoverningRefs,
  truncateDescription,
  generateSkillPage,
  generateIndexPage,
  loadSkill,
  // Exposed so Story #141 can add SHA-256 pin enforcement on top without
  // forking the file. The pin computation itself lives there.
  computeSkillMdHash: (skillMdPath) =>
    crypto.createHash('sha256').update(fs.readFileSync(skillMdPath)).digest('hex'),
  SKILLS_SOURCE,
  SKILLS_DEST,
  MANIFEST_PATH,
};

if (require.main === module) {
  main();
}
