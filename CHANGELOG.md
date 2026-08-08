# Changelog

All notable changes to the SDD plugin (`claude-plugin-sdd`) are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/) and the project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Harness portability across Codex CLI, OpenCode, and Crush**: new `references/harness-compat.md` maps every Claude Code-specific tool surface the skills name (`AskUserQuestion`, `Task`, `TeamCreate`/`SendMessage`, `Task*`, `ToolSearch`, `mcp__*`, `${CLAUDE_PLUGIN_ROOT}`) to per-harness equivalents and documented fallbacks, defines the project memory file resolution (`CLAUDE.md` / `AGENTS.md` / `CRUSH.md`), plugin-root resolution, permissions equivalents, and worktree placement rules. All 20 skills carry a standard portability note, `shared-patterns.md` generalizes Config Resolution to the memory file, `/sdd:init` selects the harness-native memory file and gates the `.claude/settings.local.json` permissions step to Claude Code, and `/sdd:work`'s `/autofix-pr` stage skips cleanly (without filing version issues) on harnesses that can never ship the built-in.

### Fixed

- **Scaffolded docs sites now typecheck**: the five badge components shipped in `templates/docusaurus/src/components/` (`DateBadge`, `DomainBadge`, `PriorityBadge`, `SeverityBadge`, `StatusBadge`) annotated their return type as `JSX.Element`. `package.json` declares React 18, but the `@types/react` hoisted in from Docusaurus is v19, which removed the global `JSX` namespace, so `tsc` failed with `TS2503: Cannot find namespace 'JSX'` in every site `/sdd:docs` scaffolds. All five now use `React.JSX.Element`, which resolves under both type versions.
- **`/sdd:prime` untargeted-priming qmd commands now work against the real CLI** ([#200](https://github.com/joestump/claude-plugin-sdd/issues/200)): the documented `qmd query --json -c {c} --limit 10000 --minScore 0` pattern failed three ways — `--minScore` is the MCP parameter name (CLI is `--min-score`), the result cap flag is `-n`, and an empty query is not a wildcard (qmd's query expansion garbles it). Untargeted mode now enumerates via `qmd ls` per a new `qmd-helpers.md` § "Exhaustive Retrieval (list-all)" section; topic mode puts the positional query first with kebab-case flags. The `qmd-helpers.md` CLI example is corrected to match.
- **Single-agent fallback in `/sdd:work` and `/sdd:review` no longer burns tokens on inline diff-reading** ([#201](https://github.com/joestump/claude-plugin-sdd/issues/201)): the TeamCreate-unavailable fallback paths now carry explicit context-hygiene rules — fork per-PR diff-read-and-verify to a subagent returning only a verdict + compact summary when subagents exist, otherwise default to `--name-only` plus targeted excerpts, and carry only outcome summaries between items. Canonical guidance lives in `harness-compat.md` § "Single-Agent Sequential Fallback".

## [5.2.1] — 2026-07-31

Bug-fix release addressing five issues reported from real-world adoption ([#190](https://github.com/joestump/claude-plugin-sdd/issues/190)–[#194](https://github.com/joestump/claude-plugin-sdd/issues/194)). No new features, no breaking changes.

### Fixed

- **`/sdd:check` and `/sdd:audit` can now invoke qmd from restricted contexts** ([#194](https://github.com/joestump/claude-plugin-sdd/issues/194)): both skills mandate qmd hybrid retrieval with an explicit never-fall-back rule, but were the only qmd-mandating skills whose `allowed-tools` lacked `Bash`. Wherever `allowed-tools` is enforced (e.g. subagents), they were required to do something they were not permitted to do. `Bash` added to both, matching the other six qmd-aware skills.
- **`/sdd:index` embed-prompt contradiction resolved** ([#194](https://github.com/joestump/claude-plugin-sdd/issues/194)): a leftover pre-v5 Rules bullet still mandated the three-way `AskUserQuestion` embed prompt on CPU machines, contradicting the Process section and ADR-0026's no-prompt policy. The bullet now describes the actual policy: background by default on CPU, `--foreground`/`--skip` override.
- **Reference paths fully qualified** ([#194](https://github.com/joestump/claude-plugin-sdd/issues/194)): all 190 bare `references/...` mentions of plugin-root reference docs across every `SKILL.md` now use `${CLAUDE_PLUGIN_ROOT}/references/...` — the bare form resolved against the invoking skill's own directory and 404'd (e.g. `/sdd:init`'s `claude-md-template.md` pointer). Skill-local references are unchanged.
- **Conflict-marker gate no longer false-positives on Markdown setext headings** ([#191](https://github.com/joestump/claude-plugin-sdd/issues/191)): `/sdd:review` treated any standalone `=======` line as a merge-conflict marker, rejecting PRs that merely added a seven-character setext-underlined heading (`Summary`, `Roadmap`, …). `=======` now counts only between a `<<<<<<<`/`>>>>>>>` pair in the same file; the bracketing markers still flag on their own. Spec, skill, README, and eval assertion updated together, with a new spec scenario covering the setext case.
- **Scaffolded docs-site first build no longer fails** ([#193](https://github.com/joestump/claude-plugin-sdd/issues/193)): three independent cold-start defects fixed — the `sdd-content` plugin now creates `docs-generated/` eagerly at construction (Docusaurus validates the directory before `loadContent()` runs); `@docusaurus/theme-mermaid` is pinned exactly to match core (a caret range resolved to 3.10.x and tripped the version-mismatch guard); and a `webpackbar` `^7` override guards against the 6.x/webpack ≥5.101 ProgressPlugin breakage.
- **Loop budget's built-in rate table flagged as a point-in-time snapshot** ([#192](https://github.com/joestump/claude-plugin-sdd/issues/192)): the compiled-in fallback rate table silently attributed $0 to models it didn't list, under-counting `dollars_estimate` exactly when a cost ceiling mattered. The table now carries an explicit freshness note, and implementations surface a once-per-run staleness notice whenever cost accounting runs on the built-in default with an active dollar ceiling — including the matched-but-drifted-prices case the unknown-model warning cannot detect.
- **`eval-tier3` CI job reads the real prompt corpus** ([#190](https://github.com/joestump/claude-plugin-sdd/issues/190)): the job pointed at a nonexistent `evals/tier3.json`; it now reads `evals/evals.json` filtered to the Tier 3 skill set, matching the other eval jobs.

## [5.2.0] — 2026-06-30

### Added

- **`/sdd:respond`**: new author-side skill that addresses review feedback already present on a PR — gathers review threads, requested-changes reviews, top-level comments, and failing CI; makes the code fixes on the PR branch and pushes; replies to each thread; and captures out-of-scope feedback as tracked follow-up issues. It judges requested changes against governing specs/ADRs (declining, with citation, those that would violate them) and never merges. Complements `/sdd:review` (reviewer-driven) by handling feedback that originated outside the plugin — the common human-review case. See [ADR-0034](docs/adrs/ADR-0034-author-side-pr-response-skill.md) and SPEC-0035. Functional and trigger evals added under `evals/`.

## [5.0.0] — 2026-05-15

### Breaking Changes

- **qmd is now a hard runtime dependency.** The plugin's read-side and authoring skills assume [qmd](https://github.com/tobi/qmd) is installed. `/sdd:init` performs a `command -v qmd` preflight check and refuses to set up a project if qmd is absent. Install with `npm install -g @tobilu/qmd` (or `bun install -g @tobilu/qmd`) before upgrading. See [ADR-0024](https://joestump.github.io/claude-plugin-sdd/decisions/0024-qmd-as-hard-dependency) for the full rationale.
- **Optional/fallback paths removed.** Skills no longer detect qmd at runtime and degrade — they assume qmd is present. Users on v4.x who do not want qmd should pin to the latest v4 release.
- **First-time embed downloads ~2&nbsp;GB of GGUF models** (EmbeddingGemma 300M, Qwen3-Reranker 0.6B, qmd-query-expansion 1.7B) into `~/.cache/qmd/`. Subsequent runs reuse the cache.

### Added

- **`/sdd:index`**: new skill that creates and maintains per-repo qmd collections (`{repo}-adrs`, `{repo}-specs`, `{repo}-code`, `{repo}-issues`). Runs on demand and is invoked by upgrade flows.
- **Tracker issues as a fourth qmd collection** ([ADR-0025](https://joestump.github.io/claude-plugin-sdd/decisions/0025-tracker-issues-as-fourth-qmd-collection)): tracker issues sync to `.sdd/issues/` and are indexed alongside ADRs, specs, and code so planning and review skills can find prior work.
- **Tiered index freshness** ([ADR-0026](https://joestump.github.io/claude-plugin-sdd/decisions/0026-tiered-index-freshness-strategy)): each skill belongs to one of four freshness tiers and refreshes the qmd index accordingly — Tier 1 (post-mutation), Tier 2 (session-start, in `/sdd:prime`), Tier 3 (drift skills), Tier 4 (sprint skills always sync issues on entry, subject to a 5-minute dedup window).
- **`/sdd:prime` non-authoritative artifact filtering** ([ADR-0027](https://joestump.github.io/claude-plugin-sdd/decisions/0027-non-authoritative-artifact-filtering-in-prime)): ADRs and specs with status `superseded`, `deprecated`, or `rejected` are excluded from the primed context and listed in a footer with `superseded-by` transition links. Topic mode still surfaces them with a `⚠` badge.
- **qmd-aware authoring skills**: `/sdd:adr`, `/sdd:spec`, and `/sdd:status` now pre-search the artifact corpus before mutating, so users see candidate edges (supersedes, related, extends) and prior decisions on the same topic instead of guessing.
- **qmd-aware drift skills**: `/sdd:check` and `/sdd:audit` use top-K retrieval per target file/scope, replacing the corpus-wide scan path for substantially better signal on mature repos.
- **qmd-aware planning and implementation**: `/sdd:plan` and `/sdd:work` retrieve relevant existing code and prior issues before sizing stories or writing implementations, so duplicate work surfaces early.
- **`/sdd:discover` pre-search**: rules out duplicate decisions before drafting ADR candidates from existing code.

### Changed

- `/sdd:prime` topic mode (`/sdd:prime <topic>`) uses qmd hybrid retrieval rather than reading every artifact and filtering semantically.
- `/sdd:prime` runs a Tier 2 `qmd update` on entry (cheap mtime scan); skipped if the index was touched within 60 seconds.

### Documentation

- New "Prerequisites" section in [Getting Started](./guides/getting-started) covering qmd installation.
- `/sdd:prime` command reference updated for v5 behavior. Other skill entries in [Skills](./skills/) describe v4 behavior and will be updated in a follow-up doc PR.

### Notes for upgrading

1. Install qmd: `npm install -g @tobilu/qmd`.
2. Run `/sdd:init` to confirm the preflight passes; CLAUDE.md is rewritten only if needed.
3. Run `/sdd:index` to build the per-repo collections (this is when the GGUF models download).
4. Resume normal workflow — every qmd-aware skill now uses retrieval transparently.

If you cannot install qmd, stay on v4.x.

---

## [4.4.1] — 2026-04-30

See git history for v4.x and earlier releases. (CHANGELOG was introduced in v5.0.0.)
