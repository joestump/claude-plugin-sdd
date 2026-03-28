## Architecture Context

This project uses the [design plugin](https://github.com/joestump/claude-plugin-design) for architecture governance.

- Architecture Decision Records are in `docs/adrs/`
- Specifications are in `docs/openspec/specs/`

### Design Plugin Skills

| Skill | Purpose |
|-------|---------|
| `/design:adr` | Create a new Architecture Decision Record |
| `/design:spec` | Create a new specification |
| `/design:list` | List all ADRs and specs with status |
| `/design:status` | Update the status of an ADR or spec |
| `/design:docs` | Generate a documentation site |
| `/design:init` | Set up CLAUDE.md with architecture context |
| `/design:prime` | Load architecture context into session |
| `/design:check` | Quick-check code against ADRs and specs for drift |
| `/design:audit` | Comprehensive design artifact alignment audit |
| `/design:discover` | Discover implicit architecture from existing code |
| `/design:plan` | Break a spec into trackable issues with project grouping and branch conventions |
| `/design:organize` | Retroactively group issues into tracker-native projects |
| `/design:enrich` | Add branch naming and PR conventions to existing issues |
| `/design:work` | Pick up tracker issues and implement them in parallel using git worktrees |
| `/design:review` | Review and merge PRs using reviewer-responder agent pairs |

Run `/design:prime [topic]` at the start of a session to load relevant ADRs and specs into context.

### Governing Comments

When implementing code governed by ADRs or specs, leave comments referencing the governing artifacts:

```
// Governing: ADR-0001 (chose JWT over sessions), SPEC-0003 REQ "Token Validation"
```

These comments help future sessions (and `/design:check`) trace implementation back to decisions.

### Workflow

1. **Decide**: `/design:adr` — record the architectural decision
2. **Specify**: `/design:spec` — formalize requirements with RFC 2119 language
3. **Plan**: `/design:plan` — break the spec into trackable issues in your tracker
4. **Enrich**: `/design:organize` and `/design:enrich` — add projects and branch conventions
5. **Build**: `/design:work` — pick up issues and implement in parallel using git worktrees
6. **Review**: `/design:review` — review and merge PRs with spec-aware code review
7. **Validate**: `/design:check` and `/design:audit` to catch drift

### Session Coordination

When orchestrating multiple design plugin skills in a single session (e.g., running `/design:work` on several issues), use `TeamCreate` to coordinate agents. Do not spawn ad-hoc background agents for work that requires coordination — `SendMessage` only works within a Team, and isolated agents cannot see sibling file claims or type creations.
