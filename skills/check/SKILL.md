---
name: check
description: Quick-check code against ADRs and specs for drift. Use when the user says "check for drift", "does this match the spec", or wants a fast alignment check on a specific file or directory.
allowed-tools: Read, Glob, Grep
argument-hint: [target] [--module <name>]
---

# Quick Drift Check

You are performing a fast, focused drift check on a specific target. This skill detects whether code aligns with its governing ADRs and specs.

## Process

<!-- Governing: ADR-0016 (Workspace Mode), SPEC-0014 REQ "Artifact Path Resolution" -->

0. **Resolve artifact paths**: Follow the **Artifact Path Resolution** pattern from `references/shared-patterns.md` to determine the ADR and spec directories. If `$ARGUMENTS` contains `--module <name>`, resolve paths relative to that module; otherwise, in a workspace, aggregate across all modules. The resolved ADR directory is `{adr-dir}` and spec directory is `{spec-dir}`.

1. **Parse the target**: Extract the target from `$ARGUMENTS`.
   - A file path: `src/auth/login.ts`
   - A directory path: `src/auth/`
   - An ADR reference: `ADR-0001`
   - A SPEC reference: `SPEC-0001`
   - If `$ARGUMENTS` is empty, check all artifacts against the entire codebase.

2. **Validate the target exists**:
   - For file/directory targets: verify the path exists. If not, report: "Target not found: `{target}`. Provide a valid file path, directory, ADR reference (ADR-XXXX), or SPEC reference (SPEC-XXXX)."
   - For ADR references: glob `{adr-dir}/ADR-{number}-*.md`. If not found, report: "ADR-{XXXX} not found in `{adr-dir}`. Run `/design:list adr` to see available ADRs."
   - For SPEC references: glob `{spec-dir}/*/spec.md` and search for the matching SPEC number. If not found, report: "SPEC-{XXXX} not found in `{spec-dir}`. Run `/design:list spec` to see available specs."

3. **Locate design artifacts**:
   - Scan `{adr-dir}` for ADR files. If the directory does not exist, report: "The `{adr-dir}` directory does not exist. Run `/design:adr [description]` to create your first ADR."
   - Scan `{spec-dir}` for spec files. If the directory does not exist, report: "The `{spec-dir}` directory does not exist. Run `/design:spec [capability]` to create your first spec."
   - If neither ADRs nor specs exist, report: "No design artifacts found. Create an ADR with `/design:adr` or a spec with `/design:spec` first."
   - It is valid for only ADRs or only specs to exist -- proceed with whatever is available.

4. **Determine relevant artifacts**:
   - If the target is a file or directory: read the target code, then read all ADRs and specs to find which ones govern the target area (by semantic relevance -- the ADR/spec mentions the same domain, technology, or component).
   - If the target is an ADR: read the ADR, find related specs and code files that should implement the decision.
   - If the target is a SPEC: read the spec, find related ADRs and code files that should implement the requirements.

5. **Validate spec artifact pairing**: For each spec directory found under `{spec-dir}`, check that both `spec.md` and `design.md` exist. If a `spec.md` exists without a corresponding `design.md` (or vice versa), report as `[WARNING]` under "Code vs. Spec" with finding: "Unpaired spec artifact: {path} exists but {missing-file} is missing. Per ADR-0003, spec.md and design.md are a paired unit." (Governing: ADR-0003, SPEC-0003)

6. **Analyze for drift** across three categories:

   **Code vs. Spec**: Does the implementation match the spec's requirements and scenarios?
   - Check MUST/SHALL requirements -- violations are `[CRITICAL]`
   - Check SHOULD/RECOMMENDED requirements -- violations are `[WARNING]`
   - Check scenario coverage -- missing scenarios are `[WARNING]`

   **Code vs. ADR**: Does the implementation follow the accepted ADR decisions?
   - Check that the chosen option/approach is implemented, not a rejected alternative -- violations are `[CRITICAL]`
   - Check that architectural constraints from the decision are followed -- violations are `[WARNING]`

   **ADR vs. Spec**: Are the ADR decisions consistent with spec requirements?
   - Check for contradictions between ADR decisions and spec requirements -- contradictions are `[CRITICAL]`
   - Check for terminology or approach mismatches -- mismatches are `[WARNING]`

7. **Produce the findings table** using the standard format:

   ```
   ## Drift Check: {target}

   Checked {N} ADRs and {M} specs against {target}. Found {X} findings.

   ### Findings

   | Severity | Category | Finding | Source | Location |
   |----------|----------|---------|--------|----------|
   | [CRITICAL] | Code vs. Spec | {one-sentence description} | SPEC-XXXX | src/path/file.ts:NN |
   | [WARNING] | Code vs. ADR | {one-sentence description} | ADR-XXXX | src/path/file.ts:NN |

   ### Summary
   - Critical: {N}
   - Warning: {N}
   - Info: {N}
   ```

8. **Add suggested actions** at the end based on findings:
   - If critical issues exist, suggest `/design:audit {target} --review` for deeper analysis
   - If stale artifact findings exist, suggest `/design:status` to update
   - If coverage gaps suggest a missing spec, suggest `/design:spec`
   - Always provide at least one actionable fix suggestion for the highest-severity finding

9. **Handle clean results**: If no drift is found, report:

   ```
   ## Drift Check: {target}

   Checked {N} ADRs and {M} specs against {target}. No drift detected.

   All implementation in {target} aligns with governing ADRs and specs.
   ```

## Severity Assignment Rules

- A finding that contradicts a MUST, SHALL, or MUST NOT requirement is always `[CRITICAL]`
- A finding that contradicts a SHOULD or RECOMMENDED requirement is always `[WARNING]`
- A coverage gap (no governing artifact) is always `[INFO]`
- A stale artifact (status does not match reality) is `[WARNING]`
- An inconsistency between ADR and spec (e.g., ADR says X, spec says Y) is `[CRITICAL]`

## Rules

- This skill is always single-agent. It does NOT support `--review`.
- Only analyzes three of six drift categories: Code vs. Spec, Code vs. ADR, ADR vs. Spec. Coverage gaps, stale artifacts, and policy violations are NOT checked — use `/design:audit` for a comprehensive six-category analysis.
- Keep analysis focused and fast. Read only the files relevant to the target, not the entire codebase.
- Always use full artifact identifiers in output: `ADR-0001`, `SPEC-0002`, `Req 3`. Do not abbreviate.
- Include file paths with line numbers in the Location column when possible (e.g., `src/auth/login.ts:45`).
- Use `##` for the top-level heading (report title) and `###` for sections within the report.
- When the target is a single file, the Category column may be omitted from the findings table if all findings are in the same category.
