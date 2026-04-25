# Design: Drift Introspection Skills

## Context

The SDD plugin provides skills for creating and managing ADRs and specs, but has no mechanism for validating that implementation code remains aligned with these governing documents. As projects evolve, drift between design artifacts and code is inevitable. This capability adds two skills -- `/sdd:check` (fast, focused) and `/sdd:audit` (deep, comprehensive) -- to detect and report that drift. See ADR-0001 for the full decision rationale.

## Goals / Non-Goals

### Goals
- Provide fast feedback during development with `/sdd:check`
- Provide thorough analysis during reviews with `/sdd:audit`
- Produce actionable findings with specific file paths and line references
- Support the existing `--review` team pattern for `/sdd:audit`

### Non-Goals
- Auto-fixing drift (a future `/sdd:sync` skill may address this)
- Enforcing drift checks as CI gates (users can integrate manually)
- Replacing manual code review -- the skills augment, not replace, human judgment

## Decisions

### Layered approach over single command

**Choice**: Two separate skills (`/sdd:check` and `/sdd:audit`) differentiated by depth and scope.
**Rationale**: Maps to natural developer workflows -- quick checks while coding, deep audits at review time. A single command that tries to do everything becomes unwieldy.
**Alternatives considered**:
- Single `/sdd:drift` skill: SKILL.md becomes too complex; `--review` mode is awkward for quick checks
- Multiple specialized skills (`/sdd:gaps`, `/sdd:compliance`): Nearly doubles the plugin command count; cross-cutting findings don't fit neatly into categories

### LLM-native semantic analysis

**Choice**: Leverage Claude's semantic understanding for drift detection rather than syntactic pattern matching.
**Rationale**: Design artifacts are natural-language documents. Detecting whether code "matches" an ADR requires understanding intent, not just keyword matching.
**Alternatives considered**:
- Regex-based drift detection: Too brittle for natural-language requirements; high false-positive rate

### Structured findings output

**Choice**: Markdown tables with severity levels (critical, warning, info) for all output.
**Rationale**: Structured output is parseable by downstream tools and consistent across both skills. Severity levels help users prioritize.
**Alternatives considered**:
- Free-form prose: Harder to scan and act on; inconsistent across runs

## Architecture

```mermaid
flowchart TB
    subgraph Input
        adrs["docs/adrs/\nADR-XXXX-*.md"]
        specs["docs/openspec/specs/\n*/spec.md + design.md"]
        code["Source Code"]
    end

    subgraph "/sdd:check (fast)"
        check_parse["Parse target\n(file, dir, ADR, spec)"]
        check_scan["Focused scan\n(target + related artifacts)"]
        check_report["Concise findings table"]
    end

    subgraph "/sdd:audit (deep)"
        audit_scan["Full project scan"]
        audit_analysis["Multi-type analysis:\n- Code vs. Spec\n- Code vs. ADR\n- ADR vs. Spec\n- Coverage gaps\n- Stale artifacts\n- Policy violations"]
        audit_report["Comprehensive report\nwith priorities"]
    end

    subgraph "Team Mode (audit --review)"
        auditor["Auditor Agent\n(performs analysis)"]
        reviewer["Reviewer Agent\n(validates findings)"]
    end

    adrs --> check_parse
    specs --> check_parse
    code --> check_parse
    check_parse --> check_scan
    check_scan --> check_report

    adrs --> audit_scan
    specs --> audit_scan
    code --> audit_scan
    audit_scan --> audit_analysis
    audit_analysis --> audit_report
    audit_report --> auditor
    auditor --> reviewer
    reviewer -->|"APPROVED / revisions\n(max 2 rounds)"| auditor
```

## Risks / Trade-offs

- **False positives**: Semantic analysis may flag intentional deviations as drift. Mitigation: include "info" severity for uncertain findings and provide recommendations rather than assertions.
- **Context window limits**: Large codebases may exceed context for comprehensive audits. Mitigation: `/sdd:audit` scans incrementally by artifact, not by loading everything at once.
- **Overlapping output**: `/sdd:check` and `/sdd:audit` may produce overlapping findings on the same target. This is acceptable since they serve different use cases.

## Open Questions

- Should `/sdd:check` support a `--fix` flag to suggest updates to drifted artifacts?
- Should audit findings be cacheable to avoid re-analyzing unchanged files?
