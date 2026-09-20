---
name: prd
description: Create a Product Requirements Document (PRD) for a client-facing capability. Use when the user wants to capture product intent before engineering, produce a client-ready document for sign-off, or says "create a PRD", "write a product requirements document", or "capture what the client asked for".
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Task, WebFetch, WebSearch, AskUserQuestion
argument-hint: "[capability or client name] [--module <name>]"
---

# Create a Product Requirements Document (PRD)

> **Harness portability.** This skill runs on any agent harness that loads Agent Skills — Claude Code, Codex CLI, OpenCode, Crush. Tool names used below (`AskUserQuestion`, `Task`, `ToolSearch`, `mcp__*`, `${CLAUDE_PLUGIN_ROOT}`) denote *capabilities*, not hard requirements: map each to your harness's equivalent or use the documented fallback per `${CLAUDE_PLUGIN_ROOT}/references/harness-compat.md`. References to `CLAUDE.md` mean the project memory file (`CLAUDE.md`, `AGENTS.md`, or `CRUSH.md`) per harness-compat § "Project Memory File". A citation of the form `shared-patterns.md § "Section"` names one `##` heading in that file — load only that section (see its "How to Read This File" note), never the whole file.

<!-- Governing: ADR-0036 (PRD as an Optional, Pre-ADR, Client-Facing Product-Intent Artifact), SPEC-0037 -->

You are creating a **Product Requirements Document** — the product-intent artifact that precedes the ADR and spec pair for client-facing capabilities. A PRD is a **client-ready deliverable**: the client reads it, answers clarification questions, and signs off before engineering begins.

## When a PRD applies

**PRDs are optional and client-facing-only.** Write one when the requester wants a client-ready document, or when requirements must be interrogated out of a stakeholder before engineering can start.

Most ADRs have **no** PRD upstream, and that is correct — pure engineering decisions (a namespace rename, an index-freshness strategy, a cycle-detection fix) have no product intent to capture. Per ADR-0036, **the absence of a PRD is never a finding**: `/sdd:check` and `/sdd:audit` MUST NOT flag an ADR or spec for lacking one. Do not create a PRD to satisfy a perceived gap.

## Process

0. **Grill-first interrogation**: Before drafting, stress-test the request per `${CLAUDE_PLUGIN_ROOT}/references/shared-patterns.md` § "Grill-First Interrogation Pattern" — map the design tree, work the question frontier in rounds with recommended answers, explore facts via the repository, reserve decisions for the user, and converge before writing.

   The convergence gate is stricter for a PRD than for an ADR: **do not write the file** until the frontier is empty, every template section fills without a placeholder, *and* the blast radius has been confirmed against the actual codebase (grep the surfaces — do not assume). If the gate does not pass, present the open frontier to the user instead of drafting.

   The Q&A rounds become the PRD's **clarification log**, which is part of the deliverable — for client-facing work the questions are the visible evidence of the interrogation behind the document.

<!-- Governing: ADR-0016 (Workspace Mode), SPEC-0014 REQ "Artifact Path Resolution" -->

1. **Resolve artifact paths**: Follow the **Artifact Path Resolution** pattern from `${CLAUDE_PLUGIN_ROOT}/references/shared-patterns.md` § "Artifact Path Resolution" to determine the PRD directory, declared in `CLAUDE.md` § Architecture Context as `- Product Requirements Documents are in {path}` and defaulting to `docs/prds/`. If `$ARGUMENTS` contains `--module <name>`, resolve relative to that module. The resolved directory is `{prd-dir}` below.

   PRDs MUST NOT be written inside the spec directory. A PRD often governs several specs, so co-locating it under `{spec-dir}/{capability}/` breaks the first time one PRD produces two — and the specs qmd collection mask would swallow it.

2. **Determine the next PRD number**: Scan `{prd-dir}` for existing `PRD-XXXX-*.md` files and increment to the next number. Start at `PRD-0001` if none exist. Create `{prd-dir}` if it does not exist. The file is `{prd-dir}/PRD-XXXX-{slug}.md` — one file per PRD, not a pair, and never a bare `prd.md`.

   If `$ARGUMENTS` is empty (ignoring `--module`), use `AskUserQuestion` to ask what capability the PRD covers and who the client is.

3. **qmd-aware edge pre-search**:

   <!-- Governing: ADR-0024 (qmd as hard dependency), SPEC-0019 REQ "qmd-Smart Authoring Skills" -->

   Before drafting, qmd-search the existing ADR and spec corpora to find the artifacts this PRD will govern and the prior decisions it must not contradict.

   1. Construct a hybrid query per `${CLAUDE_PLUGIN_ROOT}/references/qmd-helpers.md` § "Hybrid Retrieval":
      - `lex`: the capability description from `$ARGUMENTS` (named systems, surfaces, client terms)
      - `vec`: a one-sentence framing of the product intent this PRD captures
      - `intent: "/sdd:prd — find ADRs and specs this PRD governs, and existing surfaces for the blast radius"`
      - `collections: ["{repo}-adrs", "{repo}-specs"]` (or per-module variants per `qmd-helpers.md` § "This-Repo Collection Identification")
      - `limit: 8`, `minScore: 0.3`

   2. Results serve two purposes: candidates for the `governs:` edge list, and **named surfaces for the blast radius** — an existing spec that covers ground this capability touches is a collision question, not just a citation.

   3. Surface candidate `governs:` edges to the user via `AskUserQuestion` before writing. A PRD authored ahead of its ADR will often have an **empty** `governs:` list — that is expected and valid while status is `draft` or `client-review`.

   4. On qmd unreachable / timeout per `qmd-helpers.md` § "Error Handling", surface the error and stop. Per ADR-0024 there is no fallback path; the failure mode is "fix qmd, retry."

4. **Confirm the blast radius against the codebase**: For every surface the capability touches, grep it and record what could break and who else depends on it. A blast-radius section with no confirmed entries means the investigation did not happen — the convergence gate in step 0 has not passed.

5. **Draft from the template**: Use `${CLAUDE_PLUGIN_ROOT}/skills/prd/references/prd-template.md`. Every success criterion MUST be EARS-shaped (see below). Write the clarification log from the grill rounds.

6. **Write the file**, then tell the user the path, the allocated ID, and what the next step is (`/sdd:adr` for the engineering decision, or `/sdd:spec` once the PRD is approved).

7. **Update the qmd index** per `${CLAUDE_PLUGIN_ROOT}/references/qmd-helpers.md` § "Update Patterns", into the `{repo}-prds` collection — never the specs or adrs collections.

## Success criteria MUST use EARS

Success criteria are the PRD's completion gates: each one becomes a check an execution agent can run. Vacuous criteria produce vacuous runs, so "write them as checks" is given an enforceable syntax — [EARS](https://alistairmavin.com/ears/) (Easy Approach to Requirements Syntax). A criterion matching no EARS pattern is a validation error reported by `/sdd:check` and `/sdd:audit`.

| Pattern | Shape |
| --- | --- |
| Ubiquitous | The `<system>` shall `<response>`. |
| Event-driven | When `<trigger>`, the `<system>` shall `<response>`. |
| State-driven | While `<state>`, the `<system>` shall `<response>`. |
| Unwanted behaviour | If `<condition>`, then the `<system>` shall `<response>`. |
| Optional feature | Where `<feature is included>`, the `<system>` shall `<response>`. |

The complex form combines precondition and trigger: `While <state>, when <trigger>, the <system> shall <response>`.

Write "While the approval is pending, when the SLA window elapses without a human response, the system shall escalate to the next approver in the chain" — not "approvals should be timely".

## Status gates

| Gate | Meaning | Enforced by |
| --- | --- | --- |
| `draft` | Grill converged; every section filled without placeholders | This skill |
| `client-review` | Sent to the client or stakeholder for sign-off | The user |
| `approved` | Signed off; open questions closed or waived with an owner and a date | `/sdd:check`, `/sdd:audit` |
| `shipped` | Governed work delivered; every success criterion carries met evidence or a recorded waiver | `/sdd:audit` |

Per SPEC-0037 these gates are enforced, not decorative:

- An `approved` or `shipped` PRD MUST govern at least one ADR or spec that exists in the repository. One that governs nothing is a `[WARNING]` finding.
- A `shipped` PRD whose success criteria carry no met evidence and no waiver is a `[CRITICAL]` finding.
- A PRD MUST NOT reach `approved` while an open question is unresolved and unwaived.

Move a PRD between gates with `/sdd:status`, which validates the enum.

## Graph edges

PRDs are first-class graph nodes with their own `PRD-XXXX` ID namespace. Declare relationships with `governs:` (into the ADRs and specs that implement the PRD) and optionally `related:`, within the ADR-0023 / SPEC-0018 vocabulary.

Edges are **forward-only**: the reverse `governed-by` edge is derived by `/sdd:graph` at build time and MUST NOT be authored. `impact`, `ancestors`, `chain`, and `orphans` all cover PRDs — but `orphans` reports only `approved` and `shipped` PRDs with no governed downstream artifact, never a `draft` or `client-review` one.

## Relationship to the ADR and the spec pair

The lineage is **PRD → ADR → spec pair → plan → work**.

The PRD is the product-intent half and the commercial contract; `spec.md` / `design.md` are the engineering half. Neither replaces the other — the ADR holds the engineering tradeoff, the PRD holds what the client asked for and signed off on.

When the downstream artifacts are written from an approved PRD, the translation is mechanical:

| PRD section | Becomes |
| --- | --- |
| User stories | The spec's requirements |
| Success criteria (EARS) | The spec's `WHEN`/`THEN` scenarios |
| Blast radius / touch points | The impact analysis |
| Decision log | The ADRs cited by the spec's design section |

## qmd collection

PRDs live in their own qmd collection (`{repo}-prds`, masked over `{prd-dir}`), the way ADR-0025 gave tracker issues theirs. `/sdd:index` MUST NOT index PRDs into the specs collection — the specs mask globs `**/*.md` and would swallow them, returning product intent when an agent searched for an engineering contract.

## Rules

- Never ask the user for a fact you can look up. Grep the codebase, read the specs, then ask only about intent, preference, and tradeoff tolerance.
- Never draft before the convergence gate passes. A PRD with placeholder sections is worse than no PRD — it looks signed-off-able and is not.
- Never write a success criterion that cannot be checked by running something.
- Never author a reverse edge (`governed-by`); `/sdd:graph` derives it.
- Never create a PRD for a pure engineering decision. Absence of a PRD is never a finding.
