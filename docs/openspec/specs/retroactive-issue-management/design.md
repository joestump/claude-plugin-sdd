# Design: Retroactive Issue Management

## Context

ADR-0009 decided to add project grouping and developer workflow conventions (branch naming, PR close keywords) to the `/sdd:plan` skill, with opt-out flags. It also decided to create two separate retroactive skills -- `/sdd:organize` and `/sdd:enrich` -- for applying these conventions to issues that already exist. SPEC-0007 covers the forward-looking additions to `/sdd:plan`; this spec (SPEC-0008) covers the retroactive skills exclusively. See ADR-0009 and SPEC-0007.

## Goals / Non-Goals

### Goals
- Enable retroactive project grouping for issues created by prior `/sdd:plan` runs
- Enable retroactive branch naming and PR convention enrichment for existing issue bodies
- Share spec resolution and tracker detection logic with `/sdd:plan` for consistency
- Support dry-run previews so users can verify changes before applying them
- Be idempotent: safe to run multiple times without duplicating projects or sections
- Read `.claude-plugin-design.json` for saved preferences to minimize re-prompting

### Non-Goals
- Re-creating issues (both skills operate on existing issues only)
- Modifying acceptance criteria or issue content beyond appending `### Branch` and `### PR Convention` sections
- Supporting `--review` mode (both are utility skills, not authoring skills)
- Syncing issue state back to spec artifacts
- Creating issues for requirements that lack corresponding tracker issues (use `/sdd:plan` instead)
- Supporting trackerless environments (both skills require a live tracker connection)

## Decisions

### Separate skills over combined skill

**Choice**: Two separate skills (`/sdd:organize` and `/sdd:enrich`) rather than a single `/sdd:workflow` or a mode flag on `/sdd:plan`.
**Rationale**: Organize and enrich operate on different tracker primitives. Organize creates projects and manages membership (no issue content changes). Enrich modifies issue bodies (no project operations). Their allowed-tools overlap but their concerns do not. A user may want to organize without enriching, or vice versa. Separate skills follow the plugin's single-purpose skill convention (see ADR-0003).
**Alternatives considered**:
- Combined `/sdd:workflow` skill with `--organize` and `--enrich` flags: Violates single-purpose convention; forces a large allowed-tools union; confusing invocation surface
- Flags on `/sdd:plan` (`--retroactive`): Overloads planning with a fundamentally different operation (modifying existing issues vs. creating new ones)

### Shared spec resolution and tracker detection

**Choice**: Reuse the same spec resolution (SPEC number or capability name) and tracker detection (`.claude-plugin-design.json` → ToolSearch + CLI probing) flows from `/sdd:plan`.
**Rationale**: Users already understand these patterns from `/sdd:plan`. Consistency reduces cognitive load and ensures `.claude-plugin-design.json` preferences work identically across all three skills. The duplication is in the SKILL.md instructions only -- there is no shared code to maintain.
**Alternatives considered**:
- Accept only SPEC numbers (not capability names): Inconsistent with `/sdd:plan`; users would have to look up the SPEC number
- Skip `.claude-plugin-design.json` and always prompt: Adds friction; defeats the preference persistence from ADR-0008

### Issue discovery via tracker search

**Choice**: Search for issues containing the spec number (e.g., "SPEC-0007") in their body text using the tracker's native search API.
**Rationale**: Every issue created by `/sdd:plan` includes a spec reference in its body (per SPEC-0007, Requirement: Issue Creation Flow). Searching by spec number reliably discovers these issues. Tracker-native search is fast and requires no local state.
**Alternatives considered**:
- Maintain a local issue manifest in `.claude-plugin-design.json`: Adds complexity; goes stale when issues are deleted or moved
- Search by label (e.g., `spec:SPEC-0007`): Not all trackers support structured labels; `/sdd:plan` does not currently set labels

### Epic classification heuristics

**Choice**: Classify issues as epics if their title starts with "Implement " or they have an `epic` label.
**Rationale**: `/sdd:plan` creates epics with titles following the pattern "Implement {Capability Title}" (SPEC-0007). The `epic` label provides a fallback for manually created epics or tracker-specific labeling conventions. These heuristics are simple, deterministic, and match the existing planning output.
**Alternatives considered**:
- Require an explicit `epic` label: Too strict; `/sdd:plan` doesn't currently add labels
- Use the tracker's native epic type (GitHub Projects item type, Jira epic issue type): Not all trackers distinguish epic types; adds tracker-specific branching to classification logic

### Two-pass enrichment (read then update)

**Choice**: For each issue, read the body first to check for existing sections, then update with appended content.
**Rationale**: Idempotency requires checking whether `### Branch` and `### PR Convention` sections already exist. Blindly appending would create duplicates. The two-pass approach (read body, check for sections, append if missing, write) is the simplest way to achieve idempotency.
**Alternatives considered**:
- Track enriched issues in `.claude-plugin-design.json`: Adds local state that can go stale; the issue body is the source of truth
- Use a marker comment instead of section headers: Less readable; section headers serve as useful documentation for developers

## Architecture

```mermaid
flowchart TD
    subgraph "Shared Preamble"
        A["Parse arguments\n(spec ID, flags)"]
        B["Resolve spec\n(SPEC-XXXX or name)"]
        C["Read spec.md"]
        D["Detect tracker\n(.claude-plugin-design.json → ToolSearch)"]
        E["Search tracker for\nissues referencing spec"]
        F["Classify: epics vs tasks"]
    end

    A --> B --> C --> D --> E --> F

    subgraph "/sdd:organize"
        G{"--project flag?"}
        G -->|"--project <name>"| H["Create single\nnamed project"]
        G -->|"Default"| I["Create one project\nper epic"]
        H --> J["Add all issues\nto project"]
        I --> J
        J --> K["Report: projects\ncreated, issues added"]
    end

    subgraph "/sdd:enrich"
        L["Read .claude-plugin-design.json\nbranch/PR config"]
        L --> M["For each issue"]
        M --> N{"Has ### Branch?"}
        N -->|"No"| O["Append branch\nsection"]
        N -->|"Yes"| P["Skip"]
        O --> Q{"Has ### PR\nConvention?"}
        P --> Q
        Q -->|"No"| R["Append PR\nconvention section"]
        Q -->|"Yes"| S["Skip"]
        R --> T["Update issue body"]
        S --> T
        T --> U["Report: enriched,\nskipped, failures"]
    end

    F --> G
    F --> L
```

```mermaid
flowchart LR
    subgraph "Issue Body (before enrich)"
        B1["## Acceptance Criteria\n- [ ] Per SPEC-0007 REQ ...\n- [ ] Per SPEC-0007 Scenario ..."]
    end

    subgraph "Issue Body (after enrich)"
        B2["## Acceptance Criteria\n- [ ] Per SPEC-0007 REQ ...\n- [ ] Per SPEC-0007 Scenario ..."]
        B3["### Branch\n`feature/42-jwt-token-generation`"]
        B4["### PR Convention\nCloses #42\nPart of #41 (SPEC-0007)"]
    end

    B1 -->|"/sdd:enrich"| B2
    B2 --> B3
    B3 --> B4
```

```mermaid
sequenceDiagram
    participant User
    participant Organize as /sdd:organize
    participant Tracker as Issue Tracker

    User->>Organize: /sdd:organize SPEC-0007
    Organize->>Organize: Resolve spec, detect tracker
    Organize->>Tracker: Search issues referencing SPEC-0007
    Tracker-->>Organize: Issues [#41 epic, #42 task, #43 task]
    Organize->>Organize: Classify: #41 = epic, #42/#43 = tasks
    Organize->>Tracker: Create project "Implement Sprint Planning"
    Tracker-->>Organize: Project PVT_abc123
    Organize->>Tracker: Add #41, #42, #43 to project
    Organize->>User: Report: 1 project created, 3 issues organized
```

```mermaid
sequenceDiagram
    participant User
    participant Enrich as /sdd:enrich
    participant Tracker as Issue Tracker

    User->>Enrich: /sdd:enrich SPEC-0007
    Enrich->>Enrich: Resolve spec, detect tracker
    Enrich->>Tracker: Search issues referencing SPEC-0007
    Tracker-->>Enrich: Issues [#41, #42, #43]
    loop For each issue
        Enrich->>Tracker: Read issue body
        Tracker-->>Enrich: Body text
        Enrich->>Enrich: Check for ### Branch and ### PR Convention
        alt Sections missing
            Enrich->>Enrich: Derive slug from title
            Enrich->>Tracker: Update body with appended sections
        else Sections exist
            Enrich->>Enrich: Skip (idempotent)
        end
    end
    Enrich->>User: Report: 2 enriched, 1 skipped
```

## Risks / Trade-offs

- **Tracker search accuracy**: Searching issue bodies for "SPEC-XXXX" may return false positives if the spec number appears in unrelated contexts (e.g., comments referencing the spec). Mitigation: the spec number format is distinctive (`SPEC-` prefix with zero-padded digits); false positives are unlikely and harmless (the skill checks for epic/task classification before acting).
- **GitHub Projects V2 API complexity**: GitHub Projects V2 uses a GraphQL-only API with separate concepts for projects, items, and fields. The `gh project create` and `gh project item-add` CLI commands abstract most of this, but edge cases (organization vs. user projects, project visibility) may require additional handling. Mitigation: use `ToolSearch` to discover MCP tools first; fall back to CLI; graceful failure on project creation errors.
- **Rate limiting during enrichment**: Enriching many issues involves one read and one write API call per issue. For large specs with 20+ tasks, this could hit rate limits. Mitigation: the skill processes issues sequentially; individual failures are reported and skipped without blocking the rest.
- **Issue body format assumptions**: The enrichment skill assumes issue bodies are markdown and that appending `### Branch` sections at the end is appropriate. If trackers use different body formats (e.g., Jira's wiki markup), the appended content may not render correctly. Mitigation: the `### Branch` and `### PR Convention` sections use simple markdown that renders acceptably in most contexts.
- **Stale `.claude-plugin-design.json` project IDs**: If a project is deleted from the tracker but its ID remains cached in `.claude-plugin-design.json`, the organize skill will attempt to reuse it and fail. Mitigation: the skill handles project-not-found errors gracefully and falls back to creating a new project.
- **Epic classification heuristics may miss custom epics**: The "Implement " title prefix and `epic` label heuristics may not catch epics created with different naming conventions. Mitigation: these heuristics match `/sdd:plan`'s output; manually created epics would need to follow the convention or be labeled.

## Open Questions

- Should `/sdd:organize` support linking tasks to epics within a project (e.g., GitHub Projects V2 parent-child relationships) or just add all items flat?
- Should `/sdd:enrich` offer to create the branch in git (not just document it in the issue body)?
- Should there be a combined `/sdd:organize --enrich` shorthand to run both in sequence?
- When `/sdd:plan` creates issues with branch/PR sections (per SPEC-0007 updates), should `/sdd:enrich` detect and respect those as already-enriched?
