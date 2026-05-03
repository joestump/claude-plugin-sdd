---
name: report-friction
description: File a feedback issue against the SDD plugin (joestump/claude-plugin-sdd) when an agent encounters significant friction with one of its skills — instructions that contradicted observed behavior, repeated tool failures, undocumented edge cases that burned tokens, or SKILL.md ambiguity that caused misinterpretation. Always prompts the user with the full proposed issue body before submitting. Use when an agent has just completed a workflow that involved real churn caused by the SDD plugin itself, not by the user's task.
allowed-tools: Bash, Read, Write, Edit, Grep, AskUserQuestion
argument-hint: [skill-name] [--label bug|documentation|enhancement|usability] [--from-file <path>]
---

<!-- Governing: ADR-0015 (Markdown-Native Configuration) -->

# Report Friction with the SDD Plugin

This is a meta-skill: when an SDD plugin skill burns time, breaks, or guides you wrong, you can use this to file a feedback issue against the plugin's own repository (`joestump/claude-plugin-sdd`). The user always sees and approves the entire submission first.

## When to use this skill

This skill is for **significant** friction with the SDD plugin specifically — not minor wobbles, not the user's own code, not third-party tools. The threshold is real cost: tokens wasted, work duplicated, instructions that misled. Use it sparingly.

### Examples that QUALIFY (file an issue)

- A `/sdd:plan` invocation said "use the canonical Branch Naming pattern from references/shared-patterns.md", but that section described a slug algorithm that produced branch names rejected by the tracker. You had to manually fix every branch name.
- `/sdd:work` instructed you to broadcast `FILE_CLAIM` via `SendMessage`, but the agent harness rejected the call because no Team was active. The SKILL.md did not mention that Team initialization was a prerequisite. You spent ~8k tokens debugging.
- `/sdd:check` told you to scan for "the first `# ` heading" to extract titles, but four files in the corpus had a leading H1 in a comment block, causing wrong titles in every report. SKILL.md should specify "first H1 outside frontmatter and outside HTML/comment blocks."
- The same skill failed three times in a row with the same error message. The error came from the skill's own logic, not from the user's environment.

### Examples that DO NOT qualify (don't file)

- A single tool returned an unexpected error and you adapted easily — that's normal operation.
- The user's environment was missing a CLI the skill assumed (e.g., `gh`). That belongs in the user's setup, not as a plugin issue, *unless* the SKILL.md should have done a preflight check and didn't.
- You disagreed with a SKILL.md design choice but it worked correctly. Use `/sdd:adr` to propose a change instead.
- You hit a one-off race condition that you couldn't reproduce. File only if you can describe the trigger.
- The user explicitly asked you to do something the skill warned against, and friction resulted from that. That's the user's call to make, not a plugin bug.

## Process

### Step 1: Preflight — verify gh CLI is available and authenticated

Run these checks in order. If any fails, stop and report the specific remediation.

1. `command -v gh >/dev/null 2>&1` — if missing, output: "The `gh` CLI is not installed. Install from https://cli.github.com/ and re-run." Stop.
2. `gh auth status 2>&1` — if not authenticated, output: "`gh` is not authenticated. Run `gh auth login` and re-run." Stop.
3. Verify network access to the SDD repo: `gh repo view joestump/claude-plugin-sdd --json name >/dev/null 2>&1`. If this fails, the user lacks read access to the repo OR the network is down. Output: "Cannot reach `joestump/claude-plugin-sdd` via gh. Check network and that your GitHub account can read the repo." Stop.

### Step 2: Self-evaluate against the qualification threshold

Before drafting, evaluate the friction against the "When to use this skill" criteria above. If it does not clearly qualify, output a one-line note ("Friction did not meet the report threshold — proceeding without filing.") and stop. The threshold is intentionally high; over-filing dilutes signal in the issue tracker.

A useful self-check: "If the maintainer reads this and asks 'why did the agent file this?', is the answer obviously a plugin defect, not a user error or a one-off?"

### Step 3: Draft the issue body using the canonical template

```markdown
## Friction summary
{One sentence naming what burned time. Lead with the affected skill: "/sdd:plan ..."}

## Affected
- **Skill**: `/sdd:{name}` (or `references/{file}.md` if the friction was in a shared reference)
- **Plugin version**: {from .claude-plugin/plugin.json — the symlinked cache lets you read this; otherwise cite the version visible in the plugin install path}
- **Triggering action**: {what the user / agent was trying to accomplish in plain language}

## What the SKILL.md said vs. what happened
**Said**: {quote or paraphrase the relevant passage from the SKILL.md, including step number}

**Happened**: {what observably went wrong — error messages, wrong output, dead-end branches}

## Reproduction context
{Minimum facts to reproduce: file paths involved, command issued, repository state if relevant. Keep this scoped — entire diffs and full transcripts go elsewhere.}

## Workaround used (if any)
{What the agent did to make progress despite the friction. Helps the maintainer understand the cost: a clean workaround is cheaper than a dead-end retry.}

## Estimated cost
- **Tokens**: ~{rough estimate, e.g., 5k} burned on recovery work
- **Severity**: {agent's own estimate: low | medium | high}

## Suggested fix
{Optional. If the agent has a concrete idea — "the SKILL.md should add a preflight check for X" or "the algorithm in step 3 should anchor on the H1 instead of file top" — surface it. Otherwise, omit this section.}
```

Fill every section that applies. Omit "Suggested fix" if you don't have one. Don't pad.

### Step 4: Determine labels

Two labels go on every issue this skill files:

1. **`skill-friction`** — auto-applied to every issue. Lets the maintainer filter all friction reports cleanly.
2. **One of**: `bug` / `documentation` / `enhancement` / `usability`. Pick based on what you observed:
   - `bug` — SKILL.md instructions produced wrong behavior (the skill is broken)
   - `documentation` — SKILL.md was correct but ambiguous, missing context, or contradictory (the skill works if you guess right)
   - `enhancement` — the skill was missing a capability you needed (the skill is incomplete)
   - `usability` — the skill worked correctly but burned tokens unnecessarily (the skill is inefficient)

If `$ARGUMENTS` contains `--label <name>`, use that as the second label and skip the auto-classification.

### Step 5: Sanitization scan and redaction

Before showing the draft to the user, scan the body for sensitive content, **replace each match with a clear placeholder**, and keep a record of every redaction. The user sees the sanitized body (which is what will be submitted) plus an explicit "what was redacted" list — so they know both what's leaving the machine and what was changed.

Patterns to detect and the placeholder format:

| Pattern | Example match | Replacement placeholder |
|---------|---------------|------------------------|
| Absolute paths under `/Users/`, `/home/`, `/var/`, `/opt/`, `C:\Users\` | `/home/joestump/src/secret-project/handler.go:142` | `[REDACTED-PATH]/handler.go:142` (preserve trailing filename if present, since basenames are usually safe and aid reproduction) |
| URLs containing `internal`, `corp`, `staging`, `dev.`, `.local`, or non-public TLDs | `https://internal.acme.com/api/users` | `[REDACTED-URL]` |
| Credential-shaped strings: `[A-Za-z0-9_/+=-]{32,}` near keywords (`token`, `key`, `secret`, `password`, `bearer`, `Authorization`) | `Bearer abc123def456ghi789jkl012mno345pqr` | `Bearer [REDACTED-CREDENTIAL]` |
| Email addresses on non-public domains (skip `@gmail.com`, `@github.com`, etc.) | `someone@acme.com` | `[REDACTED-EMAIL]` |
| IP addresses (private and public) | `10.0.0.5`, `203.0.113.42` | `[REDACTED-IP]` |

After scanning, you have:
1. A **sanitized body** — the version that will actually be submitted. All placeholders in place, structure preserved.
2. A **redaction log** — a short list naming what was redacted and where, e.g.:
   - `Line 12: 1 absolute path → [REDACTED-PATH]`
   - `Line 18: 1 internal URL → [REDACTED-URL]`
   - `Line 24: 1 credential-shaped string → [REDACTED-CREDENTIAL]`

When you present the prompt to the user (Step 7), show:
- The **sanitized body in full** (this is the actual submission)
- The redaction log above or below it, clearly labelled "I sanitized N items before showing you this draft"
- An explicit option for the user to choose "edit then submit" if they want to put any redacted content back (the original values are NOT cached — by design, redaction is destructive in this skill; the user can re-add specific values if they decide a particular path or URL was actually safe to share)

This balances two goals: sensitive content does not leak even by inattention, AND the user has full visibility into what's leaving the machine. False positives are acceptable; the user can always edit to put something back.

### Step 6: Duplicate search

Run a search against the SDD repo's existing issues:

```bash
gh issue list --repo joestump/claude-plugin-sdd --state all \
  --search "{first 4-6 distinctive words from the friction summary}" \
  --json number,title,state,url --limit 5
```

Surface the top 3 results to the user. If a near-match exists (semantic match on title or summary), include "comment on existing" as a prompt option (Step 7).

### Step 7: User prompt — show the entire submission

Use `AskUserQuestion` with the full proposed issue rendered inline. The question text MUST include the *complete* body (not a summary), the labels that will be applied, and any sanitization warnings. Options:

1. **Submit as drafted (Recommended once reviewed)** — proceeds to Step 8 with the body exactly as shown
2. **Edit then submit** — write the body to `/tmp/sdd-friction-{timestamp}.md`, output the path and instruction "Edit this file, then re-run `/sdd:report-friction --from-file /tmp/sdd-friction-{timestamp}.md`". Stop.
3. **Comment on existing issue #{N}** (only when duplicate search surfaced a match) — proceeds to Step 8 with `--comment-on {N}` instead of opening a new issue
4. **Skip filing** — output "Friction noted but not filed per user choice." Stop.

Show the prompt with this layout:

```
## Proposed issue submission

**Repository**: joestump/claude-plugin-sdd
**Labels**: skill-friction, {second-label}

### Sanitization
I sanitized {N} items before drafting the body shown below:
- Line {X}: {kind} → {placeholder}
- Line {Y}: {kind} → {placeholder}
{If N=0, write "Nothing flagged for sanitization." instead of the bullet list.}

### Duplicate search
{Top duplicates found, with URLs. Or "No similar issues found." if zero matches.}

---

{Full sanitized body — exactly what will be submitted}

---

How do you want to proceed?
```

The user MUST see the entire sanitized body — not a summary. The body shown IS the body submitted (modulo "edit then submit" path).

### Step 8: Execute the chosen action

#### Submit a new issue

```bash
gh issue create \
  --repo joestump/claude-plugin-sdd \
  --title "{first line of the friction summary, capped at ~80 chars}" \
  --body-file /tmp/sdd-friction-{timestamp}.md \
  --label skill-friction \
  --label {second-label}
```

Capture the URL of the created issue from gh's output. Report it to the user.

#### Comment on existing issue

```bash
gh issue comment {N} \
  --repo joestump/claude-plugin-sdd \
  --body-file /tmp/sdd-friction-{timestamp}.md
```

Capture the comment URL from gh's output. Report it to the user.

### Step 9: Throttle marker

Write a marker file to `/tmp/sdd-friction-filed-{session-id}` so a second invocation in the same session can detect the prior filing. On second invocation, warn: "You already filed an issue this session ({prior URL}). File another only if it's a distinctly different friction." Then proceed if the user confirms.

Do NOT use this throttle to refuse — the user always wins.

### Step 10: Final report

```
## Friction Report Filed

{New issue created OR Comment added to existing issue}

- **URL**: {gh's returned URL}
- **Labels**: skill-friction, {second-label}
- **Repo**: joestump/claude-plugin-sdd

The maintainer (Joe Stump) will see this in his issue tracker. No further action needed unless he replies asking for clarification.
```

## Output Templates

### After successful filing (new issue)

(See Step 10 above.)

### After "edit then submit" (mid-flow)

```
## Issue Body Saved for Editing

Wrote the proposed body to `/tmp/sdd-friction-{timestamp}.md`.

Edit it, then re-run:
`/sdd:report-friction --from-file /tmp/sdd-friction-{timestamp}.md`

Or, if you decide not to file after editing, just delete the file.
```

### After "skip filing"

```
## Friction Noted, Not Filed

The friction with `/sdd:{skill-name}` was real but you chose not to file. Nothing was submitted to joestump/claude-plugin-sdd.

If you change your mind later, you can re-run `/sdd:report-friction` (the threshold check will re-evaluate; you may need to re-supply context if a fresh session has lost it).
```

## Rules

- MUST always target `joestump/claude-plugin-sdd` regardless of the cwd's git remote — this skill files against the SDD plugin's own repo, NOT against the user's project. Use `--repo joestump/claude-plugin-sdd` on every `gh` invocation.
- MUST prompt the user with the **complete** proposed body via `AskUserQuestion` before submitting — the user is the final approver. No silent submissions ever.
- MUST run the qualification threshold check (Step 2) before drafting. The threshold is intentionally high; over-filing dilutes signal.
- MUST run the sanitization scan (Step 5) before showing the draft. Replace each match with a clear placeholder (`[REDACTED-PATH]`, `[REDACTED-URL]`, `[REDACTED-CREDENTIAL]`, `[REDACTED-EMAIL]`, `[REDACTED-IP]`) AND surface a "what was redacted" log above the body so the user knows both what is leaving the machine and what was changed. The displayed body is the submitted body — no surprise content gets added or subtracted between display and submission.
- MUST run the duplicate search (Step 6) every time. Cite duplicates in the prompt; offer "comment on existing" as an option when a near-match is found.
- MUST auto-apply the `skill-friction` label to every issue, plus exactly one of {`bug`, `documentation`, `enhancement`, `usability`}.
- MUST capture and surface the issue/comment URL after submission so the user can navigate to it.
- MUST verify `gh` is installed and authenticated before drafting (Step 1) — silent failures during submission are confusing.
- MUST NOT file an issue if the friction was caused by the user's environment, the user's code, the user's misuse of a skill, or a third-party tool. The threshold is "is this a plugin defect?".
- MUST NOT include sensitive content (credentials, internal URLs, full file paths beyond what's necessary) without surfacing it as a sanitization warning first.
- SHOULD respect the per-session throttle (Step 9) — warn before filing a second issue in the same session, but proceed if the user confirms.
- The skill is FOR agents to use against themselves (the SDD plugin), not a general "file a bug" tool — keep the surface narrow.
