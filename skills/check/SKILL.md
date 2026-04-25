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

   <!-- Governing: ADR-0016 (Workspace Mode), SPEC-0014 REQ "Cross-Module Aggregation" -->

   **Cross-module aggregation**: When in aggregate mode (no `--module`, workspace detected), check all modules and group findings by module in the output. Add a `Module` column to the findings table and organize findings under per-module subheadings. When `--module` is provided, check only that module — no module labels needed. When in single-module mode (no workspace), operate normally.

1. **Parse the target**: Extract the target from `$ARGUMENTS`.
   - A file path: `src/auth/login.ts`
   - A directory path: `src/auth/`
   - An ADR reference: `ADR-0001`
   - A SPEC reference: `SPEC-0001`
   - If `$ARGUMENTS` is empty, check all artifacts against the entire codebase.

2. **Validate the target exists**:
   - For file/directory targets: verify the path exists. If not, report: "Target not found: `{target}`. Provide a valid file path, directory, ADR reference (ADR-XXXX), or SPEC reference (SPEC-XXXX)."
   - For ADR references: glob `{adr-dir}/ADR-{number}-*.md`. If not found, report: "ADR-{XXXX} not found in `{adr-dir}`. Run `/sdd:list adr` to see available ADRs."
   - For SPEC references: glob `{spec-dir}/*/spec.md` and search for the matching SPEC number. If not found, report: "SPEC-{XXXX} not found in `{spec-dir}`. Run `/sdd:list spec` to see available specs."

3. **Locate design artifacts**:
   - Scan `{adr-dir}` for ADR files. If the directory does not exist, report: "The `{adr-dir}` directory does not exist. Run `/sdd:adr [description]` to create your first ADR."
   - Scan `{spec-dir}` for spec files. If the directory does not exist, report: "The `{spec-dir}` directory does not exist. Run `/sdd:spec [capability]` to create your first spec."
   - If neither ADRs nor specs exist, report: "No design artifacts found. Create an ADR with `/sdd:adr` or a spec with `/sdd:spec` first."
   - It is valid for only ADRs or only specs to exist -- proceed with whatever is available.

4. **Determine relevant artifacts**:
   - If the target is a file or directory: read the target code, then read all ADRs and specs to find which ones govern the target area (by semantic relevance -- the ADR/spec mentions the same domain, technology, or component).
   - If the target is an ADR: read the ADR, find related specs and code files that should implement the decision.
   - If the target is a SPEC: read the spec, find related ADRs and code files that should implement the requirements.

5. **Validate spec artifact pairing**: For each spec directory found under `{spec-dir}`, check that both `spec.md` and `design.md` exist. If a `spec.md` exists without a corresponding `design.md` (or vice versa), report as `[WARNING]` under "Code vs. Spec" with finding: "Unpaired spec artifact: {path} exists but {missing-file} is missing. Per ADR-0003, spec.md and design.md are a paired unit." (Governing: ADR-0003, SPEC-0003)

6. **Security lint scan**: Scan source code files in the target for dangerous patterns that indicate security risks. Use text-based pattern matching (Grep tool with regex), NOT AST analysis. False positives are acceptable — flag patterns for human review.

   <!-- Governing: ADR-0018 (Security-by-Default), ADR-0019 (Frontend Quality Standards), SPEC-0016 REQ "Security Lint Patterns" -->

   For each pattern below, search applicable source files and report any matches as findings in the output table. All security lint findings use category **Security Lint** and severity **[WARNING]**.

   **Pattern 1 — Unbounded body read**: Reading an HTTP request body without enforcing a size limit allows a single request to allocate arbitrary memory.
   - Go: `io.ReadAll(r.Body)` or `ioutil.ReadAll(r.Body)` without `http.MaxBytesReader` wrapping the body in the same function or file.
   - JS/Node: `req.on('data'` accumulating chunks without a size check, or body-parser / express.json without a `limit` option.
   - Python: Reading `request.body` or `request.data` without `DATA_UPLOAD_MAX_MEMORY_SIZE` or equivalent framework-level limit.
   - Remediation: "Wrap the body with a size-limiting reader (e.g., `http.MaxBytesReader` in Go, `{ limit: '1mb' }` in Express, `DATA_UPLOAD_MAX_MEMORY_SIZE` in Django) before reading."

   **Pattern 2 — Template safety bypass**: Disabling template auto-escaping injects raw HTML into rendered output, enabling XSS.
   - Go: `template.HTML(` casting user-supplied or unsanitized content.
   - JS/React: `dangerouslySetInnerHTML` usage.
   - Python/Jinja: `|safe` filter or `{% autoescape false %}` in Jinja/Django templates.
   - Remediation: "Avoid bypassing template auto-escaping. If raw HTML is required, sanitize the content with a trusted library before marking it safe."

   **Pattern 3 — User-controlled redirect**: HTTP redirects where the target URL comes from request parameters allow open redirect attacks.
   - Go: `http.Redirect(` where the URL argument references `r.URL.Query()`, `r.FormValue`, or `r.PostFormValue`.
   - JS/Express: `res.redirect(req.query` or `res.redirect(req.body` or `res.redirect(req.params`.
   - Python/Django: `redirect(request.GET[` or `redirect(request.POST[` or `HttpResponseRedirect(request.GET[`.
   - Remediation: "Validate redirect targets against an allowlist of trusted URLs or paths. Never redirect to a raw user-supplied URL."

   **Pattern 4 — Missing auth middleware**: Route or endpoint registration without authentication middleware in the handler chain leaves the endpoint publicly accessible.
   - Go: `http.HandleFunc(` or `router.GET(` / `router.POST(` / `mux.Handle(` where the handler chain does not reference an auth middleware function in the same registration block.
   - JS/Express: `app.get(` / `app.post(` / `router.get(` / `router.post(` without an `auth` or `authenticate` or `requireAuth` middleware in the argument list.
   - Python/Django: View functions or class-based views without `@login_required`, `@permission_required`, or equivalent auth decorator.
   - Remediation: "Add authentication middleware to the handler chain. If this endpoint is intentionally public, add a comment: `// Public: [justification]`."

   **Pattern 5 — DOM injection**: Assigning to `innerHTML` bypasses DOM sanitization and is a common XSS vector.
   - JS/HTML: `.innerHTML =` or `.innerHTML +=` assignments in JavaScript files or inline `<script>` blocks.
   - Remediation: "Prefer `textContent` for text content or use a DOM sanitization library (e.g., DOMPurify) before assigning to `innerHTML`."

   **Pattern 6 — CDN without SRI**: Loading external scripts or stylesheets without Subresource Integrity attributes allows compromised CDNs to inject malicious code.
   - HTML: `<script src="https://` or `<script src="http://` without an `integrity` attribute on the same tag. Also `<link href="https://` or `<link href="http://` with `rel="stylesheet"` without an `integrity` attribute.
   - Remediation: "Add `integrity` and `crossorigin` attributes to all CDN-loaded `<script>` and `<link>` tags. Generate SRI hashes with `shasum` or an online SRI hash generator."

   Each finding MUST include: the file path with line number in the Location column, the matched pattern in the Finding column, and the remediation suggestion. Report findings even if they may be false positives — the goal is to flag patterns for human review.

7. **Template quality scan**: Scan HTML templates, JavaScript files, and frontend assets in the target for template quality patterns. Use text-based pattern matching (Grep tool) to detect the following 5 patterns. All template quality findings use category **Template Quality**.

   <!-- Governing: ADR-0019 (Frontend Quality Standards), SPEC-0016 REQ "Template Quality Detection" -->

   **Pattern 1 — Duplicate inline `<script>` blocks** (Severity: **[WARNING]**): Identical or near-identical `<script>` blocks appearing in the same file or across multiple template files indicate code duplication.
   - Detection: Search for inline `<script>` blocks (not `<script src=`). Compare content of inline script blocks within the same file and across template files. Flag when the same block (or substantially similar content) appears more than once.
   - Remediation: "Duplicate inline script detected in [files]. Extract to a shared JavaScript file or template partial."

   **Pattern 2 — Duplicate form structure** (Severity: **[INFO]**): The same form structure (same `action`, same field names) appearing in multiple template files signals a refactoring opportunity.
   - Detection: Search for `<form` tags across template files. Compare form `action` attributes and field `name` attributes. Flag when two or more templates contain forms with the same structure.
   - Remediation: "Similar form structure found in [files]. Consider extracting to a shared form partial or component."

   **Pattern 3 — Duplicate navigation/sidebar** (Severity: **[WARNING]**): Navigation or sidebar markup rendered in multiple templates without using a shared partial creates layout inconsistency risk.
   - Detection: Search for `<nav` elements or elements with `role="navigation"` across template files. Flag when navigation markup appears in more than one template file without evidence of a shared partial/include (e.g., Go `{{ template "nav" }}`, Jinja `{% include "nav.html" %}`, EJS `<%- include('nav') %>`).
   - Remediation: "Navigation markup appears in multiple templates: [files]. Extract to a shared partial/include to prevent layout drift."

   **Pattern 4 — Dev-only CDN URLs** (Severity: **[WARNING]**): CDN URLs intended only for development (such as `cdn.tailwindcss.com`) should not appear in production templates.
   - Detection: Search for `<script` or `<link` tags referencing known dev-only CDN URLs: `cdn.tailwindcss.com`, `unpkg.com` (when used for production), or any CDN URL containing `/dev/` or `/debug/` in the path.
   - Remediation: "Dev-only CDN detected: `[url]`. Replace with a production build (bundler, CLI tool, or self-hosted asset)."

   **Pattern 5 — Multiple JS interaction frameworks** (Severity: **[INFO]**): Loading more than one JS interaction framework (e.g., HTMX + Alpine.js + Hyperscript, or React + jQuery) signals framework sprawl and a missing architectural decision.
   - Detection: Search across all project files for references to JS interaction frameworks: HTMX (`htmx.org`, `hx-get`, `hx-post`, `hx-swap`), Alpine.js (`alpinejs`, `x-data`, `x-bind`), Hyperscript (`hyperscript.org`, `_="on`), React (`react.`, `ReactDOM`, `jsx`), jQuery (`jquery`, `$(document)`, `$(function`), Vue (`vue.js`, `v-bind`, `v-model`), Stimulus (`stimulus`, `data-controller`). Flag when more than one distinct framework is detected.
   - Remediation: "Multiple JS interaction frameworks detected: [list]. Consider an ADR to document the rationale for each framework or consolidate to one."

   Each finding MUST include the affected file paths in the Location column and the remediation suggestion.

8. **Analyze for drift** across three categories:

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

9. **Produce the findings table** using the standard format:

   ```
   ## Drift Check: {target}

   Checked {N} ADRs and {M} specs against {target}. Found {X} findings.

   ### Findings

   | Severity | Category | Finding | Source | Location |
   |----------|----------|---------|--------|----------|
   | [CRITICAL] | Code vs. Spec | {one-sentence description} | SPEC-XXXX | src/path/file.ts:NN |
   | [WARNING] | Code vs. ADR | {one-sentence description} | ADR-XXXX | src/path/file.ts:NN |
   | [WARNING] | Security Lint | {pattern name}: {matched code}. {remediation} | ADR-0018 | src/path/file.go:NN |
   | [WARNING] | Template Quality | {pattern name}: {description}. {remediation} | ADR-0019 | templates/page.html:NN |

   ### Summary
   - Critical: {N}
   - Warning: {N}
   - Info: {N}
   ```

10. **Add suggested actions** at the end based on findings:
   - If critical issues exist, suggest `/sdd:audit {target} --review` for deeper analysis
   - If stale artifact findings exist, suggest `/sdd:status` to update
   - If coverage gaps suggest a missing spec, suggest `/sdd:spec`
   - Always provide at least one actionable fix suggestion for the highest-severity finding

11. **Handle clean results**: If no drift is found, report:

   ```
   ## Drift Check: {target}

   Checked {N} ADRs and {M} specs against {target}. No drift detected.

   All implementation in {target} aligns with governing ADRs and specs.
   ```

12. **Workspace aggregate output**: When in aggregate mode, use per-module grouping:

   ```
   ## Drift Check: {target}

   Checked {N} ADRs and {M} specs across {K} modules against {target}. Found {X} findings.

   ### [api] Findings

   | Severity | Category | Finding | Source | Location |
   |----------|----------|---------|--------|----------|
   | [CRITICAL] | Code vs. Spec | {description} | SPEC-XXXX | services/api/src/file.ts:NN |

   ### [worker] Findings

   | Severity | Category | Finding | Source | Location |
   |----------|----------|---------|--------|----------|
   | [WARNING] | Code vs. ADR | {description} | ADR-XXXX | services/worker/src/file.ts:NN |

   ### Summary
   | Module | Critical | Warning | Info | Total |
   |--------|----------|---------|------|-------|
   | [api] | N | N | N | N |
   | [worker] | N | N | N | N |
   | **Total** | **N** | **N** | **N** | **N** |
   ```

   If a module has no findings, omit its section and show "No drift detected" in the summary row.

## Severity Assignment Rules

- A finding that contradicts a MUST, SHALL, or MUST NOT requirement is always `[CRITICAL]`
- A finding that contradicts a SHOULD or RECOMMENDED requirement is always `[WARNING]`
- A coverage gap (no governing artifact) is always `[INFO]`
- A stale artifact (status does not match reality) is `[WARNING]`
- An inconsistency between ADR and spec (e.g., ADR says X, spec says Y) is `[CRITICAL]`
- All security lint pattern matches are `[WARNING]` (false positives are acceptable — flag for human review)
- Template quality patterns use their individually defined severity: duplicate scripts and duplicate nav are `[WARNING]`, duplicate forms and framework sprawl are `[INFO]`, dev-only CDN is `[WARNING]`

## Rules

- This skill is always single-agent. It does NOT support `--review`.
- Analyzes three drift categories (Code vs. Spec, Code vs. ADR, ADR vs. Spec) plus two code quality scans (Security Lint, Template Quality). Coverage gaps, stale artifacts, and policy violations are NOT checked — use `/sdd:audit` for a comprehensive six-category analysis.
- Keep analysis focused and fast. Read only the files relevant to the target, not the entire codebase.
- Always use full artifact identifiers in output: `ADR-0001`, `SPEC-0002`, `Req 3`. Do not abbreviate.
- Include file paths with line numbers in the Location column when possible (e.g., `src/auth/login.ts:45`).
- Use `##` for the top-level heading (report title) and `###` for sections within the report.
- When the target is a single file, the Category column may be omitted from the findings table if all findings are in the same category.
- In workspace aggregate mode, MUST group findings by module under per-module subheadings (Governing: ADR-0016, SPEC-0014 REQ "Cross-Module Aggregation")
- In workspace aggregate mode, MUST include a per-module summary table
- When `--module` is provided, check only that module — do not scan other modules
