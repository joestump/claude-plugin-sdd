## Architecture Context

This project uses the [SDD plugin](https://github.com/joestump/claude-plugin-sdd) for architecture governance.

- Architecture Decision Records are in `docs/adrs/`
- Specifications are in `docs/openspec/specs/`

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
| `/sdd:respond` | Address review feedback on a PR: make the code fixes, push, and reply to each thread |
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
7. **Respond**: `/sdd:respond` — address review feedback on a PR (fix, push, reply); the author-side counterpart to `/sdd:review`
8. **Validate**: `/sdd:check` and `/sdd:audit` to catch drift

### Session Coordination

When orchestrating multiple SDD plugin skills in a single session (e.g., running `/sdd:work` on several issues), use `TeamCreate` to coordinate agents. Do not spawn ad-hoc background agents for work that requires coordination — `SendMessage` only works within a Team, and isolated agents cannot see sibling file claims or type creations.

### SDD Configuration

**Tracker**: GitHub
**Owner**: joestump
**Repo**: claude-plugin-sdd
**Branch Conventions**:
- Prefix: `feature`
- Epic Prefix: `epic`
- Slug Max Length: 50

### Tests and Linting

Run `make check` (`make test` + `make lint` + `make scan`) before pushing.

- `make test` runs the docs-site build-script unit tests (`node --test`), the `/sdd:graph` helper's unit tests (`python3 -m unittest` over `skills/graph/lib/`), and then a full docs-site build.
- `make lint` runs `scripts/check-structure.sh` — plugin manifest, SKILL.md frontmatter, `skills/_index.json` consistency, eval definition shape, and a guard against bare `JSX.Element` annotations in `templates/` — plus a docs-site typecheck.
- `make scan` runs `scripts/gitleaks-scan.sh` — gitleaks over git history and the working tree. Needs `gitleaks` installed (`brew install gitleaks`); it fails rather than skipping when the tool is missing.

The LLM-graded skill evals under `evals/` run only in CI; `make test` does not invoke them.

`.github/workflows/ci.yml` runs the same targets on every PR, so keep new checks in the `Makefile` rather than inlining them into the workflow. Its `lint`, `test`, and `gitleaks` jobs are required status checks on `main` — if you add a job that should gate merges, add it to the required list too, or it runs without gating anything.

### Release Process

`main` is protected: direct pushes are rejected, and `lint`, `test`, and `gitleaks` must pass before anything merges. Enforcement includes admins, so the version bump goes through a PR like any other change.

When releasing a new version:
1. Bump the version in `.claude-plugin/plugin.json`
2. Open a PR with the bump and merge it once CI is green (squash — `main` requires linear history)
3. Create a GitHub release with `gh release create vX.Y.Z --title "vX.Y.Z" --notes "..."` using a haiku as the release summary
4. Always tag releases as `vX.Y.Z` (e.g., `v1.5.0`)
