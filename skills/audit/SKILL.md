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

1. **Parse arguments**: Extract the scope and flags from `$ARGUMENTS`.
   - Scope can be a topic keyword (`security`, `api`, `database`), a directory path (`src/`), or omitted for a full project audit.
   - Check for the `--review` flag.
   - If scope matches nothing, report: "No design artifacts or source files matched the scope \"{scope}\". Try a broader scope, or run `/design:audit` without a scope for a full project audit."

2. **Locate design artifacts**:
   - Scan `{adr-dir}` for ADR files. If the directory does not exist, report: "The `{adr-dir}` directory does not exist. Run `/design:adr [description]` to create your first ADR."
   - Scan `{spec-dir}` for spec files. If the directory does not exist, report: "The `{spec-dir}` directory does not exist. Run `/design:spec [capability]` to create your first spec."
   - If neither ADRs nor specs exist, report: "No design artifacts found. Create an ADR with `/design:adr` or a spec with `/design:spec` first."
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

7. **Add recommended actions** at the end, ordered by severity:
   - For stale artifact findings, suggest `/design:status` to update
   - For coverage gaps suggesting missing ADRs, suggest `/design:adr`
   - For coverage gaps suggesting missing specs, suggest `/design:spec`
   - Never suggest `/design:check` (audit is a superset of check)

8. **Handle clean results**: If no drift is found across any category:

   ```
   ## Design Audit Report

   Scope: {scope or "Full project"}
   Analyzed: {N} ADRs, {M} specs, {P} source files

   No drift detected. All implementation aligns with governing ADRs and specs.
   ```

---

## Scrum Triage Ceremony (`--scrum`)

When `--scrum` is set, run the standard audit analysis (steps 4–8 above) first, then execute the triage ceremony below. The raw audit findings are the input to the ceremony. Governing: SPEC-0013, ADR-0014.

Tell the user after the standard audit completes: "Audit complete. Starting scrum triage — grouping findings into themes and running the triage team. Give me a few minutes."

### Triage Phase 1: Source of Truth Validation

Before grouping, classify each finding by the authority level of its governing artifact:

- **High-authority**: Finding contradicts an ADR with status `accepted` OR a spec with status `approved` or `implemented`. The code is presumed wrong.
- **Lower-authority**: Finding contradicts an ADR with status `proposed` OR a spec with status `draft`. The PO may accept this as "not yet binding" without triggering Engineer B's mandatory objection.

### Triage Phase 2: Functional Theme Grouping

Group all findings into **4–8 functional themes** by the affected part of the system. Do this in the lead's context before spawning the triage team.

**Grouping rules:**
1. Name themes for the affected system area (e.g., "Authentication & Authorization", "Billing API Contracts", "Data Model Coverage", "Configuration & Secrets"). Do NOT name themes for drift categories (e.g., "Code vs. Spec findings").
2. Each finding MUST appear in exactly one theme.
3. If naive grouping produces more than 8 themes, merge the smallest or most closely related themes.
4. Group all INFO-severity-only findings into a single "Technical Debt & Coverage Gaps" theme unless they span heterogeneous functional areas.
5. If the standard audit found zero findings, skip all remaining triage phases and output only the clean audit result. Do NOT spawn the triage team for a clean audit.

### Triage Phase 3: Spawn Triage Team

Spawn five specialist agents with the following **verbatim personas**:

**Product Owner (PO)**
> Assign business priority per theme: P1 (before next release), P2 (within 2 sprints), P3 (tech debt). Assess impact on users, revenue, security, compliance. If deferring a MUST/SHALL violation to P2/P3, provide written justification — Engineer B will object.

**Scrum Master (SM)**
> Estimate remediation effort per theme (XS/S/M/L/XL). Propose splitting XL themes. Flag cross-team coordination needs. Tiebreaker on disputes.

**Engineer A**
> Assess per theme: SIMPLE FIX, MODERATE REFACTOR, or LARGE REFACTOR. Flag hidden dependencies and suggest batching themes that touch the same files.

**Engineer B (Grumpy)**
> Challenge whether each finding is genuine drift or intentional evolution the spec hasn't caught up to. Articulate the architectural rationale — "looks intentional" is not sufficient. MUST object to deferred MUST/SHALL violations. Approve only with explicit one-sentence justification.

**Architect**
> For each disputed finding: is the ADR/spec still the correct source of truth? If Engineer B's evolution argument is sound, reclassify as "ARTIFACT UPDATE NEEDED" and suggest `/design:adr` or `/design:spec`. Verify governing comment requirements in remediation acceptance criteria.

### Triage Phase 4: Collect and Resolve

The lead collects all five agents' feedback. Process disputes and resolutions:

1. **For each Engineer B dispute**: Present the dispute to the Architect. The Architect decides: **code fix** (Engineer B is wrong, finding stands) or **artifact update** (Engineer B is right, reclassify). There is no negotiation round — the Architect makes the final call on SoT disputes.

2. **For each PO MUST/SHALL deferral proposal** (where Engineer B has objected): The PO must provide a written justification. Add the finding to the **accepted-for-now list** with: the finding description, Engineer B's objection, and the PO's written justification. The finding is NOT added to the code-fix remediation themes — it is tracked separately.

3. **Finalize themes**: Apply all reclassifications. Each theme now has: priority (P1/P2/P3), effort (XS–XL), finding list (code fixes only), and complexity flag (Engineer A's assessment).

### Triage Phase 5: Emit Triage Report

Output the full triage report:

```markdown
## Audit Triage Report — {scope or "Full Project"} — {date}

### Theme Summary

| Theme | Findings | Highest Severity | Priority | Effort | Complexity |
|-------|----------|-----------------|----------|--------|-----------|
| {theme name} | {N} | CRITICAL/WARNING/INFO | P1/P2/P3 | XS–XL | Simple/Moderate/Large |

---

### P1 Themes (Must Fix Before Next Release)

#### {Theme Name}
**Findings ({N}):**
- [CRITICAL] {finding} — {spec/ADR ref} — {file:line}
- [WARNING] {finding} — ...

**PO Priority**: P1 — {one-sentence reasoning}
**SM Estimate**: {size} — {one-sentence reasoning}
**Engineer A**: {SIMPLE FIX / MODERATE REFACTOR / LARGE REFACTOR} — {one sentence}

---

### P2 Themes (Fix Within 2 Sprints)

{same structure as P1}

---

### P3 Themes (Technical Debt)

{same structure as P1}

---

### Artifact Update Queue

These findings were reclassified by the Architect as artifacts that need updating rather than code that needs fixing:

| Finding | Current Artifact | Suggested Action |
|---------|-----------------|-----------------|
| {finding description} | ADR-XXXX / SPEC-XXXX | `/design:adr {description}` / `/design:spec {capability}` |

---

### Accepted-For-Now (MUST/SHALL violations deferred by PO)

| Finding | Severity | Engineer B Objection | PO Justification |
|---------|----------|---------------------|-----------------|
| {finding} | CRITICAL | {objection} | {justification} |

---

### Recommended Next Steps
1. P1 themes: {list}
2. Artifact updates needed: {list}
3. Run `/design:plan --scrum` after updating artifacts to plan the remediation sprint
```

### Triage Phase 6: Offer Issue Creation

After the report, ask the user with `AskUserQuestion`: "Want me to create tracker issues for the P1 and P2 themes? I'll use your configured tracker and follow the standard issue format."

If the user says yes, follow the tracker detection and issue creation flow from `/design:plan` steps 4–5. Each theme becomes one story issue with findings as the task checklist. P1 themes get priority label `p1`; P2 themes get `p2`.

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
- Themes MUST be grouped by functional area, not by drift category (Governing: SPEC-0013 REQ "Functional Theme Grouping")
- Engineer B MUST challenge findings with substantive arguments — "this looks intentional" is not acceptable justification; an architecturally-sound reason is required (Governing: SPEC-0013 REQ "Triage Team Composition")
- MUST/SHALL violations the PO proposes to defer MUST be documented with Engineer B's objection and the PO's written justification in the accepted-for-now list (Governing: SPEC-0013 REQ "Triage Team Composition")
- Do NOT spawn the triage team if the standard audit found zero findings — report clean audit directly (Governing: SPEC-0013 REQ "Functional Theme Grouping")
