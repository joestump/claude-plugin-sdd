# Design: Respond to PR Review Feedback

## Context

The SDD pipeline runs spec → plan → organize → enrich → work → review. ADR-0010's `/sdd:review` closes the loop by reviewing and merging `/sdd:work` PRs with reviewer-responder pairs. But its responder only ever answers a reviewer it spawned itself. The most common real-world case — a human (or external bot) leaves comments on a PR — has no plugin entry point. ADR-0034 decided to fill that gap with a standalone, author-driven `/sdd:respond` skill. This document describes how to implement that decision. See ADR-0034 and SPEC-0035.

## Goals / Non-Goals

### Goals

- Address review feedback that already exists on a PR: review threads, requested-changes reviews, top-level comments, and failing CI.
- Make the code fixes on the PR branch, push them, and reply to each thread explaining what was done.
- Judge requested changes against governing specs/ADRs and decline (with citation) those that would violate them.
- Capture out-of-scope feedback as tracked follow-up issues rather than dropping it.
- Support GitHub, GitLab, and Gitea.

### Non-Goals

- Merging the PR. Merge authority stays with `/sdd:review` or the human.
- Reviewing the PR or generating new feedback (that is `/sdd:review`).
- Unbounded back-and-forth. One complete pass per invocation; new feedback means a new run.
- Trackers without PR review (Beads, Jira, Linear).

## Decisions

### Standalone skill over a `/sdd:review` flag

A new `skills/respond/SKILL.md` rather than `/sdd:review --respond-only`. `/sdd:review` is reviewer-driven and loop-capable; bending it into an author tool inverts its model and bloats an already-large skill. A separate skill keeps both focused and discoverable. The two share the responder protocol (worktree reuse, push, reply) conceptually, and `/sdd:respond` reuses the shared patterns in `references/shared-patterns.md` to stay aligned.

### Author-driven feedback gathering

The skill starts from feedback that already exists. It pulls review line comments, review summaries with state, top-level comments, and — treating failing CI as feedback — the failing-check logs. This is the inverse of `/sdd:review`, which produces the feedback before responding.

### Four-way triage with spec-aware rejection

Each item is classified `fix`, `reply`, `reject`, or `defer`. `reject` is what makes the responder safe to automate: a requested change that violates a governing spec/ADR is declined with a cited explanation rather than blindly applied. This requires loading the governing artifacts up front (Architecture Context Loading).

### Deferred feedback becomes a single tracked issue, not `/sdd:plan`

A deferred review comment is one follow-up. `/sdd:plan` decomposes an entire spec into an epic plus many stories — the wrong granularity for a single comment. So `defer` items are filed directly via the tracker's issue API, linked back to the PR/thread/spec. Issue creation is outward-facing, so it is gated by `--no-defer-issues` and confirmed interactively. When a cluster of deferrals amounts to a new capability, the summary points the user at `/sdd:spec` → `/sdd:plan` instead.

### Bounded single round, never merge

Mirroring ADR-0010's bounded-iteration invariant, the skill performs one complete pass over current feedback. It never merges — responding is not approving. For ongoing watch, it points the user at `subscribe_pr_activity` rather than polling.

### Mode flags for partial runs

`--reply-only` (communicate only), `--fix-only` (change + push, no replies), and `--no-push` (local changes only, no replies) cover the partial workflows. `--reply-only` and `--fix-only` are mutually exclusive.

## Architecture

```mermaid
sequenceDiagram
    participant U as User
    participant R as /sdd:respond
    participant T as Tracker (GitHub/GitLab/Gitea)
    participant W as Worktree
    participant I as Issue tracker

    U->>R: /sdd:respond [PR | current branch]
    R->>T: Resolve PR + fetch threads, reviews, comments, CI
    R->>R: Load governing spec/ADRs; triage items
    alt fix
        R->>W: Apply change + governing comments, run tests
        W->>T: Push to PR branch
        R->>T: Reply "Fixed in {sha}", resolve thread
    else reply
        R->>T: Answer on thread
    else reject
        R->>T: Decline, cite spec/ADR
    else defer
        R->>I: File follow-up issue (linked)
        R->>T: Reply linking issue
    end
    R->>U: Summary (no merge); offer subscribe_pr_activity
```

## Risks / Trade-offs

- **Two responders to keep aligned.** `/sdd:respond` and the responder inside `/sdd:review` share a protocol; divergence would confuse users. Mitigated by routing both through `references/shared-patterns.md`.
- **One round may be insufficient.** Complex reviews need follow-up runs or human help; the skill makes this explicit in its summary rather than pretending to fully resolve.
- **Outward-facing issue creation.** Filing follow-up issues could surprise users; mitigated by interactive confirmation and `--no-defer-issues`.
- **Untrusted comment content.** Review text and CI logs are external input; the skill escalates suspicious redirection via `AskUserQuestion` rather than acting on it.

## Open Questions

- Should `/sdd:respond` optionally re-request review (e.g., re-request the original reviewer) after pushing fixes, or leave that to the user?
- Should it offer to auto-subscribe to PR activity at the end of a run rather than only suggesting it?
