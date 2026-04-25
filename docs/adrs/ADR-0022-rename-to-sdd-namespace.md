---
status: accepted
date: 2026-04-25
decision-makers: Joe Stump
---

# ADR-0022: Rename Plugin to `sdd` (Spec-Driven Development)

## Context and Problem Statement

Anthropic has shipped an official Claude Code plugin under the slash-command namespace `design`, which collides with this plugin's `/design:*` commands. Users who install Anthropic's plugin alongside this one see ambiguous skill resolution, and the `/design:` namespace can no longer be considered ours to claim.

Separately, the discipline this plugin codifies — ADRs, paired spec/design docs, requirements with scenarios, drift detection — is now widely referred to in the industry as "spec-driven development" (SDD). Adopting that name is both clearer to newcomers and aligned with how the practice is discussed.

## Decision Drivers

* **Namespace collision**: `/design:*` ships with Anthropic's tooling; we cannot keep using it without breaking users
* **Industry convention**: "spec-driven development" is the established name for this practice
* **Breaking change tolerance**: All artifacts in this repo are still in `proposed`/`accepted` ADRs and `draft` specs; there is no large external user base whose existing automation would break catastrophically
* **GitHub repo naming**: Repos under the `claude-plugin-*` convention should keep that prefix

## Considered Options

* **Option 1**: Keep `/design:*`, accept the collision (rely on user-side disambiguation)
* **Option 2**: Rename to `sdd` everywhere — namespace, repo, plugin name, config heading
* **Option 3**: Rename only the slash namespace to `sdd`, keep the repo name `claude-plugin-design`

## Decision Outcome

Chosen option: **Option 2** — full rename to `sdd`. Half-renames are confusing; aligning every surface (namespace, repo, package, configuration heading) avoids ongoing user friction.

Concretely:

| Surface | Before | After |
|---------|--------|-------|
| Slash command namespace | `/design:*` | `/sdd:*` |
| Plugin `name` field | `design` | `sdd` |
| GitHub repo | `joestump/claude-plugin-design` | `joestump/claude-plugin-sdd` |
| Local dir convention | `claude-plugin-design/` | `claude-plugin-sdd/` |
| Marketplace `name` | `claude-plugin-design` | `claude-plugin-sdd` |
| Docusaurus build plugin dir | `templates/integration/sync-design-docs/` | `templates/integration/sync-spec-docs/` |
| Docusaurus manifest file | `.design-docs.json` | `.sdd-docs.json` |
| CLAUDE.md config heading | `### Design Plugin Configuration` | `### SDD Configuration` |
| CLAUDE.md skills heading | `### Design Plugin Skills` | `### SDD Skills` |
| Project title (docs site) | `Claude Plugin: Design` | `Claude Plugin: Spec-Driven Development` |
| Plugin version | `3.0.0` | `4.0.0` (breaking) |

The legacy `.claude-plugin-design.json` config file is **removed**. Per ADR-0015, configuration moved to CLAUDE.md, and `/sdd:init` already auto-migrates any remaining JSON files it discovers in user repos. The migration logic continues to look for the old filename so users upgrading from v3 still get a clean migration path.

GitHub provides automatic redirects from the old repo URL to the new one, so existing clones (`origin` URLs) keep working until users update them.

### Positive Consequences

* No more namespace collision with Anthropic's `design` plugin
* Plugin name aligns with the industry term "spec-driven development"
* All surfaces (namespace, repo, headings, config) are consistent

### Negative Consequences

* Users on v3 must reinstall under the new namespace; their existing `### Design Plugin Configuration` sections will not be parsed by v4 skills
  * Mitigation: `/sdd:init` rewrites the heading on first run
* GitHub repo rename invalidates external links (e.g., docs site links from third-party blog posts)
  * Mitigation: GitHub auto-redirects URLs and clones; published docs site stays on old `BASE_URL` until next deploy
* Any user-authored governing comments referencing `/design:*` commands become slightly stale, but remain readable

## Links

* Supersedes the implicit naming established in ADR-0003 (Foundational Design Artifact Formats and Core Skills)
* Related to ADR-0015 (Markdown-Native Configuration) — the renamed `### SDD Configuration` heading is what migrated config writes
