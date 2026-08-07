<!-- Governing: ADR-0015 (Markdown-Native Configuration), SPEC-0014 REQ "Config Resolution Pattern in shared-patterns.md" -->

# Harness Compatibility Reference

SDD skills are written in the open Agent Skills format (`SKILL.md`) and are designed to run on any agent harness that loads skills — Claude Code, Codex CLI, OpenCode, and Crush are the four we target explicitly. Skill bodies name Claude Code tool surfaces (`AskUserQuestion`, `Task`, `TeamCreate`, `SendMessage`, `TaskCreate`/`TaskUpdate`/`TaskList`/`TaskGet`, `ToolSearch`, `mcp__*`, `${CLAUDE_PLUGIN_ROOT}`) because that is the richest capability set; this reference defines how to interpret those names everywhere else.

**The rule: tool names denote capabilities, not hard requirements.** When a SKILL.md names a tool your harness does not have, map it to your harness's equivalent capability, or apply the documented fallback below. A skill MUST NOT abort solely because a named tool does not exist — the fallback paths are part of the skill's contract.

## Capability Map

| Capability | Claude Code | Codex CLI | OpenCode | Crush | Fallback when absent |
|------------|-------------|-----------|----------|-------|----------------------|
| Ask the user a structured question | `AskUserQuestion` | Plain question in chat | Plain question in chat | Plain question in chat | Ask in plain text with options as a numbered list; in non-interactive/batch/CI mode, take the skill's documented default without asking |
| Spawn a subagent | `Task` / `Agent` tool | None (treat as absent) | Subagent/task support (version-dependent) | None (treat as absent) | Do the work inline, sequentially, following § Single-Agent Sequential Fallback |
| Team coordination + inter-agent messaging | `TeamCreate`, `SendMessage`, team-scoped `Task*` tools | None | None | None | Single-agent sequential mode (§ below). Skills with a `TeamCreate` flow always document this fallback |
| Session task tracking | `TaskCreate` / `TaskUpdate` / `TaskList` / `TaskGet` | Harness todo/plan feature if present | Harness todo/plan feature if present | Harness todo/plan feature if present | Maintain a markdown checklist in the session (or a scratch file) and keep it current |
| MCP tool discovery | `ToolSearch` | Configured MCP servers (no runtime probe) | Configured MCP servers | Configured MCP servers | If you cannot probe for an MCP tool, assume it is absent and use the CLI path |
| MCP tools (`mcp__{server}__{tool}`) | Same naming | Server/tool naming differs per harness | Server/tool naming differs per harness | Server/tool naming differs per harness | Every MCP usage in these skills has a CLI equivalent (`gh`, `glab`, `tea`, `qmd`, `curl`); prefer the CLI when in doubt |
| Web fetch / search | `WebFetch` / `WebSearch` | Built-in browsing if enabled | Built-in fetch if enabled | Built-in fetch if enabled | `curl -sL {url}` for fetch; skip non-essential web searches |
| Worktree helpers | `EnterWorktree` | — | — | — | Plain `git worktree add` / `git worktree remove` commands (the skills already spell these out) |

Harness capabilities change between releases — when in doubt, probe for the capability (attempt the call, or check the harness's tool list) rather than assuming from this table, and fall back gracefully.

### Frontmatter

The `allowed-tools` frontmatter key is Claude Code-specific (it restricts the tool surface there). Other harnesses ignore unknown frontmatter keys — treat it as informative, not restrictive.

## Plugin Root Resolution

`${CLAUDE_PLUGIN_ROOT}` means "the directory this plugin is installed in" — the directory containing `skills/`, `references/`, and `templates/`. Resolve it in this order:

1. The `CLAUDE_PLUGIN_ROOT` environment variable, if set (Claude Code plugin runtime).
2. Two levels up from the running skill's `SKILL.md` (`{plugin-root}/skills/{name}/SKILL.md`) — works on any harness that tells you where the skill was loaded from.
3. Ask the user where the plugin is installed.

Never silently substitute a stale copy of a reference file — if a `${CLAUDE_PLUGIN_ROOT}/references/*.md` path cannot be resolved, say so.

## Project Memory File

Wherever a SKILL.md or reference says "CLAUDE.md" in the context of project configuration (`## Architecture Context`, `### SDD Configuration`, `### Workspace Modules`), read it as **the project memory file**: the instructions file the harness auto-loads per project.

| Harness | Native memory file |
|---------|--------------------|
| Claude Code | `CLAUDE.md` |
| Codex CLI | `AGENTS.md` |
| OpenCode | `AGENTS.md` |
| Crush | `CRUSH.md` (also reads `AGENTS.md`/`CLAUDE.md` in most builds) |

### Resolution rules

- **Read**: check `CLAUDE.md`, then `AGENTS.md`, then `CRUSH.md` at the relevant root (project or module). The first file containing the SDD sections (`## Architecture Context` or `### SDD Configuration`) is the memory file for all subsequent reads and writes in the session. If none contains them, the project is not initialized — suggest `/sdd:init`.
- **Write** (config producers: `/sdd:init`, `/sdd:plan`): converge into the file that already carries the SDD sections. On a fresh init, write to your harness's native memory file (table above); when unsure, `CLAUDE.md` remains the default for backward compatibility.
- **Never duplicate** the SDD sections across multiple memory files — two sources of truth will drift. If the sections live in `CLAUDE.md` but your harness only auto-loads `AGENTS.md`, add a one-line pointer in `AGENTS.md` ("Architecture context and SDD configuration live in CLAUDE.md") rather than copying the content.

## Single-Agent Sequential Fallback

Skills that orchestrate parallel work (`/sdd:work`, `/sdd:review`, and the `--review`/`--scrum` modes of `/sdd:adr`, `/sdd:spec`, `/sdd:plan`, `/sdd:audit`) fall back to **single-agent sequential mode** when team primitives are unavailable — whether `TeamCreate` fails at runtime or was never a registered tool. The work still completes; what changes is *where reading happens*, and that has a real token cost: everything pulled into the lead session's context is resent on every subsequent turn, so a long multi-PR session compounds.

Context-hygiene rules for sequential mode:

1. **Never pull a full PR diff into the lead session by default.** Start with `gh pr diff {N} --name-only` (or tracker equivalent), then fetch targeted per-file excerpts for the files that matter to the acceptance criteria. Escalate to a full diff only when the targeted read is genuinely insufficient, and prefer reading it in a subagent (rule 2) when you do.
2. **If subagents are available (just not teams), fork read-heavy verification.** Dispatch the per-PR "read the diff, check against acceptance criteria and CI" step to a subagent that returns only a verdict plus a compact summary — not the diff. The lead keeps orchestration state; the subagent absorbs the bulk reading.
3. **Summarize, then move on.** After verifying a PR (or reading a large log, or dumping qmd results), carry forward only the verdict and a few-line summary. Do not re-quote large content in later turns.
4. **Batch hygiene applies per item.** In a multi-PR loop, apply rules 1–3 to *each* PR — the compounding cost comes from the accumulation, not any single read.

## Permissions and Approvals

`/sdd:init`'s permissions step writes tool allowlists to `.claude/settings.local.json` — that file is Claude Code-specific. On other harnesses, skip the step and instead tell the user which commands the SDD skills will invoke (`git`, `gh`/`glab`/`tea`, `qmd`) so they can pre-approve them in their harness's own mechanism:

| Harness | Where approvals live |
|---------|----------------------|
| Claude Code | `.claude/settings.local.json` `permissions.allow` |
| Codex CLI | `~/.codex/config.toml` (approval policy / sandbox settings) |
| OpenCode | `opencode.json` permission configuration |
| Crush | Crush config (`crush.json`) allowed-tools settings |

Do not write another harness's config file by guessing its schema — name the commands and let the user (or their harness docs) do the wiring.

## Worktrees

The default worktree base directory (`.claude/worktrees/`, from `### SDD Configuration` → `#### Worktrees` → `Base Dir`) matches Claude Code's managed worktree location, which is gitignored there. On other harnesses, set `Base Dir` to a path that is invisible to git and build tooling — `.sdd/worktrees/` works (`/sdd:init` already gitignores `.sdd/`), as does a sibling directory outside the repo. The invariant is the location's gitignore status, not the specific path: a worktree must never show up in `git status`, builds, or linters.

## Skill-to-Skill Invocation

The `/sdd:{name}` prefix is Claude Code plugin namespacing. When a SKILL.md says "run `/sdd:check`" (or suggests it to the user), read: "invoke the `check` skill however your harness invokes skills" — by slash command, by name, or by asking the agent to apply the skill. Non-SDD built-ins referenced by skills (e.g. `/autofix-pr` in `/sdd:work`) exist only on the harness that ships them; the referencing skill documents what to do when they are unavailable — follow that path rather than emulating the built-in.

## Consumers

All skills consume this reference via the standard harness-portability note under their title. Skills with harness-specific deep behavior additionally reference specific sections:

| Skill | Sections |
|-------|----------|
| `/sdd:init` | Project Memory File; Permissions and Approvals |
| `/sdd:work`, `/sdd:review` | Single-Agent Sequential Fallback; Worktrees; Skill-to-Skill Invocation |
| `/sdd:respond` | Worktrees; Capability Map (MCP fallbacks) |
| `/sdd:search`, `/sdd:index`, `/sdd:prime` | Capability Map (MCP tool discovery); Plugin Root Resolution |
| All others | Capability Map; Plugin Root Resolution; Project Memory File |
