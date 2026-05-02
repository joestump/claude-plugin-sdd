---
implements: [ADR-0002]
---

# SPEC-0002: Initialization and Context Priming

## Overview

Onboarding and session-startup capabilities for the SDD plugin. The `/sdd:init` skill handles one-time project setup (creating/updating CLAUDE.md), while `/sdd:prime` handles per-session context loading with optional topic filtering. See ADR-0002.

## Requirements

### Requirement: Project Initialization

The `/sdd:init` skill SHALL create or update the project's `CLAUDE.md` with an `## Architecture Context` section referencing `docs/adrs/` and `docs/openspec/specs/`. It MUST be idempotent -- running it multiple times MUST NOT duplicate content or corrupt existing `CLAUDE.md` content.

#### Scenario: First-time initialization with no CLAUDE.md

- **WHEN** a user runs `/sdd:init` in a project with no `CLAUDE.md`
- **THEN** the skill SHALL create a `CLAUDE.md` with an `## Architecture Context` section containing references to `docs/adrs/` and `docs/openspec/specs/`, a brief explanation of available SDD plugin skills, and a note about using `/sdd:prime`

#### Scenario: Initialization with existing CLAUDE.md

- **WHEN** a user runs `/sdd:init` in a project with an existing `CLAUDE.md` that lacks SDD plugin references
- **THEN** the skill SHALL append an `## Architecture Context` section without modifying existing content

#### Scenario: Re-running initialization

- **WHEN** a user runs `/sdd:init` in a project where `CLAUDE.md` already contains SDD plugin references
- **THEN** the skill SHALL report that the project is already configured and not modify the file

### Requirement: Context Priming

The `/sdd:prime` skill SHALL load summaries of existing ADRs and specs into the context window and present them in a structured format. It MUST support an optional topic argument to filter artifacts by relevance.

#### Scenario: Prime with no topic filter

- **WHEN** a user runs `/sdd:prime`
- **THEN** the skill SHALL read all ADRs from `docs/adrs/` and all specs from `docs/openspec/specs/`, summarize each, and present them in a structured table

#### Scenario: Prime with topic filter

- **WHEN** a user runs `/sdd:prime security`
- **THEN** the skill SHALL use semantic matching to identify and load only ADRs and specs related to the "security" topic (including related concepts like authentication, authorization, encryption)

#### Scenario: Prime with no artifacts

- **WHEN** a user runs `/sdd:prime` in a project with no ADRs or specs
- **THEN** the skill SHALL report that no artifacts were found and suggest creating some with `/sdd:adr` or `/sdd:spec`

### Requirement: Init Detection

The `/sdd:prime` skill SHOULD detect when `/sdd:init` has not been run. It MAY suggest running `/sdd:init` first if `CLAUDE.md` lacks SDD plugin references.

#### Scenario: Prime before init

- **WHEN** a user runs `/sdd:prime` and `CLAUDE.md` does not contain SDD plugin references
- **THEN** the skill SHALL still load and present artifacts but SHOULD suggest running `/sdd:init` for a better experience

### Requirement: Read-Only Operation

The `/sdd:prime` skill MUST NOT modify any files. It SHALL only read artifacts and present summaries. Its allowed-tools MUST be limited to Read, Glob, and Grep.

#### Scenario: Prime does not modify files

- **WHEN** a user runs `/sdd:prime`
- **THEN** no files in the project SHALL be created, modified, or deleted
