# Trigger Eval Sets

Per-skill query corpora for optimizing each `SKILL.md`'s `description` field via skill-creator's `run_loop.py`.

Governing: [ADR-0021](../../docs/adrs/ADR-0021-skill-evaluation-and-ci-testing.md), SPEC-0017 REQ "Description Optimization".

## What this is for

Each skill's `SKILL.md` frontmatter has a `description` field that determines whether Claude triggers the skill in response to a user prompt. A vague or noisy description means Claude either over-triggers (firing the skill on near-misses) or under-triggers (missing the cases the skill exists to handle).

`run_loop.py` (from the skill-creator skill) iteratively rewrites the description against a graded corpus of trigger queries until it maximizes the trigger-rate for cases that *should* fire and minimizes it for cases that *should not*. This directory holds the corpora.

## Per-skill file format

Each skill has a JSON file at `evals/triggers/{skill_name}.json`:

```json
[
  {"query": "Plan SPEC-0015 into stories for joestump/joe-links", "should_trigger": true},
  {"query": "Plan a vacation to Barcelona", "should_trigger": false}
]
```

Per SPEC-0017 each file contains **20 queries: 10 with `should_trigger: true` and 10 with `should_trigger: false`**. The 10/10 balance lets `run_loop.py` compute precision and recall against a stratified train/test split.

## Authoring guidelines

**Should-trigger (positive) queries** — vary the surface form to cover what real users would type:
- Direct slash invocation: `"/sdd:plan SPEC-0015"`
- Natural language: `"break SPEC-0015 into trackable issues"`
- Indirect / inferred intent: `"now that the spec is approved, what's next?"`
- With workflow context: `"create the GitHub issues for the auth work"`
- Multi-artifact: `"plan SPEC-0014 and SPEC-0015"`
- Constraint-bearing: `"plan SPEC-0015 but only foundation stories"`

Avoid 10 paraphrases of the same sentence — variation is the whole point.

**Should-NOT-trigger (adversarial) queries** — pick near-misses, not random off-topic prompts. The optimizer learns most from queries that *look* like the skill's domain but aren't:
- Same keyword, different meaning: `"plan a vacation to Spain"` (`/sdd:plan` only)
- Adjacent SDD skill territory: `"create an ADR for using Redis"` (should fire `/sdd:adr`, not `/sdd:plan`)
- Read-only when the skill writes: `"what does ADR-0012 say?"` (should fire `/sdd:list` or nothing, not `/sdd:adr`)
- Meta-questions about the skill: `"what does /sdd:plan do?"` (asking *about* the skill is not invoking it)
- Tooling questions: `"how do I configure GitHub issue templates?"` (Q&A, not a skill task)
- Generic vocabulary collisions: `"address bar broken in browser"` (collides with ADR / "addr")

A purely off-topic query like `"what's the weather?"` is fine to include 1–2 of but doesn't teach the optimizer much.

## Running optimization for one skill

```bash
# From the plugin root, with the skill-creator marketplace skill installed:
SKILL=plan
python3 ~/.claude/plugins/marketplaces/anthropic-agent-skills/skills/skill-creator/scripts/run_loop.py \
  --eval-set evals/triggers/${SKILL}.json \
  --skill-path skills/${SKILL} \
  --num-workers 5 \
  --max-iterations 5 \
  --runs-per-query 3 \
  --trigger-threshold 0.5 \
  --holdout 0.3 \
  --model claude-sonnet-4-6
```

### Picking `--model`

`run_loop.py`'s `--model` flag controls which model the trigger-test runs use, which in turn determines whose decision boundary the optimizer is tuning against. **Choose the model your team actually runs in their Claude Code sessions** — typically Sonnet 4.6 (the default).

If you optimize against Haiku and your team runs Sonnet, the resulting `best_description` is locally optimal on Haiku and may behave differently in real sessions. Two reasonable strategies:

- **Single model (recommended):** run optimization with the same model your team uses day-to-day. Sonnet 4.6 is the right default for most users.
- **Two-pass:** iterate quickly on the corpus with `claude-haiku-4-5` (cheaper, faster), then do the final commit-worthy pass with the production model.

`run_loop.py` writes a `best_description` to stdout (and an HTML report to a temp dir). **Do not auto-commit the result** — per SPEC-0017 REQ "Description Optimization", the before/after must be reviewed by a human before updating `SKILL.md`.

## Running optimization for all skills (manual, expensive)

This is PR 3 territory, not PR 2. Authoring lives here; the actual runs spend real API budget per query × per iteration × per skill, and each result needs human eyes before commit.

## Files

| Skill    | Tier | File |
|----------|------|------|
| audit    | 1    | [`audit.json`](audit.json) |
| plan     | 1    | [`plan.json`](plan.json) |
| review   | 1    | [`review.json`](review.json) |
| work     | 1    | [`work.json`](work.json) |
| check    | 2    | [`check.json`](check.json) |
| discover | 2    | [`discover.json`](discover.json) |
| docs     | 2    | [`docs.json`](docs.json) |
| spec     | 2    | [`spec.json`](spec.json) |
| adr      | 3    | [`adr.json`](adr.json) |
| enrich   | 3    | [`enrich.json`](enrich.json) |
| init     | 3    | [`init.json`](init.json) |
| list     | 3    | [`list.json`](list.json) |
| organize | 3    | [`organize.json`](organize.json) |
| prime    | 3    | [`prime.json`](prime.json) |
| status   | 3    | [`status.json`](status.json) |

Total: **300 trigger queries** (150 should-trigger, 150 should-NOT-trigger), 20 per skill in a balanced 10/10 split.
