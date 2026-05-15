<!-- Governing: ADR-0033 (cgg call graph integration), SPEC-0034 REQ "Call Graph Generation Uses cgg With Filtering", SPEC-0034 REQ "Error Messages and Logs Must Be Clear" -->

# cgg Integration Reference

Canonical reference for how SDD plugin skills invoke [cgg](https://github.com/NeuralNotwerk/cgg) (NeuralNotwerk call graph generator). Every skill that generates call graphs MUST consume this reference by section name rather than inlining its own cgg invocations, filter logic, or error messages. Centralizing the patterns here ensures a single place to update if cgg's CLI surface changes and prevents per-skill drift in error message wording.

cgg is an **optional** runtime dependency — skills that use it MUST degrade gracefully when it is unavailable (see § Graceful Degradation). This is in contrast to qmd, which is a hard dependency per ADR-0024.

## Availability Check

Before invoking cgg, every skill MUST probe for its presence. Do not assume cgg is installed.

```bash
which cgg >/dev/null 2>&1
```

**If cgg is not found**, surface this exact message to the user and fall back to qmd-only results:

```
Call graphs unavailable — install cgg with: cargo install cgg
or see https://github.com/NeuralNotwerk/cgg
```

Do NOT fail the skill. Return whatever results qmd provided and include the one-line unavailability notice at the top of the call graphs section.

## Filter Derivation Strategy

Raw cgg output for a large codebase can exceed 100 nodes — unreadable as a Mermaid diagram. Always derive a `--filter` argument from qmd matches or requirement keywords before invoking cgg.

### From qmd code matches

When qmd returns file path matches for `{repo}-code`, extract filter tokens from those paths and from the function/symbol names qmd surfaces:

1. Take each matched file path stem (e.g., `auth/jwt.go` → `jwt`, `auth`)
2. Take each qmd-matched symbol or heading keyword (e.g., `validateToken`, `parseUserID`)
3. Compose a regex alternation: `jwt|auth|validateToken|parseUserID`
4. Pass as `--filter "jwt|auth|validateToken|parseUserID"` to cgg

### From requirement keywords

When filtering from spec requirement names (e.g., "Payment Processing", "Token Validation"):

1. Lowercase and split on spaces/punctuation: `["payment", "processing", "token", "validation"]`
2. Strip common stop words (`the`, `a`, `an`, `for`, `with`, `of`, `in`, `and`, `or`, `to`)
3. Compose regex alternation from the remaining terms: `payment|processing|token|validation`
4. Pass as `--filter "payment|processing|token|validation"` to cgg

### Node cap

After cgg returns its Mermaid output, count the nodes (lines matching `^\s+\w+\[`). If the diagram exceeds **20 nodes**, trim to the 20 nodes with the highest in-degree + out-degree scores (most connected = most relevant). Append the legend footer (see § Mermaid Output Normalization).

If trimming is needed, add a comment inside the Mermaid block:

```
%% Showing top 20 nodes by connectivity; {N} nodes omitted. Use /cgg with --filter to refine.
```

### `--unfiltered` escape hatch

When a skill exposes an `--unfiltered` flag, skip filter derivation and pass the raw query keywords directly to cgg without `--filter`. Warn the user:

```
Generating unfiltered call graph — output may be large. Use /cgg directly for advanced scoping.
```

## cgg Invocation Pattern

Use the following invocation shape. Always capture stdout (the Mermaid output) and stderr (cgg diagnostics) separately.

```bash
timeout 30 cgg <target-path> --filter "<filter-regex>" --format mermaid 2>/tmp/cgg-stderr-$$.txt
CGG_EXIT=$?
CGG_STDERR=$(cat /tmp/cgg-stderr-$$.txt)
rm -f /tmp/cgg-stderr-$$.txt
```

- `<target-path>`: the directory or file to analyze (repo root by default; module directory in workspace mode — see § Workspace-Mode Scoping)
- `--filter "<filter-regex>"`: derived per § Filter Derivation Strategy; omit when `--unfiltered`
- `--format mermaid`: always request Mermaid output; use `--format json` only when the skill explicitly needs structured output
- `timeout 30`: the default 30-second wall-clock cap; skills MAY expose a config option to override it

### Exit code handling

| Exit code | Meaning | Action |
|-----------|---------|--------|
| 0 | Success | Read stdout as Mermaid content |
| 1 | cgg error (parse failure, no entry points found, etc.) | Surface stderr as-is with the "error" message template below; fall back to qmd-only |
| 124 | Timeout (from `timeout` shell builtin) | Surface the timeout message (see § Timeout Handling); fall back to qmd-only |
| Any other | Unknown failure | Treat as cgg error; surface stderr |

## Timeout Handling

When the `timeout` wrapper exits with code 124, surface this exact message:

```
Call graph generation timed out (30s). The codebase may be very large.
Try: /cgg <module/path> --filter <keyword> to narrow the scope.
```

Do NOT fail the skill. Return qmd results and include the timeout notice in place of the call graphs section.

The timeout value in the message MUST match the actual timeout used in the invocation.

## Unsupported Language Handling

cgg writes unsupported-language warnings to stderr, one per file, in this form:

```
warning: unsupported language for path/to/file.prisma
```

When cgg exits 0 but stderr contains one or more such warnings, surface a per-file notice:

```
Call graph generation skipped for path/to/file.prisma (language not supported by cgg). Showing other results.
```

One line per skipped file. Do NOT aggregate or suppress individual file notices — operators need to know which files were excluded.

If ALL target files were skipped (cgg exits 0 but produces no Mermaid nodes), treat the result the same as a cgg error and fall back to qmd-only results.

## Graceful Degradation

The full graceful degradation stack, in priority order:

| Condition | User-facing output | Skill behavior |
|-----------|-------------------|----------------|
| cgg not in PATH | One-line unavailability notice (see § Availability Check) | Return qmd results only; no error |
| cgg timeout | Timeout message (see § Timeout Handling) | Return qmd results only; no error |
| cgg exit ≠ 0 | stderr content, prefixed with "Call graph generation failed: " | Return qmd results only; no error |
| All files skipped (unsupported language) | Per-file skip notices | Return qmd results only; no error |
| cgg returns 0 nodes after filtering | "No call graph nodes matched the filter. Try broadening your search term or use --unfiltered." | Return qmd results only; no error |

In every degradation case, the skill MUST complete and return partial results. Never surface a hard failure to the user when cgg is the only failing component.

## Mermaid Output Normalization

Raw cgg Mermaid output may be non-deterministic (node IDs vary between runs) or contain syntax incompatible with some renderers. Apply these normalization steps before embedding:

1. **Sort nodes alphabetically** by node ID so diffs are stable across repeated runs
2. **Ensure graph direction**: if cgg outputs `graph LR` or `graph RL`, rewrite to `graph TD` for top-down layout (better readability in Docusaurus and GitHub)
3. **Strip internal node IDs** that look like memory addresses or hash prefixes (e.g., `abc123_validateToken` → `validateToken`) — use the human-readable label only
4. **Append legend footer** as the last line inside the Mermaid block:

```
%% Showing entry points + main flow; internal helpers omitted
```

5. **Validate Mermaid syntax** by checking that every `-->` edge references a node declared in the block. Remove dangling edges silently.

### Embedding in markdown

Wrap the normalized output in a fenced Mermaid block with a caption comment above it:

```markdown
<!-- Call graph: <filter used>, generated <date> -->
```mermaid
graph TD
    ...
```
```

The caption comment gives future readers context on what was filtered and when the diagram was generated, without cluttering the rendered output.

## Workspace-Mode Scoping

When the invoking skill is running in workspace mode (i.e., `--module <name>` was passed or a workspace was detected), cgg MUST be scoped to the active module's source directory rather than the repo root.

Resolution:

1. Resolve the module root using the **Artifact Path Resolution** pattern from `references/shared-patterns.md`
2. Use the module root as `<target-path>` in the cgg invocation (not the repo root)
3. Scope qmd collections to `{repo}-{module}-code` (not `{repo}-code`) when deriving filters

This prevents call graphs from spanning module boundaries unintentionally. Users who want cross-module graphs should invoke `/cgg` directly with explicit path arguments.
