# Skill Evaluations

Automated evaluation framework for the 15 SDD plugin skills.

## Tier Structure

| Tier | Skills | Threshold | Description |
|------|--------|-----------|-------------|
| 1 | plan, work, review, audit | **>80% required** | High-complexity, multi-agent skills |
| 2 | spec, check, discover, docs | Tracked | Medium-complexity analysis skills |
| 3 | adr, init, prime, list, status, organize, enrich | Tracked | Low-complexity, fast-executing skills |

## Eval Files

- `evals.json` - All 39 evals in a single file
- `tier1.json` - Tier 1 evals only (15 prompts)
- `tier2.json` - Tier 2 evals only (10 prompts)
- `tier3.json` - Tier 3 evals only (14 prompts)
- `pipeline/` - Cross-skill end-to-end scenarios (release-only, see [`pipeline/README.md`](pipeline/README.md))
- `triggers/` - Per-skill trigger eval sets for description optimization via `run_loop.py` (see [`triggers/README.md`](triggers/README.md))
- `benchmarks/` - Persisted benchmark results on merge

## Running Evals Locally

Run a single skill eval with `claude -p`:

```bash
# Run a specific eval prompt
claude -p "Create a spec for a webhook-delivery service..."

# Run all evals for a skill using the eval file
cat evals/tier3.json | jq '.evals[] | select(.skill == "adr") | .prompt' -r | while read prompt; do
  echo "=== Running: $prompt ==="
  claude -p "$prompt"
done
```

## CI Integration

The `skill-evals.yml` workflow triggers automatically on PRs that modify:
- `skills/**` - Skill definitions
- `references/**` - Shared reference documents
- `evals/**` - Eval definitions

### Modes

- **Quick mode** (default): Runs Tier 3 evals + evals for changed skills
- **Full mode**: Runs all 39 evals across all tiers
- **Pipeline mode**: Runs the cross-skill end-to-end scenarios from `pipeline/` _in addition to_ the Tier 3 baseline (so a manual pipeline run still gets baseline regression signal)

Full mode activates when:
- PR has the `full-eval` label
- Manual workflow dispatch with `mode: full`
- PR targets a `release/*` branch

Pipeline-mode scenarios run when:
- Manual workflow dispatch with `mode: pipeline` (Tier 3 + pipeline)
- PR targets a `release/*` branch (full mode + pipeline together)

### Manual Trigger

Go to Actions > Skill Evaluations > Run workflow, and select `quick`, `full`, or `pipeline`.

## Adding Evals for a New Skill

1. Add eval entries to `evals/evals.json` with unique IDs:
   - Tier 1 IDs: 1-99
   - Tier 2 IDs: 100-199
   - Tier 3 IDs: 200-299

2. Add to the appropriate tier file (`tier1.json`, `tier2.json`, or `tier3.json`)

3. Each eval needs:
   - `id` - Unique numeric ID
   - `skill` - Skill name (must match `skills/{name}/`)
   - `prompt` - The test prompt to send to the skill
   - `expected_output` - Human-readable description of expected behavior
   - `assertions` - Array of `{ text, type }` checks (types: structural, content, format, coverage)
   - `files` - Array of file paths the skill needs to read

4. Run the eval locally to verify before pushing
