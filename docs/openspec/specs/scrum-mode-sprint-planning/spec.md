# SPEC-0012: Scrum Mode Sprint Planning

## Overview

A `--scrum` flag for `/sdd:plan` that orchestrates a complete, team-groomed sprint planning ceremony in a single invocation. The ceremony combines spec completeness auditing, issue decomposition, multi-agent backlog grooming, project organization, and developer workflow enrichment — eliminating the current three-step manual sequence (`/sdd:plan` → `/sdd:organize` → `/sdd:enrich`). See ADR-0013.

## Requirements

### Requirement: Single-Invocation Ceremony Flag

The `/sdd:plan` skill MUST accept a `--scrum` flag that activates scrum mode. When `--scrum` is provided, the skill SHALL execute the full ceremony sequence (spec completeness audit → issue decomposition → grooming → organize → enrich) and produce a sprint report without requiring additional commands from the user. The `--scrum` flag MUST compose with existing arguments: `/sdd:plan SPEC-XXXX --scrum` (single spec) and `/sdd:plan --scrum` (full backlog) SHALL both be valid invocations.

#### Scenario: Single-spec scrum mode

- **WHEN** the user runs `/sdd:plan SPEC-0003 --scrum`
- **THEN** the skill performs the full ceremony for SPEC-0003 and delivers a complete sprint backlog with projects, branch names, and PR keywords in one run

#### Scenario: Full-backlog scrum mode

- **WHEN** the user runs `/sdd:plan --scrum` with no spec argument
- **THEN** the skill grooms all active backlog issues across all specs in the tracker and delivers a groomed, organized, enriched full backlog

#### Scenario: Flag composition with existing options

- **WHEN** the user runs `/sdd:plan SPEC-XXXX --scrum --no-projects`
- **THEN** the scrum ceremony runs but project creation is skipped, respecting the `--no-projects` opt-out

### Requirement: Scrum Team Composition

The skill MUST spawn exactly five specialist agents to participate in the ceremony alongside the orchestrating lead:

| Role | Persona |
|------|---------|
| Product Owner | Business-value focused; reviews priority, acceptance criteria completeness, and user-outcome framing |
| Scrum Master | Process-oriented; ensures stories are sprint-ready, sized, and unblocked; flags dependencies |
| Engineer A | Pragmatic generalist; estimates effort, identifies technical risk, proposes splits for overscoped stories |
| Engineer B | Grumpy, tenured, pedantic; holds a high quality bar; challenges weak requirements and over-engineering; often clashes with the PO; usually right; does not always win |
| Architect | ADR- and spec-aware; validates governing comment requirements, checks design.md coverage, ensures stories reference correct ADR/spec anchors |

The lead SHALL orchestrate ceremony phases, distribute stories, collect feedback, and apply consensus decisions.

#### Scenario: All five roles participate

- **WHEN** `--scrum` mode begins
- **THEN** all five specialist agents are spawned and each submits feedback on every story before finalization

#### Scenario: Engineer B provides substantive dissent

- **WHEN** a story has a weak requirement, is overscoped, or lacks spec backing
- **THEN** Engineer B MUST raise a substantive objection with specific reasoning, not a generic approval

#### Scenario: Engineer B finds nothing to push back on

- **WHEN** the backlog is genuinely well-formed and all stories are solid
- **THEN** Engineer B SHALL say so explicitly with a brief explanation of why the backlog passes the high-quality bar

### Requirement: Spec Completeness Audit

Before grooming begins, the skill MUST audit every spec referenced by any backlog issue. The audit SHALL verify:

1. A `spec.md` exists for the spec
2. A `design.md` exists alongside the `spec.md`
3. Every tracker issue in scope traces to a spec

For any spec missing `design.md`, the skill SHALL generate a `design.md` draft co-located with `spec.md` before grooming begins. For any tracker issue with no backing spec, the skill SHALL generate both `spec.md` and `design.md` draft files in `docs/openspec/specs/` before that issue enters grooming. All generated drafts MUST be clearly marked as drafts in their YAML frontmatter (`status: draft`).

#### Scenario: Missing design.md detected

- **WHEN** a spec directory contains `spec.md` but no `design.md`
- **THEN** the skill generates `design.md` as a draft and includes it in the spec completeness report

#### Scenario: Unspec'd issue detected

- **WHEN** a tracker issue references no spec in its body
- **THEN** the skill generates a draft `spec.md` + `design.md` proposal and includes the proposed spec in the ceremony as a new item for the team to review

#### Scenario: All specs are complete

- **WHEN** every issue in scope has a backing spec with both `spec.md` and `design.md`
- **THEN** the audit passes and grooming begins immediately with no generated drafts

### Requirement: Backlog Grooming Ceremony

Each specialist agent MUST review every story in scope and submit asynchronous feedback to the lead. The lead SHALL not finalize any story until all five agents have submitted feedback. Each agent's feedback MUST address their role-specific concerns:

- **PO**: priority order, user-value framing, acceptance criteria completeness, scope appropriateness
- **SM**: sprint-readiness, dependency identification, effort estimate using XS/S/M/L/XL t-shirt sizing
- **Engineer A**: implementation complexity, technical risk flags, recommendation to split or merge stories
- **Engineer B**: requirement quality, spec compliance, ADR reference correctness, pedantic objections to vague or overloaded requirements
- **Architect**: governing comment requirements (`// Governing: SPEC-XXXX REQ "..."` pattern), design.md coverage for all requirements, ADR alignment

#### Scenario: Story receives unanimous approval

- **WHEN** all five agents approve a story without substantive objections
- **THEN** the story is finalized immediately and moves to the organize phase

#### Scenario: Story receives mixed feedback

- **WHEN** at least one agent raises a substantive objection
- **THEN** the story enters dissent resolution before finalization

### Requirement: Dissent Resolution

When a story receives a substantive objection, the skill SHALL run a one-round negotiation between the PO and the objecting agent. The Scrum Master MUST cast a tiebreaking decision if the negotiation does not reach consensus within one round. Stories MUST NOT remain in an unresolved state — they are either finalized, revised, or deferred to a future sprint.

#### Scenario: PO and dissenter reach consensus

- **WHEN** the PO and dissenting agent agree on a revision during the one-round negotiation
- **THEN** the story is updated to reflect the agreed revision and finalized

#### Scenario: Negotiation does not resolve

- **WHEN** the PO and dissenting agent do not agree after one negotiation round
- **THEN** the Scrum Master SHALL make the final decision: accept the story as-is, accept the revision, or defer the story to a future sprint

#### Scenario: Deferral

- **WHEN** the Scrum Master defers a story
- **THEN** the story is excluded from the current sprint backlog and listed in the sprint report under "Deferred"

### Requirement: Automatic Organize and Enrich

After grooming, the skill MUST automatically execute the organize and enrich steps without requiring a separate invocation. The organize step SHALL create or update tracker-native projects per ADR-0009 and ADR-0012 (descriptions, READMEs, iteration fields, named views for GitHub; milestones and board columns for Gitea). The enrich step SHALL append branch naming and PR close-keyword sections to all finalized issue bodies per ADR-0009.

Users who have set `--no-projects` or `--no-branches` flags MUST have those opt-outs respected during the automatic organize and enrich phases.

#### Scenario: Organize step runs automatically

- **WHEN** grooming completes
- **THEN** project creation/update runs without user prompting, and tracker-native projects reflect the finalized sprint backlog

#### Scenario: Enrich step runs automatically

- **WHEN** organize step completes
- **THEN** all finalized issue bodies include branch name and PR close-keyword sections without user prompting

#### Scenario: Opt-outs respected

- **WHEN** the user ran `/sdd:plan --scrum --no-projects`
- **THEN** the organize step skips project creation but still generates the sprint report

### Requirement: Sprint Report

The skill MUST deliver a sprint report at the end of the ceremony. The report SHALL include:

- **Accepted**: stories finalized without revision, with story titles and issue numbers
- **Revised**: stories modified during dissent resolution, with before/after description of what changed and which agent raised the objection
- **Deferred**: stories excluded from the current sprint, with the reason for deferral
- **Specs proposed**: new spec.md + design.md drafts generated for unspec'd issues, with file paths
- **Design docs generated**: design.md drafts generated for specs that were missing them, with file paths
- **Final backlog**: ordered list of accepted stories with issue numbers, branch names, and sprint assignment

#### Scenario: Successful ceremony completion

- **WHEN** the ceremony completes with at least one accepted story
- **THEN** the sprint report is output to the conversation with all required sections

#### Scenario: Empty result

- **WHEN** all stories are deferred and no stories are accepted
- **THEN** the sprint report is still output, indicating the backlog needs further refinement before a sprint can begin, and lists all deferred stories with reasoning
