---
name: spec
description: Create a specification with requirements, scenarios, and design rationale. Use when the user wants to write a spec, formalize requirements, convert an ADR to a specification, or says "create a spec".
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Task, WebFetch, WebSearch, TeamCreate, TeamDelete, TaskCreate, TaskUpdate, TaskList, TaskGet, SendMessage, AskUserQuestion
argument-hint: [capability name or ADR reference] [--review]
---

# Create an OpenSpec Specification

You are creating or updating an OpenSpec specification. Every spec is a **paired artifact**: `spec.md` (requirements — what the system does) and `design.md` (architecture and rationale — how and why it does it).

**You MUST ALWAYS create or update BOTH files together. They are a single unit of truth. Never create, edit, or deliver one without the other.**

**When updating an existing spec, you MUST review the companion file for alignment.** If `spec.md` changes, read `design.md` and update it where the architectural decisions or rationale no longer reflect the updated requirements — and vice versa. The two files MUST remain internally consistent at all times.

## Process

1. **Determine the capability name**: Use kebab-case (e.g., `web-dashboard`, `webhook-trigger`). If converting from an ADR, derive from the ADR title. If `$ARGUMENTS` is empty (ignoring flags like `--review`), use `AskUserQuestion` to ask the user what capability they want to specify.

2. **Check for existing directory**: If `docs/openspec/specs/{capability-name}/` already exists, use `AskUserQuestion` to ask whether to update the existing spec or choose a different name. If updating: read both the existing `spec.md` and `design.md` before making changes, then update both files maintaining alignment between them.

3. **Determine the next SPEC number**: Scan `docs/openspec/specs/` for existing spec.md files, find the highest SPEC number used, and increment. SPEC numbers are formatted as `SPEC-XXXX` (e.g., SPEC-0001). Start at SPEC-0001 if none exist. **IMPORTANT**: The prefix is `SPEC-`, NOT `RFC-`. Do not confuse spec numbering with RFC 2119 (which is a language standard for requirements keywords).

4. **Choose drafting mode**: Check if `$ARGUMENTS` contains `--review`.

   **Default (no `--review`)**: Single-agent mode. Research the codebase (read relevant files, understand the current architecture), draft both spec.md and design.md directly, self-review against the architect's checklist in the Rules section, then write both files.

   **With `--review`**: Team review mode.
   - Tell the user: "Creating a drafting team to write and review the spec. This takes a minute or two."
   - Create a Claude Team with `TeamCreate` to draft and review:
     - Spawn a **spec-writer** agent (`general-purpose`) to write both spec.md and design.md based on the user's description or ADR: `$ARGUMENTS`. **Remind the spec-writer that specs use `SPEC-XXXX` numbering, NOT `RFC-XXXX`.**
     - Spawn an **architect** agent (`general-purpose`) to review both documents for completeness, accuracy, RFC 2119 keyword compliance, and proper scenario format. **The architect MUST verify the spec uses `SPEC-XXXX` numbering, not `RFC-XXXX`.**
     - The architect MUST review and approve BOTH documents before they are finalized
     - If converting from an ADR, the spec-writer should read the ADR and use it as the basis
     - If `TeamCreate` fails, fall back to single-agent mode: draft both files directly, then self-review against the architect's checklist in the Rules section before writing.

5. **Write both files**:
   - `docs/openspec/specs/{capability-name}/spec.md`
   - `docs/openspec/specs/{capability-name}/design.md`

6. **Clean up** the team when done (if `--review` was used).

7. **Summarize** what happened (files created, spec documented, review outcome).

8. **Suggest sprint planning**: After the spec is written, suggest: "To break this spec into trackable issues, run `/design:plan SPEC-XXXX`."

9. **CLAUDE.md integration**: Check if this is the first spec (i.e., `docs/openspec/specs/` was just created or contains only this new directory). If so:
   - Check if a `CLAUDE.md` exists in the project root
   - If it exists, check if it already references `docs/openspec/specs/`
   - If no reference exists, ask the user: "I can add an Architecture Context section to your CLAUDE.md so future sessions know about your specs. Shall I?"
   - If the user says yes, append an `## Architecture Context` section with `- Specifications are in docs/openspec/specs/`
   - If `CLAUDE.md` doesn't exist, suggest creating one

### Team Handoff Protocol (only for `--review` mode)

Follow the standard team handoff protocol from the plugin's `references/shared-patterns.md`. The drafter is the spec-writer; the reviewer is the architect who checks both spec.md and design.md against the Rules checklist below.

## Web-Facing Detection and Security Injection

<!-- Governing: ADR-0018 (Security-by-Default), SPEC-0016 REQ "Mandatory Security Section in Web Specs" -->

Before writing the spec, determine whether the capability is **web-facing**. A spec is web-facing if ANY of the following are true:

- It defines or modifies HTTP endpoints (REST API, GraphQL, gRPC-web, etc.)
- It involves web server routes or middleware
- It includes browser-rendered UI (HTML templates, HTMX, SPAs)
- It describes an API consumed over HTTP/HTTPS
- The capability name or description references: API, dashboard, webhook, web, HTTP, endpoint, route, server, frontend, UI, portal, gateway

A spec is **NOT web-facing** if it exclusively involves: CLI tools, internal libraries, batch/cron jobs, data migrations, background workers, message queue consumers, or purely offline processing.

### When the spec IS web-facing

You MUST inject a **## Security Requirements** section into spec.md, placed after the functional `## Requirements` section. This section MUST cover all six topics below. Use the template in the "Security Requirements Section Template" below.

You MUST also apply **auth-by-default**: when generating endpoint tables or lists, every endpoint MUST default to "Auth: Required". Any endpoint the spec author wants to be public MUST be listed as "Auth: Public" with an explicit justification (e.g., "Health check — required for load balancer probes"). Do NOT leave any endpoint without an auth designation.

### When the spec is NOT web-facing

Do NOT inject the Security Requirements section. Proceed with the standard spec template only.

## Security Requirements Section Template

When injecting the security section into a web-facing spec, use this template placed after the functional requirements:

```markdown
## Security Requirements

<!-- Governing: ADR-0018 (Security-by-Default), SPEC-0016 REQ "Mandatory Security Section in Web Specs" -->

### Authentication

All endpoints MUST require authentication by default. Public (unauthenticated) endpoints MUST be explicitly listed with justification.

| Endpoint | Auth | Justification |
|----------|------|---------------|
| {endpoint} | Required | — |
| {public endpoint} | Public | {why auth is not required} |

### Rate Limiting

{Declare the rate limiting strategy for this capability. Specify limits per endpoint or globally. If rate limiting is deferred, state the justification.}

### Security Headers

All HTTP responses MUST include the following security headers:

- `Content-Security-Policy`: {policy}
- `X-Frame-Options`: DENY (or SAMEORIGIN with justification)
- `X-Content-Type-Options`: nosniff
- `Referrer-Policy`: strict-origin-when-cross-origin

### Request Body Size Limits

All endpoints that accept request bodies MUST enforce size limits. Request bodies MUST be bounded (e.g., `http.MaxBytesReader` in Go, `express.json({ limit })` in Node.js) to prevent unbounded memory allocation.

Default limit: {size, e.g., 1MB} unless a specific endpoint requires a higher limit with justification.

### CSRF Protection

State-changing endpoints (POST, PUT, PATCH, DELETE) MUST implement CSRF protection. Strategy: {e.g., SameSite=Lax cookies, CSRF tokens, custom header validation}.

### Redirect Validation

Any endpoint that performs HTTP redirects with user-supplied URLs MUST validate the redirect target against an allowlist of permitted domains or paths. Open redirects MUST NOT be permitted.
```

## Auth-by-Default in Endpoint Tables

<!-- Governing: ADR-0018 (Security-by-Default), SPEC-0016 REQ "Auth-by-Default" -->

When a web-facing spec includes an endpoint table or endpoint list, you MUST apply auth-by-default:

1. Every endpoint defaults to **"Auth: Required"**
2. If the spec author identifies endpoints that should be public, mark them as **"Auth: Public"** and require a justification
3. Justifications MUST be specific (e.g., "Health check — load balancer requires unauthenticated access"), not generic (e.g., "public endpoint")

Example endpoint table with auth-by-default:

```markdown
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/items | Required | List items |
| POST | /api/items | Required | Create item |
| GET | /health | Public | Health check — required for load balancer probes |
| GET | /login | Public | Login page — must be accessible to unauthenticated users |
```

## spec.md Template

```markdown
# SPEC-XXXX: {Capability Title}

## Overview

{Brief description of what this capability does and why it exists. If derived from an ADR, reference it here (e.g., "See ADR-0003").}

## Requirements

### Requirement: {Descriptive Name}

{Description using RFC 2119 keywords. Every normative statement MUST use SHALL, MUST, MUST NOT, SHOULD, SHOULD NOT, MAY, REQUIRED, RECOMMENDED, or OPTIONAL per RFC 2119.}

#### Scenario: {Scenario Name}

- **WHEN** {precondition or trigger}
- **THEN** {expected outcome}

#### Scenario: {Another Scenario}

- **WHEN** {precondition or trigger}
- **THEN** {expected outcome}

### Requirement: {Another Requirement}

{Description with RFC 2119 keywords.}

#### Scenario: {Scenario Name}

- **WHEN** {precondition or trigger}
- **THEN** {expected outcome}
```

**Note:** For web-facing specs, append the Security Requirements section (from the template above) after the functional requirements.

## design.md Template

```markdown
# Design: {Capability Title}

## Context

{Background, current state, constraints, stakeholders. Reference the spec and any related ADRs.}

## Goals / Non-Goals

### Goals
- {goal 1}
- {goal 2}

### Non-Goals
- {non-goal 1}
- {non-goal 2}

## Decisions

### {Decision 1 Title}

**Choice**: {what was decided}
**Rationale**: {why this over alternatives}
**Alternatives considered**:
- {alternative A}: {why rejected}
- {alternative B}: {why rejected}

### {Decision 2 Title}

**Choice**: {what was decided}
**Rationale**: {why}

## Architecture

{High-level architecture description. MUST include at least one Mermaid diagram.}

```mermaid
{Mermaid diagram: C4 context/container for system-level, sequence for flows, ERD for data models.}
```

## Risks / Trade-offs

- **{Risk 1}** → {Mitigation}
- **{Risk 2}** → {Mitigation}

## Migration Plan

{Steps to deploy, rollback strategy if applicable. Omit if greenfield.}

## Open Questions

- {question 1}
- {question 2}
```

## Rules

- You MUST ALWAYS create or update BOTH spec.md AND design.md together -- never one without the other
- When ANY change is made to spec.md, design.md MUST be reviewed and updated where requirements have changed the architecture, decisions, or rationale -- and vice versa. Both files MUST remain consistent with each other at all times.
- spec.md MUST use RFC 2119 language (SHALL, MUST, MUST NOT, SHOULD, SHOULD NOT, MAY, REQUIRED, RECOMMENDED, OPTIONAL) for ALL normative requirements
- spec.md MUST use spec numbering: SPEC-XXXX (sequential, zero-padded to 4 digits). NEVER use RFC-XXXX -- "RFC 2119" refers to the requirements language standard, NOT the spec numbering scheme
- Scenarios MUST use exactly 4 hashtags (`####`) -- using 3 hashtags or bullets will cause silent failures in downstream tooling
- Every requirement MUST have at least one scenario
- design.md focuses on HOW and WHY -- architecture and rationale, not line-by-line implementation details
- Self-review (default) or architect review (`--review`) MUST check for:
  - RFC 2119 compliance (every normative statement uses the proper keywords)
  - Scenario format correctness (exactly `####` level headings with WHEN/THEN)
  - Completeness of both documents
  - Alignment between spec requirements and design decisions
  - **Security section present for web-facing specs** (Governing: ADR-0018, SPEC-0016)
  - **Auth-by-default applied to all endpoint tables** (Governing: ADR-0018, SPEC-0016)
- If converting from an ADR, reference the ADR number in the spec's Overview section
- design.md MUST include at least one Mermaid architecture diagram. Prefer C4 context/container diagrams for system-level, sequence diagrams for flows, and ERDs for data models.
- When implementing code governed by this spec, agents SHOULD leave governing comments referencing the spec and requirement numbers: `// Governing: SPEC-XXXX REQ "Requirement Name", ADR-XXXX`
- For web-facing specs: MUST inject the Security Requirements section covering authentication, rate limiting, security headers, body size limits, CSRF protection, and redirect validation (Governing: ADR-0018, SPEC-0016 REQ "Mandatory Security Section in Web Specs")
- For web-facing specs: MUST apply auth-by-default — every endpoint defaults to "Auth: Required"; public endpoints need "Auth: Public" with explicit justification (Governing: ADR-0018, SPEC-0016 REQ "Auth-by-Default")
- MUST NOT inject the Security Requirements section for non-web specs (CLI tools, libraries, batch jobs, data migrations, background workers)
