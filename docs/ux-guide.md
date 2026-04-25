# UX Guide: New Skills for the SDD Plugin

This guide defines the user experience patterns for the four new skills introduced by [ADR-0001](adrs/ADR-0001-drift-introspection-skills.md) and [ADR-0002](adrs/ADR-0002-init-and-context-priming-skill.md). Developers implementing these skills MUST follow these conventions to maintain consistency with the existing plugin.

---

## 1. Frontmatter Conventions

Every SKILL.md MUST include YAML frontmatter with these fields:

| Field | Required | Notes |
|-------|----------|-------|
| `name` | Yes | Lowercase, matches the skill directory name |
| `description` | Yes | One sentence. Starts with a verb. Includes trigger phrases. |
| `allowed-tools` | Yes | Comma-separated list of tools the skill may use |
| `argument-hint` | Yes | Shows accepted arguments in `[brackets]` with flags |
| `disable-model-invocation` | No | Only for read-only skills that need no LLM reasoning (e.g., `list`, `status`) |
| `context` | No | Set to `fork` only if the skill needs an isolated context (e.g., `docs`) |

### Allowed-tools Patterns

Existing skills follow two tiers:

- **Read-only skills** (`list`, `status`): `Read, Glob, Grep` (plus `Write, Edit, AskUserQuestion` for status)
- **Creative skills** (`adr`, `spec`, `docs`, `work`): `Bash, Read, Write, Edit, Glob, Grep, Task, WebFetch, WebSearch, TeamCreate, TeamDelete, TaskCreate, TaskUpdate, TaskList, TaskGet, SendMessage, AskUserQuestion`

The new skills should follow these patterns:

| Skill | Tier | `allowed-tools` |
|-------|------|-----------------|
| `init` | Creative (writes CLAUDE.md) | `Read, Write, Edit, Glob, Grep, AskUserQuestion` |
| `prime` | Read-only (loads context) | `Read, Glob, Grep` |
| `check` | Read-only (reports findings) | `Read, Glob, Grep` |
| `audit` | Creative (team mode) | `Read, Glob, Grep, Task, TeamCreate, TeamDelete, TaskCreate, TaskUpdate, TaskList, TaskGet, SendMessage, AskUserQuestion` |
| `work` | Creative (team + worktrees) | `Bash, Read, Write, Edit, Glob, Grep, Task, WebFetch, WebSearch, TeamCreate, TeamDelete, TaskCreate, TaskUpdate, TaskList, TaskGet, SendMessage, AskUserQuestion, ToolSearch, EnterWorktree` |

### `--review` Flag Convention

The `--review` flag is used by `adr` and `spec` to enable team review mode. Among the new skills, only `audit` supports `--review`. The `init`, `prime`, and `check` skills do NOT support `--review` -- they are always single-agent.

---

## 2. Argument Patterns

### Argument-hint Format

Argument hints use square brackets for optional arguments. Flags like `--review` appear after positional arguments.

| Skill | `argument-hint` | Examples |
|-------|-----------------|----------|
| `init` | (no arguments) | `/sdd:init` |
| `prime` | `[topic]` | `/sdd:prime`, `/sdd:prime security`, `/sdd:prime api authentication` |
| `check` | `[target]` | `/sdd:check`, `/sdd:check src/auth/`, `/sdd:check ADR-0001`, `/sdd:check SPEC-0001` |
| `audit` | `[scope] [--review]` | `/sdd:audit`, `/sdd:audit security`, `/sdd:audit --review`, `/sdd:audit api --review` |

### Argument Semantics

**`init`**: Takes no arguments. Always operates on the project root CLAUDE.md.

**`prime [topic]`**: The `topic` is a free-text string used for semantic matching (see Section 7). When omitted, all ADRs and specs are summarized. When provided, only relevant artifacts are loaded.

**`check [target]`**: The `target` can be:
- A file path: `src/auth/login.ts`
- A directory path: `src/auth/`
- An ADR reference: `ADR-0001`
- A SPEC reference: `SPEC-0001`
- Omitted: checks all artifacts against the codebase

**`audit [scope]`**: The `scope` can be:
- A topic keyword: `security`, `api`, `database`
- A directory path: `src/`
- Omitted: audits the entire project

---

## 3. Severity Levels

Both `check` and `audit` use a three-tier severity system for findings.

| Severity | Badge | Meaning | Examples |
|----------|-------|---------|----------|
| Critical | `[CRITICAL]` | Implementation directly contradicts a MUST/SHALL requirement or accepted ADR decision | Code uses REST when ADR mandates GraphQL; spec says MUST encrypt but no encryption found |
| Warning | `[WARNING]` | Implementation partially drifts from a SHOULD/RECOMMENDED requirement, or an artifact is stale | ADR status is `accepted` but related code was significantly refactored; spec scenario not fully covered |
| Info | `[INFO]` | Observation that may need attention but is not a violation | Coverage gap (code area has no governing ADR); ADR is `proposed` and may need status update |

### Severity Assignment Rules

- A finding that contradicts a MUST, SHALL, or MUST NOT requirement is always **Critical**
- A finding that contradicts a SHOULD or RECOMMENDED requirement is always **Warning**
- A coverage gap (no governing artifact) is always **Info**
- A stale artifact (status does not match reality) is **Warning**
- An inconsistency between ADR and spec (e.g., ADR says X, spec says Y) is **Critical**

---

## 4. Output Formats

### 4.1 `/sdd:init` Output

Init produces a short confirmation report. No tables needed.

```
## SDD Plugin Initialized

CLAUDE.md updated with architecture context.

### What was added:
- Reference to `docs/adrs/` (Architecture Decision Records)
- Reference to `docs/openspec/specs/` (OpenSpec Specifications)
- SDD plugin usage hints

### Next steps:
- Create your first ADR: `/sdd:adr [description]`
- Create your first spec: `/sdd:spec [capability]`
- Prime a session with context: `/sdd:prime [topic]`
```

When CLAUDE.md already has the references (idempotent re-run):

```
## SDD Plugin Already Configured

CLAUDE.md already contains architecture context references. No changes made.

- ADR path: docs/adrs/
- Spec path: docs/openspec/specs/
```

When CLAUDE.md does not exist and is being created:

```
## SDD Plugin Initialized

Created CLAUDE.md with architecture context.

### What was created:
- New CLAUDE.md at project root
- Reference to `docs/adrs/` (Architecture Decision Records)
- Reference to `docs/openspec/specs/` (OpenSpec Specifications)
- SDD plugin usage hints

### Next steps:
- Create your first ADR: `/sdd:adr [description]`
- Create your first spec: `/sdd:spec [capability]`
- Prime a session with context: `/sdd:prime [topic]`
```

### 4.2 `/sdd:prime` Output

Prime presents a structured context summary. The format depends on whether a topic filter is used.

**Without topic filter** (`/sdd:prime`):

```
## Architecture Context Loaded

Primed session with 3 ADRs and 2 specs.

### Architecture Decision Records

| ID | Title | Status | Key Decision |
|----|-------|--------|--------------|
| ADR-0001 | Use React for frontend | accepted | Chose React over Vue/Angular for component ecosystem |
| ADR-0002 | PostgreSQL for persistence | accepted | Chose Postgres over MongoDB for relational integrity |
| ADR-0003 | Event-driven auth service | proposed | Proposing event sourcing for auth audit trail |

### Specifications

| ID | Title | Status | Requirements |
|----|-------|--------|--------------|
| SPEC-0001 | Web Dashboard | approved | 8 requirements, 14 scenarios |
| SPEC-0002 | Auth Service | draft | 5 requirements, 9 scenarios |

### Quick Reference
- Check for drift: `/sdd:check [target]`
- Full audit: `/sdd:audit [scope]`
- List all artifacts: `/sdd:list`
```

**With topic filter** (`/sdd:prime security`):

```
## Architecture Context Loaded (filtered: "security")

Primed session with 1 ADR and 1 spec matching "security".

### Matching ADRs

| ID | Title | Status | Relevance |
|----|-------|--------|-----------|
| ADR-0003 | Event-driven auth service | proposed | Authentication, authorization, audit trail |

### Matching Specs

| ID | Title | Status | Relevance |
|----|-------|--------|-----------|
| SPEC-0002 | Auth Service | draft | Authentication flows, token management, access control |

### Summaries

**ADR-0003: Event-driven auth service**
Proposes event sourcing for the authentication service to provide a complete audit trail of auth events. Chose event sourcing over traditional CRUD for auditability. Status: proposed.

**SPEC-0002: Auth Service**
Defines requirements for user authentication (login, logout, MFA), authorization (role-based access), and token lifecycle management. 5 requirements with 9 scenarios covering happy paths and error cases.

### Skipped (not relevant to "security")
- ADR-0001: Use React for frontend
- ADR-0002: PostgreSQL for persistence
- SPEC-0001: Web Dashboard
```

### 4.3 `/sdd:check` Output — Findings Table

Check produces a concise findings table. This is the standard findings format used by both `check` and the summary section of `audit`.

```
## Drift Check: src/auth/

Checked 3 ADRs and 1 spec against src/auth/. Found 2 findings.

### Findings

| Severity | Category | Finding | Source | Location |
|----------|----------|---------|--------|----------|
| [CRITICAL] | Code vs. Spec | Login endpoint missing MFA verification step required by SPEC-0002 Req 3 | SPEC-0002 | src/auth/login.ts:45 |
| [WARNING] | Code vs. ADR | Auth service uses synchronous calls; ADR-0003 decided on event-driven architecture | ADR-0003 | src/auth/service.ts:12 |

### Summary
- Critical: 1
- Warning: 1
- Info: 0

**Suggested actions:**
- Fix the MFA gap in login.ts to match SPEC-0002
- Run `/sdd:audit src/auth/ --review` for a deeper analysis
```

When no findings are found:

```
## Drift Check: src/auth/

Checked 2 ADRs and 1 spec against src/auth/. No drift detected.

All implementation in src/auth/ aligns with governing ADRs and specs.
```

### 4.4 `/sdd:audit` Output — Audit Report

Audit produces a comprehensive, structured report organized by analysis type.

```
## Design Audit Report

Scope: Full project
Analyzed: 3 ADRs, 2 specs, 47 source files
Total findings: 12 (3 critical, 5 warning, 4 info)

---

### Code vs. Specification Drift

| Severity | Finding | Spec | Location |
|----------|---------|------|----------|
| [CRITICAL] | Login endpoint missing MFA verification step required by Req 3 | SPEC-0002 | src/auth/login.ts:45 |
| [CRITICAL] | Dashboard refresh interval is 30s; spec says MUST be <= 10s | SPEC-0001 | src/dashboard/poller.ts:8 |
| [WARNING] | Error messages use generic text; spec RECOMMENDS user-friendly messages | SPEC-0002 | src/auth/errors.ts:15 |

### Code vs. ADR Drift

| Severity | Finding | ADR | Location |
|----------|---------|-----|----------|
| [WARNING] | Auth service uses synchronous calls; ADR-0003 decided event-driven | ADR-0003 | src/auth/service.ts:12 |
| [WARNING] | Database queries use raw SQL; ADR-0002 decided on ORM usage | ADR-0002 | src/db/queries.ts:22 |

### ADR vs. Spec Inconsistencies

| Severity | Finding | ADR | Spec |
|----------|---------|-----|------|
| [CRITICAL] | ADR-0003 says "JWT tokens" but SPEC-0002 says "opaque tokens" for session management | ADR-0003 | SPEC-0002 |

### Coverage Gaps

| Severity | Area | Description |
|----------|------|-------------|
| [INFO] | src/auth/middleware.ts | No governing spec or ADR |
| [INFO] | src/utils/ | Entire directory has no governing design artifact |
| [INFO] | src/dashboard/charts/ | Chart components not covered by SPEC-0001 |

### Stale Artifacts

| Severity | Artifact | Issue |
|----------|----------|-------|
| [WARNING] | ADR-0003 | Status is `proposed` but implementation exists |
| [WARNING] | SPEC-0001 | Status is `draft` but dashboard is deployed |

### Policy Violations

| Severity | Finding | Source | Location |
|----------|---------|--------|----------|
| [INFO] | SPEC-0002 uses SHOULD where MUST appears intended (Req 4: "SHOULD reject expired tokens") | SPEC-0002 | docs/openspec/specs/auth-service/spec.md |

---

### Summary

| Category | Critical | Warning | Info | Total |
|----------|----------|---------|------|-------|
| Code vs. Spec | 2 | 1 | 0 | 3 |
| Code vs. ADR | 0 | 2 | 0 | 2 |
| ADR vs. Spec | 1 | 0 | 0 | 1 |
| Coverage Gaps | 0 | 0 | 3 | 3 |
| Stale Artifacts | 0 | 2 | 0 | 2 |
| Policy Violations | 0 | 0 | 1 | 1 |
| **Total** | **3** | **5** | **4** | **12** |

### Recommended Actions
1. [CRITICAL] Align login.ts MFA implementation with SPEC-0002 Req 3
2. [CRITICAL] Reduce dashboard poll interval to <= 10s per SPEC-0001
3. [CRITICAL] Resolve token format conflict between ADR-0003 and SPEC-0002
4. [WARNING] Refactor auth service to event-driven per ADR-0003 or update ADR
5. [WARNING] Update ADR-0003 status to `accepted` via `/sdd:status ADR-0003 accepted`
6. [INFO] Consider creating specs for src/utils/ and src/dashboard/charts/
```

---

## 5. Error Handling

Every new skill MUST handle these edge cases with clear, actionable messages. Error messages MUST suggest the next step the user should take.

### 5.1 Common Edge Cases

| Condition | Skill(s) | Message |
|-----------|----------|---------|
| No ADRs exist | `prime`, `check`, `audit` | "No ADRs found in docs/adrs/. Create one with `/sdd:adr [description]`." |
| No specs exist | `prime`, `check`, `audit` | "No specs found in docs/openspec/specs/. Create one with `/sdd:spec [capability]`." |
| Neither ADRs nor specs exist | `prime`, `check`, `audit` | "No design artifacts found. Create an ADR with `/sdd:adr` or a spec with `/sdd:spec` first." |
| `docs/adrs/` directory does not exist | `prime`, `check`, `audit` | "The docs/adrs/ directory does not exist. Run `/sdd:adr [description]` to create your first ADR." |
| `docs/openspec/specs/` directory does not exist | `prime`, `check`, `audit` | "The docs/openspec/specs/ directory does not exist. Run `/sdd:spec [capability]` to create your first spec." |
| Init not run (CLAUDE.md missing design references) | `prime` | "CLAUDE.md does not have SDD plugin references. Run `/sdd:init` first to set up your project, then re-run `/sdd:prime`." |
| CLAUDE.md does not exist | `init` | Create it (do not error -- this is the expected first-run case). |
| Target not found | `check` | "Target not found: `{target}`. Provide a valid file path, directory, ADR reference (ADR-XXXX), or SPEC reference (SPEC-XXXX)." |
| Target is an ADR/SPEC reference that does not exist | `check` | "ADR-0005 not found in docs/adrs/. Run `/sdd:list adr` to see available ADRs." |
| Topic matches nothing | `prime` | "No ADRs or specs matched the topic \"{topic}\". Try a broader term, or run `/sdd:prime` without a topic to see all artifacts." |
| Scope matches nothing | `audit` | "No design artifacts or source files matched the scope \"{scope}\". Try a broader scope, or run `/sdd:audit` without a scope for a full project audit." |
| No drift found | `check`, `audit` | "No drift detected. All implementation aligns with governing ADRs and specs." (See Section 4.3 for full format.) |

### 5.2 Error Message Format

Error messages follow a three-part pattern:
1. **What happened** (the problem)
2. **Why** (brief context, only if not obvious)
3. **What to do** (actionable next step with a command)

Example:
```
No ADRs found in docs/adrs/. Create one with `/sdd:adr [description]`.
```

Not:
```
Error: Unable to locate Architecture Decision Records. The system searched for files matching the pattern docs/adrs/ADR-*.md but found no results. This could mean that no ADRs have been created yet, or that the directory structure is different from expected.
```

---

## 6. Consistency Rules

### 6.1 Description Format

Skill descriptions start with a verb and include at least two trigger phrases after the first sentence.

Pattern: `{Verb} {what it does}. Use when {trigger phrase 1}, {trigger phrase 2}, or {trigger phrase 3}.`

| Skill | Description |
|-------|-------------|
| `init` | Set up CLAUDE.md with SDD plugin references for architecture-aware sessions. Use when the user installs the plugin, says "initialize design", or wants to configure CLAUDE.md for the SDD plugin. |
| `prime` | Load ADR and spec context into the session for architecture-aware responses. Use when the user says "prime context", "load architecture", starts a new session, or wants Claude to know about existing decisions. |
| `check` | Quick-check code against ADRs and specs for drift. Use when the user says "check for drift", "does this match the spec", or wants a fast alignment check on a specific file or directory. |
| `audit` | Comprehensive audit of design artifact alignment across the project. Use when the user says "audit the architecture", "full drift report", or wants a thorough review of spec compliance and ADR adherence. |

### 6.2 Output Section Headers

All skill output uses `##` for the top-level heading (the report title) and `###` for sections within the report. This matches the existing `list` skill pattern.

### 6.3 Table Format

Tables use standard markdown with left-aligned columns. The first column is always the most important identifier (Severity, ID, etc.). Tables MUST have a header row and separator row.

### 6.4 Cross-references to Artifacts

When referencing ADRs and specs in output, always use the full identifier: `ADR-0001`, `SPEC-0002`, `Req 3`. Do not abbreviate to just the number.

### 6.5 Command Suggestions

When suggesting commands to the user, always use inline code format with the full skill name: `` `/sdd:init` ``, `` `/sdd:check src/auth/` ``.

---

## 7. Topic Filtering (`/sdd:prime`)

### Semantic Matching

The `topic` argument uses semantic matching, not keyword search. This means Claude should consider the meaning of the topic, not just whether the word appears in the title or content.

### Matching Rules

1. Read the title, context/problem statement, and decision outcome of each ADR
2. Read the title and overview of each spec
3. Determine relevance based on semantic similarity to the topic
4. An artifact is relevant if the topic relates to any of its key concepts, technologies, domains, or concerns

### Examples of Semantic Matching

| Topic | Should match | Reasoning |
|-------|-------------|-----------|
| `security` | ADR about authentication, spec about access control | Security encompasses auth, authz, encryption, tokens |
| `frontend` | ADR about React, spec about web dashboard | Frontend encompasses UI frameworks, components, rendering |
| `data` | ADR about PostgreSQL, spec about data models | Data encompasses databases, schemas, persistence, storage |
| `api` | ADR about REST vs GraphQL, spec about API endpoints | API encompasses endpoints, protocols, request/response |

### Output for Topic Filtering

When a topic is used, the output MUST include:
1. A "Matching" section with artifacts that are relevant, including a `Relevance` column explaining why each matched
2. A "Skipped" section listing artifacts that were not relevant (just ID and title, no detail)
3. A "Summaries" section with a 2-3 sentence summary of each matching artifact's key points

See Section 4.2 for the full output format.

---

## 8. Cross-skill References

Skills should suggest other skills when it would help the user's workflow. These suggestions appear in a "Suggested actions" or "Next steps" section at the end of the output.

### Reference Matrix

| When this skill runs... | It should suggest... | Condition |
|------------------------|---------------------|-----------|
| `init` | `prime` | Always (next logical step after init) |
| `init` | `adr`, `spec` | When no ADRs or specs exist yet |
| `prime` | `init` | When CLAUDE.md lacks design references |
| `prime` | `check`, `audit` | Always (natural follow-up after loading context) |
| `check` | `audit --review` | When findings include critical issues |
| `check` | `status` | When stale artifact findings are present |
| `check` | `spec` | When coverage gap findings suggest a missing spec |
| `audit` | `status` | When stale artifact findings are present |
| `audit` | `adr` | When coverage gaps suggest missing ADRs |
| `audit` | `spec` | When coverage gaps suggest missing specs |
| `audit` | `check` | Never (audit is a superset of check) |
| `work` | `check` | Always (verify implementation alignment after building) |
| `work` | `audit` | When all issues are complete (comprehensive review) |
| `work` | `enrich` | When issues lack `### Branch` sections |
| `work` | `plan` | When no issues exist for the spec |
| `plan` | `work` | Always (natural follow-up after planning issues) |
| `enrich` | `work` | Always (natural follow-up after enriching issues) |

### Suggestion Format

Suggestions appear as a bulleted list at the end of output, with the command in inline code:

```
### Suggested actions:
- Fix the MFA gap in login.ts to match SPEC-0002
- Run `/sdd:audit src/auth/ --review` for a deeper analysis
- Update ADR-0003 status with `/sdd:status ADR-0003 accepted`
```

---

## 9. Findings Categories

Both `check` and `audit` use these categories for classifying findings. `check` covers the first three; `audit` covers all six.

| Category | Description | Used by |
|----------|-------------|---------|
| Code vs. Spec | Implementation does not match a spec requirement or scenario | `check`, `audit` |
| Code vs. ADR | Implementation contradicts an accepted ADR decision | `check`, `audit` |
| ADR vs. Spec | An ADR decision conflicts with a spec requirement | `check`, `audit` |
| Coverage Gaps | Code areas with no governing ADR or spec | `audit` only |
| Stale Artifacts | ADR/spec status does not match implementation reality | `audit` only |
| Policy Violations | Spec requirements that appear internally inconsistent or use wrong RFC 2119 keywords | `audit` only |

### Note on `check` vs `audit` Scope

`/sdd:check` is intentionally limited to the first three categories to keep it fast. It answers: "Does this code match what the design says?" It does NOT look for missing artifacts or internal spec issues.

`/sdd:audit` covers all six categories for a comprehensive view. It answers: "Is the project's design health good overall?"

---

## 10. Findings Table Schema

The standard findings table has these columns:

| Column | Description | Always present |
|--------|-------------|----------------|
| Severity | `[CRITICAL]`, `[WARNING]`, or `[INFO]` | Yes |
| Category | One of the six categories from Section 9 | Yes (in `audit`), omitted when `check` targets a single file |
| Finding | One-sentence description of the issue | Yes |
| Source | The governing ADR or SPEC reference, or `--` for gaps | Yes |
| Location | File path with line number (`src/auth/login.ts:45`) or artifact path | Yes |

In `audit` reports, findings are grouped by category with per-category tables (see Section 4.4). In `check` reports, findings are in a single flat table (see Section 4.3).
