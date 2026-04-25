# Design: Parallel PR Review and Response

## Context

The SDD plugin's workflow pipeline covers architectural decisions (ADR), specifications (spec), sprint planning (plan), issue organization (organize), developer conventions (enrich), and parallel implementation (work). The final manual step -- reviewing, addressing feedback, and merging PRs -- is the remaining bottleneck. ADR-0010 decided to automate this with a `/sdd:review` skill that uses reviewer-responder agent pairs. This design document describes how to implement that decision. See ADR-0010 and SPEC-0009.

## Goals / Non-Goals

### Goals
- Automate PR review with spec-aware feedback that checks acceptance criteria, not just style
- Address review comments by pushing fix commits and replying to each comment
- Merge approved PRs automatically (with opt-out via `--no-merge`)
- Process multiple PRs concurrently using agent pairs
- Bound the review cycle to exactly one round to prevent runaway compute
- Reuse existing worktrees from `/sdd:work` when available

### Non-Goals
- Replacing human review for security-critical or high-risk changes
- Multi-round review cycles (one round only; human picks up unresolved items)
- Modifying the `/sdd:work` skill or its PR creation behavior
- Supporting trackerless environments (a live tracker with PR/MR support is required)
- Running CI/CD pipelines or waiting for external check suites

## Decisions

### Reviewer-responder pairs over single-agent processing

**Choice**: Organize agents into dedicated reviewer-responder pairs rather than having one agent per PR that self-reviews.
**Rationale**: Separation of concerns is the core value of code review. An agent that wrote code (via `/sdd:work`) and then reviews its own output provides no independent verification. Dedicated reviewers who only read diffs and check spec compliance provide genuine quality assurance. Dedicated responders who only fix issues keep the roles clean.
**Alternatives considered**:
- Self-reviewing agent: No separation of concerns; the review adds no value beyond what the implementation agent already verified
- Single shared reviewer: Bottleneck; cannot start responses until all reviews are done

### Round-robin PR distribution

**Choice**: Distribute PRs across pairs using simple round-robin (PR 1 → Pair 1, PR 2 → Pair 2, PR 3 → Pair 1, ...).
**Rationale**: PRs from `/sdd:work` are already scoped to individual issues with clear boundaries. Domain-aware scheduling (grouping related PRs to one pair) adds complexity with minimal benefit since each PR is self-contained. Round-robin is fair, deterministic, and requires no analysis of PR content.
**Alternatives considered**:
- Domain-based grouping: Over-engineered for independent, issue-scoped PRs
- Shortest-queue-first: Adds dynamic scheduling complexity; round-robin is sufficient

### One review-response round

**Choice**: Exactly one round of review → response → re-evaluation per PR.
**Rationale**: ADR-0010 established bounded iteration as a key driver. One round catches the majority of issues (spec compliance, missing tests, obvious bugs) while keeping compute predictable. Complex issues that survive one round are better handled by humans who can make judgment calls the agent cannot.
**Alternatives considered**:
- Two rounds: Doubles compute cost; diminishing returns after first round
- Unbounded rounds: Risk of infinite loops; unpredictable cost

### Reuse `/sdd:work` worktrees

**Choice**: Responders check for existing worktrees at `.claude/worktrees/{branch-name}` before creating new ones.
**Rationale**: `/sdd:work` creates worktrees that may still exist (especially if `auto_cleanup` is false). Reusing them avoids redundant checkouts and preserves any local state. If the worktree was cleaned up, the responder creates a fresh one from the remote branch.
**Alternatives considered**:
- Always create new worktrees: Wastes time re-checking out code that may already be local
- Require worktrees to exist: Too strict; users who cleaned up after `/sdd:work` would be blocked

### Automatic epic closure after final story merge

**Choice**: After merging a PR and its linked story issue is closed, check if all sibling stories under the parent epic are also closed; if so, close the epic automatically.
**Rationale**: Epics are grouping issues created by `/sdd:plan` to represent a spec's implementation scope. They have no standalone value once all their child stories are merged. Leaving them open creates tracker noise and makes it appear that work is incomplete when it is not. The "Part of #XX" reference in PR bodies provides a reliable link from story to epic, and checking sibling story status is a cheap API call.
**Alternatives considered**:
- Manual epic closure: Adds a tedious manual step that is easy to forget, which is exactly the problem users reported
- Close epic when Nth PR merges (fixed threshold): Fragile; story counts vary per spec

### Squash merge as default

**Choice**: Default merge strategy is squash, configurable via `.claude-plugin-design.json` `review.merge_strategy`.
**Rationale**: Squash produces clean commit history (one commit per PR) which aligns with the "one issue, one branch, one PR" convention from `/sdd:plan`. Teams that prefer merge commits or rebases can configure their preference.
**Alternatives considered**:
- Merge commit default: Preserves individual commits but clutters history for agent-generated code
- Rebase default: Risk of rewriting public history if branches were shared

## Architecture

```mermaid
flowchart TD
    A["/sdd:review\n[SPEC-XXXX or PR numbers]"] --> B["Parse arguments\n+ detect tracker"]

    B --> C["Discover target PRs"]
    C --> D["Load spec context\n(spec.md, design.md, ADRs)"]

    D --> E{"PR count vs\npair count"}
    E -->|"PRs >= 2"| F["Create team:\nN reviewer + N responder"]
    E -->|"PRs < 2"| F2["Create team:\n1 reviewer + 1 responder"]

    F --> G["Round-robin assign\nPRs to pairs"]
    F2 --> G

    G --> H["Phase 1: Review"]

    subgraph "Per PR (parallel across pairs)"
        H --> H1["Reviewer reads diff\n+ spec acceptance criteria"]
        H1 --> H2{"Issues found?"}
        H2 -->|"No"| H3["Submit APPROVE"]
        H2 -->|"Yes"| H4["Submit REQUEST_CHANGES\nwith line comments"]

        H4 --> I["Phase 2: Response"]
        I --> I1["Responder checks out\nbranch (reuse worktree)"]
        I1 --> I2["Fix issues,\ncommit + push"]
        I2 --> I3["Reply to review\ncomments"]

        I3 --> J["Phase 3: Re-evaluate"]
        J --> J1["Reviewer reads\nupdated diff"]
        J1 --> J2{"Resolved?"}
        J2 -->|"Yes"| J3["Submit APPROVE"]
        J2 -->|"No"| J4["Leave summary comment\nfor human follow-up"]
    end

    H3 --> K{"--no-merge?"}
    J3 --> K
    J4 --> L["Report as\nneeds-human"]

    K -->|"No"| M["Merge PR\n(squash default)"]
    K -->|"Yes"| N["Report as\napproved-not-merged"]

    M --> M1{"All sibling\nstories closed?"}
    M1 -->|"Yes"| M2["Close parent epic"]
    M1 -->|"No"| O["Final report"]
    M2 --> O
    N --> O
    L --> O
```

```mermaid
sequenceDiagram
    participant Lead
    participant R as Reviewer
    participant S as Responder
    participant Tracker as Tracker API

    Lead->>Lead: Discover PRs, load spec context
    Lead->>R: Assign PR #101 for review

    R->>Tracker: Fetch PR diff
    Tracker-->>R: Diff + linked issue body
    R->>R: Check diff against spec acceptance criteria
    R->>Tracker: Submit review (REQUEST_CHANGES)
    R->>Lead: Review complete: changes requested

    Lead->>S: Address review on PR #101
    S->>S: Locate or create worktree
    S->>Tracker: Read review comments
    S->>S: Apply fixes in worktree
    S->>Tracker: Push fix commits
    S->>Tracker: Reply to each comment
    S->>Lead: Response complete

    Lead->>R: Re-evaluate PR #101
    R->>Tracker: Fetch updated diff
    R->>Tracker: Submit review (APPROVE)
    R->>Lead: PR #101 approved

    Lead->>Tracker: Merge PR #101 (squash)
    Tracker-->>Lead: Merged, issue #42 closed
    Lead->>Tracker: Check sibling stories for epic #50
    Tracker-->>Lead: All stories closed
    Lead->>Tracker: Close epic #50
```

```mermaid
flowchart LR
    subgraph ".claude-plugin-design.json review section"
        r1["review.max_pairs: 2"]
        r2["review.merge_strategy: 'squash'"]
        r3["review.auto_cleanup: false"]
    end
```

## Risks / Trade-offs

- **One round may be insufficient**: Complex PRs with deep architectural issues may not be fully resolved in one review-response cycle. Mitigation: the skill leaves clear comments explaining what remains, and the report lists unresolved PRs for human follow-up.
- **Auto-merge trust**: Merging without human approval requires trust in the reviewer agent's judgment. Mitigation: the `--no-merge` flag provides a safety valve; users can review approvals before manually merging.
- **Merge conflicts**: If multiple PRs touch overlapping files, merging one may cause conflicts in another. Mitigation: the skill handles merge failures gracefully, reports the conflict, and continues with remaining PRs. The user can resolve conflicts and re-run `/sdd:review` for the affected PRs.
- **Compute cost**: 4 agents (2 pairs) per invocation is compute-intensive. Mitigation: adaptive pair count reduces to 1 pair for small batches; `.claude-plugin-design.json` `review.max_pairs` provides control.
- **Worktree state**: Reused worktrees from `/sdd:work` may have uncommitted changes or be on the wrong commit. Mitigation: responders should `git pull` and verify they are on the correct branch before making changes.
- **Tracker API rate limits**: Submitting reviews, pushing commits, and merging in rapid succession may hit rate limits. Mitigation: sequential processing within each pair (review → response → merge) provides natural pacing; individual failures are reported and skipped.

## Open Questions

- Should the skill support reviewing PRs across multiple repositories (e.g., a monorepo with multiple specs)?
- Should reviewers enforce a minimum test coverage threshold before approving?
- Should the skill post a summary comment on each PR before closing (e.g., "Reviewed and merged by /sdd:review")?
- Should there be a `--strict` flag that requires ALL review comments to be addressed before approving (vs. the default which allows the reviewer to approve with minor unresolved items)?
