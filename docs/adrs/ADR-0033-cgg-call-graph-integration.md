---
status: proposed
date: 2026-05-14
decision-makers: Plugin maintainers, SDD user community
---

# ADR-0033: Integrate cgg Call Graphs into Design Doc Authoring and Semantic Code Exploration

## Context and Problem Statement

The SDD plugin provides powerful tools for architectural governance (ADRs and specs), drift detection (`/sdd:check`, `/sdd:audit`), and artifact graph analysis (`/sdd:graph`). It also integrates qmd for semantic search across artifacts and code. However, there is no unified, operator-friendly skill for exploring "what's relevant to this query?" that combines:

1. Semantic search across ADRs, specs, and code (qmd)
2. Function-level call graphs and dependencies (cgg, which exists as a standalone skill)

Currently, operators must choose between:
- Running `/sdd:graph` to navigate artifact relationships (ADR→spec→code)
- Running `/cgg` directly to see function-level call graphs
- Using qmd implicitly via `/sdd:prime`, `/sdd:check`, `/sdd:audit`

But there is no single entry point to answer queries like: "Show me everything related to JWT authentication" or "What code implements the payment module?" that would combine architecture decisions, specifications, and function-level structure.

This creates friction when:
- Onboarding to unfamiliar modules (need both architectural context and code structure)
- Planning changes that cross module boundaries (need to understand both ADR decisions and function dependencies)
- Understanding implementation scope before `/sdd:work` (need spec requirements + affected functions)
- Reviewing spec compliance in `/sdd:review` (need to trace from spec requirement through function implementations)
- Discovering where to document new architecture (need to see what's already covered in ADRs/specs and how code is structured)

How can the SDD plugin provide a unified semantic exploration interface that combines qmd's artifact search with cgg's call graph visibility to answer exploratory queries across the full architectural and code landscape?

## Decision Drivers

* **Function-level visibility**: Users need to understand caller/callee relationships when analyzing code structure, especially in unfamiliar codebases
* **Language agnostic**: The tool should work across 30+ languages without language-specific plugins or configuration
* **Zero setup required**: Users should get instant results without installing language servers, build tools, or configuring parsers
* **Mermaid output native**: Call graphs should integrate naturally with Markdown documentation (specs can reference them as `mermaid` blocks)
* **Fast analysis**: Call graph generation should complete in seconds for typical projects (< 100 files)
* **Complementary to existing tools**: The integration should enhance existing skills (`/sdd:discover`, `/sdd:check`, `/sdd:audit`) without replacing them
* **Minimal maintenance**: Adding a new tool dependency should not require maintaining language-specific parsing logic

## Considered Options

### Option 1: Status Quo — Keep Separate Skills

Keep `/sdd:graph` (artifact relationships) and `/cgg` (call graphs) as separate tools. Users run them independently when needed. No unified search interface.

* Good, because each tool has a focused responsibility
* Good, because no new code needed
* Bad, because operators must choose which tool to use (artifact graph? call graph? semantic search?)
* Bad, because no unified entry point for exploratory queries ("show me everything about X")
* Bad, because context-switching between tools is cognitively expensive
* Bad, because qmd semantic search remains implicit/internal, not available as a direct query tool

### Option 2: Unified `/sdd:search` Skill (Recommended)

Create a new human-friendly `/sdd:search <query>` skill that uses qmd semantic search and cgg call graphs together. No standalone `/sdd:callgraph` skill. Users with advanced needs can run `/cgg` directly; operators use `/sdd:search` for exploratory queries.

* Good, because single, intuitive entry point for "what's relevant to this query?"
* Good, because combines architecture (qmd), decisions (ADRs/specs), and code structure (cgg) in one result
* Good, because operators don't need to know which tool (qmd vs cgg) to use
* Good, because leverages existing cgg skill (no duplication)
* Good, because qmd semantic search becomes first-class (currently only internal)
* Good, because naturally integrates with `/sdd:discover`, `/sdd:plan`, `/sdd:work`, `/sdd:review` workflows
* Neutral, because adds one new skill to the plugin surface
* Bad, because the unified interface must balance two different result types (semantic + structural)

### Option 3: Create Separate `/sdd:callgraph` AND `/sdd:search` Skills

Create both a dedicated `/sdd:callgraph` skill for cgg integration AND a `/sdd:search` skill for qmd. Offer maximum flexibility but higher maintenance burden.

* Good, because each skill has explicit purpose
* Good, because advanced users can use either separately
* Bad, because doubles the new surface area (two new skills)
* Bad, because duplicates some functionality between the skills
* Bad, because operators still face choice paralysis ("do I use search or callgraph?")
* Bad, because more code to maintain and document

* Good, because cgg supports 30+ languages out of the box with no configuration
* Good, because cgg is battle-tested and maintained by the open-source community
* Good, because Mermaid output integrates naturally with markdown documentation
* Good, because cgg runs offline with no language server or build step required
* Good, because type inference and cross-file resolution work across language boundaries
* Good, because cgg's maintenance burden falls on upstream; the plugin simply invokes it
* Good, because users already have Mermaid rendering in their docs site (Docusaurus), specs, and ADRs
* Neutral, because adds a Rust binary as a dependency (already acceptable in user environments per existing tooling patterns)
* Neutral, because output format (Mermaid, JSON) is deterministic and testable
* Bad, because if cgg is unavailable or crashes, the skill must degrade gracefully (not a blocker, handled via error handling)

## Decision Outcome

Chosen option: **Option 2 — Unified `/sdd:search` skill**, because it provides a single, intuitive entry point for operators to explore architecture, decisions, and code structure together. Rather than forcing users to choose between qmd and cgg, the unified interface naturally combines semantic search (finding relevant ADRs, specs, and code) with structural understanding (seeing function-level call graphs). This aligns with SDD philosophy: one command for one job. Users with advanced needs can still invoke `/cgg` directly; most operators use `/sdd:search` for exploratory queries.

### Consequences

* Good, because `/sdd:search` provides a single, intuitive entry point for exploratory queries
* Good, because operators can ask natural language questions ("show me JWT auth", "payment module implementation") and get both architecture and code structure
* Good, because qmd semantic search becomes first-class and user-accessible (currently implicit/internal)
* Good, because leverages existing `/cgg` skill (no duplication, users with advanced needs can invoke it directly)
* Good, because combining qmd results (ADRs, specs, related code) with cgg call graphs provides complete context for onboarding and planning
* Good, because `/sdd:search` naturally flows into downstream skills (`/sdd:discover`, `/sdd:plan`, `/sdd:work`, `/sdd:review`)
* Good, because zero-configuration call graph generation aligns with SDD philosophy
* Good, because Mermaid output lands naturally in markdown specs and documentation
* Bad, because adds one new skill to the plugin surface (though less than the "three separate skills" approach)
* Bad, because very large codebases (100k+ functions) may produce unwieldy call graphs (mitigated by filtering)
* Bad, because cgg failures (unsupported language, missing file) must be handled gracefully with fallback
* Neutral, because call graphs are most useful when filtered to specific modules/functions (cgg `--filter` handles this)

### Confirmation

Implementation will be confirmed by:

1. **New skill `/sdd:search`** exists at `skills/search/SKILL.md` and can:
   - Accept natural language queries about architecture, code, and implementation
   - Use qmd hybrid retrieval to find relevant ADRs, specs, and code snippets
   - Use cgg to generate call graphs for code areas matching the query
   - Combine results in a unified report (architecture decisions + spec requirements + function structure)
   - Support optional `--output mermaid|json` to control result format
   - Gracefully degrade if cgg is not installed (fall back to qmd-only results with clear note)
   - Handle unsupported languages with clear feedback

2. **`/sdd:search` enables downstream workflows**:
   - Operators can ask "Show me JWT authentication" and get relevant ADRs, specs, and call graphs
   - Developers can understand implementation scope before `/sdd:work` (spec requirements + affected functions)
   - Reviewers can use `/sdd:search` to understand code context before `/sdd:review`
   - Users discovering architecture can ask exploratory questions and get both decisions and structure

3. **qmd semantic search is now first-class**:
   - `/sdd:search` makes qmd queries directly accessible to operators (previously implicit/internal)
   - Users can ask natural language questions without learning qmd syntax or `/sdd:graph` commands

4. **`/cgg` skill remains available**:
   - Users with advanced needs can invoke `/cgg` directly for raw call graph generation
   - Advanced filtering, format selection, and optimization lives in `/cgg`
   - `/sdd:search` uses `/cgg` under the hood for integrated results

5. **Enhanced `/sdd:adr` authoring**:
   - When creating an ADR, optionally include call graphs showing affected code structure
   - Helps future readers understand "where in the codebase does this decision apply?"
   - Call graphs generated for functions/modules mentioned in the ADR's decision outcome
   - Embedded as Mermaid diagrams in the `## Architecture Diagram` section
   - Example: ADR about "switch from sessions to JWT" includes before/after call graphs of auth boundary functions

6. **Enhanced `/sdd:spec` authoring**:
   - When creating a spec, automatically generate call graphs for implementing code
   - Helps developers understand which functions/modules implement each requirement
   - Call graphs generated from `/sdd:search` results during spec authoring
   - Embedded in `## Implementation` section showing current or proposed code structure
   - Example: Payment processing spec includes call graphs of payment validation, transaction, and error handling functions

7. **Call graphs in refactoring workflows**:
   - When updating specs/ADRs due to refactoring, include before/after call graphs
   - Shows structural changes side-by-side for reviewers
   - Helps assess refactoring impact on related specs and ADRs
   - Embedded in updated design docs to document why the change was necessary

8. **Documentation** includes:
   - `/sdd:search` skill SKILL.md with examples of exploratory queries
   - Enhanced `/sdd:adr` SKILL.md guidance on including call graphs
   - Enhanced `/sdd:spec` SKILL.md guidance on including call graphs  
   - Updated CLAUDE.md guide showing how call graphs strengthen design docs
   - ADR-0033 reference explaining the unified search and authoring approach

## Pros and Cons of the Options

### Option 1: Status Quo — Keep Separate Skills

Keep `/sdd:graph` (artifact relationships) and `/cgg` (call graphs) as separate tools.

* Good, because each tool has a focused responsibility
* Good, because no new code needed
* Bad, because operators must choose between tools (artifact graph? call graph? semantic search?)
* Bad, because no unified entry point for "show me everything about X"
* Bad, because context-switching is cognitively expensive
* Bad, because qmd remains implicit/internal, not accessible as direct query tool
* Bad, because less accessible to operators unfamiliar with SDD internals

### Option 2: Unified `/sdd:search` Skill ← RECOMMENDED

Create a new `/sdd:search <query>` skill combining qmd semantic search and cgg call graphs.

* Good, because single, intuitive entry point for exploratory queries
* Good, because combines architecture (qmd), decisions (ADRs/specs), and code structure (cgg)
* Good, because operators don't need to choose which tool to use
* Good, because leverages existing `/cgg` skill (no duplication)
* Good, because qmd semantic search becomes first-class
* Good, because naturally flows into downstream skills
* Neutral, because adds one new skill (modest surface area increase)
* Bad, because unified interface must balance two different result types (semantic + structural)
* Bad, because very large graphs may be unwieldy (mitigated by filtering)

### Option 3: Create Separate `/sdd:callgraph` AND `/sdd:search`

Create both a dedicated `/sdd:callgraph` skill for cgg AND a `/sdd:search` skill for qmd.

* Good, because each skill has explicit purpose
* Good, because advanced users can use either separately
* Bad, because doubles new surface area (two new skills)
* Bad, because duplicates functionality between skills
* Bad, because operators still face choice paralysis
* Bad, because more code to maintain and document

## More Information

**cgg Repository**: https://github.com/NeuralNotwerk/cgg

**Call Graph Generator Skill**: https://github.com/NeuralNotwerk/cgg/blob/main/skills/cgg/SKILL.md

**Features**:
- 30+ language support (Rust, Python, JavaScript, TypeScript, Go, Java, C/C++, C#, and more)
- Mermaid diagram output (readable by humans and agents)
- JSON, Graphviz DOT, GraphML export formats
- Type inference for better accuracy linking callers to callees
- FFI support (PyO3, wasm-bindgen, JNI, etc.)
- `--filter <regex>` to zoom into specific modules or functions
- Typical project analysis completes in under a second

**Integration Roadmap**:
- **Story 1**: Create `/sdd:search` unified skill combining qmd + cgg
  - Accept natural language queries
  - Use qmd to find relevant ADRs, specs, and code
  - Use cgg to generate call graphs for matching code areas
  - Combine results in unified report
- **Story 2**: Enhance `/sdd:adr` to optionally generate and embed call graphs
  - When authoring ADR, user is prompted: "Include call graphs of affected code? (y/n)"
  - Calls `/sdd:search` with ADR decision keywords to find relevant functions
  - Generates call graphs via cgg and embeds in `## Architecture Diagram` section
  - Shows future readers exactly where in the codebase the decision applies
- **Story 3**: Enhance `/sdd:spec` to auto-generate and embed call graphs
  - When authoring spec, automatically run `/sdd:search` on spec requirements
  - Generate call graphs of current/proposed implementation
  - Embed in new `## Implementation` section showing function-level scope
  - Helps implementers understand which functions must change
- **Story 4**: Integrate `/sdd:search` results into downstream workflows
  - Use `/sdd:search` results in `/sdd:discover`, `/sdd:plan`, `/sdd:work`, `/sdd:review`
- **Story 5**: Add optional `--focus <artifact>` flag to `/sdd:search` to scope results
- **Story 6**: Support before/after call graphs in refactoring workflows
  - When updating ADR/spec due to refactoring, include side-by-side call graphs
  - Document structural changes for reviewers

**Related ADRs**:
- ADR-0005: Codebase Discovery Skill — `/sdd:search` supports exploratory architecture discovery
- ADR-0001: Drift Introspection Skills — `/sdd:search` provides context for understanding `/sdd:check` and `/sdd:audit` findings
- ADR-0024: qmd as Hard Dependency — `/sdd:search` makes qmd accessible as first-class query interface
- ADR-0008: Standalone Sprint Planning Skill — `/sdd:search` helps scope work before `/sdd:plan`
- ADR-0010: Parallel PR Review and Response Skill — `/sdd:search` provides context for `/sdd:review`
- ADR-0030: Post-PR Chain in /sdd:work — `/sdd:search` enables understanding scope before `/sdd:work`
- ADR-0002: Init and Context Priming Skill — `/sdd:search` complements `/sdd:prime` for exploratory context
- ADR-0023: Frontmatter DAG — `/sdd:search` results can reference artifact graph relationships
- **ADR Authoring** — Enhanced `/sdd:adr` generates and includes call graphs in design docs
- **Spec Authoring** — Enhanced `/sdd:spec` auto-generates call graphs from `/sdd:search` results showing implementation scope

