---
status: proposed
date: 2026-05-03
decision-makers: Joe Stump
related: [ADR-0015, ADR-0017, ADR-0023]
enables: [ADR-0025]
---

# ADR-0024: Make qmd a Hard Dependency of the SDD Plugin (v5)

## Context and Problem Statement

The plugin's read-side skills (`/sdd:prime`, `/sdd:check`, `/sdd:audit`, `/sdd:discover`) currently scan the entire ADR + spec corpus to answer any question, because they have no way to ask "which of these N artifacts are *relevant* to this target?" That works at 23 ADRs and 18 specs; it does not scale to mature projects. Authoring skills (`/sdd:adr`, `/sdd:spec`) ask the human to declare graph edges (`supersedes`, `extends`, `related`) without surfacing candidate matches, so connections are missed and the DAG ADR-0023 introduced stays sparse. Planning and implementation skills (`/sdd:plan`, `/sdd:work`) cannot retrieve "existing code that already solves part of this story", so issues get framed as greenfield and stories duplicate work.

[qmd](https://github.com/tobi/qmd) is an on-device hybrid retrieval engine (BM25 + vector + LLM rerank, all local GGUF models) that the new `/sdd:index` skill (introduced alongside this ADR) wires into per-repo collections of ADRs, specs, and code. Every read-side and authoring skill could become dramatically smarter by retrieving "top-K artifacts relevant to this question" before reading anything in full — but only if it can *assume* qmd is present. The question is whether to treat qmd as an optional accelerator (with fallback paths in every skill) or a required peer of the plugin.

## Decision Drivers

* **Skill complexity scales with optional dependencies.** Every "if qmd available, do X; else do Y" branch is two code paths to author, test, and document. With ~11 skills slated to become qmd-aware, that is ~22 paths instead of ~11.
* **Capability ceiling matters more than installation friction.** A skill that *might* call qmd cannot rely on its results being available, so its design ceiling is the no-qmd path. Hard dependency lets each skill design *for* hybrid retrieval rather than around it.
* **The architectural primitive the plugin actually optimizes for.** ADR-0015 declared markdown the source of truth; ADR-0023 declared the artifact graph first-class; both decisions hinge on being able to *traverse and search* that markdown corpus efficiently. qmd is the runtime for that traversal — making it optional means the foundation is conditionally present.
* **Onboarding is a one-time cost.** `npm install -g @tobilu/qmd` is a single command, and the GGUF models auto-download on first embed. The cost is paid once per machine; the benefit accrues across every project the user touches.
* **Forcing function for ecosystem coherence.** A hard dependency means every SDD project has the same retrieval primitives available, so skill authors and downstream tooling (a future MCP, a CI runner, etc.) can rely on them. Optional means the lowest common denominator wins.
* **Breaking change is the right time.** The plugin is at v4.2.0 with active users. Slipping a hard dep into a minor version would break installs silently. v5.0.0 is honest about the rupture.

## Considered Options

* **Option 1**: Status quo — no qmd integration. Skills continue to scan the whole corpus.
* **Option 2**: Optional dependency — every qmd-aware skill checks for qmd at runtime and falls back to the current behavior when absent.
* **Option 3**: Soft requirement — `/sdd:init` warns if qmd is missing and recommends installing it; skills assume qmd is present and error cleanly when it is not.
* **Option 4**: Hard dependency — `/sdd:init` enforces qmd presence; the plugin refuses to operate without it; v5.0.0 marks the breaking change.
* **Option 5**: Bundle qmd in the plugin manifest via npx — declare an MCP server in `.claude-plugin/.mcp.json` as `npx -y @tobilu/qmd mcp` so the plugin "ships" qmd.

## Decision Outcome

Chosen option: **"Option 4 — Hard dependency, v5.0.0"**, because the value of qmd-aware skills compounds across the plugin's surface and the cost of optional fallbacks would be paid in skill complexity for the lifetime of the project. The other options each fail on a specific axis:

- Option 1 leaves the plugin in its current shape and forecloses the qmd-native skills capability we already see working in `/sdd:index`.
- Option 2 doubles the surface area of every qmd-aware skill, doubles the test matrix, and constrains design to the no-qmd ceiling.
- Option 3 has the same skill-author cost as Option 4 (skills still assume qmd) without the install-time guarantee — users hit cryptic mid-run failures instead of a clear precheck error.
- Option 5 is unviable today because qmd's MCP surface is read-only (`query`, `get`, `multi_get`, `status`); write operations (`collection add`, `embed`, `update`, `context add`) require the CLI in PATH, so bundling the MCP does not eliminate the install precheck. (Reconsider when qmd exposes write operations as MCP tools.)

### Sub-decision 1: Enforcement happens in `/sdd:init`

`/sdd:init` runs `command -v qmd` as a preflight check. If qmd is missing, init refuses to write CLAUDE.md and emits the install command (`npm install -g @tobilu/qmd` or `bun install -g @tobilu/qmd`) plus a link to qmd's repository. This makes the dependency obvious at the moment a user is setting up a project — not three skills deep into a workflow.

### Sub-decision 2: Other qmd-aware skills MAY assume qmd is present

Skills downstream of `/sdd:init` MAY assume qmd is installed and the repo is indexed (or invite the user to run `/sdd:index` if not). They MUST NOT include conditional fallback paths. If a skill needs to handle "qmd installed but this repo not yet indexed", it does so by routing to `/sdd:index` rather than by silently degrading.

### Sub-decision 3: Version bump to 5.0.0

The plugin moves from v4.2.0 → v5.0.0 in `.claude-plugin/plugin.json`. The CHANGELOG documents the qmd requirement under "Breaking Changes" with the install command. Existing users on v4.x continue to work without qmd; only fresh installs and explicit upgrades pick up the requirement.

### Consequences

* Good, because every qmd-aware skill becomes designable *for* hybrid retrieval rather than around its absence — the design ceiling of `/sdd:check`, `/sdd:audit`, `/sdd:discover`, `/sdd:adr`, `/sdd:spec`, `/sdd:plan`, `/sdd:prime`, `/sdd:work`, and `/sdd:review` rises substantially.
* Good, because skill code stays single-path: no `if qmd available` branches to author, test, or document.
* Good, because users receive a coherent "the plugin assumes X" promise instead of "the plugin has feature parity with and without X."
* Good, because forcing qmd installation creates the surface area for future plugin features (RAG over the artifact corpus, semantic graph queries, cross-repo search) without re-litigating the dependency model.
* Bad, because new users must install qmd before `/sdd:init` succeeds — a friction point that did not previously exist.
* Bad, because qmd's GGUF models (~2GB total: EmbeddingGemma 300M, Qwen3-Reranker 0.6B, qmd-query-expansion 1.7B) auto-download on first embed, which surprises bandwidth-constrained users.
* Bad, because CPU-only machines pay a real time cost on initial embed (mitigated by `/sdd:index`'s background-mode prompt) and a smaller cost on every subsequent query (mitigated by qmd's HTTP daemon, which keeps models loaded between requests).
* Bad, because v5.0.0 is a breaking release — any tooling, marketplace listing, or downstream automation that pinned to v4 needs an update.

### Confirmation

Compliance is confirmed by:

1. `/sdd:init` exits non-zero with the install command when qmd is absent. Verified by an integration test that runs `init` in a sandbox without qmd in PATH.
2. No qmd-aware skill contains a `command -v qmd || fallback` branch. Verified by a `grep -r "command -v qmd" skills/` lint check; only `/sdd:init` may match.
3. The plugin's `README.md` and `.claude-plugin/plugin.json` description list qmd as a runtime requirement, not a recommendation.
4. CHANGELOG entry for v5.0.0 enumerates the breaking change and the install command.

## Pros and Cons of the Options

### Option 1: Status quo (no qmd)

The current shape of the plugin — read-side skills scan the full corpus; authoring skills ask humans to declare edges manually; planning skills greenfield every story.

* Good, because zero install friction — anyone with the plugin can use it immediately.
* Good, because no breaking change required.
* Neutral, because the existing skills work fine at small corpus sizes (today's claude-plugin-sdd repo is the proof).
* Bad, because the design ceiling of every read-side skill is "load everything into context", which fails as repos mature.
* Bad, because authoring skills cannot suggest graph edges, leaving the DAG ADR-0023 introduced sparse.
* Bad, because planning skills cannot retrieve existing code, so stories are sized as if from scratch.

### Option 2: Optional dependency (with fallback)

Every qmd-aware skill detects qmd at runtime and branches: smart path if present, current path if absent.

* Good, because no install friction for users who do not want qmd.
* Good, because no breaking change.
* Bad, because every qmd-aware skill is two code paths — roughly double the SKILL.md authoring effort and test coverage.
* Bad, because the design ceiling of each skill is constrained by the no-qmd path; the qmd path is at most a faster version of the same behavior, never genuinely smarter.
* Bad, because users on the fallback path receive a strictly worse experience while reading the same documentation.
* Bad, because skill authors must reason about both paths simultaneously, which leaks complexity into every PR.

### Option 3: Soft requirement (warn at init, assume in skills)

`/sdd:init` warns about missing qmd but proceeds. Skills assume qmd is present and error out when it is not.

* Good, because no breaking change at the install layer.
* Good, because skill code stays single-path (same as Option 4).
* Neutral, because the user-facing failure mode shifts from "init refuses" to "skills crash" — same outcome, later in the workflow.
* Bad, because users discover the dependency mid-task instead of at setup, which is the worst possible time to learn it.
* Bad, because warnings are routinely ignored — the soft signal does nothing the hard precheck would not do better.

### Option 4: Hard dependency (chosen)

`/sdd:init` enforces qmd presence; v5.0.0 marks the breaking change; downstream skills MAY assume qmd is available.

* Good, because skill code stays single-path.
* Good, because the dependency is discovered at the right moment (init), not mid-workflow.
* Good, because the v5.0.0 bump is honest about the rupture and gives existing users a clear upgrade signal.
* Good, because future plugin capabilities (semantic graph, RAG, cross-repo search) can rely on qmd as primitive.
* Bad, because new users hit an install step before the plugin works.
* Bad, because qmd's GGUF models auto-download (~2GB) on first embed.
* Bad, because the v5.0.0 release requires CHANGELOG, README, and marketplace updates.

### Option 5: Bundle qmd in plugin manifest via npx

Declare an MCP server in `.claude-plugin/.mcp.json` as `npx -y @tobilu/qmd mcp` so the plugin auto-spawns qmd's MCP. The skills shell out to `npx -y @tobilu/qmd ...` for write operations.

* Good, because zero-install for users — `/plugin install` fetches qmd transitively.
* Neutral, because this option does not eliminate the requirement on the qmd CLI being callable; it only reframes how it is invoked.
* Bad, because qmd's MCP is read-only today (`query`, `get`, `multi_get`, `status`). Write operations (`collection add`, `embed`, `update`, `context add`) are CLI-only, so the plugin still needs a CLI path. Bundling the MCP eliminates only the *search* install friction, not the *index* friction.
* Bad, because every `npx -y` invocation does a dependency-resolve check (~1-3s overhead) on top of any user-installed qmd, doubling the latency on indexing operations.
* Bad, because users who already have the standalone `qmd@qmd` plugin installed (a separate marketplace entry) end up with two MCP servers backed by the same `~/.cache/qmd/index.sqlite` file — reads are fine, but writes can race.
* Bad, because the plugin would silently re-implement what an upstream-maintained marketplace plugin already provides, creating version-drift risk between the bundled qmd and the standalone plugin.
* Reconsider, when qmd exposes write operations as MCP tools — at that point, bundling the MCP becomes a genuine alternative to a CLI dependency.

## Architecture Diagram

```mermaid
flowchart TD
  User([User]) -->|1. /sdd:init| Init[/sdd:init]
  Init -->|preflight: command -v qmd| QmdCheck{qmd in PATH?}
  QmdCheck -->|no| Refuse[Refuse with install command:<br/>npm install -g @tobilu/qmd]
  QmdCheck -->|yes| WriteClaude[Write CLAUDE.md<br/>+ suggest /sdd:index]
  WriteClaude -->|2. /sdd:index| Index[/sdd:index]
  Index -->|qmd collection add x3| QmdIndex[(qmd index<br/>~/.cache/qmd/index.sqlite)]

  WriteClaude -.->|3+. all qmd-aware skills MAY assume qmd is present| Skills

  subgraph Skills [qmd-aware skills v5+]
    Prime[/sdd:prime]
    Check[/sdd:check]
    Audit[/sdd:audit]
    Discover[/sdd:discover]
    AdrSk[/sdd:adr]
    SpecSk[/sdd:spec]
    Plan[/sdd:plan]
    Work[/sdd:work]
    Review[/sdd:review]
  end

  Skills -->|qmd MCP query<br/>or qmd CLI| QmdIndex

  classDef refuse fill:#fbb,stroke:#900
  classDef ok fill:#bfb,stroke:#090
  class Refuse refuse
  class WriteClaude,QmdIndex ok
```

## More Information

* `/sdd:index` (introduced alongside this ADR) is the only skill that *creates* qmd state. All other qmd-aware skills are consumers.
* ADR-0025 (paired with this one) extends the per-repo collection set with a fourth `{repo}-issues` collection by syncing tracker issues to `.sdd/issues/`. That decision assumes the dependency model established here.
* The forthcoming `qmd-native-skills` spec enumerates the per-skill requirements that consume this dependency.
* qmd's HTTP daemon mode (`qmd mcp --http --daemon`) is the recommended runtime for CPU-only users — it keeps models loaded across requests, eliminating cold-start latency on every query. Future plugin work may auto-start the daemon on `/sdd:init`.
* This ADR does *not* require users to install the standalone `qmd@qmd` Claude Code plugin (which exposes the qmd MCP to all sessions). The SDD plugin's skills work with either the qmd CLI directly or the qmd MCP if present; both surfaces talk to the same underlying index.
