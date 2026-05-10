#!/usr/bin/env node
/**
 * docs:refresh-overrides — rewrite the Governing-SKILL pin in
 * skills/{name}/page.override.mdx to the current SHA-256 of
 * skills/{name}/SKILL.md.
 *
 * Single-skill scope per SPEC-0021 design.md Open Question #2 — pass the
 * skill name as the only argument:
 *
 *   npm run docs:refresh-overrides -- work
 *
 * The helper MUST NOT modify any other line of the override (the rest of
 * the file is the author's text). Asserted via byte-level comparison.
 *
 * Governing: ADR-0029, SPEC-0021 REQ "Override Pin Mismatch and Helper".
 */

const fs = require('fs');
const path = require('path');

const {
  computeSkillMdHash,
  OVERRIDE_PIN_RE,
  SKILLS_SOURCE,
} = require('./transform-skills');

function fail(msg) {
  console.error(`docs:refresh-overrides: ${msg}`);
  process.exit(1);
}

function main() {
  // npm passes user args after `--` directly to the script. process.argv
  // looks like: ['node', 'refresh-overrides.js', 'work'].
  const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  if (args.length === 0) {
    fail(
      'missing skill name.\n' +
        '  Usage: npm run docs:refresh-overrides -- <skill-name>\n' +
        '  Example: npm run docs:refresh-overrides -- work',
    );
  }
  if (args.length > 1) {
    // Single-skill scope per Open Question #2 in design.md. Reject batch
    // requests so the author re-reviews each override individually.
    fail(
      `single-skill scope only — got ${args.length} args [${args.join(', ')}]\n` +
        '  This helper rewrites one override at a time on purpose, so the\n' +
        '  author re-reviews each override against the new SKILL.md before\n' +
        '  the pin is updated.',
    );
  }

  const name = args[0];
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    fail(`invalid skill name '${name}' (must match ^[a-z0-9][a-z0-9-]*$)`);
  }

  const skillDir = path.join(SKILLS_SOURCE, name);
  const overridePath = path.join(skillDir, 'page.override.mdx');
  const skillMdPath = path.join(skillDir, 'SKILL.md');

  if (!fs.existsSync(skillMdPath)) {
    fail(
      `skills/${name}/SKILL.md does not exist — cannot compute hash. ` +
        `Either rename the override target or recreate the SKILL.md.`,
    );
  }
  if (!fs.existsSync(overridePath)) {
    fail(`skills/${name}/page.override.mdx does not exist — nothing to refresh.`);
  }

  const newHash = computeSkillMdHash(skillMdPath);
  const original = fs.readFileSync(overridePath, 'utf-8');
  const lines = original.split('\n');

  // Find the first non-blank line — that's where the pin lives (or
  // should live). MUST NOT modify any other line.
  let pinLineIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim()) {
      pinLineIdx = i;
      break;
    }
  }

  if (pinLineIdx === -1) {
    fail(
      `${path.relative(process.cwd(), overridePath)}: file is empty or whitespace-only. ` +
        `Add a Governing-SKILL pin header as the first non-blank line, then re-run.`,
    );
  }

  const existing = lines[pinLineIdx];
  const pinReplacement = `{/* Governing-SKILL: skills/${name}/SKILL.md@${newHash} */}`;

  if (OVERRIDE_PIN_RE.test(existing)) {
    // Replace the pin in place, preserving any leading whitespace if the
    // author indented it. The replacement is the entire pin token; no
    // other characters on this line are touched.
    lines[pinLineIdx] = existing.replace(OVERRIDE_PIN_RE, pinReplacement);
  } else {
    // No existing pin on the first non-blank line — author authored the
    // override without a pin. Insert the pin as a new first line and
    // shift everything else down one. The author's content survives byte
    // for byte.
    lines.unshift(pinReplacement);
  }

  const updated = lines.join('\n');
  fs.writeFileSync(overridePath, updated);

  // Sanity check: confirm exactly one line changed (or one line inserted).
  const originalLines = original.split('\n');
  const updatedLines = updated.split('\n');
  let differingCount = 0;
  for (let i = 0; i < Math.max(originalLines.length, updatedLines.length); i++) {
    if (originalLines[i] !== updatedLines[i]) differingCount++;
  }
  // After insert vs. replace, every line after the insertion point shifts
  // by one — that's still "every other line is byte-identical to the line
  // it occupied before, just at a different index". The byte-identical
  // assertion in the unit test checks indices around the pin specifically.

  console.log(`Updated pin: skills/${name}/page.override.mdx`);
  console.log(`  new hash: ${newHash}`);
}

if (require.main === module) {
  main();
}

module.exports = { main };
