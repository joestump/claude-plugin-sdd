# Pipeline Eval Scenarios

End-to-end test scenarios that invoke multiple skills in sequence against a disposable test repository.

Governing: [ADR-0021](../../docs/adrs/ADR-0021-skill-evaluation-and-ci-testing.md), SPEC-0017 REQ "Cross-Skill Pipeline Testing".

## What this is for

The standard evals in `evals/evals.json` test each skill in isolation: one prompt, one skill, one set of assertions. That doesn't catch regressions in the *handoff* between skills — a `/sdd:plan` issue body that `/sdd:work` can't parse, a worktree branch that `/sdd:review` can't open a PR against, a spec format that `/sdd:plan` reads differently than `/sdd:spec` writes.

Pipeline scenarios run a sequence (spec → plan → work → review) on a disposable repo and verify that the artifacts each skill produces are consumable by the next.

## When these run

Pipeline tests are **not** part of the per-PR eval suite — each scenario takes minutes and consumes meaningful API budget. They run only when:

- A PR targets a `release/*` branch (release-gate)
- Someone manually triggers the workflow via `Actions → Skill Evaluations → Run workflow` and selects pipeline mode
- A maintainer runs the scenario locally for debugging (see "Running locally" below)

## Scenario file format

Each scenario is a JSON file in this directory. Schema:

```json
{
  "id": "core-workflow",
  "description": "Human-readable summary of what this scenario covers",
  "cost_class": "low",
  "setup": {
    "repo_strategy": "local-tmp-init",
    "seed": {
      "claude_md": "<contents of CLAUDE.md to seed the disposable repo with>",
      "files": []
    }
  },
  "steps": [
    {
      "step": 1,
      "skill": "spec",
      "prompt": "<prompt to send when invoking the skill>",
      "verify": [
        "<assertion>",
        "..."
      ]
    }
  ],
  "final_assertions": [
    "<cross-step assertion verifying artifact handoff>"
  ]
}
```

Field reference:

- `id` — kebab-case identifier, must match the filename stem
- `description` — short human-readable purpose
- `cost_class` — `"low"` (default; local-tmp scenarios, no real API calls beyond Claude) or `"high"` (scenarios that create real GitHub repos/PRs and run reviewer-responder pairs). The `report` job surfaces a cost notice for `"high"` scenarios.
- `setup.repo_strategy`:
  - `local-tmp-init` — `git init` in a temp dir; no GitHub interaction; preferred for skill-handoff testing
  - `gh-disposable` — creates a real private repo via `gh repo create --private joestump/sdd-eval-{scenario-id}-{run-id}`, seeds it with a local push, then deletes it in `final_assertions` cleanup. Required when a scenario needs real GitHub PRs (e.g., `/sdd:review`). No template repo is needed — the strategy seeds the repo from `setup.seed` directly.
- `setup.seed.claude_md` — content for the seed `CLAUDE.md`. For `local-tmp-init` scenarios, tracker config MUST select `tasks.md` fallback so the scenario doesn't pollute real issue trackers. For `gh-disposable` scenarios, tracker config points to the disposable repo itself.
- `setup.seed.files` — additional seed files (e.g., a starter ADR if the scenario needs one)
- `steps` — ordered skill invocations. Each step's `verify` list is checked before the next step runs
- `final_assertions` — cross-step checks verifying artifacts flowed correctly between skills; for `gh-disposable` scenarios, the cleanup `gh repo delete` runs here

## Setup

`gh-disposable` scenarios require a GitHub token with repo-delete scope. Set the `GH_JANITOR_TOKEN` secret in the repository settings (Settings → Secrets → Actions). The token needs: `repo` (full), `delete_repo`. The `eval-pipeline` job uses `GITHUB_TOKEN` for the scenario run itself and `GH_JANITOR_TOKEN` for the cleanup delete step.

## Running locally

```bash
# From the plugin root, with claude-code installed:
mkdir -p /tmp/sdd-pipeline-eval && cd /tmp/sdd-pipeline-eval
git init
# ...seed files per the scenario's setup section...
# ...invoke each skill via `claude -p "/sdd:<skill> <prompt>"`...
# Verify artifacts after each step.
# Clean up: rm -rf /tmp/sdd-pipeline-eval
```

The CI runner (`eval-pipeline` job in `skill-evals.yml`) automates all of the above using `claude-code-action`.

## Adding a new scenario

1. Pick a kebab-case `id` (e.g., `discover-then-spec`)
2. Create `evals/pipeline/{id}.json` matching the schema above
3. Set `cost_class` appropriately (`"low"` for local-tmp, `"high"` for gh-disposable)
4. For `local-tmp-init`: use `tasks.md` fallback in the seeded CLAUDE.md so the scenario doesn't depend on a tracker
5. For `gh-disposable`: include a `gh repo delete` cleanup step in `final_assertions`
6. Verify locally before pushing — pipeline tests are expensive in CI
7. Update this README's scenario list

## Current scenarios

| ID | Cost | Description |
|----|------|-------------|
| [`core-workflow`](core-workflow.json) | low | Spec → plan → work on a fresh local-tmp repo, verifying artifact flow at each handoff |
| [`full-chain-with-review`](full-chain-with-review.json) | high | Full spec → plan → work → review chain on a real disposable GitHub repo; exercises `/sdd:review` end-to-end |
