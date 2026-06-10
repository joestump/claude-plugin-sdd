---
status: draft
date: 2026-06-10
implements: [ADR-0034]
requires: [SPEC-0017, SPEC-0007]
---

# SPEC-0035: Skill Distillation

## Overview

This capability lets Claude (the frontier **teacher**) iteratively author and refine small, discrete markdown skills that a cheaper, locally-hosted **student** model can execute inside an open agent harness at measured, Claude-relative parity. It adds two skills — `/sdd:distill` (the distillation sprint loop) and `/sdd:route` (model/harness/skill recommendation), an integration point in `/sdd:plan` that annotates issues with suggested local execution, configuration carried in `CLAUDE.md` per ADR-0015, and runtime artifacts under a gitignored `.sdd/distillation/` directory. See ADR-0034. The student runs by shelling out to the harness's own CLI; endpoints and tokens come from conventional environment variables. Parity is measured by reusing the evaluation harness from SPEC-0017; routing annotations extend the planning flow from SPEC-0007.

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

### Requirement: Convergence by Skill Decomposition

When parity is below threshold, the skill MUST close the gap primarily by **decomposing** the target skill into smaller, single-purpose discrete skills, each sized to fit a local model's limited context window, and by tightening each skill's trigger keywords so the right small skill surfaces for the right step. The skill MUST NOT close gaps by accumulating guidance that inflates a single skill's context beyond what the student model can hold. Decomposition MUST preserve behavior: the decomposed set MUST compose back to the frontier skill's outcome and MUST NOT degrade the skill's quality for the frontier teacher.

#### Scenario: Gap closed by splitting a skill

- **WHEN** a parity gap is traced to a step the student performed incorrectly and the student's context is a limiting factor
- **THEN** the failing concern is split into a smaller discrete skill with focused triggers, and the split is recorded so the next iteration's parity change can be attributed to it

#### Scenario: Decomposition must not regress the teacher

- **WHEN** a proposed decomposition would change or reduce the skill's outcome for the frontier model
- **THEN** the decomposition MUST be rejected or reworked so the small skills still compose to the original frontier behavior

#### Scenario: Context budget respected

- **WHEN** a candidate skill's instructions would exceed the configured student model's context budget
- **THEN** the skill MUST be split further rather than shipped as a single oversized unit

### Requirement: Harness Adapter Abstraction

Harnesses MUST be integrated through an adapter contract exposing three operations: install a skill into the harness, dispatch a task, and capture the task's output. The dispatch operation MUST execute by **shelling out to the harness's own CLI as a subprocess** — it MUST NOT depend on Claude Code's Task/subagent mechanism (which runs Claude models) and MUST NOT require a bespoke backend service. An MCP-backed adapter MAY be provided as an alternative variant for harnesses exposed that way. **Crush** MUST be provided as the reference adapter. The student model MUST be reached through a generic OpenAI-compatible endpoint whose location and credentials are resolved from **conventional environment variables** (e.g., `OPENAI_BASE_URL`, `OPENAI_API_KEY`, plus each harness's native env conventions) so that any runner (e.g., Ollama, llama.cpp, vLLM) serving any compatible model is interchangeable. Endpoints and tokens MUST NOT be stored in committed configuration. No skill in this capability MAY hard-code a specific harness or runner.

#### Scenario: Crush adapter dispatches a pair run

- **WHEN** the registered configuration selects the Crush adapter for a triple
- **THEN** `/sdd:distill` installs the skill into Crush, dispatches the task by invoking the Crush CLI as a subprocess, and captures the output through the adapter contract without harness-specific logic leaking into the skill body

#### Scenario: Model runner swapped via environment

- **WHEN** the OpenAI-compatible endpoint environment variables are repointed from one runner to another serving a different model
- **THEN** the distillation loop runs unchanged against the new endpoint with no skill or committed-config edits required

### Requirement: Configuration and Artifact Layout

Configuration — which harness adapters and model identifiers are registered for distillation — MUST live in a structured **Distillation** section in `CLAUDE.md` per ADR-0015, NOT in a bespoke config file. Endpoints and tokens MUST be resolved from environment variables rather than recorded in that section. Runtime artifacts — pair-session transcripts and working parity state — MUST be written under a gitignored `.sdd/distillation/` directory consistent with the repo's existing `.sdd-*` hidden state. Durable parity scores MUST be recorded in `evals/benchmarks/` per `{skill, model, harness}` triple per SPEC-0017. `/sdd:route` MUST read the registered configuration together with the recorded parity scores.

#### Scenario: Configuration registered in CLAUDE.md

- **WHEN** a harness adapter or model is registered for distillation
- **THEN** the registration appears as a human-readable entry in the `CLAUDE.md` Distillation section, and no endpoint URL or token is committed there

#### Scenario: Runtime artifacts are gitignored

- **WHEN** a sprint writes pair-session transcripts or working parity state
- **THEN** those artifacts land under `.sdd/distillation/` and are excluded from version control, while the durable parity score is recorded in `evals/benchmarks/`

### Requirement: Routing Recommendation

The `/sdd:route` skill MUST, given a task description or a tracker issue, read the registered configuration and recorded parity scores and recommend a `{harness, model, skill}` for local execution together with an explicit cloud-escalation condition. When no triple meets the parity threshold for the relevant skill, the recommendation MUST default to frontier-model (cloud) execution.

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

#### Scenario: Routing with no registered triples

- **WHEN** `/sdd:route` or `/sdd:plan --distill` runs and no distilled triples have been recorded yet
- **THEN** the recommendation defaults to cloud execution with a note that no local triples are available, and the plan/route operation still completes successfully

#### Scenario: Harness adapter missing on the host

- **WHEN** the configured harness binary is not installed in the environment
- **THEN** `/sdd:distill` surfaces a one-line unavailability notice naming the harness and stops the sprint without raising an unhandled error
