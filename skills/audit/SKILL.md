---
name: audit
description: Comprehensive audit of design artifact alignment across the project. Use when the user says "audit the architecture", "full drift report", or wants a thorough review of spec compliance and ADR adherence.
allowed-tools: Read, Glob, Grep, Task, TeamCreate, TeamDelete, TaskCreate, TaskUpdate, TaskList, TaskGet, SendMessage, AskUserQuestion
argument-hint: [scope] [--review] [--scrum] [--module <name>]
---

# Comprehensive Design Audit

You are performing a deep, comprehensive audit of design artifact alignment across the project or a specified scope. This skill covers all six drift categories and produces a structured report with prioritized findings.

## Process

<!-- Governing: ADR-0016 (Workspace Mode), SPEC-0014 REQ "Artifact Path Resolution" -->

0. **Resolve artifact paths**: Follow the **Artifact Path Resolution** pattern from `references/shared-patterns.md` to determine the ADR and spec directories. If `$ARGUMENTS` contains `--module <name>`, resolve paths relative to that module; otherwise, in a workspace, aggregate across all modules. The resolved ADR directory is `{adr-dir}` and spec directory is `{spec-dir}`.

   <!-- Governing: ADR-0016 (Workspace Mode), SPEC-0014 REQ "Cross-Module Aggregation" -->

   **Cross-module aggregation**: When in aggregate mode (no `--module`, workspace detected), iterate over all discovered modules and run the full audit analysis (steps 4–6) per module. Label every finding with its source module in the output tables (add a `Module` column). After per-module analysis, include a **Cross-Module Summary** section that aggregates finding counts per module and highlights any cross-module inconsistencies (e.g., one module's ADR contradicting another module's spec). When `--module` is provided, scope to that single module — no module labels needed. When in single-module mode (no workspace), operate normally.

1. **Parse arguments**: Extract the scope and flags from `$ARGUMENTS`.
   - Scope can be a topic keyword (`security`, `api`, `database`), a directory path (`src/`), or omitted for a full project audit.
   - `--review`: Enable team review mode. Default: off. Mutually exclusive with: `--scrum`.
   - `--scrum`: Enable scrum triage ceremony. Default: off. Mutually exclusive with: `--review`.
   - `--module <name>`: Resolve artifact paths relative to the named module. Default: none.
   - If scope matches nothing, report: "No design artifacts or source files matched the scope \"{scope}\". Try a broader scope, or run `/sdd:audit` without a scope for a full project audit."

2. **Locate design artifacts**:
   - Scan `{adr-dir}` for ADR files. If the directory does not exist, report: "The `{adr-dir}` directory does not exist. Run `/sdd:adr [description]` to create your first ADR."
   - Scan `{spec-dir}` for spec files. If the directory does not exist, report: "The `{spec-dir}` directory does not exist. Run `/sdd:spec [capability]` to create your first spec."
   - If neither ADRs nor specs exist, report: "No design artifacts found. Create an ADR with `/sdd:adr` or a spec with `/sdd:spec` first."
   - It is valid for only ADRs or only specs to exist -- proceed with whatever is available and note which categories cannot be checked.

3. **Choose execution mode**: Check if `$ARGUMENTS` contains `--scrum` or `--review`. `--scrum` takes precedence over `--review` if both are present.

   **Default (no `--review`, no `--scrum`)**: Single-agent mode.
   - Perform the full analysis yourself across all six categories.
   - Self-review the findings for accuracy and completeness before producing the report.
   - Verify that severity assignments follow the rules in this document.

   **With `--review`** (and no `--scrum`): Team review mode.
   - Tell the user: "Creating an audit team to analyze and review findings. This takes a few minutes."
   - Create a Claude Team with `TeamCreate`:
     - Spawn an **auditor** agent (`general-purpose`) to perform the full analysis and write the audit report
     - Spawn a **reviewer** agent (`general-purpose`) to validate the auditor's findings for accuracy, completeness, and correct severity assignments
   - If `TeamCreate` fails, fall back to single-agent mode and tell the user: "Team creation failed. Proceeding with single-agent audit and self-review."

   **With `--scrum`**: Scrum triage mode — see the **Scrum Triage Ceremony** section below. When `--scrum` is set, complete the standard audit analysis (steps 4–6) first, then enter the ceremony. Do NOT run `--review` mode when `--scrum` is set.

4. **Validate spec artifact pairing**: For each spec directory found under `{spec-dir}`, check that both `spec.md` and `design.md` exist. If a `spec.md` exists without a corresponding `design.md` (or vice versa), report as `[WARNING]` under "Stale Artifacts" with finding: "Unpaired spec artifact: {path} exists but {missing-file} is missing. Per ADR-0003, spec.md and design.md are a paired unit." (Governing: ADR-0003, SPEC-0003)

5. **Analyze across all six categories**:

   **Code vs. Specification Drift**: Does the implementation match spec requirements and scenarios?
   - Read each spec's requirements and scenarios
   - Find implementing code files by semantic relevance
   - Check MUST/SHALL requirements -- violations are `[CRITICAL]`
   - Check SHOULD/RECOMMENDED requirements -- violations are `[WARNING]`
   - Check scenario coverage -- missing scenarios are `[WARNING]`

   **Code vs. ADR Drift**: Does the implementation follow accepted ADR decisions?
   - Read each accepted ADR's decision outcome and consequences
   - Find implementing code files
   - Check that the chosen approach is implemented -- violations are `[CRITICAL]`
   - Check architectural constraints -- violations are `[WARNING]`

   **ADR vs. Spec Inconsistencies**: Are ADR decisions consistent with spec requirements?
   - Cross-reference ADR decisions with related spec requirements
   - Check for contradictions -- contradictions are `[CRITICAL]`
   - Check for terminology or approach mismatches -- mismatches are `[WARNING]`

   **Coverage Gaps**: What code areas have no governing ADR or spec?
   - Scan source directories for code files
   - Identify files and directories not referenced by any ADR or spec
   - All coverage gaps are `[INFO]`

   **Stale Artifacts**: Do artifact statuses match implementation reality?
   - Check for ADRs with status `proposed` that have existing implementations -- `[WARNING]`
   - Check for specs with status `draft` that have deployed implementations -- `[WARNING]`
   - Check for `accepted` ADRs whose decisions have been overridden in code -- `[WARNING]`

   **Policy Violations**: Are specs internally consistent in their use of RFC 2119 keywords?
   - Check for SHOULD where MUST appears intended (e.g., security requirements using SHOULD instead of MUST) -- `[INFO]`
   - Check for contradictory requirements within the same spec -- `[CRITICAL]`
   - Check for requirements that are untestable or ambiguous -- `[INFO]`

6. **Produce the audit report** using the standard format:

   ```
   ## Design Audit Report

   Scope: {scope or "Full project"}
   Analyzed: {N} ADRs, {M} specs, {P} source files
   Total findings: {X} ({C} critical, {W} warning, {I} info)

   ---

   ### Code vs. Specification Drift

   | Severity | Finding | Spec | Location |
   |----------|---------|------|----------|
   | [CRITICAL] | {description} | SPEC-XXXX | src/path/file.ts:NN |

   ### Code vs. ADR Drift

   | Severity | Finding | ADR | Location |
   |----------|---------|-----|----------|
   | [WARNING] | {description} | ADR-XXXX | src/path/file.ts:NN |

   ### ADR vs. Spec Inconsistencies

   | Severity | Finding | ADR | Spec |
   |----------|---------|-----|------|
   | [CRITICAL] | {description} | ADR-XXXX | SPEC-XXXX |

   ### Coverage Gaps

   | Severity | Area | Description |
   |----------|------|-------------|
   | [INFO] | src/path/ | {description} |

   ### Stale Artifacts

   | Severity | Artifact | Issue |
   |----------|----------|-------|
   | [WARNING] | ADR-XXXX | {description} |

   ### Policy Violations

   | Severity | Finding | Source | Location |
   |----------|---------|--------|----------|
   | [INFO] | {description} | SPEC-XXXX | {spec-dir}/path/spec.md |

   ---

   ### Summary

   | Category | Critical | Warning | Info | Total |
   |----------|----------|---------|------|-------|
   | Code vs. Spec | N | N | N | N |
   | Code vs. ADR | N | N | N | N |
   | ADR vs. Spec | N | N | N | N |
   | Coverage Gaps | N | N | N | N |
   | Stale Artifacts | N | N | N | N |
   | Policy Violations | N | N | N | N |
   | **Total** | **N** | **N** | **N** | **N** |

   ### Recommended Actions
   1. [CRITICAL] {action}
   2. [WARNING] {action}
   3. [INFO] {action}
   ```

   **Workspace aggregate mode** adds these sections to the report:

   - A `Module` column in every findings table (e.g., `| [api] | [CRITICAL] | ... |`)
   - A **Cross-Module Summary** section after the per-category summary:

   ```
   ### Cross-Module Summary

   | Module | Critical | Warning | Info | Total |
   |--------|----------|---------|------|-------|
   | [api] | N | N | N | N |
   | [worker] | N | N | N | N |
   | **Total** | **N** | **N** | **N** | **N** |

   ### Cross-Module Inconsistencies
   | Severity | Finding | Module A | Module B |
   |----------|---------|----------|----------|
   | [CRITICAL] | {description of cross-module contradiction} | [api] ADR-XXXX | [worker] SPEC-XXXX |
   ```

   If no cross-module inconsistencies are found, omit the "Cross-Module Inconsistencies" table and note: "No cross-module inconsistencies detected."

7. **Add recommended actions** at the end, ordered by severity:
   - For stale artifact findings, suggest `/sdd:status` to update
   - For coverage gaps suggesting missing ADRs, suggest `/sdd:adr`
   - For coverage gaps suggesting missing specs, suggest `/sdd:spec`
   - Never suggest `/sdd:check` (audit is a superset of check)

8. **Handle clean results**: If no drift is found across any category:

   ```
   ## Design Audit Report

   Scope: {scope or "Full project"}
   Analyzed: {N} ADRs, {M} specs, {P} source files

   No drift detected. All implementation aligns with governing ADRs and specs.
   ```

---

## Scrum Triage Ceremony (`--scrum`)

When `--scrum` is set, run the standard audit analysis (steps 4-8 above) first, then follow the Triage Ceremony in `references/triage-ceremony.md`. The triage ceremony groups audit findings into functional themes, runs a 5-agent triage team to prioritize and dispute findings, and produces a triage report with remediation priorities and optional issue creation. Governing: SPEC-0013, ADR-0014.

---

### Team Handoff Protocol (only for `--review` mode)

1. The auditor performs the full analysis and writes the audit report
2. The auditor sends a message to the reviewer: "Audit report ready for review"
3. The reviewer validates the findings by:
   - Checking that each finding is accurate (the drift actually exists)
   - Checking that severity assignments follow the rules
   - Checking for findings the auditor may have missed
   - Verifying the summary matrix counts are correct
4. The reviewer either:
   a. Sends "APPROVED" to the lead, or
   b. Sends specific revision requests to the auditor (e.g., "Finding #3 severity should be WARNING not CRITICAL because the requirement uses SHOULD")
5. Maximum 2 revision rounds. After that, the reviewer approves with noted concerns.
6. The lead agent presents the final report only after receiving "APPROVED"
7. Clean up the team with `TeamDelete` when done.

## Severity Assignment Rules

See the plugin's `references/shared-patterns.md` § "Severity Assignment Rules" for the full mapping. Key: MUST/SHALL violations → CRITICAL, SHOULD violations → WARNING, coverage gaps → INFO.

## Rules

- Analyze ALL six drift categories. This is a comprehensive audit, not a quick check.
- When scope is provided, filter artifacts and code to only those relevant to the scope. When scope is omitted, audit the entire project.
- In single-agent mode, self-review all findings before producing the final report. Verify each finding is accurate and severity is correctly assigned.
- In `--review` mode, follow the team handoff protocol exactly. Do not present the report until the reviewer sends "APPROVED".
- Omit any category section from the report if it has zero findings (but always include it in the summary matrix with zeros).
- Always use full artifact identifiers in output: `ADR-0001`, `SPEC-0002`, `Req 3`. Do not abbreviate.
- Include file paths with line numbers in the Location column when possible (e.g., `src/auth/login.ts:45`).
- Use `##` for the top-level heading (report title) and `###` for sections within the report.
- The Recommended Actions list must be ordered by severity (critical first, then warning, then info).
- Present findings within each category ordered by severity (critical first).
- MUST validate spec.md + design.md pairing in step 4 — report unpaired artifacts as [WARNING] under Stale Artifacts (Governing: ADR-0003, SPEC-0003)
- When `--scrum` is set, MUST run the full standard audit analysis first, then the triage ceremony — never skip the standard analysis (Governing: SPEC-0013 REQ "Scrum Flag and Mode Activation")
- `--scrum` and `--review` are mutually exclusive; `--scrum` takes precedence if both are provided
- ADRs (`accepted`) and specs (`approved`/`implemented`) are the source of truth — code deviation is presumed wrong unless the Architect explicitly reclassifies a finding as an artifact update (Governing: SPEC-0013 REQ "Source of Truth Principle")
- In workspace aggregate mode, MUST label every finding with its source module and include a Cross-Module Summary section (Governing: ADR-0016, SPEC-0014 REQ "Cross-Module Aggregation")
- In workspace aggregate mode, MUST check for cross-module inconsistencies (e.g., conflicting ADR decisions across modules)
- Themes MUST be grouped by functional area, not by drift category (Governing: SPEC-0013 REQ "Functional Theme Grouping")
- Engineer B MUST challenge findings with substantive arguments — "this looks intentional" is not acceptable justification; an architecturally-sound reason is required (Governing: SPEC-0013 REQ "Triage Team Composition")
- MUST/SHALL violations the PO proposes to defer MUST be documented with Engineer B's objection and the PO's written justification in the accepted-for-now list (Governing: SPEC-0013 REQ "Triage Team Composition")
- Do NOT spawn the triage team if the standard audit found zero findings — report clean audit directly (Governing: SPEC-0013 REQ "Functional Theme Grouping")
