---
name: discover
description: Discover implicit architectural decisions and spec-worthy subsystems in an existing codebase. Use when the user says "discover architecture", "what decisions exist in this code", "bootstrap ADRs", or wants to reverse-engineer design artifacts from code.
allowed-tools: Read, Glob, Grep, Task, AskUserQuestion
argument-hint: [scope] [--module <name>]
---

# Discover Implicit Architecture

Explore an existing codebase to discover implicit architectural decisions and specification-worthy subsystems. Produces a suggestion report -- does NOT create any files.

## Process

<!-- Governing: ADR-0016 (Workspace Mode), SPEC-0014 REQ "Artifact Path Resolution" -->

0. **Resolve artifact paths**: Follow the **Artifact Path Resolution** pattern from `references/shared-patterns.md` to determine the ADR and spec directories. If `$ARGUMENTS` contains `--module <name>`, resolve paths relative to that module; otherwise, in a workspace, aggregate across all modules. The resolved ADR directory is `{adr-dir}` and spec directory is `{spec-dir}`.

1. **Parse the scope**: Extract the optional scope from `$ARGUMENTS`.
   - A directory path: `src/auth/` -- limit analysis to that subtree
   - A domain keyword: `auth`, `api`, `data` -- limit by semantic relevance
   - If `$ARGUMENTS` is empty, analyze the entire project (or module if `--module` is set)

2. **Validate the scope** (if provided):
   - For directory paths: verify the path exists. If not, report: "Scope not found: `{scope}`. Provide a valid directory path or omit the scope to analyze the entire project."

3. **Load existing design artifacts**:
   - Glob `{adr-dir}/ADR-*.md` and read each file's title, context, and decision outcome
   - Glob `{spec-dir}/*/spec.md` and read each file's title and overview. Validate spec pairing per `references/shared-patterns.md` § "Spec Pairing Validation".
   - Build an exclusion list of already-documented decisions and subsystems
   - If neither directory exists, note that no existing artifacts were found (this is expected for first-time discovery)

4. **Analyze the codebase** across four categories. Use the Task tool to spawn parallel Explore agents for each category. Each agent should return a list of findings with evidence.

   **Agent 1 -- Dependency & Framework Analysis**:
   - Scan for project manifests (e.g., `package.json`, `requirements.txt`, `pyproject.toml`, `Cargo.toml`, `Gemfile`, `pom.xml`, `build.gradle`, `composer.json`, and other ecosystem-specific files).
   - Read dependency lists and identify major framework/library choices
   - Look for lock files to confirm actively used dependencies
   - Identify technology choices that represent architectural decisions (e.g., "chose Next.js over Remix", "chose PostgreSQL over MongoDB", "chose REST over GraphQL")

   **Agent 2 -- Architectural Pattern Analysis**:
   - Examine code structure for API patterns (REST controllers, GraphQL resolvers, gRPC services)
   - Look for data access patterns (ORM usage, repository pattern, direct queries)
   - Identify authentication/authorization patterns (JWT, sessions, OAuth)
   - Detect state management patterns (Redux, Context, Zustand, etc.)
   - Look for messaging/event patterns (queues, pub/sub, event emitters)
   - Identify error handling and logging patterns

   **Agent 3 -- Project Structure & Boundary Analysis**:
   - Examine top-level directory layout and module organization
   - Identify subsystem boundaries (directories with cohesive responsibility)
   - Look for monorepo patterns (workspaces, packages/)
   - Identify API surface boundaries (routes, endpoints, public interfaces)
   - Detect data model boundaries (schema files, migration directories, model definitions)
   - Look for clear module interfaces that suggest spec-worthy subsystems

   **Agent 4 -- Configuration & Infrastructure Analysis**:
   - Scan for Docker/container configuration (Dockerfile, docker-compose.yml, .containerignore)
   - Look for CI/CD configuration (.github/workflows/, .gitlab-ci.yml, Jenkinsfile)
   - Check for infrastructure-as-code (Terraform, CloudFormation, Pulumi)
   - Examine environment configuration (.env.example, config files)
   - Identify deployment targets and hosting decisions
   - Look for monitoring/observability configuration

5. **Merge and deduplicate findings**:
   - Combine results from all four agents
   - Group related findings (e.g., "chose Express" and "REST API pattern" both relate to the API layer)
   - Remove findings that overlap with existing ADRs or specs from step 3
   - For partial overlaps, note what the existing artifact covers and what remains undocumented

6. **Assign confidence levels** to each suggestion:
   - **High**: Explicit evidence in declarations or configuration (e.g., dependency in package.json, Dockerfile present)
   - **Medium**: Inferred from consistent code patterns across multiple files (e.g., repository pattern used in 5+ files)
   - **Low**: Inferred from limited evidence or indirect signals (e.g., a single config value suggesting a deployment target)

7. **Classify suggestions** into two categories:
   - **Suggested ADRs**: Implicit decisions where an alternative existed (technology choices, pattern choices, architectural trade-offs)
   - **Suggested Specs**: Subsystem boundaries with enough complexity to warrant formal specification (3+ files, clear interface, distinct responsibility)

8. **Produce the discovery report** using the output format below.

## Output Format

```
## Discovery Report

Analyzed {scope or "entire project"}: {N} files across {M} directories.
Found {X} suggested ADRs and {Y} suggested specs.
Existing artifacts: {A} ADRs, {B} specs (excluded from suggestions).

### Suggested ADRs

| # | Confidence | Decision | Evidence | Command |
|---|------------|----------|----------|---------|
| 1 | High | {short decision title} | {key evidence: files, deps, config} | `/sdd:adr {description}` |
| 2 | Medium | {short decision title} | {key evidence} | `/sdd:adr {description}` |

{For each suggestion, add a brief paragraph below the table:}

**1. {Decision title}**
{2-3 sentences explaining what was found, what the implicit decision is, and what alternatives likely existed.}
Evidence: `{file1}`, `{file2}`, `{config entry}`

### Suggested Specs

| # | Confidence | Subsystem | Boundary | Command |
|---|------------|-----------|----------|---------|
| 1 | High | {subsystem name} | {files/dirs that define it} | `/sdd:spec {capability}` |
| 2 | Medium | {subsystem name} | {files/dirs} | `/sdd:spec {capability}` |

{For each suggestion, add a brief paragraph below the table:}

**1. {Subsystem name}**
{2-3 sentences explaining the subsystem's responsibility, its boundaries, and why it warrants a formal spec.}
Boundary: `{dir1}/`, `{dir2}/`, `{key files}`

### Already Documented

{List existing ADRs and specs that cover areas found in the codebase, confirming they are accounted for. Omit this section if no existing artifacts.}

- ADR-XXXX: {title} -- covers {what area}
- SPEC-XXXX: {title} -- covers {what area}

### Next Steps

Pick the suggestions you want to formalize:

{For each high-confidence suggestion, repeat the command:}
```
/sdd:adr {description}
/sdd:spec {capability}
```

Or prime your session with existing context first: `/sdd:prime`
```

### Empty Results

If no suggestions are found:

```
## Discovery Report

Analyzed {scope or "entire project"}: {N} files across {M} directories.
No implicit architectural decisions or spec-worthy subsystems were identified.

This may indicate:
- The project is very small or early-stage
- The codebase uses highly conventional patterns that don't require explicit documentation
- A narrower scope might reveal more specific patterns: `/sdd:discover src/`

### Next Steps
- Create your first ADR manually: `/sdd:adr [description]`
- Create your first spec manually: `/sdd:spec [capability]`
```

## Rules

- This skill is READ-ONLY -- it MUST NOT create, modify, or delete any files
- This skill is always single-agent at the top level, but MUST use Task tool to spawn parallel Explore agents for the four analysis categories
- Every suggestion MUST cite specific evidence from the codebase -- file paths, dependency declarations, configuration entries, or code patterns
- Suggestions MUST NOT be based on speculation or assumptions about code that was not read
- MUST read existing ADRs and specs before producing suggestions to avoid duplicating already-documented decisions
- MUST include a confidence level (High, Medium, Low) for every suggestion
- MUST include a ready-to-use `/sdd:adr` or `/sdd:spec` command for every suggestion
- The Command column MUST contain a complete, copy-paste-ready command with a descriptive argument
- Sort suggestions by confidence (High first, then Medium, then Low) within each section
- If the scope argument points to a nonexistent path, report the error and stop -- do NOT fall back to full-project analysis
- Do NOT suggest ADRs for trivial decisions (e.g., "chose npm over yarn" when only one package manager file exists with no evidence of evaluation)
- Do NOT suggest specs for directories with fewer than 3 files unless they represent a critical subsystem boundary
- Keep the report concise -- prefer fewer high-quality suggestions over many low-confidence ones
- Use `##` for the top-level heading and `###` for sections within the report
