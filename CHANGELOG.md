# Changelog

All notable changes to the SDD plugin (`claude-plugin-sdd`) are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/) and the project follows [Semantic Versioning](https://semver.org/).

## [5.0.0] — Unreleased

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
