## Architecture Context

This project uses the [SDD plugin](https://github.com/joestump/claude-plugin-sdd) for architecture governance.

- Architecture Decision Records are in `docs/adrs/`
- Specifications are in `docs/openspec/specs/`

### qmd Dependency

Starting with SDD plugin v5.0.0, [qmd](https://github.com/tobi/qmd) is a hard dependency — `/sdd:init` enforces qmd presence at setup, and every qmd-aware consumer skill (`/sdd:prime`, `/sdd:check`, `/sdd:audit`, `/sdd:discover`, `/sdd:adr`, `/sdd:spec`, `/sdd:plan`, `/sdd:work`, `/sdd:review`) MAY assume qmd is installed and MUST NOT include conditional fallback paths. If a skill needs to handle "qmd installed but this repo not yet indexed", it routes to `/sdd:index` rather than silently degrading. This invariant lets every skill be designed for hybrid retrieval rather than around its absence.

### SDD Skills

| Skill | Purpose |
|-------|---------|
| `/sdd:adr` | Create a new Architecture Decision Record |
| `/sdd:spec` | Create a new specification |
| `/sdd:list` | List all ADRs and specs with status |
| `/sdd:status` | Update the status of an ADR or spec |
| `/sdd:docs` | Generate a documentation site |
| `/sdd:init` | Set up CLAUDE.md with architecture context |
| `/sdd:prime` | Load architecture context into session |
| `/sdd:check` | Quick-check code against ADRs and specs for drift |
| `/sdd:audit` | Comprehensive design artifact alignment audit |
| `/sdd:discover` | Discover implicit architecture from existing code |
| `/sdd:plan` | Break a spec into trackable issues with project grouping and branch conventions |
| `/sdd:organize` | Retroactively group issues into tracker-native projects |
| `/sdd:enrich` | Add branch naming and PR conventions to existing issues |
| `/sdd:work` | Pick up tracker issues and implement them in parallel using git worktrees |
| `/sdd:review` | Review and merge PRs using reviewer-responder agent pairs |
| `/sdd:graph` | Build and query the artifact graph (validate, impact, ancestors, chain, orphans, cycles, backfill) |
| `/sdd:index` | Index ADRs, specs, and code into qmd collections for hybrid semantic search |
| `/sdd:report-friction` | File a feedback issue against the SDD plugin when one of its skills caused significant churn |

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
