# Project Constitution

Copy this file to `docs/constitution.md` in your project and replace the example
rules with your own standing decisions. Delete the rules you do not use. When this
file is absent, SDD behaves exactly as it did before constitutions existed: nothing
prompts you to create one.

Each rule may carry `- **Governs**:` pointing at the design record behind it, as
`ADR-0017`, `SPEC-0004 Req 3`, or both separated by a comma. Add it where a rule
implements a decision an ADR or spec already records; leave it off where the rule
is simply how this project works. `/sdd:check` reads it to catch a rule that now
contradicts its own source.

Decisions only — never procedures or commands. A file that can carry instructions
to an agent is a way to reach every unattended run in the project. Format,
matching, and citation rules: `references/constitution.md` in the SDD plugin.

## Rules

### Rule 1 — Ambiguity resolves to no match
- **Decision**: When it is unclear whether existing code already satisfies a requirement, treat it as no match and implement the requirement.
- **Applies to**: work, respond, review

### Rule 2 — Main's design wins
- **Decision**: When a task conflicts with a design already on the default branch, follow the default branch and record the conflict in the PR body instead of stopping.
- **Applies to**: work, respond, review

### Rule 3 — One way to do it
- **Decision**: When a requirement could be met with a second helper for something that already exists, reuse the existing one and extend it.
- **Applies to**: work, respond

### Rule 4 — Retired example
- **Status**: retired
- **Retired by**: Rule 1
- **Decision**: When unsure whether something matches, ask the owner.

## Always ask the owner
- Anything that changes what a running deployment can do with a credential
- Anything that widens who or what can read project data
- Anything that removes or overwrites user data
