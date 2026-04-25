# SDD Plugin v4.0 Plan

## Table of Contents

1. [Kill `.claude-plugin-design.json`](#key-insight-kill-claude-plugin-sddjson)
2. [Workspace Mode for Multi-Module Projects](#workspace-mode)
3. [Init Permission Setup](#init-permission-setup)
4. [PR Stacking and Parallel Agent Coordination](#pr-stacking-and-parallel-agent-coordination)
5. [Security-by-Default](#security-by-default)
6. [Code Quality Guardrails](#code-quality-guardrails)
7. [Frontend Quality Standards](#frontend-quality-standards)
8. [Governing Comment Reform](#governing-comment-reform)
9. [Skill Updates Required](#skill-updates-required)
10. [New ADRs and Specs](#new-adrs-and-specs)
11. [Rollout Order](#rollout-order)

---

## Problem

The plugin produces well-structured, thoroughly documented codebases with excellent traceability from decisions to implementation. But a review of three production projects (spotter, joe-links, claude-ops) revealed systemic blind spots in five areas:

1. **Hardcoded paths** — every skill assumes `docs/adrs/` and `docs/openspec/specs/` at a single project root
2. **JSON config antipattern** — `.claude-plugin-design.json` creates split truth with CLAUDE.md
3. **PR stacking chaos** — parallel agents create duplicate code, rebase conflicts, and wasted PRs
4. **Security as opt-in** — no default security requirements; claude-ops shipped an unauthenticated dashboard
5. **No frontend quality standards** — zero frontend tests, zero accessibility, template duplication across all 3 repos

---

## Key Insight: Kill `.claude-plugin-design.json`

JSON config is a traditional-tooling reflex. Claude reads markdown natively, and Claude Code already recursively loads CLAUDE.md files from subdirectories. The config should *be* CLAUDE.md.

**What `.claude-plugin-design.json` currently stores:**
- Tracker choice and credentials
- Project grouping settings
- Branch naming conventions
- PR conventions
- Worktree settings
- Review settings

**Why markdown instead:**
- Claude is already interpreting natural language instructions from CLAUDE.md — JSON doesn't add determinism
- Two config sources (JSON + CLAUDE.md) creates split truth
- CLAUDE.md is human-readable, version-controlled, and already understood by every Claude Code session
- Claude Code recursively loads CLAUDE.md from subdirectories — workspace support comes for free
- `.claude-plugin-design.json` was the #1 merge conflict source in claude-ops — every PR modified it

**Migration path:** Move all config sections from `.claude-plugin-design.json` into CLAUDE.md as structured markdown sections. Each submodule's CLAUDE.md carries its own design config.

### CLAUDE.md Config Structure

Example of what replaces `.claude-plugin-design.json`:

```markdown
### SDD Configuration

#### Tracker
- **Type**: gitea
- **URL**: https://git.example.com
- **Owner**: myorg
- **Repo**: service-a

#### Branch Conventions
- **Prefix**: feat/
- **Epic prefix**: epic/
- **Slug length**: 40

#### PR Conventions
- **Close keyword**: Closes
- **Spec reference**: Include SPEC-XXXX in PR body

#### Review
- **Max pairs**: 2
- **Merge strategy**: squash
- **Auto cleanup**: true
```

For workspaces, the top-level CLAUDE.md would include:

```markdown
### Workspace Modules

This project uses git submodules. Each submodule carries its own design artifacts and CLAUDE.md configuration.

| Module | Path | Description |
|--------|------|-------------|
| service-a | service-a/ | Core API service |
| service-b | service-b/ | Event processor |
```

---

## Workspace Mode

### Problem

Every skill hardcodes `docs/adrs/` and `docs/openspec/specs/` relative to a single project root. If ADRs/specs live in submodules, every skill silently fails.

### Solution

Leverage CLAUDE.md's recursive loading. Each submodule's CLAUDE.md declares its own design artifacts. Skills resolve paths by reading CLAUDE.md instead of hardcoding.

**Key design choices:**
- **Auto-discover from `.gitmodules`** — detect submodules automatically
- **Per-module CLAUDE.md** — each submodule carries its own design config
- **Module-scoped operations** — skills accept a `--module <name>` flag to scope to one submodule, or operate across all by default
- **Shared patterns get a path resolver** — `references/shared-patterns.md` gains an "Artifact Path Resolution" pattern

---

## Init Permission Setup

### Problem

Running `/sdd:work` with parallel agents means dozens of `git push`, `gh pr create`, and MCP tool calls — each requiring manual approval.

### Solution

`/sdd:init` offers to configure `.claude/settings.json` with permission allowlists based on detected tracker.

### Recommended Allowlist

```json
{
  "permissions": {
    "allow": [
      "Bash(git *)",
      "Bash(gh *)",
      "mcp__gitea__*"
    ]
  }
}
```

| Pattern | What it covers |
|---------|---------------|
| `Bash(git *)` | push, commit, worktree add/remove, fetch, checkout, branch |
| `Bash(gh *)` | pr create/merge, issue create/list, release create |
| `mcp__gitea__*` | All Gitea API operations (issues, PRs, projects, labels) |
| `mcp__github__*` | All GitHub MCP operations (if using GitHub MCP instead of gh CLI) |
| `mcp__gitlab__*` | All GitLab MCP operations |

---

## PR Stacking and Parallel Agent Coordination

This is the highest-impact area for improvement, based on evidence from all three production repos.

### Evidence Summary

| Metric | spotter | joe-links | claude-ops |
|--------|---------|-----------|------------|
| Parallel batches identified | 8+ | 6+ | 5+ |
| Merge conflict commits | 4 | 6 | 1 |
| PRs closed/recreated | 0 | 5 | 1 |
| Confirmed duplicate implementations | 2 | 1 | 1 |
| Worst file hotspot | `sync.go` (3 concurrent PRs) | `link_store.go` (6 concurrent PRs) | `.claude-plugin-design.json` (all 7 PRs) |
| Conflict markers merged into main | No | No | Yes (`api_handlers.go`) |
| Issues with assignees set | 0 | 0 | 0 |
| Issues with "in-progress" labels | 0 | 0 | 0 |
| PR review comments catching duplicates | 0 | 0 | 0 |

### Concrete Failures

**Duplicate code across parallel PRs:**
- spotter: `nopHandler` struct implemented independently in `enrichers/openai/` and `vibes/generator.go`. Cleaned up in PR 168.
- spotter: LLM client code (`ChatRequest`/`ChatResponse` types, `callOpenAI()` HTTP logic) duplicated across 4 packages. PR 171 extracted it, removing 181 lines.
- joe-links: `PublicLink` struct created independently in PRs 112 and 114. Had to be manually unified at merge.

**Rebase churn:**
- spotter PR 144: Required explicit merge-conflict-resolution commit after 5 other PRs merged. Commit fixed "missing AuthMiddleware function" and "missing closing brace" — broken code from a bad rebase.
- joe-links PRs 142-144: All three closed without merging and recreated as 145-147 after a dependency merged. 100% wasted effort.
- claude-ops: Conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`) actually merged into `main` in `api_handlers.go`. Required a follow-up commit to remove 32 lines of conflict markers.

**Design document pollution:**
- In claude-ops, `.claude-plugin-design.json` was modified by every single PR in parallel sprints — guaranteed merge conflicts. The spec/ADR documents were similarly touched by 5-7 PRs simultaneously.

### Root Causes

1. **No coordination signals**: Zero assignees, zero "in-progress" labels, zero machine-readable dependencies across all 3 repos
2. **No pre-flight conflict detection**: Agents don't check what files other agents are modifying
3. **No foundation-first ordering**: Shared infrastructure (helpers, types, middleware) created in feature PRs instead of extracted first
4. **All PRs target main**: No stacking — every PR rebases independently against main
5. **Design docs modified per-PR**: Every agent updates spec/ADR/config files, creating guaranteed conflicts
6. **No parallelism limits**: claude-ops launched 78 concurrent PRs in one sprint

### Solution: Five-Layer Coordination System

#### Layer 1: Dependency-Aware Planning (`/sdd:plan`)

During issue decomposition, identify **foundation stories** before feature stories:

- Static analysis of spec requirements to find shared types, packages, and helper functions needed by 2+ stories
- Foundation stories get a `foundation` label and must merge before dependent stories begin
- **Hotspot detection**: Analyze recent git history for "god files" (files modified by >50% of recent PRs). In spotter, `cmd/server/main.go` and `internal/config/config.go` are hotspots. Stories touching hotspot files should be serialized, not parallelized.
- **Config consolidation**: When multiple features add config fields and server wiring, create a single "wiring story" that stubs all config fields. Feature stories then fill in implementations.
- **Maximum parallelism**: Cap concurrent agents at 3-4 per sprint. Empirically, 8+ concurrent PRs caused failures in all repos.

#### Layer 2: Issue Lifecycle Signals (`/sdd:work`)

Structured status tracking so agents know what's in flight:

- **Labels**: Automatically apply `queued` → `in-progress` → `in-review` → `merged` during work lifecycle
- **Assignees**: Set the agent/worker as assignee when picking up an issue
- **Machine-readable dependencies**: Use task list syntax in epic bodies: `- [ ] #272 (blocks: #273, #274)` instead of free-text "Depends on #141"
- **Dependency enforcement**: Refuse to start an issue if its dependencies are not in `merged` state

#### Layer 3: Pre-Flight PR Awareness (`/sdd:work`)

Before an agent starts coding, inject context about sibling work:

```markdown
## Active Sprint Context
This issue is part of Epic #268 (DRY — Handler Layer Consolidation).

Currently in-progress PRs from this sprint:
- PR #282 (issue #272): Modifies internal/handlers/params.go, errors.go, htmx.go
- PR #283 (issue #273): Modifies internal/handlers/auth_helpers.go, loaders.go

AVOID modifying these files. If you need functionality from these files,
import and use it — do NOT create your own version.

Shared types available (from foundation PR #281):
- `store.PublicLink` in internal/store/link_store.go
- `ParseIntParam()` in internal/handlers/params.go
```

**File-level conflict prediction**: Query all `in-progress` issues and their planned file changes. If overlap exceeds 2 files, serialize instead of parallelize.

#### Layer 4: Topological Merge Ordering (`/sdd:work`, `/sdd:review`)

Compute optimal merge order by analyzing file overlap:

- Merge PRs with zero overlapping files first
- Then merge PRs that depend on those changes
- Example: In spotter's resilience sprint, optimal order was: 142 (isolated) → 141 (main.go + sync.go) → 143 (sync.go, depends on 141) → 145 (generator.go) → 144 (touches everything, merge last)

**PR stacking option**: Instead of all PRs targeting `main`, offer stacked PRs where dependent changes branch from their dependency. PR 143 branches from PR 141's branch, not main. Eliminates rebase entirely.

**Auto-rebase orchestration**: After merging a PR, automatically trigger rebases for remaining open PRs in the sprint.

#### Layer 5: Design Document Isolation

Stop every PR from modifying spec/ADR/config files:

- **Batch design doc updates**: Instead of each agent updating spec files, create a single "design docs update" PR that runs after all feature PRs merge
- **Append-only governing references**: Each agent writes to `docs/governing/PR-476.md`; a consolidation step merges them into specs
- **Kill `.claude-plugin-design.json`**: (See above) — this file was the #1 conflict source in claude-ops

---

## Security-by-Default

### Evidence

| Issue | spotter | joe-links | claude-ops |
|-------|---------|-----------|------------|
| All endpoints authenticated | Yes | Yes | **No — dashboard wide open** |
| Rate limiting | Login only | **None** | **None** |
| Security headers | Yes (post-audit) | **None** | **None** |
| Request body size limits | **None** | **None** | **None** |
| CSRF protection | SameSite=Lax | SameSite=Lax | **None** |
| Open redirect prevention | N/A | **Vulnerable** | N/A |
| Input validation | Strong | Moderate | Weak |

Spotter's security is strongest — but only because it was retrofitted via dedicated security audit issues (#94, #101, #107). The plugin never prompted for these requirements.

### Solution

1. **Security spec template**: `/sdd:spec` injects a mandatory "Security Requirements" section into every web-facing spec:
   - Authentication requirement (explicitly justify any public endpoints)
   - Rate limiting strategy
   - Security headers (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy)
   - Request body size limits (`http.MaxBytesReader`)
   - CSRF protection strategy
   - Open redirect prevention for any redirect parameter

2. **Security checklist in issues**: When `/sdd:plan` creates issues involving HTTP endpoints, include a security checklist in the issue body: authentication, input validation, output encoding, rate limiting, body size limits.

3. **Security lint in `/sdd:check`**: Flag known dangerous patterns:
   - `io.ReadAll(r.Body)` without `MaxBytesReader`
   - `template.HTML` with unsanitized content
   - `http.Redirect` with user-controlled URLs
   - Endpoint registration without auth middleware
   - `json.NewDecoder` without `DisallowUnknownFields`
   - CDN `<script>` tags without `integrity` attributes
   - `innerHTML` assignments in JavaScript

4. **Auth-by-default**: When generating web server specs, require authentication on all endpoints. Force the spec author to explicitly declare public endpoints and justify why.

---

## Code Quality Guardrails

### Evidence (Go-specific, from all 3 repos)

| Pattern | spotter | joe-links | claude-ops |
|---------|---------|-----------|------------|
| Structured logging | slog (good) | log.Printf | log.Printf + fmt.Printf |
| Error wrapping | Mixes %v and %w | Consistent %w | Consistent %w, but nil/nil returns |
| Fire-and-forget goroutines | 30+ untracked | None | None |
| Constructor params | 13 positional | Reasonable | Reasonable |
| interface{} vs any | interface{} (Go 1.24!) | any | any |
| Race conditions | syncErrors++ in goroutines | None found | TOCTOU in TriggerAdHoc |

### Solution

1. **Logging ADR on init**: When `/sdd:init` detects a Go project (via `go.mod`), suggest creating an ADR mandating structured logging (`slog`). Two of three repos fell back to `log.Printf`.

2. **Error handling guidelines**: `/sdd:spec` for Go projects includes:
   - Always `%w` in `fmt.Errorf`, never `%v`
   - Sentinel errors for domain concepts (`ErrNotFound`, `ErrSlugTaken`)
   - Never return `nil, nil` for not-found — use sentinel errors

3. **Concurrency checklist**: When a spec involves background work or goroutines, include requirements for:
   - Context propagation (never `http.Get()`, always `http.NewRequestWithContext`)
   - Goroutine tracking (all goroutines participate in shutdown WaitGroup)
   - Race safety (no bare `counter++` in goroutines — use `atomic` or channels)

4. **Constructor limit**: When generating code with >5 constructor parameters, use options struct pattern.

5. **Go version awareness**: Read `go.mod` to determine Go version. Use `any` instead of `interface{}`, explore generics for common patterns.

6. **CI requirements**: `/sdd:plan` for Go projects should create a CI story including `go vet`, `go test -race`, and `golangci-lint`.

---

## Frontend Quality Standards

### Evidence

| Dimension | spotter | joe-links | claude-ops |
|-----------|---------|-----------|------------|
| Frontend tests | **Zero** | **Zero** | **Zero** |
| ARIA attributes | 7 | 1 | 4 |
| Code duplication | Low | **High** (modal_form.html) | **Medium** (nav rendered twice) |
| JS frameworks loaded | 3 (HTMX+Alpine+Hyperscript) | 1 (HTMX) | 1 (HTMX) |
| CDN SRI hashes | **None** | **None** | **None** |
| Tailwind production build | N/A | N/A | **CDN Play script (dev-only)** |
| Responsive design | Good | **Poor** (fixed sidebar) | Good (retrofit) |
| innerHTML usage | N/A | **33 occurrences** | N/A |

### Solution

1. **Frontend test scaffolding**: When `/sdd:plan` creates stories touching UI (templates, JS, CSS), automatically create companion test stories:
   - Template render tests (correct HTML structure for given data)
   - JavaScript unit tests for inline/external JS functions
   - HTMX swap integration tests

2. **Accessibility requirements**: `/sdd:spec` injects a mandatory "Accessibility Requirements" section into every UI spec:
   - WCAG 2.1 AA compliance
   - Required ARIA landmarks
   - `aria-label` on icon-only controls
   - `aria-live` for dynamically updated content (HTMX swaps, auto-refresh)
   - Keyboard navigation
   - Focus management for modals

3. **Template duplication detection**: `/sdd:check` flags:
   - Duplicate inline `<script>` blocks
   - Same form structure appearing in multiple templates
   - Navigation/sidebar rendered more than once
   - Identical JS functions defined twice in same file

4. **CDN audit**: `/sdd:check` flags:
   - CDN `<script>`/`<link>` without `integrity` attributes
   - `cdn.tailwindcss.com` (dev-only)
   - More than 1 JS interaction framework per project

5. **Responsive requirements**: UI specs require responsive breakpoint coverage from the start, not as a retrofit.

---

## Governing Comment Reform

### Evidence

The Golang reviewer noted: "Some files have more governing comment lines than actual code. Spotter `main.go` has 40+ governing comments."

The PR stacking reviewer found: claude-ops launched ~78 concurrent PRs just to add governing comments. These touched shared files and created merge conflicts.

### Solution

1. **File-level consolidation**: Instead of annotating every 2-3 lines, consolidate governing references to a single block at the top of each file:
   ```go
   // Governing: ADR-0001 (JWT auth), ADR-0005 (graceful shutdown)
   // Implements: SPEC-0003 REQ "Auth Middleware", SPEC-0007 REQ "Shutdown"
   ```

2. **Inline only for non-obvious**: Use inline governing comments only when the connection between code and decision is not obvious from the file-level block.

3. **Never batch governing comments as separate PRs**: Governing comments should be added in the PR that implements the feature, not as a retroactive sprint of dozens of PRs touching shared files.

---

## Skill Updates Required

| Skill | Change |
|-------|--------|
| **shared-patterns** | Artifact Path Resolution pattern; Config Resolution pattern; Pre-Flight PR Awareness pattern; Foundation Story Detection pattern |
| **init** | Detect `.gitmodules` for workspace; write CLAUDE.md config sections; configure `.claude/settings.json` permissions; suggest logging/security ADRs for Go/web projects |
| **prime** | Aggregate ADRs/specs across modules; show module labels |
| **check** | Module-scoped; security lint patterns; template duplication detection; CDN audit; innerHTML detection |
| **audit** | Per-module + cross-module; security posture section; frontend quality section |
| **discover** | Per-module codebase scanning |
| **adr** | `--module` flag |
| **spec** | `--module` flag; mandatory security section for web specs; mandatory accessibility section for UI specs |
| **plan** | Foundation story detection; dependency-aware ordering; hotspot analysis; max parallelism cap; security checklist in HTTP endpoint issues; frontend test companion stories; CI story for Go projects |
| **work** | Pre-flight PR scan; sibling PR context injection; issue lifecycle labels; dependency enforcement; topological merge ordering; auto-rebase orchestration; design document isolation; parallelism limits |
| **review** | Cross-repo spec context; duplicate code detection across sibling PRs; security checklist verification; conflict-marker CI gate |
| **docs** | Multi-module aggregation |
| **list/status** | Module-aware listing |
| **organize/enrich** | Module context; lifecycle labels |

---

## New ADRs and Specs

| ID | Title | Scope |
|----|-------|-------|
| ADR-0015 | Markdown-Native Configuration | Kill `.claude-plugin-design.json`, move config to CLAUDE.md |
| ADR-0016 | Workspace Mode for Multi-Module Projects | Submodule support via recursive CLAUDE.md |
| ADR-0017 | Parallel Agent Coordination and PR Stacking | Foundation-first ordering, pre-flight awareness, merge topology, design doc isolation |
| ADR-0018 | Security-by-Default for Web Specifications | Mandatory security sections, auth-by-default, security lint patterns |
| ADR-0019 | Frontend Quality Standards | Accessibility requirements, test scaffolding, template quality |
| ADR-0020 | Governing Comment Reform | File-level consolidation, no retroactive batching |
| SPEC-0014 | Markdown-Native Configuration and Workspace Mode | Requirements for ADR-0015 and ADR-0016 |
| SPEC-0015 | Parallel Agent Coordination | Requirements for foundation detection, lifecycle signals, pre-flight awareness, merge ordering |
| SPEC-0016 | Security and Quality Guardrails | Requirements for security defaults, code quality checks, frontend standards |

---

## Rollout Order

### Phase 1: Foundation ADRs and Specs
1. Create ADR-0015 — Markdown-Native Configuration
2. Create ADR-0016 — Workspace Mode
3. Create ADR-0017 — Parallel Agent Coordination
4. Create ADR-0018 — Security-by-Default
5. Create ADR-0019 — Frontend Quality Standards
6. Create ADR-0020 — Governing Comment Reform
7. Create SPEC-0014, SPEC-0015, SPEC-0016

### Phase 2: Shared Patterns (the foundation code)
8. Add "Artifact Path Resolution" to `shared-patterns.md`
9. Add "Config Resolution" (CLAUDE.md-based) to `shared-patterns.md`
10. Add "Pre-Flight PR Awareness" to `shared-patterns.md`
11. Add "Foundation Story Detection" to `shared-patterns.md`
12. Add "Security Lint Patterns" to `shared-patterns.md`

### Phase 3: Config Migration + Init Overhaul
13. Update all skills to read config from CLAUDE.md instead of `.claude-plugin-design.json`
14. Update `init` — workspace detection, CLAUDE.md config, permission setup, project-type-aware ADR suggestions
15. Add migration guidance for existing users

### Phase 4: Plan + Work Overhaul (highest impact)
16. Update `plan` — foundation story detection, dependency ordering, hotspot analysis, parallelism cap, security/accessibility/test checklist injection
17. Update `work` — pre-flight PR scan, sibling context injection, lifecycle labels, dependency enforcement, topological merge ordering, auto-rebase, design doc isolation
18. Update `review` — duplicate detection across sibling PRs, security checklist verification, conflict-marker gate

### Phase 5: Read-Only Skills with Workspace + Quality
19. Update `prime` — multi-module aggregation
20. Update `check` — module-scoped, security lint, template/CDN audit
21. Update `audit` — per-module + cross-module, security posture, frontend quality sections
22. Update `list/status` — module-aware
23. Update `discover` — per-module scanning

### Phase 6: Write Skills with Workspace
24. Update `adr` — `--module` flag
25. Update `spec` — `--module` flag, mandatory security/accessibility sections
26. Update `organize/enrich` — module context, lifecycle labels

### Phase 7: Docs
27. Update `docs` — multi-module documentation aggregation
28. Update governing comment guidance across all skills
