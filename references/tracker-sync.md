<!-- Governing: ADR-0025 (Tracker Issues as Fourth qmd Collection), SPEC-0019 REQ "Tracker Sync Layer" -->

# Tracker Sync Reference

Canonical reference for syncing tracker issues into `.sdd/issues/{id}.md` markdown files (per ADR-0025). Every consumer skill that touches tracker issues — `/sdd:index update`, `/sdd:plan`, `/sdd:work`, `/sdd:review`, `/sdd:enrich`, `/sdd:organize` — MUST consume this reference by section name and MUST NOT inline tracker-specific API calls in their own SKILL.md files. Centralizing the tracker abstraction here means a new tracker is a single-file edit (this reference, plus a minimal entry in `shared-patterns.md` § Tracker Detection).

The plugin currently supports seven trackers: GitHub, Gitea, GitLab, Jira, Linear, Beads, and the `tasks.md` fallback (per ADR-0007). Each section below specifies how to fetch issues, how to normalize the response into the canonical frontmatter schema, and the cursor mechanism for incremental sync.

## Canonical Frontmatter Schema

Every synced file under `.sdd/issues/` MUST carry this frontmatter, populated from the tracker's response. Field-by-field requirements per ADR-0025 sub-decision 2:

```yaml
---
id: 142                              # tracker-native ID (number for GH/Gitea/GitLab/Beads, key for Jira/Linear)
title: "Add JWT validation to auth middleware"
status: open                         # normalized: open | closed | merged | draft
labels: [story, auth, sprint-3]
assignees: [joestump]
author: alice
created: 2026-04-12T10:30:00Z        # ISO 8601 UTC
updated: 2026-05-01T14:22:00Z
closed: null                         # ISO timestamp or null
url: https://github.com/owner/repo/issues/142
tracker: github                      # github | gitea | gitlab | jira | linear | beads | tasks-md
references:
  specs: [SPEC-0010]                 # parsed from title + body, regex SPEC-\d{4}
  adrs: [ADR-0011]                   # parsed from title + body, regex ADR-\d{4}
  blocks: [#138, #140]               # parsed from "Blocks:" lines or tracker-native dependency edges
  blocked_by: [#135]                 # parsed from "Blocked by:" lines or tracker-native dependency edges
---

# {title}

{verbatim issue body}

{optional appended PR data section if an associated PR exists — see § PR Data Append below}
```

### Field requirements

- `id` MUST be the tracker-native identifier preserved in its native form (numeric for GitHub/Gitea/GitLab/Beads; composite like `PROJ-123` for Jira; `TEAM-45` for Linear). The filename matches: `.sdd/issues/{id}.md`.
- `title` MUST be the issue's current title, stripped of leading/trailing whitespace.
- `status` MUST be normalized to one of `open` / `closed` / `merged` / `draft`. The mapping table is per-tracker (see each section below).
- `labels`, `assignees` MUST be lists. Empty lists are valid (`labels: []`).
- `created`, `updated` MUST be ISO 8601 UTC timestamps.
- `closed` MUST be an ISO 8601 UTC timestamp when the issue is closed, or `null` for open issues.
- `url` MUST be a fully-qualified URL pointing back to the issue in the tracker's UI.
- `tracker` MUST be the lowercase short name of the tracker.
- `references.specs` and `references.adrs` MUST be derived by parsing `SPEC-\d{4}` and `ADR-\d{4}` patterns from the title AND body. Deduplicate.
- `references.blocks` and `references.blocked_by` MUST be parsed from explicit "Blocks: #N, #M" / "Blocked by: #N" lines in the body, AND from tracker-native dependency edges where the tracker exposes them (Gitea, Linear).

### PR Data Append

When an issue has an associated PR (linked via the tracker's native cross-reference), append a section to the body (after the verbatim issue body, separated by a blank line):

```markdown
## Associated PR

- **PR**: #{pr-number}
- **Branch**: `{branch-name}`
- **Status**: open | merged | closed | draft
- **Files modified**: `{path1}`, `{path2}`, ...
- **Last updated**: {ISO timestamp}
```

This data is sourced from the same fetch (most trackers expose linked PRs in the issue response or via a follow-up call). When the issue has no associated PR, omit the section entirely.

## Sync Triggering Rules

`/sdd:index update` syncs the issues collection as part of its normal pass. Consumer skills MAY trigger an opportunistic sync at start-of-run subject to a 5-minute deduplication window, per SPEC-0019 REQ "Issues Collection Sync via /sdd:index" and REQ "Tier 4 Always-Sync Issues for Sprint Skills".

| Skill | Sync trigger |
|-------|--------------|
| `/sdd:index update` | Always (part of normal pass) |
| `/sdd:plan` | On entry, subject to 5-min dedup |
| `/sdd:work` | On entry, subject to 5-min dedup |
| `/sdd:review` | On entry, subject to 5-min dedup |
| `/sdd:enrich` | On entry, subject to 5-min dedup |
| `/sdd:organize` | On entry, subject to 5-min dedup |

The 5-minute window is checked against the `last_sync` timestamp in `.sdd/issues/_meta.json` (see § Cursor Management). If the last sync was within 5 minutes, skip the sync silently. Otherwise, run the sync and emit a one-line note in the consumer skill's report header: "Syncing N issues from {tracker}…".

## Cursor Management

Incremental sync uses `.sdd/issues/_meta.json` to track per-tracker cursors. Schema:

```json
{
  "last_sync": "2026-05-03T14:22:00Z",
  "tracker": "github",
  "cursor": {
    "github": "2026-05-01T10:00:00Z",
    "gitea": "2026-05-01T10:00:00Z"
  },
  "sync_counts": {
    "added": 0,
    "updated": 0,
    "removed": 0
  }
}
```

### Cursor semantics

- `last_sync` is the wall-clock time of the most recent sync invocation (any tracker).
- `tracker` is the currently-configured tracker (per CLAUDE.md `### SDD Configuration` `#### Tracker`).
- `cursor.{tracker}` is the most-recent `updated` timestamp seen for any synced issue under that tracker. Used as the "fetch issues updated since" filter on the next sync.
- `sync_counts` is the result of the most recent sync (added/updated/removed file counts).

### Cursor update protocol

1. Read `.sdd/issues/_meta.json` (create with empty values if absent).
2. Take `cursor.{current-tracker}` (or epoch 0 if absent) as the "since" parameter for the tracker-specific fetch.
3. Fetch issues updated since the cursor.
4. For each issue, write/overwrite `.sdd/issues/{id}.md` per the canonical schema.
5. Update `cursor.{current-tracker}` to the maximum `updated` timestamp seen across all fetched issues.
6. Update `last_sync` to wall-clock now.
7. Update `sync_counts` to the operation result.
8. Write the updated `.sdd/issues/_meta.json`.

### Full re-sync

When a user wants to discard the cursor and re-fetch from scratch (e.g., after a tracker migration), `/sdd:index update --full-resync` deletes the `cursor.{tracker}` entry, runs a full sync, and rewrites the cursor. Out of scope for V1 SPEC-0019 — the incremental path is sufficient.

## Per-Tracker Sync

### GitHub

**Fetch** (incremental, scoped to issues updated since cursor):

```bash
gh issue list --state all \
  --json number,title,body,state,labels,assignees,author,createdAt,updatedAt,closedAt,url \
  --search "updated:>{cursor-iso-date}" \
  --limit 1000
```

For composite issue + PR data, use the GraphQL API:

```bash
gh api graphql -f query='
  query($owner: String!, $repo: String!, $since: DateTime!) {
    repository(owner: $owner, name: $repo) {
      issues(filterBy: {since: $since}, first: 100) {
        nodes {
          number
          title
          body
          state
          labels(first: 20) { nodes { name } }
          assignees(first: 10) { nodes { login } }
          author { login }
          createdAt
          updatedAt
          closedAt
          url
          timelineItems(itemTypes: [CONNECTED_EVENT, CROSS_REFERENCED_EVENT], first: 10) {
            nodes { ... on ConnectedEvent { source { ... on PullRequest { number url merged } } } }
          }
        }
      }
    }
  }
' -F owner={owner} -F repo={repo} -F since={cursor-iso-date}
```

**Status normalization**:
- GitHub `state: OPEN` → `open`
- GitHub `state: CLOSED` and PR-merged → `merged`
- GitHub `state: CLOSED` and not PR-merged → `closed`
- GitHub PR `isDraft: true` → `draft` (only for issues with associated PRs)

**Cursor**: ISO 8601 timestamp. The `updated:>` search qualifier is exclusive — fetch returns issues strictly after the cursor, preventing re-fetch of the cursor-boundary issue.

**Rate limits**: GitHub's REST quota is 5000 requests/hour per token. The GraphQL API has its own point system. The incremental cursor keeps both well within limits for typical usage.

### Gitea

**Fetch**:

Use MCP tools discovered via `ToolSearch` with query `select:mcp__gitea__issue_list` (or the equivalent local MCP tool name). The Gitea API exposes a `since` parameter for incremental fetch:

```
GET /repos/{owner}/{repo}/issues?state=all&since={cursor-iso-date}&limit=50&page={page}
```

**Status normalization**:
- Gitea `state: open` → `open`
- Gitea `state: closed` → `closed` (Gitea does not distinguish PR-merged from closed at the issue level; check the linked PR's `merged: true` field if PR data is needed)

**Native dependencies**: Gitea exposes issue dependencies via `GET /repos/{owner}/{repo}/issues/{index}/dependencies`. Populate `references.blocked_by` from this endpoint in addition to body parsing.

**Cursor**: ISO 8601 timestamp. The `since` parameter is inclusive on some Gitea versions and exclusive on others — to be safe, store the cursor and after each sync set it to the maximum `updated_at` from the response, and on the next fetch increment by one second to avoid re-fetch.

### GitLab

**Fetch**:

```bash
glab issue list --all --updated-after {cursor-iso-date} --output json --per-page 100
```

Or via MCP tools discovered with `ToolSearch` query `select:mcp__gitlab__issues_list`.

**Status normalization**:
- GitLab `state: opened` → `open`
- GitLab `state: closed` and merged via MR → `merged`
- GitLab `state: closed` and not merged → `closed`

**Cursor**: ISO 8601 timestamp passed as `--updated-after`. Inclusive — increment by one second to avoid re-fetch.

### Jira

**Fetch** (via MCP tools):

```
mcp__jira__search with JQL: "project = {project-key} AND updated >= '{cursor-iso-date}' ORDER BY updated ASC"
```

Discover via `ToolSearch` query `select:mcp__jira__search`.

**Status normalization** (Jira's status field is workflow-specific; map common cases):
- Jira `status: To Do` / `Open` / `In Progress` / `In Review` → `open`
- Jira `status: Done` / `Closed` / `Resolved` → `closed`
- Jira `resolution: Won't Fix` / `Cannot Reproduce` → `closed`
- Jira does not have a "merged" concept at the issue level; PR association is via Smart Commits or Bitbucket integration.

**ID format**: Jira keys are `{PROJECT}-{NUMBER}` (e.g., `PROJ-123`). Filename: `.sdd/issues/PROJ-123.md` (preserve the dash).

**Cursor**: ISO 8601 timestamp in JQL `updated >=` clause. JQL's `>=` is inclusive at second granularity — increment by one second to avoid re-fetch.

### Linear

**Fetch** (via MCP tools):

```
mcp__linear__issue_list with filter: { updatedAt: { gte: cursor-iso-date } }
```

Discover via `ToolSearch` query `select:mcp__linear__issue_list`.

**Status normalization** (Linear uses workflow states):
- Linear `state.type: backlog` / `unstarted` / `started` → `open`
- Linear `state.type: completed` → `closed`
- Linear `state.type: canceled` → `closed`

**ID format**: Linear identifiers are `{TEAM}-{NUMBER}` (e.g., `TEAM-45`). Filename: `.sdd/issues/TEAM-45.md`.

**Native dependencies**: Linear exposes blocking/blocked-by relationships via the `relations` field. Populate `references.blocks` and `references.blocked_by` from this in addition to body parsing.

### Beads

**Fetch**:

```bash
bd list --json --all
```

Beads stores tasks locally in `.beads/`. The corpus is typically small enough that incremental cursor management adds no value — full corpus fetch on each sync is fine.

**Status normalization**:
- Beads `status: open` / `in-progress` / `blocked` → `open`
- Beads `status: resolved` / `closed` → `closed`

**ID format**: Numeric (`bd-1`, `bd-2`, etc.). Filename: `.sdd/issues/bd-1.md`.

**Cursor**: Not used. Always do a full re-sync.

### tasks.md fallback

When no tracker is configured (per ADR-0007), parse `docs/openspec/specs/*/tasks.md` files as the issue source. Each `## N. Section Title` becomes a synthetic "issue" with synthetic ID `tasks-{spec-name}-N`.

**Fetch**: filesystem scan of `{spec-dir}/*/tasks.md`.

**Status normalization**:
- Task line `- [ ] X.Y ...` → `open`
- Task line `- [x] X.Y ...` → `closed`

**ID format**: Synthetic `tasks-{spec-name}-{section-number}`. Filename: `.sdd/issues/tasks-{spec-name}-{section-number}.md`.

**Cursor**: File mtime of the source `tasks.md`. Re-sync on mtime change.

## Failure Modes and Degradation

| Failure | Behavior |
|---------|----------|
| Tracker rate-limit (HTTP 429) | Retry with exponential backoff: 1s, 2s, 4s. After 3 failures, report sync failure and stop. |
| Tracker server error (HTTP 5xx) | Retry with same backoff. After 3 failures, report sync failure. |
| Tracker auth error (HTTP 401/403) | Stop immediately. Surface: "Tracker authentication failed — check `gh auth status` (or equivalent)." Do not retry. |
| Network unreachable | Stop immediately. Surface: "Network unreachable — sync skipped." Consumer skill MAY proceed with stale local cache. |
| Partial response (some issues fetched, some failed) | Write the issues that succeeded; report the failed IDs in the sync result. The next sync will pick them up. |
| Issue body too large for filesystem | Truncate body to 100KB and append a note: `[Body truncated — full content at {url}]`. Sync continues. |
| Tracker MCP tool not loaded | Fall back to CLI (`gh`, `glab`, `bd`). If neither is available, stop with: "Tracker {name} not reachable — install the CLI or load the MCP tool." |
| `.sdd/issues/_meta.json` corrupt | Treat as missing; do a full re-sync; rewrite the meta file. |
| `.sdd/issues/` directory not writable | Stop immediately. Surface: "Cannot write to .sdd/issues/ — check directory permissions." |

### Consumer skill fallback on sync failure

When a consumer skill (per the Sync Triggering Rules above) triggers an opportunistic sync that fails, it MUST NOT block the skill's primary work. Instead:

1. Emit a one-line warning in the skill's report: "Issues sync failed ({reason}) — degrading to live tracker queries for this run."
2. Proceed with the skill's pre-v5 behavior (live tracker queries via the same gh/glab/MCP tools, without the local cache).
3. The next consumer-skill invocation (or `/sdd:index update`) retries the sync.

## Consumers

The following skills consume this reference. Maintain this list when adding new consumers (matching the convention from `references/issue-authoring.md` and `references/qmd-helpers.md`):

| Skill | Consumes |
|-------|----------|
| `/sdd:index update` | All sections (drives the canonical sync) |
| `/sdd:plan` | Sync Triggering Rules; Per-Tracker Sync (relevant tracker section); Failure Modes |
| `/sdd:work` | Sync Triggering Rules; Per-Tracker Sync; Failure Modes |
| `/sdd:review` | Sync Triggering Rules; Per-Tracker Sync; Failure Modes |
| `/sdd:enrich` | Sync Triggering Rules; Failure Modes |
| `/sdd:organize` | Sync Triggering Rules; Failure Modes |

Future tracker-touching skills SHOULD consume the relevant sections rather than re-deriving the patterns.
