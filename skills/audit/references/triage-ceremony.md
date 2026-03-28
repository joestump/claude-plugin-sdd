# Triage Ceremony

<!-- Governing: ADR-0014 (Scrum Triage), SPEC-0013 REQ "Scrum Flag and Mode Activation" -->

The triage ceremony runs after the standard audit analysis (steps 4-8) completes. The raw audit findings are the input. The ceremony groups findings into functional themes, runs a 5-agent triage team, resolves disputes, and produces a triage report with remediation priorities.

Note: These are the same 5 agent roles as the Grooming Ceremony (used by `/design:plan --scrum`), but with different responsibilities. In grooming, Engineer B challenges vague requirements. In triage, Engineer B challenges whether findings are genuine drift vs intentional evolution.

Tell the user after the standard audit completes: "Audit complete. Starting scrum triage — grouping findings into themes and running the triage team. Give me a few minutes."

## Phase 1: Source of Truth Validation

Before grouping, classify each finding by the authority level of its governing artifact:

- **High-authority**: Finding contradicts an ADR with status `accepted` OR a spec with status `approved` or `implemented`. The code is presumed wrong.
- **Lower-authority**: Finding contradicts an ADR with status `proposed` OR a spec with status `draft`. The PO may accept this as "not yet binding" without triggering Engineer B's mandatory objection.

## Phase 2: Functional Theme Grouping

Group all findings into **4-8 functional themes** by the affected part of the system. Do this in the lead's context before spawning the triage team.

**Grouping rules:**
1. Name themes for the affected system area (e.g., "Authentication & Authorization", "Billing API Contracts", "Data Model Coverage", "Configuration & Secrets"). Do NOT name themes for drift categories (e.g., "Code vs. Spec findings").
2. Each finding MUST appear in exactly one theme.
3. If naive grouping produces more than 8 themes, merge the smallest or most closely related themes.
4. Group all INFO-severity-only findings into a single "Technical Debt & Coverage Gaps" theme unless they span heterogeneous functional areas.
5. If the standard audit found zero findings, skip all remaining triage phases and output only the clean audit result. Do NOT spawn the triage team for a clean audit.

## Phase 3: Spawn Triage Team

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
> For each disputed finding: is the ADR/spec still the correct source of truth? If Engineer B's evolution argument is sound, reclassify as "ARTIFACT UPDATE NEEDED" and suggest `/design:adr` or `/design:spec`. Verify governing comment requirements (per `references/shared-patterns.md` § "Governing Comment Format") in remediation acceptance criteria.

## Phase 4: Collect and Resolve

The lead collects all five agents' feedback. Process disputes and resolutions:

1. **For each Engineer B dispute**: Present the dispute to the Architect. The Architect decides: **code fix** (Engineer B is wrong, finding stands) or **artifact update** (Engineer B is right, reclassify). There is no negotiation round — the Architect makes the final call on SoT disputes.

2. **For each PO MUST/SHALL deferral proposal** (where Engineer B has objected): The PO must provide a written justification. Add the finding to the **accepted-for-now list** with: the finding description, Engineer B's objection, and the PO's written justification. The finding is NOT added to the code-fix remediation themes — it is tracked separately.

3. **Finalize themes**: Apply all reclassifications. Each theme now has: priority (P1/P2/P3), effort (XS-XL), finding list (code fixes only), and complexity flag (Engineer A's assessment).

## Phase 5: Emit Triage Report

Output the full triage report:

```markdown
## Audit Triage Report — {scope or "Full Project"} — {date}

### Theme Summary

| Theme | Findings | Highest Severity | Priority | Effort | Complexity |
|-------|----------|-----------------|----------|--------|-----------|
| {theme name} | {N} | CRITICAL/WARNING/INFO | P1/P2/P3 | XS-XL | Simple/Moderate/Large |

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

## Phase 6: Offer Issue Creation

After the report, ask the user with `AskUserQuestion`: "Want me to create tracker issues for the P1 and P2 themes? I'll use your configured tracker and follow the standard issue format."

If the user says yes, follow the tracker detection and issue creation flow from `/design:plan` steps 4-5. Each theme becomes one story issue with findings as the task checklist. P1 themes get priority label `p1`; P2 themes get `p2`.
