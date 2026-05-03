<!-- Governing: ADR-0011 (Story-Sized Issue Granularity), ADR-0015 (Markdown-Native Configuration), ADR-0018 (Security-by-Default for Web Specifications) -->

# Issue Authoring Reference

Canonical reference for the structure and content of tracker issues created or modified by SDD plugin skills. Skills MUST consume this reference by section name rather than inlining their own conventions, the same way they reference `references/shared-patterns.md`. Keeping issue-body knowledge in one place means a future tracker-touching skill can be authored without re-deriving the conventions, and changes to issue quality propagate everywhere at once.

This reference is structured in three layers:

1. **Universal Principles** — apply to every issue regardless of type. Skills MUST follow these.
2. **Body Templates** — type-specific shapes for the four issue types the plugin currently produces (story, friction report, enrichment overlay, bug report). Skills MUST use the template that matches the issue type they are creating.
3. **Cross-Cutting Conventions** — sanitization, labelling, and tracker-specific deviations. Skills MUST apply these regardless of template.

## Universal Principles

Apply to every issue body the plugin authors:

1. **Lead with the summary.** The first paragraph names *what* and *why* in a way that someone scanning the issue tracker understands without opening the issue. Don't start with context — start with the outcome you want.
2. **Scope the context tightly.** Include the minimum facts needed to act on the issue: file paths involved, command issued, repository state if relevant. Don't paste full transcripts or whole diffs — link to them. Verbose issues are skim-skipped, which defeats the point of filing.
3. **Make it actionable.** Every issue should answer "what does done look like?" — either as explicit acceptance criteria (story issues) or as a clear definition of the desired fix (bug reports). Issues without an actionable next step rot in the backlog.
4. **Reference governance explicitly.** When an issue implements a spec requirement, governs by an ADR, or relates to another issue, name the artifact (`SPEC-0010 REQ "Token Validation"`, `ADR-0018`, `Closes #142`). The graph (ADR-0023) and PR-merge automation depend on these references being machine-parseable.
5. **Use RFC 2119 keywords intentionally.** `MUST` / `SHALL` indicate hard requirements. `SHOULD` / `RECOMMENDED` indicate strong preferences. `MAY` indicates options. Misusing these keywords misleads implementers and reviewers about which deviations are acceptable.

## Body Templates

### Story Issue

Used by `/sdd:plan` to break specs into trackable work items. A story issue groups related requirements from a single spec into one work unit producing a 200-500 line PR (per ADR-0011).

Required sections, in order:

```markdown
## Requirements

- [ ] **REQ "{Requirement Name}"** (SPEC-XXXX): {normative statement from the requirement}
  - WHEN {trigger from key scenario} THEN {expected outcome}
  - WHEN {trigger from another scenario} THEN {expected outcome}
- [ ] **REQ "{Another Requirement}"** (SPEC-XXXX): {normative statement}
  - WHEN {trigger} THEN {outcome}

## Acceptance Criteria

- [ ] Per SPEC-XXXX REQ "{Req 1}": {summary}
- [ ] Per SPEC-XXXX REQ "{Req 2}": {summary}
- [ ] Governing: ADR-XXXX ({decision title})
```

Rules:

- The requirement name MUST match the `### Requirement:` heading in the spec exactly — character-for-character. Reviewers and tooling rely on this to map issues back to spec requirements.
- The SPEC reference MUST use the spec's number (e.g., `SPEC-0010`), not the spec's title or directory name.
- WHEN/THEN pairs MUST be derived from the requirement's `#### Scenario:` blocks in the spec, not invented. If the spec lacks scenarios for a requirement, that's a spec defect — flag it rather than synthesize.
- Every requirement in the spec MUST appear in exactly one story's `## Requirements` section across the sprint. No double-coverage; no gaps.

#### Conditional sections

The story body gets additional sections appended in this order, when the conditions apply:

| Section | Append when | Template location |
|---------|-------------|-------------------|
| `## Security Checklist` | Story implements/modifies HTTP endpoints (per ADR-0018) | See "Security Checklist Template" below |
| `## Test Requirements` | Story is a UI-companion test story (per ADR-0019) | See "Test Requirements Template" below |
| `### Branch` | `--branches` is enabled (default) | See "Branch Section Template" in `shared-patterns.md` § Branch Naming Conventions |
| `### PR Convention` | `--pr-conventions` is enabled (default) | See "PR Convention Template" below |

#### Security Checklist Template

Append after `## Acceptance Criteria`, before `### Branch` or `### PR Convention`:

```markdown
## Security Checklist
- [ ] Authentication middleware applied
- [ ] Input validation for all request parameters and body fields
- [ ] Output encoding for user-supplied data in responses
- [ ] Rate limiting configured
- [ ] Request body size limits enforced
```

A story does NOT involve HTTP endpoints if it exclusively involves database migrations, background jobs, CLI commands, library refactoring, configuration setup, CI/CD pipelines, or documentation. In that case, omit the section entirely.

#### Test Requirements Template

Used for companion test stories that cover UI feature stories (per ADR-0019). Body MUST include a reference to the feature story it covers (`Covers #{feature-issue-number}`) and a `## Test Requirements` section:

```markdown
## Test Requirements
- [ ] Template render tests: {what to verify}
- [ ] JS unit tests: {what to verify}            (only if the feature story involves JavaScript)
- [ ] HTMX integration tests: {what to verify}   (only if the feature story involves HTMX)
```

#### PR Convention Template

```markdown
### PR Convention

- **Close keyword**: `{tracker-specific keyword from shared-patterns.md § PR Close Keywords} #{this-issue-number}`
- **Parent epic**: `Part of #{epic-issue-number}`
- **Spec reference**: `Implements SPEC-XXXX REQ "{Requirement Name}"`
```

Use CLAUDE.md `### SDD Configuration` `#### PR Conventions` settings when available (Close Keyword, Ref Keyword, Include Spec Reference) — see `shared-patterns.md` § Config Resolution.

### Friction Report

Used by `/sdd:report-friction` to file feedback against the SDD plugin when one of its skills caused significant agent churn. The shape is intentionally different from a story — friction reports are bug-shaped, not work-shaped.

Required sections, in order:

```markdown
## Friction summary
{One sentence naming what burned time. Lead with the affected skill: "/sdd:plan ..."}

## Affected
- **Skill**: `/sdd:{name}` (or `references/{file}.md` if friction was in a shared reference)
- **Plugin version**: {from .claude-plugin/plugin.json}
- **Triggering action**: {what the user / agent was trying to accomplish in plain language}

## What the SKILL.md said vs. what happened
**Said**: {quote or paraphrase the relevant passage from the SKILL.md, including step number}

**Happened**: {what observably went wrong — error messages, wrong output, dead-end branches}

## Reproduction context
{Minimum facts to reproduce: file paths, command issued, repository state if relevant.}

## Workaround used (if any)
{What the agent did to make progress despite the friction.}

## Estimated cost
- **Tokens**: ~{rough estimate, e.g., 5k} burned on recovery work
- **Severity**: {agent's own estimate: low | medium | high}

## Suggested fix
{Optional. If the agent has a concrete idea, surface it. Otherwise, omit this section.}
```

Rules:

- The "Said vs. Happened" section is the load-bearing one — it gives the maintainer the diff between intent and observed reality. Without it, a friction report is just a complaint.
- Cost and severity matter for triage. Be honest: "low / I lost ~2k tokens but worked around it" is useful signal; inflating to "high" because you were frustrated is not.
- The "Suggested fix" section is optional. If the agent has a concrete idea ("the SKILL.md should add a preflight check for X"), include it. If not, omit — half-baked suggestions are worse than none.

### Bug Report (user's project, not the SDD plugin)

For a hypothetical future skill (`/sdd:bug` or similar) that files bugs against the user's own project, not the SDD plugin. Currently no skill produces this shape, but the template is documented here so any future bug-filing skill has a canonical starting point.

Required sections, in order:

```markdown
## Summary
{One sentence stating the observed defect. Lead with the user-visible effect, not the internal cause.}

## Steps to reproduce
1. {Action 1}
2. {Action 2}
3. {Action 3}

## Expected behavior
{What should happen}

## Actual behavior
{What did happen — include error messages, stack traces, screenshots inline if small}

## Environment
- {Relevant version info: OS, browser, runtime, project version}
- {Configuration that may matter}

## Severity
{low | medium | high — based on user impact, not on your annoyance level}

## Suggested investigation (optional)
{If you have a hypothesis about the root cause, include it. If not, omit.}
```

### Enrichment Sections

Used by `/sdd:enrich` to append `### Branch` and `### PR Convention` sections to existing issues that lack them. Enrichment NEVER replaces existing content — it only appends missing sections. The templates are the same as the story-issue versions above (see "Branch Section Template" in `shared-patterns.md` and "PR Convention Template" above).

## Cross-Cutting Conventions

### Sanitization

Skills that file issues to remote trackers MUST scan the proposed body for sensitive content before submission and MUST surface findings to the user. Two policies exist depending on the issue type:

| Skill | Policy | Rationale |
|-------|--------|-----------|
| `/sdd:plan`, `/sdd:enrich` | No automatic sanitization. The user is creating issues for their own project; the body content is theirs to manage. | Story bodies are intentionally derived from the user's spec, which is also under their control. |
| `/sdd:report-friction` | Active redaction: replace absolute paths, internal URLs, credential-shaped strings, non-public emails, and IPs with `[REDACTED-*]` placeholders. Surface a redaction log so the user knows what was changed before approving. | Friction reports go to a public repo (`joestump/claude-plugin-sdd`); content the agent would have included by reflex (file paths from the user's session, internal URLs from the user's project) does not belong there. |

Patterns to detect during active redaction:

| Pattern | Example | Replacement |
|---------|---------|-------------|
| Absolute paths under `/Users/`, `/home/`, `/var/`, `/opt/`, `C:\Users\` | `/home/joestump/src/secret-project/handler.go:142` | `[REDACTED-PATH]/handler.go:142` (preserve trailing filename) |
| URLs containing `internal`, `corp`, `staging`, `dev.`, `.local`, or non-public TLDs | `https://internal.acme.com/api/users` | `[REDACTED-URL]` |
| Credential-shaped strings near keywords (`token`, `key`, `secret`, `password`, `bearer`) | `Bearer abc123def456...` | `Bearer [REDACTED-CREDENTIAL]` |
| Email addresses on non-public domains | `someone@acme.com` | `[REDACTED-EMAIL]` |
| IP addresses (private and public) | `10.0.0.5` | `[REDACTED-IP]` |

The displayed body MUST equal the submitted body — no surprise content added or subtracted between display and submission. If the user wants to put a redacted value back (because they decided it was actually safe), they MUST do so via the "edit then submit" path that re-shows the prompt with their changes.

### Labelling

Apply labels uniformly so triage and filtering work consistently. Use the **Try-Then-Create Label Pattern** from `shared-patterns.md` so missing labels in the tracker are auto-created with sensible defaults.

| Skill | Auto-applied labels | Optional second label (agent picks) |
|-------|---------------------|-----------------------------------|
| `/sdd:plan` story issue | `story` (color: `#1D76DB`); plus `epic` (`#6E40C9`) on the parent epic; plus `spec` (`#0E8A16`) on the linked spec issue if produced | None per-story; `foundation` (`#D4A017`) on stories detected as foundations (per `shared-patterns.md` § Foundation Story Detection); `ci` on CI-setup stories; `test` on companion test stories |
| `/sdd:report-friction` | `skill-friction` (the discriminator that lets the maintainer filter all friction reports) | One of: `bug` / `documentation` / `enhancement` / `usability` (agent picks based on observed defect type) |
| `/sdd:enrich` | None — enrichment overlays existing issues without changing labels | None |

When a skill auto-applies a label and the user wants to override (e.g., suppress the `foundation` classification), the skill MUST accept a `--no-{label}` flag rather than silently skipping the labelling. The default is to apply.

### Cross-Tracker Considerations

Most issue-body conventions translate across trackers, but a few details differ:

| Tracker | Difference | Handling |
|---------|------------|----------|
| **Beads** | Native subtasks instead of markdown task checklists | `/sdd:plan` MUST create subtasks via `bd subtask add` for the requirements list, not a markdown checklist. Each subtask gets the requirement name as title, normative statement + WHEN/THEN scenarios as body. |
| **Jira** | Issue keys are project-scoped (`PROJ-123`) not numeric | Close keywords use the full key. Branch naming uses the full key. Cross-references in PR bodies use the full key. |
| **Linear** | Same key-scoped pattern as Jira (`TEAM-45`) | Same handling. |
| **GitLab** | Merge requests, not pull requests; "MR" in user-facing text | PR Convention sections in body should say "MR" when the tracker is GitLab; close keywords go in the MR description, not the issue body. |
| **GitHub Projects V2** | Projects are owner-scoped, not repo-scoped, and need an explicit link to appear in the repo's Projects tab | `/sdd:plan` MUST link the project to the repo after creation via `gh project link {project-number} --owner {owner} --repo {owner}/{repo}` (per `/sdd:plan` Step 5.6). Without this, the project exists but is invisible. |
| **Gitea** | MCP tools vary by instance | Use `ToolSearch` to discover the tracker's MCP tool surface at runtime; do not hardcode tool names. |

For close keywords by tracker, see `shared-patterns.md` § PR Close Keywords. For branch naming by tracker, see `shared-patterns.md` § Branch Naming Conventions.

## Consumers

The following skills consume this reference. Maintain this list when adding new consumers:

| Skill | Consumes |
|-------|----------|
| `/sdd:plan` | Universal Principles; Story Issue template; Conditional sections (Security, Test Requirements, PR Convention); Labelling; Cross-Tracker Considerations |
| `/sdd:enrich` | Enrichment Sections; Branch / PR Convention templates referenced from `shared-patterns.md` |
| `/sdd:report-friction` | Universal Principles; Friction Report template; Sanitization; Labelling |

Future tracker-touching skills (e.g., a hypothetical `/sdd:bug` for filing bugs against the user's project) SHOULD consume the relevant templates rather than inline their own.
