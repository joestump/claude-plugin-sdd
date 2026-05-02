---
implements: [ADR-0018, ADR-0019, ADR-0020]
---

# SPEC-0016: Security and Quality Guardrails

## Overview

Cross-cutting security defaults, code quality checks, frontend quality standards, and governing comment reform integrated into the existing SDD plugin skill pipeline. Rather than introducing standalone security or quality skills, these guardrails are woven into `/sdd:spec`, `/sdd:plan`, `/sdd:check`, and `/sdd:init` so that security and quality are part of the normal workflow at every stage — specification authoring, sprint planning, and code verification.

This spec formalizes requirements from ADR-0018 (Security-by-Default for Web Specifications), ADR-0019 (Frontend Quality Standards), and ADR-0020 (Governing Comment Reform). Evidence is drawn from a systematic review of three production projects (spotter, joe-links, claude-ops) built with the SDD plugin.

## Requirements

### Requirement: Mandatory Security Section in Web Specs

When `/sdd:spec` creates or updates a specification that involves HTTP endpoints, web server routes, API definitions, or browser-facing UI, the skill MUST inject a "Security Requirements" section into the spec. The section MUST cover all of the following topics:

- **Authentication**: All endpoints MUST require authentication by default. Any endpoint declared as public (unauthenticated) MUST include an explicit justification for why authentication is not required.
- **Rate limiting**: The spec MUST declare a rate limiting strategy or explicitly state that rate limiting is deferred with justification.
- **Security headers**: The spec MUST require baseline security headers (Content-Security-Policy, X-Frame-Options, X-Content-Type-Options, Referrer-Policy) or reference an existing security headers ADR.
- **Request body size limits**: The spec MUST require bounded request body reading (e.g., `http.MaxBytesReader` in Go) for all endpoints that accept request bodies.
- **CSRF protection**: The spec MUST declare a CSRF protection strategy for state-changing endpoints.
- **Redirect validation**: The spec MUST require validation of redirect targets for any endpoint that performs HTTP redirects with user-supplied URLs.

The security section MUST NOT be injected for specs that do not involve web-facing characteristics (e.g., CLI tools, internal libraries, batch processing).

#### Scenario: Web-facing spec creation

- **WHEN** a user runs `/sdd:spec` for a capability involving HTTP endpoints (e.g., a REST API, a web dashboard, an HTMX application)
- **THEN** the generated spec includes a "Security Requirements" section covering authentication, rate limiting, security headers, request body limits, CSRF protection, and redirect validation

#### Scenario: Non-web spec creation

- **WHEN** a user runs `/sdd:spec` for a capability that does not involve HTTP endpoints (e.g., a CLI tool, a data migration script, an internal Go library)
- **THEN** the generated spec does NOT include a "Security Requirements" section

#### Scenario: Public endpoint justification

- **WHEN** a web-facing spec declares an endpoint as public (unauthenticated), such as a health check, login page, or OAuth callback
- **THEN** the spec MUST include an explicit justification for why that endpoint does not require authentication (e.g., "Health check endpoint is public because load balancers require unauthenticated access for health probes")

#### Scenario: Evidence — claude-ops unauthenticated dashboard

- **WHEN** a project like claude-ops builds a web dashboard without the plugin prompting for authentication requirements
- **THEN** the dashboard ships entirely unauthenticated, allowing any network-adjacent user to make arbitrary configuration changes — this spec prevents that class of failure by making authentication the default

### Requirement: Security Checklist in Issues

When `/sdd:plan` creates issues for stories that involve HTTP endpoints, the skill MUST include a security checklist in the issue body. The checklist MUST cover:

- Authentication middleware applied to the endpoint
- Input validation for all request parameters and body fields
- Output encoding for all user-supplied data rendered in responses
- Rate limiting configured for the endpoint
- Request body size limits enforced

The checklist SHOULD use checkbox syntax (e.g., `- [ ] Authentication middleware applied`) so that implementers can track completion within the issue.

#### Scenario: HTTP endpoint issue creation

- **WHEN** `/sdd:plan` creates an issue for a story that implements or modifies an HTTP endpoint
- **THEN** the issue body includes a security checklist with authentication, input validation, output encoding, rate limiting, and body size limit items

#### Scenario: Non-HTTP issue creation

- **WHEN** `/sdd:plan` creates an issue for a story that does not involve HTTP endpoints (e.g., a database migration, a background job, a library refactor)
- **THEN** the issue body does NOT include a security checklist

#### Scenario: Evidence — joe-links missing rate limiting

- **WHEN** joe-links was planned and implemented without security checklists in issues
- **THEN** zero endpoints had rate limiting, and the OIDC callback had an open redirect vulnerability — security checklists in issues would have surfaced these as explicit requirements at the implementation point

### Requirement: Security Lint Patterns

`/sdd:check` MUST scan source code for the following dangerous patterns and flag each as a security finding:

| Pattern | Language | Severity | Risk |
|---------|----------|----------|------|
| `io.ReadAll(r.Body)` without `http.MaxBytesReader` wrapping the body | Go | WARNING | Unbounded memory allocation from a single request |
| `template.HTML` with content not provably sanitized | Go | WARNING | XSS via Go template safety bypass |
| `http.Redirect` with a URL derived from request parameters | Go | WARNING | Open redirect vulnerability |
| Endpoint/route registration without auth middleware in the handler chain | Go, JS, Python | WARNING | Unauthenticated endpoint exposure |
| `innerHTML` assignment in JavaScript or HTML templates | JS, HTML | WARNING | DOM-based XSS |
| CDN `<script>` or `<link>` tags without `integrity` attribute | HTML | WARNING | Supply-chain risk from compromised CDN |

Each finding MUST include the file path, line number, the matched pattern, and a one-sentence remediation suggestion.

The lint patterns MUST be implemented as text-based pattern matching (grep/regex) against source files, not as AST analysis. False positives are acceptable and expected — the intent is to flag patterns for human review, not to guarantee correctness.

#### Scenario: Unbounded body read detection

- **WHEN** `/sdd:check` scans a Go file containing `io.ReadAll(r.Body)` and the body is not wrapped in `http.MaxBytesReader` within the same function or a calling function in the same file
- **THEN** the check flags a WARNING finding: "Unbounded body read: `io.ReadAll(r.Body)` without `MaxBytesReader`. Wrap the body with `http.MaxBytesReader(w, r.Body, maxBytes)` before reading."

#### Scenario: innerHTML detection

- **WHEN** `/sdd:check` scans JavaScript files or HTML templates containing `.innerHTML =` or `.innerHTML +=` assignments
- **THEN** the check flags a WARNING finding: "`innerHTML` assignment detected — potential DOM-based XSS. Prefer `textContent` for text or use a sanitization library."

#### Scenario: CDN without integrity attribute

- **WHEN** `/sdd:check` scans HTML files containing `<script src="https://...">` or `<link href="https://..."` without an `integrity` attribute
- **THEN** the check flags a WARNING finding: "CDN resource loaded without SRI `integrity` attribute. Add `integrity` and `crossorigin` attributes to prevent supply-chain attacks."

#### Scenario: Unauthenticated endpoint detection

- **WHEN** `/sdd:check` scans route registration code (e.g., `http.HandleFunc`, `router.GET`, `app.get`) and the handler chain does not reference auth middleware
- **THEN** the check flags a WARNING finding: "Endpoint registered without auth middleware. If this endpoint is intentionally public, add a comment: `// Public: [justification]`."

#### Scenario: Evidence — all three repos unbounded body reads

- **WHEN** all three reviewed projects (spotter, joe-links, claude-ops) use `io.ReadAll(r.Body)` without `MaxBytesReader`
- **THEN** the security lint pattern would have flagged all three during `/sdd:check`, enabling remediation before production deployment

### Requirement: Auth-by-Default

When `/sdd:spec` generates specifications for web-facing capabilities, all endpoints MUST require authentication by default. Endpoints that are public (unauthenticated) MUST be explicitly declared in the spec with a justification for each.

The spec template for web-facing capabilities MUST list endpoints in a table or list format that includes an "Auth" column or designation, with all entries defaulting to "Required" and public endpoints marked as "Public" with an accompanying justification.

#### Scenario: Default endpoint authentication

- **WHEN** `/sdd:spec` generates an endpoint table for a web API spec
- **THEN** every endpoint in the table defaults to "Auth: Required"

#### Scenario: Explicit public endpoint declaration

- **WHEN** a spec author declares an endpoint as public during `/sdd:spec`
- **THEN** the spec includes the endpoint with "Auth: Public" and a justification field (e.g., "Public: Health check — required for load balancer probes")

#### Scenario: Evidence — claude-ops dashboard

- **WHEN** claude-ops was specified without auth-by-default
- **THEN** the entire dashboard shipped unauthenticated — auth-by-default would have required explicit justification for every unauthenticated route, preventing accidental exposure

### Requirement: Go Code Quality Guidelines

For projects where `/sdd:spec` or `/sdd:init` detects a `go.mod` file at the project root, the following Go-specific quality guidelines MUST be applied:

1. `/sdd:init` SHOULD suggest creating a structured logging ADR that mandates `slog` over `log.Printf` or `fmt.Printf` when initializing a Go project for the first time.

2. `/sdd:spec` MUST include error handling guidelines in the generated spec when the spec involves Go code:
   - Error wrapping MUST use `%w` in `fmt.Errorf`, never `%v` for errors that should be unwrappable
   - Domain concepts MUST define sentinel errors (e.g., `ErrNotFound`, `ErrSlugTaken`) rather than returning string-matched errors
   - Functions MUST NOT return `nil, nil` for not-found conditions — they MUST use sentinel errors or a boolean return value

3. When a spec involves concurrency (goroutines, background workers, scheduled tasks), the spec MUST require:
   - Context propagation for all operations (never bare `http.Get()`, always `http.NewRequestWithContext`)
   - Goroutine lifecycle tracking (all goroutines MUST participate in a shutdown mechanism such as `sync.WaitGroup` or `errgroup.Group`)
   - Race safety (no unprotected shared state mutations in goroutines — MUST use `sync.Mutex`, `atomic`, or channels)

4. `/sdd:plan` SHOULD create a CI story for Go projects that includes `go vet`, `go test -race`, and `golangci-lint` in the CI pipeline.

#### Scenario: Go project initialization with logging suggestion

- **WHEN** a user runs `/sdd:init` in a directory containing a `go.mod` file and no existing logging ADR
- **THEN** the skill SHOULD suggest: "This is a Go project. Consider creating an ADR mandating structured logging with `slog` — two of three reviewed Go projects fell back to `log.Printf`."

#### Scenario: Go spec with error handling guidelines

- **WHEN** `/sdd:spec` generates a spec for a Go project (detected via `go.mod`)
- **THEN** the spec includes error handling guidelines requiring `%w` wrapping, sentinel errors for domain concepts, and prohibition of `nil, nil` returns

#### Scenario: Concurrency spec requirements

- **WHEN** `/sdd:spec` generates a spec involving goroutines or background workers
- **THEN** the spec includes requirements for context propagation, goroutine lifecycle tracking, and race safety

#### Scenario: CI story creation

- **WHEN** `/sdd:plan` creates stories for a Go project and no CI story exists in the current plan
- **THEN** the plan SHOULD include a CI story with `go vet`, `go test -race`, and `golangci-lint`

#### Scenario: Evidence — spotter fire-and-forget goroutines

- **WHEN** spotter launched 30+ untracked goroutines without shutdown coordination
- **THEN** the concurrency requirements would have mandated goroutine lifecycle tracking, preventing fire-and-forget patterns

#### Scenario: Evidence — joe-links and claude-ops unstructured logging

- **WHEN** joe-links uses `log.Printf` and claude-ops uses both `log.Printf` and `fmt.Printf` for logging
- **THEN** the `/sdd:init` logging ADR suggestion would have established `slog` as the standard from day one

### Requirement: Accessibility Requirements for UI Specs

When `/sdd:spec` creates or updates a specification that involves user interface components (HTML templates, browser-rendered pages, interactive UI elements), the skill MUST inject an "Accessibility Requirements" section. The section MUST require:

- **WCAG 2.1 AA compliance** as the minimum accessibility target
- **ARIA landmarks** (`role="banner"`, `role="navigation"`, `role="main"`, `role="contentinfo"`) on page structure elements
- **`aria-label`** on all icon-only controls (buttons, links) that have no visible text label
- **`aria-live`** regions for dynamically updated content (HTMX swaps, auto-refresh panels, real-time status updates)
- **Keyboard navigation** for all interactive elements (tab order, Enter/Space activation, Escape to dismiss)
- **Focus management** for modals and dialogs (focus trap on open, return focus on close)

The accessibility section MUST NOT be injected for specs that do not involve UI (e.g., API-only backends, CLI tools, batch jobs).

#### Scenario: UI spec creation

- **WHEN** a user runs `/sdd:spec` for a capability involving HTML templates, browser UI, or interactive frontend components
- **THEN** the generated spec includes an "Accessibility Requirements" section with WCAG 2.1 AA, ARIA landmarks, `aria-label`, `aria-live`, keyboard navigation, and focus management requirements

#### Scenario: Non-UI spec creation

- **WHEN** a user runs `/sdd:spec` for a capability with no UI component (e.g., a REST API consumed by other services, a message queue consumer)
- **THEN** the generated spec does NOT include an "Accessibility Requirements" section

#### Scenario: Evidence — near-absent accessibility across all repos

- **WHEN** spotter has 7 ARIA attributes, joe-links has 1, and claude-ops has 4, with none having ARIA landmarks, keyboard navigation, or focus management
- **THEN** the mandatory accessibility section would have established these requirements before any code was written, preventing the near-total absence of accessibility found in all three reviewed projects

### Requirement: Frontend Test Scaffolding

When `/sdd:plan` creates stories for a spec that touches UI components (HTML templates, JavaScript, CSS, HTMX interactions), the skill MUST create companion test stories alongside the feature stories. Companion test stories MUST cover:

- **Template render tests**: Verify that templates produce correct HTML structure for given input data
- **JavaScript unit tests**: Test inline or external JS functions for correctness
- **HTMX integration tests**: Verify that HTMX swap targets, triggers, and server responses produce the expected DOM state

Each companion test story SHOULD reference the feature story it covers and SHOULD be estimated at no more than half the effort of the feature story.

#### Scenario: UI feature with companion test stories

- **WHEN** `/sdd:plan` creates stories for a spec that includes HTML templates and HTMX interactions
- **THEN** the plan includes companion test stories for template rendering, JavaScript functions, and HTMX swap behavior, alongside the feature implementation stories

#### Scenario: Non-UI feature without companion test stories

- **WHEN** `/sdd:plan` creates stories for a spec that involves only backend logic with no UI components
- **THEN** no companion frontend test stories are created (backend test stories follow existing patterns)

#### Scenario: Evidence — zero frontend tests across all repos

- **WHEN** spotter, joe-links, and claude-ops all have zero frontend tests despite having browser-rendered UI
- **THEN** companion test stories would have ensured that frontend testing was planned as explicit work items from the start, not omitted because no one remembered to create test stories

### Requirement: Template Quality Detection

`/sdd:check` MUST scan HTML templates, JavaScript files, and related frontend assets for the following template quality patterns:

| Pattern | Severity | Issue |
|---------|----------|-------|
| Duplicate inline `<script>` blocks (identical or near-identical content in the same file or across templates) | WARNING | Code duplication; maintenance risk |
| Same form structure appearing in more than one template file | INFO | Template refactoring opportunity |
| Navigation or sidebar markup rendered in more than one template | WARNING | Layout inconsistency risk; should use template partials/includes |
| CDN `<script>` or `<link>` referencing `cdn.tailwindcss.com` or other dev-only CDN URLs | WARNING | Dev-only resource in production |
| More than 1 JS interaction framework loaded per project (e.g., HTMX + Alpine.js + Hyperscript) | INFO | Framework sprawl; missing architectural decision about frontend interaction model |

Each finding MUST include the affected file paths and a one-sentence remediation suggestion.

#### Scenario: Duplicate inline script detection

- **WHEN** `/sdd:check` scans HTML templates and finds identical `<script>` blocks in the same file or across multiple template files
- **THEN** the check flags a WARNING: "Duplicate inline script detected in [files]. Extract to a shared JavaScript file or template partial."

#### Scenario: Dev-only CDN detection

- **WHEN** `/sdd:check` scans HTML templates and finds a `<script>` tag referencing `cdn.tailwindcss.com`
- **THEN** the check flags a WARNING: "Dev-only CDN detected: `cdn.tailwindcss.com` (Tailwind CSS Play CDN). Replace with a production build (PostCSS, Tailwind CLI, or bundler)."

#### Scenario: Multiple JS framework detection

- **WHEN** `/sdd:check` scans a project and finds references to more than one JS interaction framework (e.g., both HTMX and Alpine.js CDN URLs or imports)
- **THEN** the check flags an INFO: "Multiple JS interaction frameworks detected: [list]. Consider an ADR to document the rationale for each framework or consolidate to one."

#### Scenario: Duplicate navigation detection

- **WHEN** `/sdd:check` scans HTML templates and finds navigation or sidebar markup (`<nav>`, elements with `role="navigation"`) rendered in more than one template file without using a shared partial/include
- **THEN** the check flags a WARNING: "Navigation markup appears in multiple templates: [files]. Extract to a shared partial/include to prevent layout drift."

#### Scenario: Evidence — joe-links duplicate JS and claude-ops duplicate nav

- **WHEN** joe-links has `modal_form.html` with an identical JS function defined twice in the same file, and claude-ops renders navigation in two separate templates
- **THEN** the template quality detection would have flagged both patterns during `/sdd:check`

### Requirement: Governing Comment Format

All SDD plugin skills that generate or suggest governing comments MUST use file-level governing comment blocks instead of per-line annotations. The canonical format is a single block at the top of the file:

```
// Governing: ADR-0001 (description), ADR-0005 (description)
// Implements: SPEC-0003 REQ "Requirement Name", SPEC-0007 REQ "Requirement Name"
```

Inline governing comments SHOULD only be used when the connection between a specific line of code and a governing decision is non-obvious from the file-level block alone. The threshold for "non-obvious" is: would a developer reading the file-level block reasonably understand why this particular code exists? If yes, the inline comment is unnecessary.

Skills MUST NOT create separate PRs, issues, or stories for retroactive governing comment addition. Governing comments MUST be added in the same PR that implements the governed feature. `/sdd:plan` MUST NOT generate stories whose sole purpose is adding governing comments to existing files.

#### Scenario: File-level governing block in generated code

- **WHEN** `/sdd:work` generates a new file implementing requirements from SPEC-0003 and decisions from ADR-0001
- **THEN** the file begins with a single governing block (e.g., `// Governing: ADR-0001 (JWT auth)\n// Implements: SPEC-0003 REQ "Auth Middleware"`) and does NOT scatter per-line annotations throughout the file

#### Scenario: Inline comment for non-obvious connection

- **WHEN** a file governed by ADR-0005 (graceful shutdown) contains a `time.Sleep(5 * time.Second)` that implements a drain delay, and the connection between the sleep and the shutdown ADR is not obvious from the file-level block
- **THEN** an inline comment is appropriate: `// Governing: ADR-0005 — drain delay allows in-flight requests to complete before shutdown`

#### Scenario: No retroactive governing comment PRs

- **WHEN** `/sdd:plan` generates a sprint plan and an existing file lacks governing comments
- **THEN** the plan MUST NOT include a story to retroactively add governing comments to that file — comments are added when the file is next modified for functional reasons

#### Scenario: Evidence — spotter comment density

- **WHEN** spotter's `main.go` has 40+ per-line governing comments with more comment lines than code
- **THEN** the file-level consolidation format would have reduced this to a single 2-3 line block at the top of the file, dramatically improving readability

#### Scenario: Evidence — claude-ops retroactive batching

- **WHEN** claude-ops launched approximately 78 concurrent PRs solely to add governing comments to existing files, creating merge conflicts on every overlapping target
- **THEN** the "no retroactive batching" rule would have prevented those PRs entirely, eliminating the conflict source
