<!-- Governing: ADR-0037 (SDD Constitution: Standing Owner Rules Applied Automatically), ADR-0015 (Markdown-Native Configuration) -->

# Constitution Reference

A **constitution** is a project's standing owner decisions: the calls an owner would otherwise make one ticket at a time ("when unsure whether something matches, treat it as no match", "main's design wins in a conflict"). It is a plain markdown file, read before an agent stops, and applied instead of stopping when a rule matches.

This file defines the file format, the citation format, and what each skill does with it. The lookup algorithm is in `shared-patterns.md § "Constitution Resolution"` — skills cite that section rather than restating it.

When a project has no constitution, every skill behaves exactly as it did before this feature existed. A constitution is additive: it removes stops, it never adds one to a path that previously ran unattended.

## Path

Default: `docs/constitution.md`, resolved per `shared-patterns.md § "Constitution Resolution"`. A project may point elsewhere with `### SDD Configuration` → `#### Constitution` → `- **Path**:` in the project memory file (ADR-0015), so a repo that keeps design records under `docs/decisions/` can keep the constitution beside them.

The file MUST stay plain markdown and data-only. It carries decisions, never procedures: an executable instruction to the agent belongs in the skill that runs it, not in a project file a non-author can edit.

## Format

One `## Rules` section holding one `### Rule N — Title` heading per rule, and one optional `## Always ask the owner` section.

```markdown
# Project Constitution

<!-- Governing: ADR-0020 (Governing Comments) -->

## Rules

### Rule 1 — Ambiguity resolves to no match
- **Decision**: When it is unclear whether existing code or behavior satisfies a requirement, treat it as no match and implement rather than asking.
- **Governs**: SPEC-0004 Req 3
- **Applies to**: work, respond, review

### Rule 2 — Main's design wins
- **Decision**: When a task conflicts with a design already on the default branch, follow the default branch and record the conflict in the PR body.
- **Governs**: ADR-0017

### Rule 3 — Retired rule
- **Status**: retired
- **Retired by**: Rule 6
- **Decision**: Always add a feature flag for a new code path.

## Always ask the owner
- Anything that changes what a running deployment can do with a credential
- Anything that widens who or what can read project data
```

Required, and what a validator checks:

| Element | Rule |
|---------|------|
| `## Rules` heading | MUST exist and MUST be the first `##` section after the title |
| `### Rule N — Title` | MUST use a positive integer `N`; MUST use an em dash or hyphen before the title; numbers MUST be unique in the file |
| `- **Decision**:` | MUST be present on every rule that is not `retired`; one sentence is enough, a paragraph is fine |
| `- **Governs**:` | OPTIONAL; one `ADR-XXXX`, or one `SPEC-XXXX Req N` / `SPEC-XXXX` requirement pointer, or both separated by a comma |
| `- **Applies to**:` | OPTIONAL; comma list drawn from `work`, `respond`, `review`, `check`, `status`; missing means all of them |
| `- **Status**: retired` | OPTIONAL; marks the rule inert. A retired rule MUST NOT be cited, and keeps its number |
| `## Always ask the owner` | OPTIONAL; a bullet list of decisions that stay human even when a rule seems to cover them |

Numbering is append-only: retiring a rule marks it `retired` and keeps its number, because PRs, tracker comments and review threads quote rules by number. Renumbering silently changes what an old citation meant.

## Reading a rule

A skill reads the constitution once per run, never per file or per tick:

1. Resolve the path (`shared-patterns.md § "Constitution Resolution"`). No file → skip every constitution step in this reference.
2. Parse the `## Rules` section into `Rule N → { title, decision, governs, applies_to, status }`. A malformed rule is reported once, on the run's first output, as `Constitution: Rule N is malformed — skipping it`, and the run continues with the remaining rules.
3. Ignore `retired` rules, and rules whose `Applies to` list excludes the current skill.
4. Keep `## Always ask the owner` alongside the rules for the rest of the run.

A rule **matches** when its decision answers the exact question the agent was about to stop on. "Close enough" is not a match: an unmatched question stops and asks, exactly as before.

## Citing a rule

An agent that applied a rule states it, in the PR body and in the tracker comment it posts for that work item:

```markdown
### Owner Rules Applied

- Owner rule applied: Rule 2 — Main's design wins (ADR-0017)
```

- The line form is exactly `Owner rule applied: Rule N — {title}`, with the `— {title}` part optional when the title is quoted verbatim from the file.
- One line per rule actually applied. A rule that was read but did not change the outcome is not cited.
- Where the skill posts a tracker comment for the same work item, the same lines appear there, one per line.
- Nothing was applied → the `### Owner Rules Applied` section is omitted entirely rather than written as empty or `None`.

## Misapplication in review

`/sdd:review` checks each cited rule against the diff: does the decision actually answer the question the change was stuck on, does the cited rule exist, and is it not `retired`? A citation that does not hold is a **blocking finding**:

```
Owner rule misapplied: Rule 2 (Main's design wins) is cited, but the change
overrides a design already on main rather than following it — the diff does
what Rule 2 says not to do. Governing: ADR-0017.
```

- A misapplied rule blocks approval (the review event is `REQUEST_CHANGES` where the harness submits reviews), the same as a contradiction of a MUST requirement.
- A citation of a rule number that does not exist in the constitution, or of a `retired` rule, is the same blocking finding.
- A rule the diff should have applied but did not cite is a non-blocking note, never a blocker: absence of a citation is not evidence of a wrong decision.
- Where the rule carries `Governs`, the finding cites the underlying ADR or spec requirement, so the author can argue against the source and not only the citation.

## Contradictions in a drift check

`/sdd:check` compares the constitution against the design records it points at:

| Finding | Severity |
|---------|----------|
| A rule's decision contradicts the ADR or spec requirement in its `Governs` pointer | `[CRITICAL]` |
| A `Governs` pointer names an ADR or spec that does not exist on the current branch | `[WARNING]` |
| A rule whose `Governs` pointer targets an artifact marked `deprecated` or `superseded` | `[WARNING]` |
| Malformed rule (missing `Decision`, duplicate number, unreadable `Applies to`) | `[WARNING]` |
| `## Rules` heading missing while the file exists | `[WARNING]` |

A constitution with no `Governs` pointers cannot contradict anything, and `/sdd:check` says so rather than inventing findings.

## Rule usage in `/sdd:status`

`/sdd:status` reports which rules point at the artifact whose status is changing, and warns when a status change orphans a live rule — moving an ADR to `deprecated` while Rule 3 and Rule 9 cite it means those rules need a decision too.

Per-run citation counts (how often each rule was applied) live in the tracker, not in the repo: `### Owner Rules Applied` sections in PR bodies are where that history accumulates, and a skill running in one checkout has no way to count them. A project that wants a running tally greps its own PR history for the literal line; the format above is stable precisely so that grep stays valid.

## Example session

An agent runs `/sdd:work 412`. Issue 412 asks for a retry path around a flaky call, and the acceptance criteria don't say whether an existing helper already counts. Instead of stopping:

1. The constitution was read at startup; Rule 1 says ambiguity about whether something already satisfies a requirement resolves to no match.
2. The agent implements the retry path, and writes `Owner rule applied: Rule 1 — Ambiguity resolves to no match` in the PR body and in its comment on issue 412.
3. `/sdd:review` on that PR confirms the diff implements rather than reuses, so the citation holds, and the PR is approved.
4. A later PR cites Rule 3, which is `retired`. Review blocks it: `Owner rule misapplied: Rule 3 is retired (retired by Rule 6)`.
