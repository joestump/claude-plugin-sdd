---
status: draft
date: 2026-05-14
implements: [ADR-0033]
---

# SPEC-0034: cgg Call Graph Integration into SDD Workflow

## Overview

This spec formalizes the integration of `cgg` (NeuralNotwerk call graph generator) into the SDD plugin to provide function-level code visibility across the architecture and design workflow. The integration comprises three components: (1) a new `/sdd:search` skill for unified semantic exploration combining qmd artifact search with cgg call graph generation, (2) enhancements to `/sdd:adr` to auto-generate and embed call graphs in architecture decision records, and (3) enhancements to `/sdd:spec` to auto-generate and embed call graphs in specifications. Together, these changes make design documents self-documenting by coupling architectural decisions and requirements with the code structure that implements them.

See ADR-0033 for decision rationale and architectural considerations.

## Requirements

### Requirement: /sdd:search Unified Semantic Exploration Skill

The `/sdd:search` skill MUST provide a single entry point for operators to explore architecture and code structure using natural language queries. The skill MUST combine qmd semantic search (finding relevant ADRs, specs, and code) with cgg call graph generation (visualizing function-level dependencies).

#### Scenario: Operator searches for JWT authentication implementation

- **WHEN** operator runs `/sdd:search "JWT authentication flow"`
- **THEN** the skill returns (1) relevant ADRs and specs mentioning JWT, (2) code snippets from files qmd identified as relevant, (3) call graphs of auth-related functions showing JWT validation flow, and (4) a unified report explaining how architecture decisions, spec requirements, and code implementation align

#### Scenario: Operator searches for unrelated topic with no matches

- **WHEN** operator runs `/sdd:search "nonexistent technology xyz"`
- **THEN** the skill returns a clear message: "No relevant ADRs, specs, or code found for 'nonexistent technology xyz'. Try a broader search term."

### Requirement: /sdd:search Must Degrade Gracefully When cgg Is Unavailable

If cgg is not installed or returns an error, the skill MUST not fail completely. Instead, it MUST return qmd results (semantic search) with a clear note that call graphs are unavailable.

#### Scenario: cgg is not installed

- **WHEN** operator runs `/sdd:search "module name"` and cgg is not in PATH
- **THEN** the skill returns qmd results with a one-line notice: "Call graphs unavailable — install cgg with: `cargo install cgg` or see https://github.com/NeuralNotwerk/cgg"

#### Scenario: cgg fails on unsupported language

- **WHEN** `/sdd:search` attempts to generate call graphs for a file in an unsupported language
- **THEN** the call graph generation is skipped for that language with a note: "Call graph generation not supported for language `.xyz` — showing qmd results only"

### Requirement: /sdd:search Output Format

The skill MUST support output in multiple formats and MUST present results in a unified report structure.

#### Scenario: Default Markdown output

- **WHEN** operator runs `/sdd:search "capability name"` without format flags
- **THEN** output is formatted as Markdown with sections: (1) Matching ADRs, (2) Matching Specs, (3) Relevant Code Snippets, (4) Call Graphs (Mermaid), (5) Summary explaining connections

#### Scenario: JSON output for tool integration

- **WHEN** operator runs `/sdd:search "capability name" --output json`
- **THEN** output is a structured JSON object with fields: `adr_matches[]`, `spec_matches[]`, `code_snippets[]`, `call_graphs[]`, containing IDs, titles, relevance scores, and formatted content

### Requirement: Enhanced /sdd:adr Skill With Call Graph Generation

When creating or updating an ADR, the skill MUST optionally generate and embed call graphs showing where in the codebase the architectural decision applies.

#### Scenario: User creates ADR and opts to include call graphs

- **WHEN** user runs `/sdd:adr "Switch from sessions to JWT tokens"` and responds "yes" to "Include call graphs? (y/n)"
- **THEN** the skill (1) uses `/sdd:search` to find functions related to the decision (auth, session, JWT keywords), (2) generates call graphs of affected functions using cgg, (3) embeds the call graph in the ADR's `## Architecture Diagram` section, showing before/after structure if applicable

#### Scenario: User creates ADR without call graphs

- **WHEN** user runs `/sdd:adr "some decision"` and responds "no" to call graph prompt
- **THEN** the ADR is created with an empty or optional `## Architecture Diagram` section (user can add diagrams manually later)

#### Scenario: Call graph generation shows implementation scope

- **WHEN** call graphs are embedded in an ADR
- **THEN** the Mermaid diagrams clearly show which functions are affected by the decision, making "where does this apply?" immediately visible to future readers

### Requirement: Enhanced /sdd:spec Skill With Call Graph Generation

When creating or updating a spec, the skill MUST automatically generate and embed call graphs showing the implementation scope and current/proposed code structure.

#### Scenario: User creates spec for payment processing

- **WHEN** user runs `/sdd:spec "Payment processing capability"` and spec authoring completes
- **THEN** the skill (1) uses `/sdd:search` on spec requirements to find implementing code, (2) generates call graphs of payment-related functions (validation, processing, error handling), (3) embeds call graphs in a new `## Implementation` section of spec.md

#### Scenario: Call graphs document requirement-to-function mapping

- **WHEN** a spec includes call graphs in the `## Implementation` section
- **THEN** implementers can see exactly which functions must be created/modified to satisfy each requirement, showing (1) requirement name, (2) relevant functions from call graph, (3) function signatures and relationships

#### Scenario: Refactoring updates include before/after call graphs

- **WHEN** user updates a spec due to refactoring and includes call graphs
- **THEN** the updated spec includes side-by-side call graphs (before and after structure) so reviewers understand the structural impact

### Requirement: Call Graph Generation Uses cgg With Filtering

Call graph generation MUST use cgg under the hood with appropriate filtering to avoid unwieldy output.

#### Scenario: Large codebase produces filtered call graphs

- **WHEN** `/sdd:search` or spec/adr authoring generates call graphs for a module with 100+ functions
- **THEN** the skill automatically applies `--filter` to cgg to focus on the most relevant functions (based on qmd matches or requirement keywords), producing readable Mermaid diagrams under ~20 nodes

#### Scenario: User can request unfiltered call graphs

- **WHEN** user runs `/sdd:search "module" --unfiltered` or directly invokes `/cgg`
- **THEN** the full unfiltered call graph is generated (may be large; user responsible for readability)

### Requirement: Integration With /sdd:adr and /sdd:spec Skills Must Not Break Existing Workflows

Enhancements to `/sdd:adr` and `/sdd:spec` MUST be backward-compatible and optional.

#### Scenario: User creates ADR without call graph option (existing workflow)

- **WHEN** user runs `/sdd:adr "decision"` and the skill does not prompt for call graphs (or user skips the prompt)
- **THEN** ADR is created normally with no call graphs; no error or disruption to existing workflow

#### Scenario: User creates spec without call graph generation (existing workflow)

- **WHEN** user runs `/sdd:spec "capability"` without call graph generation
- **THEN** spec is created normally; call graphs can be added manually later or via future `/sdd:spec --update SPEC-XXXX` with `--include-graphs`

### Requirement: Call Graphs in Design Docs Must Link to Source Code

Whenever call graphs are embedded in specs or ADRs, they MUST be readable Mermaid diagrams with function names that can be cross-referenced to actual source files.

#### Scenario: Reader can trace from spec requirement through call graph to source code

- **WHEN** a spec includes a call graph showing `validate_payment() → process_payment() → log_transaction()`
- **THEN** a developer can open the source files and find these functions by name, enabling navigation from design doc to implementation

### Requirement: cgg Skill Integration With /sdd:discover

The `/sdd:discover` skill (reverse-engineering architecture from code) MUST optionally use `/sdd:search` and call graph results to auto-generate architectural diagrams.

#### Scenario: Discovery generates ADR with call graph context

- **WHEN** user runs `/sdd:discover` on an unfamiliar module
- **THEN** the skill (1) uses `/sdd:search` to understand the module's purpose, (2) generates call graphs showing module structure, (3) proposes ADRs with embedded call graphs to document the discovered architecture

### Requirement: Mermaid Output Compatibility With Documentation Sites

All embedded call graphs MUST be valid Mermaid syntax compatible with Docusaurus, GitHub Markdown rendering, and other common markdown renderers.

#### Scenario: ADR with embedded call graph renders correctly in docs site

- **WHEN** ADR containing `\`\`\`mermaid ... \`\`\`` call graph blocks is published to the documentation site
- **THEN** the call graph renders as an interactive diagram without errors or fallbacks

### Requirement: Error Messages and Logs Must Be Clear

When cgg fails, times out, or encounters unsupported languages, error messages MUST be helpful to operators.

#### Scenario: cgg times out on large codebase

- **WHEN** `/sdd:search` or spec authoring invokes cgg and cgg exceeds timeout (configurable, default 30s)
- **THEN** the skill returns: "Call graph generation timed out (30s). The codebase may be very large. Try: `/cgg module/path --filter auth` to narrow the scope."

#### Scenario: Unsupported language file in target

- **WHEN** cgg encounters a file in an unsupported language (e.g., `.prisma`, `.groovy`)
- **THEN** the skill logs: "Call graph generation skipped for `path/file.prisma` (language not supported by cgg). Showing other results." — no failure, graceful fallback

### Requirement: Documentation and Examples

The plugin MUST include clear documentation on `/sdd:search` usage, call graph embedding, and integration with existing skills.

#### Scenario: User runs /sdd:search --help

- **WHEN** user runs `/sdd:search --help` or `/sdd:search` without arguments
- **THEN** output includes usage examples: `/sdd:search "JWT auth"`, `/sdd:search "payment" --output json`, with explanation that results include artifacts and call graphs

#### Scenario: CLAUDE.md guide includes /sdd:search examples

- **WHEN** user reads the updated CLAUDE.md SDD guide
- **THEN** it includes section "### Exploring Architecture with /sdd:search" with before/after examples showing how to use search before `/sdd:plan`, `/sdd:work`, `/sdd:review`

## Implementation Notes

- cgg binary MUST be detected at runtime (check PATH, provide clear install instructions if missing)
- qmd collections used: `{repo}-adrs`, `{repo}-specs`, `{repo}-code` (per qmd configuration)
- Call graphs MUST respect workspace mode: if in workspace, scope qmd and cgg queries to the selected module
- All call graph Mermaid output MUST be deterministic (consistent ordering) for testing and diffs
- Performance target: `/sdd:search` should complete in under 10 seconds for typical codebases (qmd ~1s, cgg ~2-5s, rendering ~1s)
