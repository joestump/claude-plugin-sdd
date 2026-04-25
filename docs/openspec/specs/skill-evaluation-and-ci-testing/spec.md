# SPEC-0017: Skill Evaluation and CI Testing

## Overview

A testing and evaluation framework for the SDD plugin's 15 skills, using skill-creator's eval infrastructure with GitHub Actions CI integration. Covers eval authoring, automated test runs, assertion-based grading, benchmark tracking, and cross-skill pipeline testing. See ADR-0021.

## Requirements

### Requirement: Eval Authoring

Every skill in `skills/*/SKILL.md` MUST have at least 2 test prompts defined in `evals/evals.json`. Each test prompt MUST include a realistic user message (the kind of thing a user would actually type), an `expected_output` description, and an `assertions` array with objectively verifiable checks. Test prompts MUST NOT be trivial one-liners — they SHOULD include context, file paths, and specifics that a real user would provide.

Skills MUST be grouped into tiers for test allocation:
- **Tier 1** (plan, work, review, audit): 3-4 test prompts each
- **Tier 2** (spec, check, discover, docs): 2-3 test prompts each
- **Tier 3** (adr, init, prime, list, status, organize, enrich): 2 test prompts each

#### Scenario: New skill added without evals

- **WHEN** a new skill is added to `skills/` and no corresponding entries exist in `evals/evals.json`
- **THEN** the CI workflow MUST fail with a message: "Skill '{name}' has no eval entries in evals/evals.json. Add at least 2 test prompts."

#### Scenario: Realistic test prompt quality

- **WHEN** an eval prompt is authored for `/sdd:plan`
- **THEN** the prompt includes a specific spec reference, mentions relevant flags, and provides enough context for the skill to operate (e.g., "Plan a sprint from SPEC-0014 for the claude-plugin-sdd repo on GitHub")

#### Scenario: Tier allocation respected

- **WHEN** `/sdd:plan` (Tier 1) has only 2 test prompts
- **THEN** CI SHOULD warn: "Tier 1 skill 'plan' has only 2 evals (minimum recommended: 3)"

### Requirement: Automated Test Runner

A GitHub Actions workflow MUST exist at `.github/workflows/skill-evals.yml` that runs skill evaluations automatically. The workflow MUST trigger on pull requests that modify `skills/**`, `references/**`, or `evals/**`. The workflow MUST use `claude-code-action` to invoke `run_eval.py` from the skill-creator plugin for each modified skill's test prompts.

The workflow MUST support two modes:
- **Quick mode** (default on PRs): Run only Tier 3 evals and evals for modified skills
- **Full mode** (triggered by `full-eval` label or on release branches): Run all tiers

Each eval run MUST execute both a **with-skill** run (skill loaded) and a **baseline** run (no skill) to measure the skill's value-add.

#### Scenario: PR modifying plan skill triggers evals

- **WHEN** a PR modifies `skills/plan/SKILL.md`
- **THEN** the CI workflow runs all eval prompts for the `plan` skill plus Tier 3 evals, in quick mode

#### Scenario: Full eval on release branch

- **WHEN** a PR targets the `release` branch or has the `full-eval` label
- **THEN** the CI workflow runs all eval prompts across all tiers

#### Scenario: No skill changes in PR

- **WHEN** a PR modifies only `docs/` or `README.md` (no skills or references changed)
- **THEN** the eval workflow does not run (skip)

### Requirement: Assertion-Based Grading

Each eval prompt MUST have at least 2 grading assertions in `evals/evals.json`. Assertions MUST be objectively verifiable — not subjective quality judgments. Assertions MUST use the `text`, `passed`, and `evidence` fields expected by the eval viewer.

Common assertion types for SDD plugin skills:
- **File existence**: "ADR file was created at docs/adrs/ADR-XXXX-*.md"
- **Content structure**: "Spec contains a ## Requirements section with at least one ### Requirement:"
- **Section presence**: "Security Requirements section present in web-facing spec"
- **Format compliance**: "YAML frontmatter contains status: proposed"
- **Reference correctness**: "Governing comment references the correct ADR number"
- **Tool usage**: "Skill used Glob to find existing artifacts before creating new ones"

Assertions that test content quality (e.g., "the ADR rationale is compelling") SHOULD be deferred to human review via the eval viewer, not automated.

#### Scenario: Grading a plan skill eval

- **WHEN** the grader evaluates a `/sdd:plan` test run
- **THEN** it checks assertions like: "Epic issue created with 'epic' label", "3-4 story issues created", "Each story has a ## Requirements section", "Branch naming conventions present in issue bodies"

#### Scenario: Assertion failure reported

- **WHEN** an assertion fails (e.g., "Security Requirements section present" but it's missing)
- **THEN** the grading output includes `passed: false` and `evidence: "No ## Security Requirements section found in generated spec.md"`

### Requirement: Benchmark Tracking

After grading, the workflow MUST run `aggregate_benchmark.py` to produce `benchmark.json` with pass rates, timing, and token usage per skill. Benchmark results MUST be posted as a PR comment showing:
- Per-skill pass rate (with delta from main branch if available)
- Mean execution time per skill
- Mean token usage per skill
- Any skills that dropped below the 80% pass rate threshold

Benchmark data MUST be committed to `evals/benchmarks/` on merge to main, enabling cross-release comparison.

#### Scenario: Benchmark posted on PR

- **WHEN** evals complete on a PR
- **THEN** a comment is posted with a summary table showing each skill's pass rate, timing, and token usage

#### Scenario: Pass rate regression detected

- **WHEN** a Tier 1 skill (plan, work, review, audit) drops below 80% pass rate
- **THEN** the CI check MUST fail with: "Tier 1 skill '{name}' pass rate is {N}% (threshold: 80%)"

#### Scenario: Benchmark history available

- **WHEN** a developer wants to see how skill performance has changed over releases
- **THEN** they can compare `evals/benchmarks/` across commits to see trends

### Requirement: Eval Viewer Integration

After test runs complete, the workflow MUST generate a static HTML eval viewer using `generate_review.py --static` for human review of qualitative outputs. The viewer MUST be uploaded as a GitHub Actions artifact so reviewers can download and inspect outputs.

The viewer MUST show:
- The test prompt
- With-skill output (files created, actions taken)
- Baseline output (for comparison)
- Formal grades (assertion pass/fail with evidence)
- A feedback textbox for human reviewers

#### Scenario: Reviewer inspects eval outputs

- **WHEN** a reviewer downloads the eval viewer artifact from a PR's CI run
- **THEN** they see each test case with the prompt, skill output, baseline output, and assertion results side-by-side

#### Scenario: Human feedback captured

- **WHEN** a reviewer leaves feedback in the eval viewer and exports `feedback.json`
- **THEN** the feedback can be committed to `evals/feedback/` for the skill-creator improvement loop

### Requirement: Cross-Skill Pipeline Testing

A dedicated `evals/pipeline/` directory MUST contain end-to-end test scenarios that invoke multiple skills in sequence against a test repository. Pipeline tests MUST cover at least the core workflow: `/sdd:spec` → `/sdd:plan` → `/sdd:work` → `/sdd:review`.

Pipeline tests MUST run only on release branches or when manually triggered (they are expensive). Each pipeline test MUST use a disposable test repository (created via `gh repo create --template` or a local git init) to avoid polluting real repos.

#### Scenario: Full pipeline test

- **WHEN** a pipeline eval runs the core workflow
- **THEN** it creates a spec, plans issues from it, implements one issue via worktree, and reviews the resulting PR — verifying that artifacts flow correctly between skills

#### Scenario: Pipeline test uses disposable repo

- **WHEN** a pipeline test starts
- **THEN** it creates a temporary repository, runs the skill sequence, and cleans up the repo after the test completes

#### Scenario: Pipeline test run on release

- **WHEN** a PR targets the `release` branch
- **THEN** pipeline tests are included in the full eval suite

### Requirement: Description Optimization

After eval prompts are authored for all skills, the skill-creator's `run_loop.py` MUST be used to optimize each skill's `description` field in SKILL.md frontmatter for triggering accuracy. The optimization MUST use a train/test split of trigger eval queries to avoid overfitting. Optimized descriptions MUST be reviewed by a human before committing.

#### Scenario: Description optimization run

- **WHEN** all eval prompts are authored and baseline benchmarks are established
- **THEN** `run_loop.py` is run for each skill with 20 trigger eval queries (10 should-trigger, 10 should-not-trigger), producing an optimized description with train and test scores

#### Scenario: Optimized description reviewed

- **WHEN** `run_loop.py` produces a `best_description` for a skill
- **THEN** the before/after descriptions and scores are shown to a human reviewer before updating SKILL.md
