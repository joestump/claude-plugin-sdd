---
name: triage
description: Triage and size tracker issues — give every open issue a verdict (OK, STALE, SUPERSEDED, DUP, BLOCKED, HUMAN, BOT), close the ones that are no longer real only on evidence from the code on main, and apply exactly one size/S|M|L|XL label measured as "the weakest model that can carry this end to end". Use when the user says "triage the backlog", "size these issues", "groom the issues", "which of these issues are stale", "close what's already done", or before planning work from an existing backlog. Also the canonical definition of the size ladder that /sdd:plan, /sdd:organize and /sdd:enrich apply.
allowed-tools: Read, Glob, Grep, Bash, ToolSearch, AskUserQuestion
argument-hint: "[SPEC-XXXX | #N | --all] [--dry-run] [--size-only] [--module <name>]"
---

<!-- Governing: ADR-0015 (Markdown-Native Configuration), SPEC-0014 REQ "Config Resolution Pattern" -->

# Triage and Size Issues

> **Harness portability.** This skill runs on any agent harness that loads Agent Skills — Claude Code, Codex CLI, OpenCode, Crush. Tool names used below (`AskUserQuestion`, `Task`, `TeamCreate`, `SendMessage`, `TaskCreate`, `ToolSearch`, `mcp__*`, `${CLAUDE_PLUGIN_ROOT}`) denote *capabilities*, not hard requirements: map each to your harness's equivalent or use the documented fallback per `${CLAUDE_PLUGIN_ROOT}/references/harness-compat.md`. References to `CLAUDE.md` mean the project memory file (`CLAUDE.md`, `AGENTS.md`, or `CRUSH.md`) per harness-compat § "Project Memory File". A citation of the form `shared-patterns.md § "Section"` names one `##` heading in that file — load only that section (see its "How to Read This File" note), never the whole file.

You are deciding, for each open issue, **whether it is still real** and, if it is, **how big it is**. The two questions are asked in that order: sizing is worthless on an issue that should be closed.

This file is also the canonical definition of the `size/*` ladder. `/sdd:plan`, `/sdd:organize` and `/sdd:enrich` apply it when they create or touch issues; they cite § "The size ladder" rather than restating it.

## The size ladder

Every open issue carries **exactly one** `size/*` label. It answers one question: *what is the weakest model that can take this issue and carry it end to end* — read it, find the code, make the change, write the tests, and not get lost.

| Label | Default anchor model | What lands here |
|---|---|---|
| `size/S` | an older Haiku | Mechanical and localized. Docs, config, a rename, a dependency bump, a one-line fix whose location the issue already names. No design judgment, no cross-file reasoning. |
| `size/M` | Opus 4.6 Max | One subsystem, a handful of files. The design is already decided in the issue or an existing spec; the work is implementing and testing it. Bug fixes needing real diagnosis but in a bounded area. |
| `size/L` | Sonnet 5 | Spans subsystems, or introduces a new component inside an established architecture. Design choices within stated constraints, schema/state migrations, concurrency or protocol work, substantial test surface. |
| `size/XL` | Opus 5 / Fable 5 | Epics. Cross-repo or cross-service work. New architecture, protocol, or security model. Anything that needs an ADR or spec written first. Anything whose problem statement is still ambiguous and needs investigation before implementation. |

The anchors are a default. A project MAY replace them — models move faster than backlogs — via `#### Sizing` in its SDD configuration (see § "Configuration"). The bucket descriptions in the third column are the stable part; the anchor is a calibration point for them.

### Tie-breakers, in order

1. An `epic` label means `size/XL` **unless** it is a thin tracking wrapper over children that are all `size/S` — then size it like its children.
2. A long "Requirements" checklist pushes an issue up a bucket.
3. Security-critical work, credential handling, and data migrations push up a bucket.
4. A well-written issue that names exact files and line numbers pulls *down* a bucket — the work is smaller when the search is already done.

### One scale only

Do not run `size/*` alongside a second capability or effort scale — `model/haiku`, `sonnet-ready`, t-shirt sizes, story points in labels, and friends. Two scales that disagree are worse than no scale, because nobody knows which one is current. When you meet a second scale, fold it into `size/*` and remove the old labels (on a project that has not asked to keep them, ask first via `AskUserQuestion`).

## Verdicts — is it still real?

Give every issue a verdict before you give it a size:

| Verdict | Meaning | Action |
|---|---|---|
| `OK` | Valid and actionable as written | Size it, leave it open |
| `STALE` | The work is already done | Close, with the evidence |
| `SUPERSEDED` | A design change made this issue describe something the project deliberately did *not* build | Close, or rewrite it against the current design |
| `DUP` | Another issue covers it | Close, naming the survivor |
| `BLOCKED` | Real, but hard-gated on another issue | Leave open, name the blocker |
| `HUMAN` | No model can do it — physical access, a browser-only vendor signup, a personal decision, contacting someone | Leave open, flag it for a human |
| `BOT` | Renovate Dependency Dashboards and similar | **Never size, never close.** They are bot-managed and re-open themselves. |

`BLOCKED` and `HUMAN` issues still get a size — the blocker and the human only gate *when* the work starts, not how big it is.

## Verify before you close — the rule that matters

**A merged PR saying `Closes #N` is not evidence that #N is fixed.** Neither is an issue's age, and neither is a PR title that sounds right. The only evidence that work is done is **the current state of the code on `main`** (or the project's default branch). Go read it.

This is not hypothetical. In one backlog triage, of the issues a merged PR claimed to close, two were untouched: in one, the exact wrong comment the issue quoted was still in both files it named; in the other, the reported bug ("tagging produces no release assets") still reproduced on the newest release. Both would have been wrongly closed on the PR reference alone.

Conversely, issues go stale **silently**: a PR that fixes the thing without a closing keyword leaves the issue open forever. In another backlog, eight issues had been fixed that way and were still open. So the check runs in both directions — never trust the tracker's own bookkeeping in either.

**Age is a prompt to look, never a reason to close.** A backlog filed in one planning session is uniformly old and uniformly valid; a two-week-old issue in a fast-moving repo can already be obsolete. Close on evidence, not on a date. **If you cannot get evidence, leave it open and say why.**

What counts as evidence, strongest first:

- The file and line on `main` showing the behaviour the issue asked for (or the absence of the defect it reported).
- A reproduction of the reported bug that now passes — a test, a command, a build of the current release.
- For `SUPERSEDED`: the ADR or spec section that chose the other path.
- For `DUP`: the surviving issue, which you have read and confirmed covers this one.

## Closing well

- **Comment before every close, and make the comment carry the evidence** — the file and line, the PR number, the ADR or spec section — not just a verdict. The next person reading the closed issue should be able to check your work without redoing it.
- **Narrow a partly-done issue; do not close it.** Say what shipped, say what remains, and leave it open scoped to the remainder (re-size it for the remainder).
- **A stale dependency link can refuse the close.** Where a tracker records issue dependencies, closing an issue that is still marked as blocked can fail (Gitea, for one, returns `412`). Fix the wrong link rather than forcing past it — the link is wrong data, and forcing leaves it wrong.

## Configuration

Read the `### SDD Configuration` section per `${CLAUDE_PLUGIN_ROOT}/references/shared-patterns.md` § "Config Resolution". This skill reads the `#### Tracker` and `#### Sizing` subsections:

```markdown
#### Sizing
- **Enabled**: true
- **S**: an older Haiku
- **M**: Opus 4.6 Max
- **L**: Sonnet 5
- **XL**: Opus 5 / Fable 5
```

- `Enabled: false` turns off size labelling here and in `/sdd:plan`, `/sdd:organize` and `/sdd:enrich`. Verdicts still run.
- `S` / `M` / `L` / `XL` replace the default anchor models. Missing keys keep the defaults above.

## Process

0. **Resolve paths and config**: Follow `${CLAUDE_PLUGIN_ROOT}/references/shared-patterns.md` § "Artifact Path Resolution" (respecting `--module <name>`) and § "Config Resolution".

1. **Parse arguments** from `$ARGUMENTS`:
   - `SPEC-XXXX` or a capability name: triage the issues that reference that spec (per `shared-patterns.md` § "Issue Search by Spec").
   - `#N` (one or more): triage those issues only.
   - `--all`: triage every open issue in the repository.
   - `--dry-run`: report verdicts and sizes; change nothing. Default: off.
   - `--size-only`: skip verdicts and closing; only fix sizes. Use this only when the caller has already established the issues are live (for example, issues `/sdd:plan` just created).

   With no scope argument, ask via `AskUserQuestion` whether to triage a spec's issues, specific issues, or all open issues.

2. **Detect the tracker**: Follow `shared-patterns.md` § "Tracker Detection". Discover tracker tools at runtime with `ToolSearch`; never assume a specific MCP server exists. No tracker → error; triage requires one.

3. **Fetch the issues** with their bodies, labels, linked PRs and dependency links. On a large backlog, page through with a bounded limit and work from saved JSON rather than reading every body into context at once.

4. **Verdict each issue** (skip with `--size-only`). Classify `BOT` first — by author or title — and set those aside untouched. For every other issue, check the code on `main` against what the issue asks for, following § "Verify before you close". Record the evidence for each verdict as you go; a verdict without evidence is `OK` by default.

5. **Size every issue whose verdict leaves it open** using § "The size ladder" and its tie-breakers. Note which tie-breaker, if any, moved the bucket.

6. **Present the plan** before changing anything: a table of issue, verdict, size (current → proposed), and one line of evidence. With `--dry-run`, stop here. Otherwise confirm via `AskUserQuestion` — closes are the destructive half, so offer "apply all", "apply sizes only", or "review individually".

7. **Apply**:
   - **Labels**: set exactly one `size/*` label per open issue using the try-then-create pattern (`shared-patterns.md` § "Try-Then-Create Label Pattern"). Remove any other `size/*` label and any retired second-scale label in the same pass.
   - **Closes** (`STALE`, `SUPERSEDED`, `DUP`): post the evidence comment first, then close, per § "Closing well". If the tracker refuses the close over a dependency link, fix the link and retry; report it.
   - **Narrowing**: rewrite partly-done issues to their remainder and comment what shipped.
   - **BLOCKED / HUMAN**: comment naming the blocker, or what a human must do. Do not close.

8. **Report**: counts per verdict, every close with its evidence link, every narrowed issue, every issue left open for lack of evidence and why, and every issue flagged `HUMAN`.

## Rules

- MUST give each issue a verdict before sizing it (unless `--size-only`)
- MUST leave exactly one `size/*` label on every open, non-`BOT` issue — never zero, never two
- MUST NOT size or close `BOT` issues
- MUST NOT close an issue on a PR's closing keyword, a PR title, or the issue's age — only on evidence from the current code on the default branch
- MUST check for silently-stale issues (fixed without a closing keyword), not only for falsely-closed ones
- MUST leave an issue open, with a comment saying why, when evidence cannot be obtained
- MUST post an evidence-bearing comment before every close
- MUST narrow partly-done issues instead of closing them
- MUST fix a stale dependency link rather than forcing a close past it
- MUST NOT run a second capability scale alongside `size/*`
- MUST confirm with the user before closing issues, unless they have already said to apply
- MUST use the try-then-create pattern for label applications
- MUST use `ToolSearch` to discover tracker tools at runtime
