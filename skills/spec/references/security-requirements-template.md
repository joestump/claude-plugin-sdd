# Security Requirements Section Template

<!-- Governing: ADR-0018 (Security-by-Default), SPEC-0016 REQ "Mandatory Security Section in Web Specs" -->

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
