---
status: proposed
date: 2026-05-09
decision-makers: joestump
---

# ADR-0027: Non-Authoritative Artifact Filtering in `/sdd:prime`

## Context and Problem Statement

`/sdd:prime` loads all ADRs and specs into the session context regardless of their status. As the project grows, artifacts accumulate statuses like `superseded`, `deprecated`, and `rejected` — these represent decisions that are no longer authoritative. Loading them alongside active artifacts creates two problems:

1. **Context pollution**: Non-authoritative artifacts consume context window space that could be used for actual implementation work. A session primed with 30 ADRs where 10 are superseded wastes a third of the architecture context on outdated decisions.
2. **Decision confusion**: An agent (or human) scanning the primed context may follow a superseded decision instead of its replacement. Nothing in the current output distinguishes "this is the current truth" from "this was replaced six months ago." The flat table treats all statuses equally.

MADR frontmatter already tracks `status` (accepted, proposed, superseded, deprecated, rejected) and the `superseded-by` field links old decisions to their replacements. `/sdd:prime` should leverage these fields to present only authoritative artifacts by default while preserving discoverability of historical decisions.

## Decision Drivers

* **Context window efficiency** — primed context should maximize the ratio of actionable architecture information to total tokens consumed
* **Decision clarity** — agents and humans should be able to trust that primed artifacts represent current architectural truth
* **Historical discoverability** — superseded and deprecated artifacts still have value for understanding why decisions changed; they should not be invisible
* **Transition traceability** — when an artifact is superseded, the user should see what replaced it without having to hunt through files
* **Consistency with topic filtering** — the existing topic filter already has a "Skipped" section pattern; non-authoritative filtering should follow the same UX

## Considered Options

* **Option 1**: Filter non-authoritative statuses from main tables with a callout footer showing excluded artifacts and their transitions
* **Option 2**: Keep all artifacts in the main table but add a status badge/icon to distinguish non-authoritative ones
* **Option 3**: Add an `--all` flag to include non-authoritative artifacts, exclude them silently by default

## Decision Outcome

Chosen option: "Option 1 — Filter with callout footer", because it removes non-authoritative artifacts from the active context while preserving full visibility of what was excluded and why. The footer pattern is consistent with the existing "Skipped" section in topic-filtered mode and provides transition links (superseded-by) so users can trace decision evolution without opening files.

The set of non-authoritative statuses is: `superseded`, `deprecated`, `rejected`. All other statuses (`accepted`, `proposed`, `draft`, or missing) are considered authoritative and remain in the main tables.

### Consequences

* Good, because primed context only contains actionable, current architectural decisions — agents won't follow outdated guidance
* Good, because the footer section preserves discoverability without polluting the main tables
* Good, because `superseded-by` transitions in the footer let users trace decision evolution at a glance
* Good, because the pattern is consistent with the existing "Skipped" section in topic-filtered output
* Good, because context window usage improves as non-authoritative artifacts are summarized in one-liners rather than full table rows
* Bad, because `/sdd:status` must enforce `superseded-by` links when marking an artifact superseded — an incomplete transition leaves a dead-end in the footer (out of scope for this ADR; tracked separately)
* Neutral, because topic-filtered mode still surfaces non-authoritative artifacts when relevant to the topic, but flags them with a warning — this is a deliberate trade-off favoring historical context over strict filtering

### Confirmation

Implementation will be confirmed by:

1. Running `/sdd:prime` on a project with superseded/deprecated/rejected ADRs excludes them from the main ADR table
2. Excluded artifacts appear in a "Non-Authoritative (excluded)" footer section with one-liner summaries
3. Superseded artifacts in the footer show `→ superseded by ADR-XXXX` transition links
4. The header count reflects only authoritative artifacts (e.g., "Primed session with 15 ADRs and 10 specs" excludes the 3 superseded ones)
5. Running `/sdd:prime {topic}` where the topic matches a superseded artifact still surfaces it in the results but with a `⚠ superseded` badge
6. Running `/sdd:prime` with zero non-authoritative artifacts produces no footer section
7. Same filtering logic applies to specs with non-authoritative statuses
8. Workspace aggregate mode renders the footer with module-prefixed artifact references (e.g., `[api] ADR-0007: ...`)

## Pros and Cons of the Options

### Option 1: Filter with Callout Footer

Filter `superseded`, `deprecated`, and `rejected` artifacts from the main tables. Add a "Non-Authoritative (excluded)" section at the bottom listing each excluded artifact as a one-liner with its status and transition target (if superseded).

* Good, because the main tables only contain current, actionable decisions
* Good, because the footer preserves discoverability — nothing is silently hidden
* Good, because transition links (`→ superseded by ADR-XXXX`) provide immediate traceability
* Good, because it follows the established "Skipped" section pattern from topic filtering
* Neutral, because the footer adds a small amount of output, but one-liners are minimal
* Bad, because it requires `superseded-by` metadata to be consistently maintained

### Option 2: Keep All with Status Badges

Show all artifacts in the main table but prepend a badge (e.g., `~~strikethrough~~` or `⚠`) to non-authoritative entries.

* Good, because all artifacts remain visible in one place
* Good, because no information is hidden or moved
* Bad, because non-authoritative artifacts still consume context window space as full table rows
* Bad, because agents may still process strikethrough text as valid guidance — visual badges don't reliably signal "ignore this" to an LLM
* Bad, because the table becomes cluttered as more artifacts are superseded over time

### Option 3: Silent Exclusion with `--all` Flag

Exclude non-authoritative artifacts by default with no indication they exist. Add `--all` flag to include them.

* Good, because the output is maximally clean — only current decisions shown
* Bad, because users have no indication that artifacts were excluded — they may not know to use `--all`
* Bad, because superseded decision chains are invisible without explicitly requesting them
* Bad, because it breaks the principle of least surprise — artifacts appear to vanish

## Non-Authoritative Status Definitions

| Status | Meaning | Footer Display |
|--------|---------|---------------|
| `superseded` | Replaced by a newer decision | `ADR-XXXX: {title} → superseded by ADR-YYYY` |
| `deprecated` | No longer recommended but not formally replaced | `ADR-XXXX: {title} (deprecated)` |
| `rejected` | Considered but not adopted | `ADR-XXXX: {title} (rejected)` |

## Impact on Topic-Filtered Mode

When `/sdd:prime {topic}` is used, non-authoritative artifacts that match the topic are **included** in the results but flagged:

- Table rows show status as `⚠ superseded`, `⚠ deprecated`, or `⚠ rejected`
- The summary section includes a note: "This artifact is superseded by ADR-XXXX — see the replacement for current guidance"
- Non-matching non-authoritative artifacts appear in the "Skipped" section as usual

This ensures that someone investigating a topic's history can see the full decision chain, while being clearly warned that certain artifacts are no longer authoritative.

## More Information

- This ADR modifies the output behavior of `/sdd:prime` (ADR-0002, SPEC-0002). The scanning and topic-matching logic remains unchanged; only the presentation layer filters and sections the results.
- The `superseded-by` field is part of the MADR format already used by `/sdd:adr` (ADR-0003). A follow-up should update `/sdd:status` to enforce that marking an artifact as `superseded` requires a `superseded-by` value.
- Related: ADR-0002 (init and context priming), ADR-0003 (foundational artifact formats), ADR-0022 (rename to sdd namespace), SPEC-0002 (initialization and context priming).
