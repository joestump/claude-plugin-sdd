#!/usr/bin/env python3
# Governing: ADR-0023 (Frontmatter DAG and /sdd:graph Skill), SPEC-0018 REQ "Graph Construction", SPEC-0018 REQ "Graph Validation", SPEC-0018 REQ "Inverse Edge Derivation"
"""sdd graph — artifact graph builder.

Story 2 scope: file discovery, frontmatter parsing, governing-comment parsing,
graph construction, inverse-edge derivation, validation. Verbs (impact,
ancestors, chain, orphans, cycles, backfill) are added in Stories 3-7.

Invoke: python3 graph.py <verb> [--root PATH]

Currently supported verbs:
    validate    Build the graph and report validation diagnostics. Exits
                non-zero if any hard error is detected.

Other v1 verbs (impact, ancestors, chain, orphans, cycles, backfill) are
accepted at the argparse layer and return a clear "not yet implemented"
message rather than an opaque argparse error. They land in Stories 3-7.

Exit codes:
    0  success, no hard errors (warnings may be present)
    1  hard error in graph (unresolved ID, cycle, malformed input)
    2  invocation error (bad arguments, missing root, unimplemented verb)

Requires Python 3.10+ (uses `str | None` syntax and other PEP 604 unions).

This file uses stdlib only — no PyYAML dependency. The frontmatter parser is
intentionally narrow: it handles scalars and inline-bracket lists, which is
all the edge schema declares. A user who wants nested YAML in frontmatter
will need to extend it.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

# ---------------------------------------------------------------------------
# Edge schema constants (mirror SPEC-0018 REQ "Frontmatter Edge Schema")
# ---------------------------------------------------------------------------

ADR_EDGE_FIELDS: tuple[str, ...] = ("supersedes", "extends", "enables", "governs", "related")
SPEC_EDGE_FIELDS: tuple[str, ...] = ("implements", "requires", "extends", "supersedes")
ALL_EDGE_FIELDS: frozenset[str] = frozenset(ADR_EDGE_FIELDS) | frozenset(SPEC_EDGE_FIELDS)

# Forward → derived inverse (SPEC-0018 REQ "Inverse Edge Derivation").
INVERSE_OF: dict[str, str] = {
    "supersedes": "superseded-by",
    "extends": "extended-by",
    "enables": "enabled-by",
    "governs": "governed-by",
    "implements": "implemented-by",
    "requires": "depended-on-by",
    "related": "related",  # symmetric
}

# Reverse-direction fields that MUST NOT appear in authored frontmatter.
DERIVED_FIELDS: frozenset[str] = frozenset(INVERSE_OF.values()) - frozenset({"related"})

# Edge types that must form a DAG (per SPEC-0018 REQ "Graph Validation").
# `related` is symmetric and exempt.
ACYCLIC_EDGE_TYPES: frozenset[str] = frozenset(
    {"supersedes", "extends", "enables", "governs", "implements", "requires"}
)

ADR_STATUSES = frozenset({"proposed", "accepted", "deprecated", "superseded"})
SPEC_STATUSES = frozenset({"draft", "review", "approved", "implemented", "deprecated"})

# ---------------------------------------------------------------------------
# Frontmatter parser (stdlib only, narrow by design)
# ---------------------------------------------------------------------------

_FRONTMATTER_RE = re.compile(r"\A---\s*\n(.*?)\n---\s*(?:\n|\Z)", re.DOTALL)


def parse_frontmatter(text: str) -> dict[str, object]:
    """Extract YAML-ish frontmatter from `text`.

    Returns a dict mapping field names to either strings (scalars) or
    lists of strings (bracket lists). Returns an empty dict if no
    frontmatter block is present.

    The parser handles:
      key: value
      key: [item1, item2]
      key: ["[module]/SPEC-XXXX", ADR-0001]   (quoted scalars in lists)
      # comment lines (skipped)
      blank lines (skipped)

    The parser does NOT handle:
      - block lists (- item form)
      - nested mappings
      - multi-line scalars
    The schema does not need any of those, so this is intentional.
    """
    m = _FRONTMATTER_RE.match(text)
    if not m:
        return {}
    body = m.group(1)
    result: dict[str, object] = {}
    for raw_line in body.splitlines():
        line = raw_line.rstrip()
        stripped = line.lstrip()
        if not stripped or stripped.startswith("#"):
            continue
        if ":" not in line:
            continue
        key, _, value = line.partition(":")
        key = key.strip()
        value = value.strip()
        # Strip inline comments only when outside quotes.
        value = _strip_inline_comment(value)
        if value.startswith("[") and value.endswith("]"):
            inner = value[1:-1].strip()
            result[key] = [_unquote(item.strip()) for item in _split_csv(inner) if item.strip()]
        else:
            result[key] = _unquote(value)
    return result


def _strip_inline_comment(value: str) -> str:
    """Strip a trailing  # comment outside of quotes."""
    in_quote: str | None = None
    for i, ch in enumerate(value):
        if in_quote:
            if ch == in_quote:
                in_quote = None
            continue
        if ch in ('"', "'"):
            in_quote = ch
            continue
        if ch == "#" and (i == 0 or value[i - 1].isspace()):
            return value[:i].rstrip()
    return value


def _split_csv(value: str) -> list[str]:
    """Split on commas that are not inside quotes or square-bracket nests."""
    out: list[str] = []
    buf: list[str] = []
    in_quote: str | None = None
    depth = 0
    for ch in value:
        if in_quote:
            buf.append(ch)
            if ch == in_quote:
                in_quote = None
        elif ch in ('"', "'"):
            in_quote = ch
            buf.append(ch)
        elif ch == "[":
            depth += 1
            buf.append(ch)
        elif ch == "]":
            depth -= 1
            buf.append(ch)
        elif ch == "," and depth == 0:
            out.append("".join(buf))
            buf = []
        else:
            buf.append(ch)
    if buf:
        out.append("".join(buf))
    return out


def _unquote(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
        return value[1:-1]
    return value


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


@dataclass
class Node:
    id: str  # canonical ID (ADR-0001, SPEC-0001) or relative file path for code nodes
    kind: str  # "adr" | "spec" | "code"
    path: str  # absolute filesystem path
    status: str | None = None
    date: str | None = None
    title: str = ""
    module: str | None = None  # workspace mode — set by Story 5


@dataclass
class Edge:
    source: str
    target: str
    type: str
    derived: bool


@dataclass
class Diagnostic:
    severity: str  # "error" or "warning"
    code: str
    message: str
    source_id: str | None = None
    field: str | None = None
    target_id: str | None = None


@dataclass
class Graph:
    nodes: dict[str, Node] = field(default_factory=dict)
    edges: list[Edge] = field(default_factory=list)
    diagnostics: list[Diagnostic] = field(default_factory=list)

    def has_errors(self) -> bool:
        return any(d.severity == "error" for d in self.diagnostics)

    def add_diagnostic(self, **kwargs: object) -> None:
        self.diagnostics.append(Diagnostic(**kwargs))  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# File discovery
# ---------------------------------------------------------------------------

_TITLE_RE = re.compile(r"^#\s+(.+?)\s*$", re.MULTILINE)
_ID_FROM_TITLE_RE = re.compile(r"^(ADR|SPEC)-(\d{4})\b")
_ADR_FILE_RE = re.compile(r"^ADR-(\d{4})-")


def discover_adrs(adr_dir: Path) -> list[tuple[str, Path, dict]]:
    """Return (id, path, frontmatter) tuples for every ADR found."""
    out: list[tuple[str, Path, dict]] = []
    if not adr_dir.is_dir():
        return out
    for path in sorted(adr_dir.glob("ADR-*.md")):
        m = _ADR_FILE_RE.match(path.name)
        if not m:
            continue
        adr_id = f"ADR-{m.group(1)}"
        text = _read_text(path)
        out.append((adr_id, path, parse_frontmatter(text)))
    return out


def discover_specs(spec_dir: Path) -> list[tuple[str, Path, dict]]:
    """Return (id, path, frontmatter) tuples for every spec.md found.

    Spec ID is read from the first `# SPEC-XXXX:` heading; spec.md files
    that lack such a heading are skipped with no error (consumers should
    surface them via /sdd:list, not here).
    """
    out: list[tuple[str, Path, dict]] = []
    if not spec_dir.is_dir():
        return out
    for path in sorted(spec_dir.glob("*/spec.md")):
        text = _read_text(path)
        spec_id = _extract_spec_id(text)
        if spec_id is None:
            continue
        out.append((spec_id, path, parse_frontmatter(text)))
    return sorted(out, key=lambda t: t[0])


def _extract_spec_id(text: str) -> str | None:
    for m in _TITLE_RE.finditer(text):
        title = m.group(1)
        id_m = _ID_FROM_TITLE_RE.match(title)
        if id_m:
            return f"SPEC-{id_m.group(2)}"
    return None


def _read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return ""


# Governing comment block per ADR-0020 / SPEC-0016 REQ "Governing Comment Format".
# File-level only — first comment line that starts with `Governing:`.
_GOVERNING_RE = re.compile(
    r"""
    ^[ \t]*                       # optional leading indent
    (?://|\#|<!--)                # comment opener: //, #, <!--
    [ \t]*Governing:[ \t]*        # marker
    (.+?)                         # body of governing line (non-greedy)
    [ \t]*(?:-->)?[ \t]*$         # optional --> closer for HTML comments
    """,
    re.IGNORECASE | re.VERBOSE | re.MULTILINE,
)
_GOVERNING_ID_RE = re.compile(r"\b(ADR-\d{4}|SPEC-\d{4})\b")

_DEFAULT_CODE_EXCLUDES = frozenset(
    {".git", "node_modules", "vendor", ".venv", "venv", "__pycache__",
     "dist", "build", "target", ".next", ".cache",
     "docs", "skills", "references", "evals", "templates",
     "docs-generated", "docs-site"}
)


def discover_code_edges(root: Path, excludes: frozenset[str] = _DEFAULT_CODE_EXCLUDES) -> list[tuple[Path, list[str]]]:
    """Walk `root` and return (path, [referenced_artifact_ids]) for every file
    whose first 4096 bytes contain a governing-comment block. Markdown files
    are skipped — they participate via frontmatter, not governing comments.
    """
    out: list[tuple[Path, list[str]]] = []
    for dirpath, dirnames, filenames in os.walk(root):
        # Prune excluded and hidden directories in-place.
        dirnames[:] = sorted(
            d for d in dirnames if d not in excludes and not d.startswith(".")
        )
        for name in sorted(filenames):
            if name.endswith((".md", ".markdown")):
                continue
            path = Path(dirpath) / name
            try:
                with open(path, "rb") as f:
                    head = f.read(4096)
            except OSError:
                continue
            try:
                text = head.decode("utf-8", errors="ignore")
            except UnicodeDecodeError:
                continue
            m = _GOVERNING_RE.search(text)
            if not m:
                continue
            ids = sorted(set(_GOVERNING_ID_RE.findall(m.group(1))))
            if ids:
                out.append((path, ids))
    return sorted(out, key=lambda t: str(t[0]))


# ---------------------------------------------------------------------------
# Graph construction
# ---------------------------------------------------------------------------


def build_graph(root: Path, adr_dir: Path, spec_dir: Path) -> Graph:
    """Build the graph for a single module rooted at `root`.

    Discovers ADRs, specs, and governed code files; constructs nodes; reads
    forward edges from frontmatter; derives inverse edges; runs validation.
    """
    g = Graph()

    # 1. ADR nodes + forward edges.
    for adr_id, path, fm in discover_adrs(adr_dir):
        if adr_id in g.nodes:
            g.add_diagnostic(
                severity="error",
                code="duplicate-id",
                message=f"{adr_id} declared by multiple files",
                source_id=adr_id,
            )
            continue
        g.nodes[adr_id] = Node(
            id=adr_id,
            kind="adr",
            path=str(path),
            status=_str_or_none(fm.get("status")),
            date=_str_or_none(fm.get("date")),
            title=_extract_title(_read_text(path)) or adr_id,
        )
        _ingest_edges(g, adr_id, fm, ADR_EDGE_FIELDS)

    # 2. Spec nodes + forward edges.
    for spec_id, path, fm in discover_specs(spec_dir):
        if spec_id in g.nodes:
            g.add_diagnostic(
                severity="error",
                code="duplicate-id",
                message=f"{spec_id} declared by multiple files",
                source_id=spec_id,
            )
            continue
        g.nodes[spec_id] = Node(
            id=spec_id,
            kind="spec",
            path=str(path),
            status=_str_or_none(fm.get("status")),
            date=_str_or_none(fm.get("date")),
            title=_extract_title(_read_text(path)) or spec_id,
        )
        _ingest_edges(g, spec_id, fm, SPEC_EDGE_FIELDS)

    # 3. Code nodes + governance edges (from governing comment blocks).
    # Note: code-edge type is `governed-by` — same name as the inverse derived
    # from `governs:` frontmatter, but with `derived=False` because it's
    # authored in code (per ADR-0020). Downstream verbs that distinguish
    # provenance can read the source-node `kind` (code vs adr/spec) along
    # with the `derived` flag.
    for path, ids in discover_code_edges(root):
        rel = str(path.relative_to(root)) if path.is_relative_to(root) else str(path)
        node_id = rel
        if node_id not in g.nodes:
            g.nodes[node_id] = Node(id=node_id, kind="code", path=str(path))
        for target in ids:
            g.edges.append(Edge(source=node_id, target=target, type="governed-by", derived=False))

    # 4. Validate.
    _validate(g)

    # 5. Derive inverse edges. (Done after validation so cycle detection
    #    operates on authored edges only.)
    _derive_inverses(g)

    return g


def _str_or_none(value: object) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value or None
    return str(value)


def _extract_title(text: str) -> str:
    m = _TITLE_RE.search(text)
    return m.group(1) if m else ""


def _ingest_edges(g: Graph, source_id: str, fm: dict, allowed: tuple[str, ...]) -> None:
    for field_name, raw in fm.items():
        if field_name in DERIVED_FIELDS:
            g.add_diagnostic(
                severity="warning",
                code="authored-derived-edge",
                message=(
                    f"{source_id} declares derived field `{field_name}`; "
                    "derived edges MUST NOT be authored — value ignored"
                ),
                source_id=source_id,
                field=field_name,
            )
            continue
        if field_name not in ALL_EDGE_FIELDS:
            continue
        if field_name not in allowed:
            g.add_diagnostic(
                severity="warning",
                code="schema-misuse",
                message=(
                    f"{source_id} declares `{field_name}`, which is not a valid "
                    f"edge field for this artifact type"
                ),
                source_id=source_id,
                field=field_name,
            )
            continue
        if not isinstance(raw, list):
            g.add_diagnostic(
                severity="error",
                code="malformed-edge-list",
                message=f"{source_id}.{field_name} must be a list (e.g., [ADR-0001])",
                source_id=source_id,
                field=field_name,
            )
            continue
        for target in raw:
            if not isinstance(target, str) or not target.strip():
                g.add_diagnostic(
                    severity="error",
                    code="malformed-edge-target",
                    message=f"{source_id}.{field_name} contains a non-string or empty target",
                    source_id=source_id,
                    field=field_name,
                )
                continue
            g.edges.append(
                Edge(source=source_id, target=target.strip(), type=field_name, derived=False)
            )


# ---------------------------------------------------------------------------
# Validation (SPEC-0018 REQ "Graph Validation")
# ---------------------------------------------------------------------------


def _validate(g: Graph) -> None:
    _validate_id_resolution(g)
    _validate_no_cycles(g)
    _validate_status_consistency(g)


def _validate_id_resolution(g: Graph) -> None:
    """Every artifact ID in a frontmatter edge MUST exist as a node.

    TODO(Story 5): When workspace mode lands, this check must understand
    `[module]/SPEC-XXXX` cross-module references. Today the parser
    coerces both quoted (`["[shared-lib]/SPEC-0001"]`) and unquoted
    (`[[shared-lib]/SPEC-0001]`) forms into the same string target, so
    the unquoted-YAML case from SPEC-0018 REQ "Workspace Mode
    Aggregation" Scenario "Cross-module edge with unquoted YAML rejected"
    falls out as a generic `unresolved-id` rather than the specified
    hard error about YAML nested-list parsing. Detect-and-distinguish in
    Story 5.
    """
    for edge in g.edges:
        if edge.derived:
            continue
        if edge.target not in g.nodes:
            g.add_diagnostic(
                severity="error",
                code="unresolved-id",
                message=(
                    f"{edge.source} {edge.type} unknown artifact {edge.target}"
                ),
                source_id=edge.source,
                field=edge.type,
                target_id=edge.target,
            )


def _validate_no_cycles(g: Graph) -> None:
    """Detect cycles in DAG-required edge types via Tarjan-style DFS."""
    # Build adjacency for acyclic-required edges only (ignores `related`).
    adj: dict[str, list[tuple[str, str]]] = {}
    for edge in g.edges:
        if edge.derived or edge.type not in ACYCLIC_EDGE_TYPES:
            continue
        if edge.target not in g.nodes:
            continue  # already reported by id-resolution
        adj.setdefault(edge.source, []).append((edge.target, edge.type))

    color: dict[str, int] = {}  # 0=white, 1=gray, 2=black
    parent: dict[str, tuple[str, str] | None] = {}

    def dfs(start: str) -> None:
        stack: list[tuple[str, int]] = [(start, 0)]
        while stack:
            node, idx = stack[-1]
            if color.get(node, 0) == 0:
                color[node] = 1
            children = adj.get(node, [])
            if idx == len(children):
                color[node] = 2
                stack.pop()
                continue
            stack[-1] = (node, idx + 1)
            child, edge_type = children[idx]
            c = color.get(child, 0)
            if c == 0:
                parent[child] = (node, edge_type)
                stack.append((child, 0))
            elif c == 1:
                cycle = _reconstruct_cycle(child, node, parent)
                g.add_diagnostic(
                    severity="error",
                    code="cycle",
                    message=f"cycle detected ({edge_type}): {' -> '.join(cycle)}",
                )

    for node_id in sorted(g.nodes):
        if color.get(node_id, 0) == 0:
            dfs(node_id)


def _reconstruct_cycle(
    cycle_start: str,
    cur: str,
    parent: dict[str, tuple[str, str] | None],
) -> list[str]:
    """Walk parent chain from `cur` back to `cycle_start` to materialize the cycle.

    The returned list closes the cycle by repeating `cycle_start` at the end —
    e.g., for A→B→A the result is ["A", "B", "A"], which renders as
    "A -> B -> A" when joined. The closing edge type is reported in the
    diagnostic message separately by the caller.
    """
    chain = [cur]
    while cur != cycle_start and cur in parent and parent[cur] is not None:
        cur = parent[cur][0]  # type: ignore[index]
        chain.append(cur)
    chain.reverse()
    chain.append(cycle_start)
    return chain


def _validate_status_consistency(g: Graph) -> None:
    """When A `supersedes` B, B's status MUST be `superseded` (ADR) or
    `deprecated` (spec or ADR). Mismatch is a warning, not a hard error.
    """
    for edge in g.edges:
        if edge.derived or edge.type != "supersedes":
            continue
        target = g.nodes.get(edge.target)
        if target is None or target.kind == "code":
            continue
        expected = ("superseded", "deprecated") if target.kind == "adr" else ("deprecated",)
        if target.status is None or target.status not in expected:
            actual = target.status or "<unset>"
            g.add_diagnostic(
                severity="warning",
                code="status-inconsistent",
                message=(
                    f"{edge.source} supersedes {edge.target}, but "
                    f"{edge.target} status is `{actual}` (expected one of "
                    f"{', '.join(expected)})"
                ),
                source_id=edge.source,
                field="supersedes",
                target_id=edge.target,
            )


# ---------------------------------------------------------------------------
# Inverse derivation (SPEC-0018 REQ "Inverse Edge Derivation")
# ---------------------------------------------------------------------------


def _derive_inverses(g: Graph) -> None:
    """For every authored forward edge, add a derived inverse edge.

    For symmetric `related`, add a derived edge in the opposite direction
    only if it is not already present as authored.
    """
    authored_pairs: set[tuple[str, str, str]] = {
        (e.source, e.target, e.type) for e in g.edges if not e.derived
    }
    new_edges: list[Edge] = []
    for edge in list(g.edges):
        if edge.derived:
            continue
        if edge.type not in INVERSE_OF:
            continue
        if edge.target not in g.nodes:
            continue  # don't derive from broken targets
        inverse_type = INVERSE_OF[edge.type]
        if edge.type == "related":
            # Skip if the symmetric authored edge already exists in reverse.
            if (edge.target, edge.source, "related") in authored_pairs:
                continue
        new_edges.append(
            Edge(source=edge.target, target=edge.source, type=inverse_type, derived=True)
        )
    g.edges.extend(new_edges)


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------


def print_validation(g: Graph) -> None:
    n_nodes = len(g.nodes)
    n_edges_authored = sum(1 for e in g.edges if not e.derived)
    n_edges_derived = sum(1 for e in g.edges if e.derived)
    errors = [d for d in g.diagnostics if d.severity == "error"]
    warnings = [d for d in g.diagnostics if d.severity == "warning"]

    print(f"# /sdd:graph validate")
    print()
    print(f"- Nodes: {n_nodes} (ADRs + specs + governed code files)")
    print(f"- Authored edges: {n_edges_authored}")
    print(f"- Derived edges: {n_edges_derived}")
    print(f"- Errors: {len(errors)}")
    print(f"- Warnings: {len(warnings)}")
    print()

    if errors:
        print("## Errors")
        print()
        for d in errors:
            print(f"- **{d.code}** — {d.message}")
        print()

    if warnings:
        print("## Warnings")
        print()
        for d in warnings:
            print(f"- **{d.code}** — {d.message}")
        print()

    if not errors and not warnings:
        print("Graph validates clean.")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


_ALL_VERBS = ("validate", "impact", "ancestors", "chain", "orphans", "cycles", "backfill")
_VERB_STORY = {
    "impact": 3,
    "ancestors": 3,
    "chain": 3,
    "orphans": 4,
    "cycles": 4,
    "backfill": 7,
}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="graph", description=__doc__)
    parser.add_argument("verb", choices=_ALL_VERBS, help="graph verb to run")
    parser.add_argument("--root", default=".", help="project root (default: cwd)")
    parser.add_argument("--adr-dir", help="ADR directory (default: <root>/docs/adrs)")
    parser.add_argument("--spec-dir", help="spec directory (default: <root>/docs/openspec/specs)")
    args = parser.parse_args(argv)

    if args.verb != "validate":
        story = _VERB_STORY.get(args.verb, "?")
        print(
            f"error: verb '{args.verb}' is not yet implemented "
            f"(planned for Story {story} of the artifact-graph chain).",
            file=sys.stderr,
        )
        print(
            "see docs/adrs/ADR-0023-frontmatter-dag-and-graph-skill.md for the roadmap.",
            file=sys.stderr,
        )
        return 2

    root = Path(args.root).resolve()
    if not root.is_dir():
        print(f"error: --root {root} is not a directory", file=sys.stderr)
        return 2
    adr_dir = Path(args.adr_dir).resolve() if args.adr_dir else root / "docs" / "adrs"
    spec_dir = Path(args.spec_dir).resolve() if args.spec_dir else root / "docs" / "openspec" / "specs"

    g = build_graph(root, adr_dir, spec_dir)
    print_validation(g)
    return 1 if g.has_errors() else 0


if __name__ == "__main__":
    sys.exit(main())
