# SPEC-0015: Parallel Agent Coordination

## Overview

A comprehensive coordination system for `/sdd:plan`, `/sdd:work`, and `/sdd:review` that eliminates the duplicate code, rebase churn, merge conflicts, and wasted PRs observed when multiple agents work in parallel. Covers foundation story detection, hotspot analysis, parallelism limits, issue lifecycle labels, pre-flight PR awareness, topological merge ordering, design document isolation, and conflict-marker CI gating. See ADR-0017.

Evidence from three production projects (spotter, joe-links, claude-ops) showed systemic failures: duplicate `nopHandler` and `PublicLink` structs across parallel PRs, 11+ merge-conflict commits, 6 PRs closed and recreated due to dependency churn, conflict markers merged into main, and zero coordination signals (no assignees, no lifecycle labels, no dependency enforcement) across all three repos.

## Requirements

### Requirement: Foundation Story Detection

`/sdd:plan` MUST analyze spec requirements to identify shared types, packages, and helper functions that are needed by two or more feature stories. These shared dependencies MUST be extracted into dedicated stories labeled `foundation`. Foundation stories MUST be scheduled to merge before any dependent feature story begins work. When multiple features require the same config fields or server wiring, `/sdd:plan` MUST create a single consolidated wiring story rather than allowing each feature story to independently add its own config and wiring code. `/sdd:plan` MUST output a dependency graph showing which feature stories depend on which foundation stories.

#### Scenario: Shared type extraction in a link management app

- **WHEN** `/sdd:plan` decomposes SPEC-XXXX for joe-links and discovers that stories "Public Link API" (#112) and "Link Expiration" (#114) both require a `PublicLink` struct in `internal/store/link_store.go`
- **THEN** `/sdd:plan` creates a foundation story "Extract PublicLink type and store interface" that defines the shared struct, labels it `foundation`, and marks both #112 and #114 as dependent on the foundation story

#### Scenario: Shared HTTP helper extraction

- **WHEN** `/sdd:plan` decomposes a spec for spotter and discovers that stories "OpenAI Enricher", "Vibes Generator", "Batch Processor", and "CLI Tool" all require an LLM client (`ChatRequest`/`ChatResponse` types, `callOpenAI()` HTTP logic)
- **THEN** `/sdd:plan` creates a foundation story "Extract shared LLM client package" that centralizes the HTTP client code, and marks all four feature stories as dependent on it

#### Scenario: Config consolidation

- **WHEN** three feature stories each need to add new fields to a shared config struct (e.g., `internal/config/config.go`) and register new HTTP routes in `cmd/server/main.go`
- **THEN** `/sdd:plan` creates a single foundation story "Stub config fields and route registration for sprint N" that adds all config fields and route stubs, so feature stories only fill in handler implementations

### Requirement: Hotspot Analysis

`/sdd:plan` MUST analyze recent git history (last 50 commits or last 30 days, whichever is larger) to identify files modified by more than 50% of recent PRs. These files MUST be classified as "hotspot files." Stories that modify hotspot files MUST be serialized rather than parallelized. `/sdd:plan` MUST report detected hotspots to the user with the file path and the percentage of recent PRs that touched it. The hotspot threshold (default 50%) SHOULD be configurable via a `## SDD Configuration` section in CLAUDE.md.

#### Scenario: God file detection in spotter

- **WHEN** `/sdd:plan` analyzes spotter's recent git history and finds that `cmd/server/main.go` was modified by 7 of 10 recent PRs (70%) and `internal/config/config.go` was modified by 6 of 10 (60%)
- **THEN** both files are classified as hotspots, and any stories that modify these files are serialized into a sequential chain rather than scheduled for parallel execution

#### Scenario: Store file hotspot in joe-links

- **WHEN** `/sdd:plan` analyzes joe-links and finds that `link_store.go` was modified by 6 concurrent PRs in the previous sprint
- **THEN** `link_store.go` is classified as a hotspot, and stories touching it are serialized with explicit ordering in the dependency graph

#### Scenario: No hotspots detected

- **WHEN** `/sdd:plan` analyzes a project with evenly distributed file modifications where no file exceeds the 50% threshold
- **THEN** no hotspot serialization is applied, and stories are parallelized normally based on dependency analysis alone

### Requirement: Parallelism Limits

`/sdd:work` MUST NOT spawn more than 4 concurrent agents per sprint. This limit MUST be configurable via a `## SDD Configuration` section in CLAUDE.md (key: `max-parallel-agents`, default: 4). When more stories are ready for parallel execution than the configured limit allows, `/sdd:work` MUST queue excess stories and start them as in-progress stories complete. `/sdd:work` MUST report the active agent count and queue depth to the user before starting work.

#### Scenario: Default parallelism cap

- **WHEN** `/sdd:work` identifies 8 stories ready for parallel execution in a sprint and no `max-parallel-agents` override exists in CLAUDE.md
- **THEN** `/sdd:work` starts 4 agents immediately and queues the remaining 4, reporting "Starting 4 of 8 ready stories (4 queued, max-parallel-agents: 4)"

#### Scenario: Custom parallelism cap

- **WHEN** CLAUDE.md contains `- **Max parallel agents**: 2` in the SDD Configuration section
- **THEN** `/sdd:work` starts at most 2 concurrent agents, regardless of how many stories are ready

#### Scenario: Queue drain

- **WHEN** one of 4 active agents completes its story (status transitions to `in-review` or `merged`) and 2 stories remain in the queue
- **THEN** `/sdd:work` immediately starts the next queued story, maintaining up to 4 active agents

### Requirement: Issue Lifecycle Labels

`/sdd:work` MUST apply structured labels to tracker issues as work progresses through the following states: `queued`, `in-progress`, `in-review`, `merged`. Each label transition MUST remove the previous lifecycle label before applying the new one. `/sdd:work` MUST set the assignee field on an issue when an agent picks it up. `/sdd:work` MUST refuse to start work on an issue if any of its declared dependencies (issues linked via `blocks:` syntax or explicit dependency fields) are not in `merged` state. When a dependency is not yet merged, `/sdd:work` MUST report which dependencies are blocking and their current states.

#### Scenario: Normal lifecycle progression

- **WHEN** an agent picks up issue #272 which has no unmerged dependencies
- **THEN** `/sdd:work` sets the assignee, removes the `queued` label, applies the `in-progress` label, and begins work. When the PR is created, it transitions to `in-review`. When the PR is merged, it transitions to `merged`.

#### Scenario: Blocked by dependency

- **WHEN** an agent attempts to start issue #274 which depends on issue #273, and #273 has the `in-progress` label
- **THEN** `/sdd:work` refuses to start #274 and reports: "Issue #274 is blocked by #273 (currently: in-progress). Will start automatically when #273 reaches merged state."

#### Scenario: Multiple dependencies with mixed states

- **WHEN** issue #280 depends on #277 (merged) and #278 (in-review)
- **THEN** `/sdd:work` refuses to start #280 and reports that #278 is the blocking dependency with its current state

#### Scenario: Label cleanup on transition

- **WHEN** an agent's PR for issue #272 is created and the issue currently has the `in-progress` label
- **THEN** `/sdd:work` removes the `in-progress` label and applies the `in-review` label in a single update

### Requirement: Pre-Flight PR Awareness

Before an agent begins coding on a story, `/sdd:work` MUST inject a "Sibling PR Manifest" into the agent's context. This manifest MUST include: (a) all in-progress PRs from the same sprint or epic, with their issue numbers and the files they are modifying; (b) all shared types and functions available from merged or in-progress foundation PRs; (c) a list of files currently being modified by sibling agents that the current agent MUST avoid modifying. Agents MUST NOT create types, structs, interfaces, or helper functions that already exist in a sibling or foundation PR. If an agent determines it needs a type or function that a sibling PR is creating, it MUST import from the expected location rather than creating a duplicate.

#### Scenario: Sibling PR awareness prevents duplicate struct

- **WHEN** agent A is working on "Public Link API" and agent B is about to start "Link Expiration", and agent A's PR modifies `internal/store/link_store.go` to add a `PublicLink` struct
- **THEN** agent B's pre-flight manifest shows `PublicLink` in `internal/store/link_store.go` as available from agent A's PR, and agent B imports it instead of creating its own definition

#### Scenario: Foundation PR types available to feature agents

- **WHEN** foundation PR #281 has merged and created `store.PublicLink` in `internal/store/link_store.go` and `ParseIntParam()` in `internal/handlers/params.go`
- **THEN** all subsequent feature agents receive these types in their pre-flight manifest under "Shared types available from foundation PRs" and MUST use them rather than defining their own

#### Scenario: File avoidance directive

- **WHEN** agent C is working on issue #272 and modifying `internal/handlers/params.go`, `errors.go`, and `htmx.go`
- **THEN** agent D's pre-flight manifest lists these files under "Files currently being modified by sibling agents — AVOID modifying" and agent D MUST NOT make changes to those files

#### Scenario: Dynamic manifest update

- **WHEN** a sibling agent's PR is merged while another agent is still working
- **THEN** the merged PR's types and functions transition from "in-progress sibling" to "available on main" in subsequent agents' manifests, and the file avoidance directive for those files is lifted

### Requirement: Topological Merge Ordering

`/sdd:work` MUST compute a merge order for sprint PRs by analyzing file overlap between PRs. PRs with zero overlapping modified files MUST be merged first (they can merge in any order relative to each other). PRs that modify files also modified by already-merged PRs MUST be merged after those PRs and rebased first. `/sdd:work` SHOULD offer PR stacking (branching a dependent PR from its dependency's branch instead of from main) when two PRs have a direct dependency relationship. `/sdd:work` MUST trigger an auto-rebase for all remaining open PRs in the sprint after each merge. The merge order MUST be reported to the user before merging begins.

#### Scenario: Optimal merge order for spotter resilience sprint

- **WHEN** the sprint has 5 PRs: #142 (isolated, no overlapping files), #141 (modifies `main.go` + `sync.go`), #143 (modifies `sync.go`, depends on #141), #145 (modifies `generator.go`, isolated), #144 (touches `main.go` + `sync.go` + `generator.go` + `config.go`)
- **THEN** `/sdd:work` computes merge order: #142 and #145 first (isolated, parallel-safe), then #141, then #143 (depends on #141 via `sync.go`), then #144 last (touches everything). Auto-rebase triggers after each merge.

#### Scenario: PR stacking offer

- **WHEN** PR #143 depends on PR #141 because both modify `sync.go` and #143 requires types introduced by #141
- **THEN** `/sdd:work` offers to create #143's branch from #141's branch instead of from main, displaying: "PR #143 depends on #141. Stack #143 on top of #141's branch to avoid rebase conflicts? (Y/n)"

#### Scenario: Auto-rebase after merge

- **WHEN** PR #142 is merged and PRs #141, #143, #144, and #145 are still open
- **THEN** `/sdd:work` triggers a rebase of all remaining open PRs against the updated main branch and reports any rebase failures to the user

#### Scenario: Circular dependency detection

- **WHEN** file overlap analysis suggests PR A should merge before PR B, and PR B should merge before PR A
- **THEN** `/sdd:work` detects the cycle, reports it to the user, and requests manual resolution: "Circular file dependency detected between PR #X and PR #Y (both modify Z). Please specify which should merge first."

### Requirement: Design Document Isolation

Agents MUST NOT modify spec files (`docs/openspec/specs/`), ADR files (`docs/adrs/`), or shared configuration files (`.claude-plugin-design.json`, root-level `CLAUDE.md`) in feature PRs. Design document updates MUST be batched into a single post-merge PR created after all feature PRs in a sprint have merged. Governing comments (per ADR-0020) MUST be added in the implementing feature PR as file-level header blocks, not as separate PRs. `/sdd:work` MUST enforce this by instructing each agent to skip design doc modifications and by validating PR diffs before submission.

#### Scenario: Agent attempts to update spec in feature PR

- **WHEN** an agent implementing "Link Expiration" (#114) attempts to update `docs/openspec/specs/link-management/spec.md` to mark a requirement as implemented
- **THEN** the agent is prevented from including the spec modification in the feature PR, and the update is queued for the post-merge design docs PR

#### Scenario: Governing comments in feature PR

- **WHEN** an agent implements authentication middleware governed by ADR-0001 and SPEC-0003
- **THEN** the agent adds a file-level governing comment block at the top of the implementation file (`// Governing: ADR-0001 (JWT auth), SPEC-0003 REQ "Auth Middleware"`) within the feature PR itself, not in a separate PR

#### Scenario: Post-merge design docs PR

- **WHEN** all 5 feature PRs in a sprint have been merged
- **THEN** `/sdd:work` creates a single "Update design docs for Sprint N" PR that batches all deferred spec status updates, ADR cross-references, and any other design document modifications

#### Scenario: Config file conflict prevention

- **WHEN** a sprint has 7 parallel feature PRs and `.claude-plugin-design.json` exists in the repo
- **THEN** no feature PR modifies `.claude-plugin-design.json`, eliminating it as a merge conflict source (per evidence from claude-ops where this file was modified by every single PR)

### Requirement: Conflict-Marker CI Gate

`/sdd:review` MUST check all files in a PR diff for conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`) before approving the PR. If any conflict markers are found, `/sdd:review` MUST reject the PR with a clear error message identifying the file(s) and line numbers containing conflict markers. This check MUST run before any other review logic. `/sdd:review` MUST NOT approve or merge a PR that contains conflict markers under any circumstances.

#### Scenario: Conflict markers detected in PR

- **WHEN** `/sdd:review` examines PR #290 and finds `<<<<<<<` on line 47 and `>>>>>>>` on line 55 of `internal/handlers/api_handlers.go`
- **THEN** the PR is rejected with: "BLOCKED: Conflict markers found in internal/handlers/api_handlers.go (lines 47, 55). Resolve merge conflicts before review."

#### Scenario: Clean PR passes gate

- **WHEN** `/sdd:review` examines PR #291 and no conflict markers are found in any file in the diff
- **THEN** the conflict-marker gate passes silently and review proceeds to the next stage

#### Scenario: Conflict markers in non-code file

- **WHEN** `/sdd:review` examines a PR that contains conflict markers in a markdown documentation file (`README.md`)
- **THEN** the conflict-marker gate still triggers and rejects the PR, because conflict markers in any file type indicate an unresolved merge conflict
