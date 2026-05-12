## Architecture Context

This project uses the [SDD plugin](https://github.com/joestump/claude-plugin-sdd) for architecture governance.

- Architecture Decision Records are in `docs/adrs/`
- Specifications are in `docs/openspec/specs/`

### qmd Dependency

Starting with SDD plugin v5.0.0, [qmd](https://github.com/tobi/qmd) is a hard dependency — `/sdd:init` enforces qmd presence at setup, and every qmd-aware consumer skill (`/sdd:prime`, `/sdd:check`, `/sdd:audit`, `/sdd:discover`, `/sdd:adr`, `/sdd:spec`, `/sdd:plan`, `/sdd:work`, `/sdd:review`) MAY assume qmd is installed and MUST NOT include conditional fallback paths. If a skill needs to handle "qmd installed but this repo not yet indexed", it routes to `/sdd:index` rather than silently degrading. This invariant lets every skill be designed for hybrid retrieval rather than around its absence.

### SDD Skills

<!-- SDD-SKILLS-TABLE -->

<!--
  AUTHORING NOTE: The skills table above is generated at runtime by /sdd:init
  from `skills/*/SKILL.md` frontmatter (name + first sentence of description),
  ordered by the canonical lifecycle list maintained in `skills/init/SKILL.md`
  under "Skills Table Generation". When /sdd:init materializes a fresh
  CLAUDE.md, it replaces the `<!-- SDD-SKILLS-TABLE -->` marker with the
  generated GFM table. When converging an existing CLAUDE.md, it merges the
  generated rows into the user's existing table additively.

  Do NOT hand-edit a table into this file. Adding a new skill is a single
  drop-in: create `skills/<name>/SKILL.md` with `name` and `description`
  frontmatter, and the row will appear on the next `/sdd:init` run.

  The static row list that used to live here was kept only as authoring
  reference; it has been removed to prevent the two sources from drifting
  out of sync.
-->


Run `/sdd:prime [topic]` at the start of a session to load relevant ADRs and specs into context.

### Governing Comments

When implementing code governed by ADRs or specs, leave comments referencing the governing artifacts:

```
// Governing: ADR-0001 (chose JWT over sessions), SPEC-0003 REQ "Token Validation"
```

These comments help future sessions (and `/sdd:check`) trace implementation back to decisions.

### Workflow

1. **Decide**: `/sdd:adr` — record the architectural decision
2. **Specify**: `/sdd:spec` — formalize requirements with RFC 2119 language
3. **Plan**: `/sdd:plan` — break the spec into trackable issues in your tracker
4. **Enrich**: `/sdd:organize` and `/sdd:enrich` — add projects and branch conventions
5. **Build**: `/sdd:work` — pick up issues and implement in parallel using git worktrees
6. **Review**: `/sdd:review` — review and merge PRs with spec-aware code review
7. **Validate**: `/sdd:check` and `/sdd:audit` to catch drift

### Session Coordination

When orchestrating multiple SDD plugin skills in a single session (e.g., running `/sdd:work` on several issues), use `TeamCreate` to coordinate agents. Do not spawn ad-hoc background agents for work that requires coordination — `SendMessage` only works within a Team, and isolated agents cannot see sibling file claims or type creations.
