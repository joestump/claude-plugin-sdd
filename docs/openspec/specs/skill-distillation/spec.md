---
status: draft
date: 2026-06-10
implements: [ADR-0034]
requires: [SPEC-0017, SPEC-0007]
---

# SPEC-0035: Skill Distillation

## Overview

This capability lets Claude (the frontier **teacher**) iteratively author and refine markdown skill artifacts that a cheaper, locally-hosted **student** model can execute inside an open agent harness at measured, Claude-relative parity. It adds two skills — `/sdd:distill` (the distillation sprint loop) and `/sdd:route` (model/harness/skill recommendation) — a markdown-native distillation manifest, and an integration point in `/sdd:plan` that annotates issues with suggested local execution. See ADR-0034. Parity is measured by reusing the evaluation harness from SPEC-0017; routing annotations extend the planning flow from SPEC-0007.

## Requirements

### Requirement: Distillation Sprint Loop

The `/sdd:distill` skill MUST run a distillation sprint scoped to a `{skill, model, harness}` triple. Each sprint iteration MUST, in order: produce a teacher reference run, produce a student pair run, score the pair run against the reference to yield a parity score, and — when parity is below the configured threshold — refine the skill artifacts before repeating. The skill MUST terminate when parity converges past the threshold or a configured maximum iteration count is reached, whichever comes first.

#### Scenario: Sprint converges

- **WHEN** `/sdd:distill` is run for a `{skill, model, harness}` triple and a pair run reaches or exceeds the parity threshold
- **THEN** the loop stops, the converged parity score and the refined artifacts are recorded in the distillation manifest, and the skill reports the triple as distilled

#### Scenario: Sprint hits iteration ceiling without converging

- **WHEN** the configured maximum iteration count is reached before parity crosses the threshold
- **THEN** the loop stops, the best observed parity score is recorded, and the triple is reported as NOT distilled with the remaining gap summarized

### Requirement: Pair-Session Execution and Reference Capture

Each sprint iteration MUST capture a teacher **reference run** by having Claude perform the task, and a student **pair run** by dispatching the identical task to the local model through the configured harness adapter. Both runs MUST be persisted as inspectable transcripts so the gap can be evaluated and later reused as training data.

#### Scenario: Reference and pair runs captured for the same task

- **WHEN** a sprint iteration executes a task
- **THEN** the teacher reference transcript and the student pair transcript for that identical task input are both persisted under the distillation artifact directory

#### Scenario: Local endpoint unreachable during a pair run

- **WHEN** the harness adapter cannot reach the configured model endpoint
- **THEN** the skill MUST surface the failure with the endpoint and harness named, MUST NOT fabricate a pair run or parity score, and MUST stop the sprint rather than silently degrade

### Requirement: Parity Evaluation Reuses the Eval Harness

Parity scoring MUST reuse the evaluation harness defined in SPEC-0017 rather than introduce a parallel grader. The pair run MUST be scored against the same per-skill assertions used by the existing evals, and the result MUST be expressed as a **Claude-relative parity score** (how close the student came to the teacher's reference), explicitly NOT as an absolute-correctness score.

#### Scenario: Parity computed from existing assertions

- **WHEN** a pair run is scored
- **THEN** the score is derived from the skill's existing eval assertions and labeled as parity-relative-to-Claude in all outputs and manifest entries

#### Scenario: Parity persisted as a benchmark

- **WHEN** a sprint records a parity score
- **THEN** the score is persisted under the eval benchmarks directory keyed by the `{skill, model, harness}` triple, consistent with the SPEC-0017 benchmark format

### Requirement: Artifact Refinement and Convergence

When parity is below threshold, the skill MUST refine the student-facing artifacts — the skill's `references/` and helper `scripts/`, and the `SKILL.md` where necessary — to close the measured gap. Refinements that target the weaker student (added procedural detail, sharper trigger keywords, tool-call scaffolding) SHOULD be additive (references and scripts) and MUST NOT degrade the skill's quality for the frontier teacher.

#### Scenario: Gap closed by additive guidance

- **WHEN** a parity gap is traced to a step the student performed incorrectly
- **THEN** the refinement adds clarifying guidance via references or scripts, and the change is recorded so the next iteration can be attributed to it

#### Scenario: Refinement must not regress the teacher

- **WHEN** a proposed refinement would reduce the skill's effectiveness for the frontier model
- **THEN** the refinement MUST be rejected or relocated into student-scoped references rather than applied to the core skill body

### Requirement: Harness Adapter Abstraction

Harnesses MUST be integrated through an adapter contract exposing three operations: install a skill into the harness, dispatch a task, and capture the task's output. **Crush** MUST be provided as the reference adapter. The model layer MUST target a generic OpenAI-compatible endpoint so that any runner (e.g., Ollama, llama.cpp, vLLM) serving any compatible model is interchangeable via configuration. No skill in this capability MAY hard-code a specific harness or runner.

#### Scenario: Crush adapter dispatches a pair run

- **WHEN** the manifest selects the Crush adapter for a triple
- **THEN** `/sdd:distill` installs the skill into Crush, dispatches the task, and captures the output through the adapter contract without harness-specific logic leaking into the skill body

#### Scenario: Model runner swapped via configuration

- **WHEN** the manifest's OpenAI-compatible endpoint is repointed from one runner to another serving a different model
- **THEN** the distillation loop runs unchanged against the new endpoint with no skill edits required

### Requirement: Distillation Manifest

The capability MUST persist a markdown-native manifest (per ADR-0015) under `docs/distillation/` that registers the available harness adapters, model endpoints, and per-`{skill, model, harness}`-triple parity scores with the date each was measured. The manifest MUST be the single source of truth that `/sdd:route` reads.

#### Scenario: Manifest updated after a sprint

- **WHEN** a distillation sprint completes
- **THEN** the manifest's entry for that triple is created or updated with the converged (or best) parity score and the measurement date

#### Scenario: Manifest is human-readable and diffable

- **WHEN** a manifest entry changes
- **THEN** the change is expressed as a reviewable markdown diff rather than an opaque binary or generated blob

### Requirement: Routing Recommendation

The `/sdd:route` skill MUST, given a task description or a tracker issue, read the manifest and recommend a `{harness, model, skill}` for local execution together with an explicit cloud-escalation condition. When no triple meets the parity threshold for the relevant skill, the recommendation MUST default to frontier-model (cloud) execution.

#### Scenario: Local recommendation above threshold

- **WHEN** `/sdd:route` is given a task whose skill has a distilled triple at or above threshold
- **THEN** it recommends that harness + model + skill for local execution and states the condition under which the task should instead escalate to the cloud

#### Scenario: No qualifying triple

- **WHEN** no triple for the relevant skill meets the parity threshold
- **THEN** `/sdd:route` recommends frontier-model execution and names the missing/under-threshold triple

### Requirement: Plan Integration via Execution Section

`/sdd:plan` MUST accept a `--distill` flag, default off, mirroring the existing optional-section flags. When `--distill` is set, each generated issue body MUST include an `### Execution` section populated from `/sdd:route` containing the suggested model, suggested harness, required distilled skill(s), and the cloud-escalation condition. When `--distill` is not set, issue bodies MUST be unchanged from current behavior.

#### Scenario: Plan with --distill annotates issues

- **WHEN** `/sdd:plan --distill` runs against a spec
- **THEN** every generated story issue body contains an `### Execution` section with suggested model, harness, required skills, and escalation condition

#### Scenario: Plan without --distill is unchanged

- **WHEN** `/sdd:plan` runs without `--distill`
- **THEN** no `### Execution` section is added and the issue bodies match the pre-existing plan output exactly

### Requirement: Graceful Degradation

Every part of the capability that depends on an external harness or model endpoint MUST degrade gracefully and MUST NOT block the SDD flow when those dependencies are absent. Distillation-specific failures MUST surface a clear, actionable message naming the missing dependency rather than producing fabricated or silent results.

#### Scenario: Routing with an empty manifest

- **WHEN** `/sdd:route` or `/sdd:plan --distill` runs and no distilled triples exist yet
- **THEN** the recommendation defaults to cloud execution with a note that no local triples are available, and the plan/route operation still completes successfully

#### Scenario: Harness adapter missing on the host

- **WHEN** the configured harness binary is not installed in the environment
- **THEN** `/sdd:distill` surfaces a one-line unavailability notice naming the harness and stops the sprint without raising an unhandled error
