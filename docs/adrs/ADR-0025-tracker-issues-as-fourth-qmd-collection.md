---
status: proposed
date: 2026-05-03
decision-makers: Joe Stump
related: [ADR-0007, ADR-0009, ADR-0011, ADR-0017]
extends: [ADR-0024]
---

# ADR-0025: Tracker Issues as a Fourth Per-Repo qmd Collection

## Context and Problem Statement

ADR-0024 establishes qmd as a hard dependency and `/sdd:index` as the canonical way to index per-repo content into three collections: `{repo}-adrs`, `{repo}-specs`, and `{repo}-code`. The unit of work in this plugin's lifecycle, however, is not the ADR or the spec — it is the **tracker issue**: stories produced by `/sdd:plan`, claimed by `/sdd:work`, reviewed by `/sdd:review`. Issues encode current state of work in a way that ADRs and specs do not: who owns what, what is in flight, what just merged, what got duplicated last sprint. Without this corpus indexed, the qmd-native versions of `/sdd:plan`, `/sdd:work`, and `/sdd:review` are blind to half the context that actually matters during sprint execution.

The tracker abstraction adds a complication: SDD supports seven backends (GitHub, Gitea, GitLab, Jira, Linear, Beads, and the `tasks.md` fallback from ADR-0007). Each has a different API, authentication model, and shape. Whatever indexing approach we choose has to absorb that variety without leaking it into every consumer skill. How should the plugin make tracker issues hybrid-searchable alongside ADRs, specs, and code, while keeping the seven-tracker abstraction in one place?

## Decision Drivers

* **qmd is a markdown indexer.** Every other collection (`-adrs`, `-specs`, `-code`) is a directory of files on disk that qmd scans. Anything we add should fit that model rather than asking qmd to do something new.
* **One abstraction, seven trackers.** The plugin already has tracker-detection and per-tracker skills (Try-Then-Create labels, PR Search by Spec). The issue-sync layer should reuse that abstraction, not re-implement it inside qmd's collection-update mechanism.
* **Debuggability of indexed content.** When a query returns an unexpected match, the user should be able to `cat` the matched file. Indexes that pull directly from a remote API at scan time make this opaque.
* **Incremental sync matters at scale.** A repo with 5,000 issues should not re-fetch and re-embed the entire corpus on every `/sdd:index update`. The sync layer needs an "updated since" cursor.
* **Issue privacy is real.** Issue bodies routinely contain customer data, internal URLs, and partial credentials. Whatever local representation we create must be `.gitignore`d by default and surfaced to the user as "do not commit this directory."
* **Existing PR/issue awareness already needs this.** ADR-0017's "Pre-Flight PR Awareness" pattern and the Sibling PR Manifest already query the tracker live. Centralizing on a synced corpus lets that pattern read from the index instead of paginating remote APIs on every dispatch.

## Considered Options

* **Option 1**: Don't index issues — keep fetching live from the tracker on demand inside each consumer skill.
* **Option 2**: Use qmd's per-collection `update:` shell command to call `gh issue list` (etc.) directly, with qmd parsing the JSON output.
* **Option 3**: Sync tracker issues to `.sdd/issues/{number}.md` markdown files via a tracker-aware sync layer in `/sdd:index`, then add `{repo}-issues` as a normal markdown collection in qmd.
* **Option 4**: Build (or commission upstream) a qmd plugin that exposes a tracker source as a first-class collection type.

## Decision Outcome

Chosen option: **"Option 3 — sync to `.sdd/issues/`, index as normal markdown collection"**, because it keeps the multi-tracker abstraction in our skill (where it already lives) and lets qmd do exactly what it is designed to do (index local markdown). The synced files are debuggable, survive qmd reinstall, give qmd structured frontmatter to weight on, and let consumer skills retrieve issues through the same `qmd query -c {repo}-issues` interface they already use for ADRs/specs/code. Three sub-decisions are bundled below because they shape the disk layout and would otherwise re-emerge the next time someone touches the sync.

### Sub-decision 1: On-disk layout

```
.sdd/
  issues/
    {number}.md            # one file per issue, named by tracker-native ID
    _meta.json             # last-sync cursor (per-tracker) and counts
```

`.sdd/` is added to `.gitignore` by `/sdd:init` (component-level convergence; existing gitignore is appended, never replaced). For trackers that use composite IDs (Jira's `PROJ-123`, Linear's `TEAM-45`), the filename uses the full ID with the dash preserved: `.sdd/issues/PROJ-123.md`.

### Sub-decision 2: Frontmatter schema (what qmd sees)

Every synced file has this frontmatter:

```yaml
---
id: 142                        # tracker-native ID (number for GH/Gitea/GitLab/Beads, key for Jira/Linear)
title: "Add JWT validation to auth middleware"
status: open                   # normalized: open | closed | merged | draft
labels: [story, auth, sprint-3]
assignees: [joestump]
author: alice
created: 2026-04-12T10:30:00Z
updated: 2026-05-01T14:22:00Z
closed: null                   # ISO timestamp or null
url: https://github.com/owner/repo/issues/142
tracker: github                # github | gitea | gitlab | jira | linear | beads | tasks-md
references:
  specs: [SPEC-0010]           # parsed from title + body
  adrs: [ADR-0011]             # parsed from title + body
  blocks: [#138, #140]         # parsed from "Blocks:" lines or tracker-native dependency edges
  blocked_by: [#135]
---

# {title}

{verbatim issue body}

{optional appended sections from PR data: Files Modified, Sibling PRs, Merge Status — only when an issue has an associated PR}
```

The `references` block parses `SPEC-XXXX` and `ADR-XXXX` mentions from title and body, and dependency edges from "Blocks:"/"Blocked by:" lines (or the tracker's native dependency fields where they exist). This gives qmd's reranker structured fields to weight on without forcing every consumer skill to re-parse.

### Sub-decision 3: Sync mechanism per tracker

| Tracker | Sync command | Incremental cursor |
|---------|--------------|-------------------|
| GitHub | `gh issue list --state all --json number,title,body,state,labels,assignees,createdAt,updatedAt,url --search "updated:>{cursor}" --limit 1000` | `updated:>YYYY-MM-DD` in search |
| Gitea | MCP tools (`mcp__gitea__issue_list` or equivalent), filtered by `since` | `since` parameter |
| GitLab | `glab issue list --all --updated-after {cursor}` | `--updated-after` |
| Jira | MCP tools with JQL `updated >= "{cursor}"` | JQL clause |
| Linear | MCP tools with `filter: { updatedAt: { gte: cursor } }` | GraphQL filter |
| Beads | `bd list --json` (full corpus — small enough; no cursor needed) | none |
| tasks.md | Parse `docs/openspec/specs/*/tasks.md` files directly | file mtime |

The sync layer normalizes all responses into the frontmatter schema above before writing to disk. Per-tracker logic lives in `references/tracker-sync.md` so consumer skills never see the API shape.

### Sub-decision 4: Sync trigger points

`/sdd:index update` syncs the issues collection as part of its normal pass — same UX as ADR/spec updates. Consumer skills MAY trigger an opportunistic sync at start-of-run when their work depends on fresh issue state:

| Skill | Trigger |
|-------|---------|
| `/sdd:plan` | Sync before grouping requirements (avoids creating duplicate stories of recently-closed issues) |
| `/sdd:work` | Sync before building the Sibling PR Manifest (ADR-0017) |
| `/sdd:review` | Sync before building the Topological Merge Order (shared-patterns.md) |
| `/sdd:enrich`, `/sdd:organize` | Sync before iterating issues to enrich/group |

Skills MUST NOT sync silently — they print a one-line note ("Syncing N issues from {tracker}…") and proceed. If the sync fails, they fall back to live tracker queries (the pre-qmd path) and continue, not block.

### Consequences

* Good, because consumer skills (`/sdd:plan`, `/sdd:work`, `/sdd:review`, `/sdd:enrich`) gain hybrid search over the entire issue corpus through the same `-c {repo}-issues` interface they already use for ADRs/specs/code.
* Good, because the multi-tracker abstraction stays in the SDD plugin, where the existing tracker-detection and per-tracker logic already lives. qmd remains tracker-agnostic.
* Good, because synced files are inspectable, greppable, and survive qmd reinstall.
* Good, because frontmatter `references` lets qmd's reranker boost matches that mention the spec/ADR a consumer is asking about — concrete reranker fuel, the way ADR-0024 already established for collection-level context.
* Good, because the Sibling PR Manifest pattern (ADR-0017) becomes a qmd query rather than a paginated remote API call on every dispatch.
* Bad, because issue bodies contain sensitive content; `.gitignore`d cache mitigates but cannot fully eliminate the risk that a user `tar`s their working directory and shares it.
* Bad, because the sync layer must implement seven tracker integrations, each with its own auth, pagination, and rate-limit story.
* Bad, because trackers can rewrite history (issue titles edit, comments delete, status flips) in ways the cursor-based incremental sync may miss until the next full re-sync.
* Bad, because `tasks.md` (ADR-0007) does not have stable issue IDs the way trackers do; the tasks.md sync is a special case that uses a content-derived hash as the file name.
* Bad, because `.sdd/issues/` adds a new on-disk artifact category users have to learn about; documented prominently in `/sdd:init`'s output and in CLAUDE.md.

### Confirmation

Compliance is confirmed by:

1. `/sdd:index add` creates the `{repo}-issues` collection alongside the existing three (or skips with a clear warning if no tracker is configured). Verified by integration tests against each supported tracker (mocked APIs OK).
2. The frontmatter of every synced file conforms to the schema in Sub-decision 2. Verified by a script in the test suite that parses every `.sdd/issues/*.md` and validates required fields.
3. `.sdd/` appears in `.gitignore` after `/sdd:init` runs (idempotent; existing entries preserved).
4. `tracker-sync.md` is the sole location of per-tracker API shape — verified by a `grep -r "gh issue list\|glab issue list\|bd list" skills/` lint that should match only inside that reference file.
5. Consumer skills emit the "Syncing N issues from {tracker}…" line before invoking sync.
6. Sync failures fall back to live tracker queries with a warning, never silently block.

## Pros and Cons of the Options

### Option 1: Don't index issues; fetch live on demand

The current shape — `/sdd:plan`, `/sdd:work`, `/sdd:review` paginate the tracker API every time they need issue context.

* Good, because no on-disk artifact to manage; no privacy-vs-cache trade-off.
* Good, because data is always fresh.
* Bad, because consumer skills cannot run hybrid retrieval over issues — they can only filter by title or label.
* Bad, because every dispatch repeats the same API calls (Pre-Flight PR Awareness in ADR-0017 already feels this pain).
* Bad, because rate limits and auth errors block consumer skills from finishing, even when the data they need was retrieved minutes ago by a sibling skill.

### Option 2: qmd per-collection `update:` shell command

qmd supports custom update commands per collection (see `getCollectionFromYaml(col.name)?.update` in qmd's source). We could give the issues collection a YAML config with `update: gh issue list --json ... | jq ... > /tmp/issues.json` and have qmd parse the JSON.

* Good, because no separate sync layer in our skill — qmd handles the lifecycle.
* Good, because update timing piggybacks on `qmd update`.
* Bad, because qmd is a markdown indexer, not a JSON indexer — the parsed output would still need to be markdown-shaped before qmd can BM25/vector-search it.
* Bad, because the multi-tracker abstraction now lives in qmd's YAML config rather than in our skill, fragmenting the tracker-handling code.
* Bad, because users debugging an issue match cannot `cat` a file — they would have to re-run the update command and parse the intermediate JSON.
* Bad, because per-collection update commands are a qmd feature, not a stable API contract — relying on them couples us to qmd internals.

### Option 3: Sync to `.sdd/issues/`, index as markdown (chosen)

`/sdd:index` calls a tracker-aware sync layer that writes one markdown file per issue to `.sdd/issues/`. qmd then indexes it as a normal markdown collection.

* Good, because the multi-tracker abstraction stays in our skill where it already lives.
* Good, because synced files are debuggable, greppable, and inspectable.
* Good, because frontmatter is reranker-friendly.
* Good, because `.gitignore` keeps the cache local without imposing structure on the user's repo.
* Good, because incremental sync via per-tracker cursors keeps the cost proportional to changed issues.
* Bad, because we own the sync code (seven tracker integrations).
* Bad, because the user has to learn that `.sdd/` exists.

### Option 4: qmd plugin that adds a tracker source

Build a qmd extension (or commission one upstream) that lets qmd treat a tracker as a first-class collection source.

* Good, because clean separation: SDD plugin is tracker-agnostic; qmd extension is tracker-specific.
* Good, because reusable beyond SDD — anyone using qmd could add their tracker.
* Bad, because qmd does not currently expose a plugin API for collection sources.
* Bad, because pushing this upstream is a months-long effort with no guarantee of acceptance.
* Bad, because we would still need to implement the seven tracker integrations — they would just live in qmd's repo instead of ours.
* Reconsider, when qmd ships a stable extension API for collection sources.

## Architecture Diagram

```mermaid
flowchart LR
  subgraph Trackers
    GH[GitHub]
    Gitea[Gitea]
    GL[GitLab]
    Jira[Jira]
    Linear[Linear]
    Beads[Beads]
    TasksMD[tasks.md]
  end

  subgraph SddPlugin [SDD plugin]
    IndexSk[/sdd:index update]
    SyncLayer[references/tracker-sync.md<br/>per-tracker fetch + normalize]
    Cursor[(.sdd/issues/_meta.json<br/>per-tracker cursors)]
  end

  Cache[(.sdd/issues/<br/>{number}.md per issue<br/>frontmatter + body)]

  Qmd[(qmd index<br/>{repo}-issues collection)]

  GH -->|gh issue list --search updated:&gt;cursor| SyncLayer
  Gitea -->|MCP issue list since cursor| SyncLayer
  GL -->|glab issue list --updated-after| SyncLayer
  Jira -->|JQL updated &gt;= cursor| SyncLayer
  Linear -->|GraphQL filter updatedAt| SyncLayer
  Beads -->|bd list --json| SyncLayer
  TasksMD -->|parse files by mtime| SyncLayer

  IndexSk -->|trigger sync| SyncLayer
  SyncLayer -->|read cursor| Cursor
  SyncLayer -->|write {number}.md| Cache
  SyncLayer -->|update cursor| Cursor

  Cache -->|qmd collection add /<br/>qmd update| Qmd

  subgraph Consumers [qmd-aware consumers]
    Plan[/sdd:plan]
    Work[/sdd:work]
    Review[/sdd:review]
    Enrich[/sdd:enrich]
  end

  Consumers -->|qmd query -c {repo}-issues| Qmd
  Consumers -.->|opportunistic sync at start| IndexSk

  classDef store fill:#e8f4ff,stroke:#0366d6
  classDef ext fill:#fff4e8,stroke:#bf8700
  class Cache,Cursor,Qmd store
  class GH,Gitea,GL,Jira,Linear,Beads,TasksMD ext
```

## More Information

* This ADR extends ADR-0024. Without qmd as a hard dependency, the consumer skills could not assume the issues collection is searchable and the sync investment would not pay off.
* The forthcoming `qmd-native-skills` spec lists the per-skill requirements for issue-aware behavior (e.g., `/sdd:plan` MUST sync before requirement grouping; `/sdd:work` MUST query for sibling PR awareness from the issues collection).
* `tracker-sync.md` (a new shared reference file) absorbs the per-tracker logic. Consumer skills never see API shapes; they only see normalized markdown files.
* The Sibling PR Manifest pattern (ADR-0017, SPEC-0015 REQ "Pre-Flight PR Awareness") gets reframed as a qmd query against the synced corpus rather than a live API call. The same data, but cached, indexed, and rerankable.
* Future: a notion of issue *projections* — generated views like "all open stories blocked by foundation PRs" — could live in `.sdd/issues/_views/` as derived markdown so qmd can search them too. Out of scope for this ADR.
