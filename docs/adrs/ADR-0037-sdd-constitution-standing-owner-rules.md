---
status: proposed
date: 2026-10-21
decision-makers: undecided — proposed by an implementation run on issue #273
related: [ADR-0003, ADR-0015, ADR-0020, ADR-0028]
---

# ADR-0037: SDD Constitution — Standing Owner Rules Applied Automatically

## Context and Problem Statement

ADRs record decisions already made about a design. Specs record requirements. Neither holds the short, ordered list of default answers an owner wishes an agent had before it stopped to ask: "when unsure whether something matches, treat it as no match", "main's design wins in a conflict", "never widen a permission without asking".

Issue #273 reports that teams running SDD unattended close this gap by hand: a `docs/owner-decision-rules.md` page in their repo, project-specific paragraphs pasted into their worker and reviewer prompts, a convention for quoting a rule in the PR, and a separate watcher that posts those quotes to Slack. Roughly half the human stops in one release were applications of such a rule. The pattern works and is not in the plugin, so every project rediscovers it, and the wiring rots the first time a skill's wording changes upstream.

The friction is not that agents ask too much in general. It is that a decision the owner already made is re-asked per ticket, and that the answer an agent reaches by asking is not written down anywhere the next ticket can find.

## Decision Drivers

* **Unattended runs are the product** — ADR-0028 exists because the loop is the point. Every standing stop is a budget stop waiting to happen.
* **Markdown-native config** — ADR-0015 settled that plugin behavior is configured in the project memory file, not a JSON file or an environment variable. A rules file that needs a parser and a schema would be the plugin's first exception.
* **Decide-then-specify discipline** — ADR-0003 fixed artifact formats, ADR-0023 the graph edge schema, ADR-0036 the PRD. A fifth authored file type lands the same way or not at all.
* **Auditability** — an applied rule has to be visible in the PR, or the constitution is a rumor. This is the same reasoning behind governing comments (ADR-0020).
* **Reversibility** — a project with no constitution must see no change at all, including no new prompt, no new output line, and no new failure mode.

## Considered Options

* **Option A — Constitution as a fifth artifact type**: numbered rules in `docs/constitution.md`, read by the skills that stop today, cited in the PR, checked against ADRs and specs by `/sdd:check`.
* **Option B — More ADRs**: tell owners to file an ADR per standing rule and have `/sdd:prime` surface them.
* **Option C — Config keys in the project memory file**: a `#### Standing Rules` list under `### SDD Configuration`, since config resolution already exists.
* **Option D — A skill that asks once and caches**: an interactive "remember this decision" prompt that writes the answer somewhere for later runs.

## Decision Outcome

Chosen: **Option A**, plus the citation and review rules that make it enforceable.

- **One file, plain markdown, data-only.** `docs/constitution.md`, overridable via `### SDD Configuration` → `#### Constitution` → `**Path**` per ADR-0015. Numbered rules under `## Rules`, each with a `Decision`, an optional `Governs` pointer to the ADR or spec requirement behind it, and an optional `Applies to` list; plus an optional `## Always ask the owner` list. Format in `references/constitution.md`.
- **Rules are decisions, never procedures.** The file carries no executable instruction to the agent. A rules file that can contain instructions is a privilege-escalation surface: whoever can send a pull request that touches it can then write instructions into every unattended run in the project. Data-only is a security boundary, not a style preference.
- **Applied instead of stopping, never instead of asking.** A skill consults the constitution at the point where it would otherwise stop, and only there. A rule matches only when its decision answers that exact question. Anything under `## Always ask the owner` stops regardless of what a rule seems to cover.
- **Cited in the artifacts.** `Owner rule applied: Rule N — {title}` in the PR body under `### Owner Rules Applied`, and in the tracker comment for the same work item. No citation for a rule merely read.
- **Misapplication blocks.** `/sdd:review` verifies each citation against the diff and treats a wrong, nonexistent, or retired citation as a blocking finding, citing the underlying ADR or spec where the rule carries one.
- **Absence is silent.** No file, no mention, no prompt, no output line. A file that does not parse is reported once and ignored.
- **`/sdd:check` flags a rule that contradicts its own `Governs` pointer** as `[CRITICAL]`, and dangling or deprecated pointers as `[WARNING]`.
- **`/sdd:status` reports which rules cite the artifact being changed**, and warns when a status change orphans a live rule. It does not count citations: those live in tracker PR bodies, which a local run cannot read. A project wanting a tally greps its own tracker for the stable citation line.

## Pros and Cons of the Options

### Option A — Constitution as a fifth artifact type

- (+) One canonical place; nothing outside the repo has to stay in sync.
- (+) Machine-checkable format with a human-readable file; the lint and `/sdd:check` can disagree with a stale rule.
- (+) The citation line gives the audit trail the reporter was building by hand, in the artifact reviewers already read.
(−) A fifth authored file type to document, validate, and keep out of the way of projects that never use it.
(−) Rule text is prose, so "does this rule match" stays a judgement — which is why misapplication is a review finding rather than a lint error.

### Option B — More ADRs

- (+) No new artifact type; the graph already knows ADRs.
(−) An ADR is a narrative about one design choice, with context and consequences. A standing default answer has no such story, and burying fifteen of them across ADRs reproduces the corpus-wide search the reporter is trying to avoid.

### Option C — Config keys in the project memory file

- (+) Reuses Config Resolution; zero new files.
(−) The project memory file is loaded into every session by the harness. Standing rules there would be prompt content the plugin cannot validate, cite per-application, or keep out of a review finding, and would grow the file every project is forced to read.

### Option D — Ask once and cache

- (+) Zero format to learn.
(−) The owner's answer gets written by an agent, unreviewed, into a file nobody owns. It also does nothing for the first ticket, which is where the stop happened.

## More Information

Wiring lives in `references/constitution.md` (format, citation, findings) and `references/shared-patterns.md` § "Constitution Resolution" (lookup). `/sdd:work` and `/sdd:respond` apply; `/sdd:review` verifies; `/sdd:check` detects contradiction; `/sdd:status` reports what cites an artifact. `/sdd:plan` deliberately does not consult it: planning sizes and sequences work rather than deciding ambiguous scope, and adding a rules read there would change sprint output for no reported need.
