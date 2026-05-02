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

# Detects an unquoted cross-module reference inside an outer bracket-list:
# `[[<module>]/<ID>` is the YAML nested-list form that strict parsers reject.
# The quoted form `["[<module>]/<ID>"` does not match because the `[` after
# the outer `[` is preceded by a quote character.
_UNQUOTED_CROSS_MODULE_RE = re.compile(r"\[\s*\[[\w.-]+\]/")

# Sentinel key used by parse_frontmatter to surface YAML-syntax issues that
# fall outside its narrow grammar but should be reported as hard errors.
_YAML_ERRORS_KEY = "__yaml_errors__"


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
    yaml_errors: list[str] = []
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
            # Per SPEC-0018 § Workspace Mode Aggregation Scenario
            # "Cross-module edge with unquoted YAML rejected": detect
            # the unquoted nested-bracket form and surface it as a hard
            # error. The quoted form does not match the regex.
            if _UNQUOTED_CROSS_MODULE_RE.search(value):
                yaml_errors.append(
                    f"`{key}: {value}` contains an unquoted cross-module "
                    f"reference (YAML nested-list form). Module-prefixed IDs "
                    f"MUST be quoted as scalars: "
                    f"`{key}: [\"[<module>]/<ID>\"]`"
                )
            inner = value[1:-1].strip()
            result[key] = [_unquote(item.strip()) for item in _split_csv(inner) if item.strip()]
        else:
            result[key] = _unquote(value)
    if yaml_errors:
        result[_YAML_ERRORS_KEY] = yaml_errors
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
    edges, _ = _walk_code_files(root, excludes)
    return edges


def discover_orphan_code(
    root: Path, excludes: frozenset[str] = _DEFAULT_CODE_EXCLUDES
) -> list[Path]:
    """Walk `root` and return code files with NO governing-comment block.

    Per SPEC-0018 § "Files without governing comments": these files MUST
    NOT become graph nodes (so they remain invisible to traversal queries)
    but MUST surface via the `orphans` verb. This walker uses the same
    exclusions as `discover_code_edges` for consistency.

    "Code files" excludes markdown (`.md`, `.markdown`) — markdown
    participates via frontmatter, not governing comments. It also
    excludes binary files (any file whose head doesn't decode as UTF-8).
    """
    _, orphans = _walk_code_files(root, excludes)
    return orphans


def _walk_code_files(
    root: Path, excludes: frozenset[str]
) -> tuple[list[tuple[Path, list[str]]], list[Path]]:
    """Single tree walk that returns both governed-edge files and orphan files.

    Returns (edges, orphans):
      - edges: list of (path, ids) for files with governing comment blocks
      - orphans: list of paths for files without governing comment blocks
    """
    edges: list[tuple[Path, list[str]]] = []
    orphans: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(root):
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
            # Skip files that look binary (high non-printable ratio).
            if _looks_binary(head):
                continue
            m = _GOVERNING_RE.search(text)
            if m:
                ids = sorted(set(_GOVERNING_ID_RE.findall(m.group(1))))
                if ids:
                    edges.append((path, ids))
                else:
                    # Block exists but referenced no IDs — treat as comment-less
                    # for orphan purposes.
                    orphans.append(path)
            else:
                orphans.append(path)
    return (
        sorted(edges, key=lambda t: str(t[0])),
        sorted(orphans),
    )


def _looks_binary(head: bytes) -> bool:
    """Heuristic: a NUL byte or a high non-text ratio implies binary."""
    if b"\x00" in head:
        return True
    if not head:
        return False
    # text characters: tab, LF, CR, form feed, printable ASCII, plus any UTF-8
    # continuation bytes (0x80-0xff).
    text_chars = sum(1 for b in head if b == 9 or b == 10 or b == 13 or 32 <= b < 127 or b >= 128)
    return text_chars / len(head) < 0.85


# ---------------------------------------------------------------------------
# Workspace mode (Story 5)
# ---------------------------------------------------------------------------


@dataclass
class Module:
    """A workspace module with resolved artifact paths."""

    name: str
    root: Path
    adr_dir: Path
    spec_dir: Path
    source: str  # "gitmodules" | "claude-md" | "single"


def detect_workspace(project_root: Path) -> list[Module]:
    """Discover workspace modules per `references/shared-patterns.md`.

    Precedence: `.gitmodules` > `### Workspace Modules` table in CLAUDE.md
    > single-module fallback. Returns the list of discovered modules. An
    empty list means "single-module project — operate on project_root."
    """
    gm_modules = _parse_gitmodules(project_root)
    if gm_modules:
        return [_resolve_module(project_root, name, path, "gitmodules") for name, path in gm_modules]
    cm_modules = _parse_workspace_table(project_root)
    if cm_modules:
        return [_resolve_module(project_root, name, path, "claude-md") for name, path in cm_modules]
    return []


_GITMODULE_NAME_RE = re.compile(r'^\[submodule\s+"([^"]+)"\]\s*$')
_GITMODULE_PATH_RE = re.compile(r"^\s*path\s*=\s*(.+?)\s*$")


def _parse_gitmodules(project_root: Path) -> list[tuple[str, str]]:
    """Parse `.gitmodules` if present; return (name, path) tuples."""
    gm = project_root / ".gitmodules"
    if not gm.is_file():
        return []
    out: list[tuple[str, str]] = []
    current_name: str | None = None
    for raw in gm.read_text(encoding="utf-8", errors="ignore").splitlines():
        m = _GITMODULE_NAME_RE.match(raw)
        if m:
            current_name = m.group(1)
            continue
        if current_name is None:
            continue
        pm = _GITMODULE_PATH_RE.match(raw)
        if pm:
            out.append((current_name, pm.group(1)))
            current_name = None
    return out


_WORKSPACE_HEADING_RE = re.compile(r"^###\s+Workspace Modules\s*$", re.MULTILINE)
_TABLE_ROW_RE = re.compile(r"^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|")


def _parse_workspace_table(project_root: Path) -> list[tuple[str, str]]:
    """Parse `### Workspace Modules` table from project-root CLAUDE.md."""
    claude_md = project_root / "CLAUDE.md"
    if not claude_md.is_file():
        return []
    text = claude_md.read_text(encoding="utf-8", errors="ignore")
    h = _WORKSPACE_HEADING_RE.search(text)
    if not h:
        return []
    body = text[h.end():]
    out: list[tuple[str, str]] = []
    for line in body.splitlines():
        if line.startswith("##"):
            break  # next heading — table ended
        if line.startswith("|---") or line.startswith("| ---"):
            continue
        m = _TABLE_ROW_RE.match(line)
        if not m:
            continue
        col1, col2 = m.group(1).strip(), m.group(2).strip()
        if col1.lower() in ("module", ""):  # header row or blank
            continue
        out.append((col1, col2))
    return out


def _resolve_module(project_root: Path, name: str, path: str, source: str) -> Module:
    """Resolve a module's ADR/spec dirs via Artifact Path Resolution."""
    module_root = (project_root / path).resolve()
    adr_dir, spec_dir = _read_module_artifact_paths(module_root)
    return Module(name=name, root=module_root, adr_dir=adr_dir, spec_dir=spec_dir, source=source)


_ADR_DIR_DECL_RE = re.compile(
    r"Architecture Decision Records are in\s+`?([^`\n]+?)`?\s*(?:[.\n]|$)"
)
_SPEC_DIR_DECL_RE = re.compile(
    r"Specifications are in\s+`?([^`\n]+?)`?\s*(?:[.\n]|$)"
)


def _read_module_artifact_paths(module_root: Path) -> tuple[Path, Path]:
    """Read module CLAUDE.md for artifact-path declarations; fall back to defaults."""
    adr_default = module_root / "docs" / "adrs"
    spec_default = module_root / "docs" / "openspec" / "specs"
    claude_md = module_root / "CLAUDE.md"
    if not claude_md.is_file():
        return adr_default, spec_default
    text = claude_md.read_text(encoding="utf-8", errors="ignore")
    adr_match = _ADR_DIR_DECL_RE.search(text)
    spec_match = _SPEC_DIR_DECL_RE.search(text)
    adr_dir = (module_root / adr_match.group(1).strip()).resolve() if adr_match else adr_default
    spec_dir = (module_root / spec_match.group(1).strip()).resolve() if spec_match else spec_default
    return adr_dir, spec_dir


# ---------------------------------------------------------------------------
# Graph construction
# ---------------------------------------------------------------------------


def build_graph(
    root: Path,
    adr_dir: Path,
    spec_dir: Path,
    module_name: str | None = None,
) -> Graph:
    """Build the graph for a single module rooted at `root`.

    Discovers ADRs, specs, and governed code files; constructs nodes; reads
    forward edges from frontmatter; derives inverse edges; runs validation.

    When `module_name` is provided, every node ID is prefixed with
    `[module_name]/` (per SPEC-0018 § Workspace Mode Aggregation), and
    same-module edge targets are auto-prefixed at ingest time. Cross-module
    targets authored as `["[other]/SPEC-XXXX"]` are recognized and left
    as-is.
    """
    g = Graph()
    prefix = f"[{module_name}]/" if module_name else ""

    # 1. ADR nodes + forward edges.
    for adr_id, path, fm in discover_adrs(adr_dir):
        _emit_yaml_errors(g, full_id=prefix + adr_id, fm=fm)
        full_id = prefix + adr_id
        if full_id in g.nodes:
            g.add_diagnostic(
                severity="error",
                code="duplicate-id",
                message=f"{full_id} declared by multiple files",
                source_id=full_id,
            )
            continue
        g.nodes[full_id] = Node(
            id=full_id,
            kind="adr",
            path=str(path),
            status=_str_or_none(fm.get("status")),
            date=_str_or_none(fm.get("date")),
            title=_extract_title(_read_text(path)) or adr_id,
            module=module_name,
        )
        _ingest_edges(g, full_id, fm, ADR_EDGE_FIELDS, prefix)

    # 2. Spec nodes + forward edges.
    for spec_id, path, fm in discover_specs(spec_dir):
        _emit_yaml_errors(g, full_id=prefix + spec_id, fm=fm)
        full_id = prefix + spec_id
        if full_id in g.nodes:
            g.add_diagnostic(
                severity="error",
                code="duplicate-id",
                message=f"{full_id} declared by multiple files",
                source_id=full_id,
            )
            continue
        g.nodes[full_id] = Node(
            id=full_id,
            kind="spec",
            path=str(path),
            status=_str_or_none(fm.get("status")),
            date=_str_or_none(fm.get("date")),
            title=_extract_title(_read_text(path)) or spec_id,
            module=module_name,
        )
        _ingest_edges(g, full_id, fm, SPEC_EDGE_FIELDS, prefix)

    # 3. Code nodes + governance edges (from governing comment blocks).
    # Note: code-edge type is `governed-by` — same name as the inverse derived
    # from `governs:` frontmatter, but with `derived=False` because it's
    # authored in code (per ADR-0020). Downstream verbs that distinguish
    # provenance can read the source-node `kind` (code vs adr/spec) along
    # with the `derived` flag.
    for path, ids in discover_code_edges(root):
        rel = str(path.relative_to(root)) if path.is_relative_to(root) else str(path)
        full_node = prefix + rel
        if full_node not in g.nodes:
            g.nodes[full_node] = Node(id=full_node, kind="code", path=str(path), module=module_name)
        for target in ids:
            full_target = _maybe_prefix_target(target, prefix)
            g.edges.append(Edge(source=full_node, target=full_target, type="governed-by", derived=False))

    # 4. Validate.
    _validate(g)

    # 5. Derive inverse edges. (Done after validation so cycle detection
    #    operates on authored edges only.)
    _derive_inverses(g)

    return g


_PREFIXED_ID_RE = re.compile(r"^\[([^\]]+)\]/(.+)$")


def _emit_yaml_errors(g: Graph, full_id: str, fm: dict) -> None:
    """Surface frontmatter YAML-syntax errors as hard graph errors."""
    errors = fm.pop(_YAML_ERRORS_KEY, None)
    if not errors:
        return
    for msg in errors:
        g.add_diagnostic(
            severity="error",
            code="malformed-yaml",
            message=f"{full_id}: {msg}",
            source_id=full_id,
        )


def _maybe_prefix_target(target: str, prefix: str) -> str:
    """Auto-prefix bare same-module IDs; pass through already-prefixed forms.

    Targets matching `[module]/ID` are cross-module references (per SPEC-0018
    § Workspace Mode Aggregation) and are returned as-is. Bare IDs like
    `ADR-0001` or `SPEC-0007` are prefixed with the current module's prefix
    so they resolve against this module's nodes.
    """
    if _PREFIXED_ID_RE.match(target):
        return target
    return prefix + target


def build_aggregate_graph(project_root: Path, modules: list[Module]) -> Graph:
    """Build per-module graphs and merge them with `[module]/ID` prefixes.

    Per-module non-resolution-dependent diagnostics (duplicate IDs,
    malformed edges, schema misuse, authored-derived fields, YAML
    syntax issues) are CARRIED OVER to the aggregate so they are not
    silently lost. Resolution-dependent diagnostics (unresolved IDs,
    cycles, status consistency) are DROPPED from per-module sets and
    re-evaluated at the aggregate level so cross-module references
    resolve correctly.
    """
    agg = Graph()
    # Diagnostics that must be re-checked at aggregate scope (because
    # cross-module references may resolve there).
    redo_codes = frozenset(
        {"unresolved-id", "cycle", "status-inconsistent"}
    )
    for mod in modules:
        sub = build_graph(mod.root, mod.adr_dir, mod.spec_dir, module_name=mod.name)
        sub_authored_edges = [e for e in sub.edges if not e.derived]
        for nid, node in sub.nodes.items():
            agg.nodes[nid] = node
        agg.edges.extend(sub_authored_edges)
        for d in sub.diagnostics:
            if d.code not in redo_codes:
                agg.diagnostics.append(d)
    _validate(agg)
    _derive_inverses(agg)
    return agg


def _str_or_none(value: object) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value or None
    return str(value)


def _extract_title(text: str) -> str:
    m = _TITLE_RE.search(text)
    return m.group(1) if m else ""


def _ingest_edges(
    g: Graph,
    source_id: str,
    fm: dict,
    allowed: tuple[str, ...],
    prefix: str = "",
) -> None:
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
            full_target = _maybe_prefix_target(target.strip(), prefix)
            g.edges.append(
                Edge(source=source_id, target=full_target, type=field_name, derived=False)
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
    """Detect cycles in DAG-required edge types via Tarjan-style DFS.

    `governs` (ADR→SPEC) and `implements` (SPEC→ADR) are semantic inverses
    describing the same relationship from opposite ends. Authoring both is
    valid (and shown in SPEC-0018's own JSON example), but my detector
    would otherwise treat the round-trip A→governs→B→implements→A as a
    cycle. To honor dual authoring, an authored `governs` edge is omitted
    from the cycle-detection adjacency when a matching authored `implements`
    edge exists in the opposite direction; the implements edge alone
    covers the relationship.
    """
    # Pre-compute the set of (spec, adr) pairs covered by authored `implements`.
    implements_pairs: set[tuple[str, str]] = {
        (e.source, e.target)
        for e in g.edges
        if e.type == "implements" and not e.derived
    }
    # Build adjacency for acyclic-required edges only (ignores `related`).
    adj: dict[str, list[tuple[str, str]]] = {}
    for edge in g.edges:
        if edge.derived or edge.type not in ACYCLIC_EDGE_TYPES:
            continue
        if edge.target not in g.nodes:
            continue  # already reported by id-resolution
        if edge.type == "governs" and (edge.target, edge.source) in implements_pairs:
            continue  # semantic-inverse pair already covered by implements
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
# Traversal verbs (Story 3): impact, ancestors, chain
# ---------------------------------------------------------------------------

# Edge types omitted from labels when they are the "default" semantic for
# a source/target-kind pair (SPEC-0018 § Layout rules). All other edge
# types MUST carry inline labels.
# Per SPEC-0018 § Layout rules: defaults are EXACTLY these three pairs. All
# other edge types (including `implements`, `governed-by`, `enables`, etc.)
# MUST carry an inline label.
_DEFAULT_LABEL_RULES: dict[tuple[str, str], str] = {
    ("adr", "spec"): "governs",
    ("spec", "spec"): "requires",
    ("adr", "adr"): "extends",
}

_TITLE_TRUNCATE = 60


def _title_for(node: Node) -> str:
    """Render `ID: normalized truncated title` per SPEC-0018 § Layout rules."""
    if node.kind == "code":
        return node.id
    title = re.sub(r"\s+", " ", node.title).strip()
    # Strip leading "ADR-XXXX: " / "SPEC-XXXX: " — we render the ID separately.
    title = re.sub(r"^(ADR|SPEC)-\d{4}:\s*", "", title)
    if len(title) > _TITLE_TRUNCATE:
        title = title[: _TITLE_TRUNCATE - 1] + "…"
    return f"{node.id}: {title}" if title else node.id


def _edge_label(
    graph: Graph,
    source_id: str,
    target_id: str,
    edge_type: str,
    derived: bool,
) -> str:
    """Bracketed label for the edge from `source_id` to `target_id`.

    Returns "" when the edge type is the default for the source/target kind
    pair AND the edge is authored (not derived). Derived edges always carry
    a label so the (derived) annotation is visible.
    """
    src = graph.nodes.get(source_id)
    tgt = graph.nodes.get(target_id)
    src_kind = src.kind if src else "?"
    tgt_kind = tgt.kind if tgt else "?"
    default = _DEFAULT_LABEL_RULES.get((src_kind, tgt_kind))
    parts: list[str] = []
    if edge_type and edge_type != default:
        parts.append(edge_type)
    if derived:
        parts.append("derived")
    return f" [{', '.join(parts)}]" if parts else ""


def _outgoing_authored(graph: Graph, node_id: str) -> list[tuple[str, str]]:
    """Authored outgoing edges (forward direction). Sorted by (target, type).

    Excludes `related` (weak association) — this edge type carries no
    dependency semantics, so propagating through it during transitive
    traversal produces noise without informational value. `related` edges
    still appear in `validate`, `orphans`, and `--json` output; they're
    just not walked by `impact`/`ancestors`/`chain`.
    """
    src = graph.nodes.get(node_id)
    if src is not None and src.kind == "code":
        return []  # code nodes have only their governing edges, treated separately
    out = [
        (e.target, e.type) for e in graph.edges
        if e.source == node_id and not e.derived and e.type != "related"
    ]
    return sorted(out)


def _outgoing_derived(graph: Graph, node_id: str) -> list[tuple[str, str]]:
    """Derived outgoing edges (inverse direction). Sorted by (target, type).

    Excludes the symmetric `related` derived inverse for the same reason
    as `_outgoing_authored`: weak associations don't carry dependency
    semantics worth transitive traversal.
    """
    out = [
        (e.target, e.type) for e in graph.edges
        if e.source == node_id and e.derived and e.type != "related"
    ]
    return sorted(out)


_ID_NUMBER_RE = re.compile(r"^(ADR|SPEC)-(\d+)$", re.IGNORECASE)


def _normalize_id(query: str) -> str:
    """Zero-pad the numeric portion of an artifact ID for fair comparison.

    Turns `ADR-99` into `ADR-0099` and `spec-7` into `SPEC-0007`. Returns
    the input upper-cased if it doesn't match the pattern.
    """
    m = _ID_NUMBER_RE.match(query)
    if not m:
        return query.upper()
    prefix, num = m.group(1).upper(), m.group(2)
    return f"{prefix}-{int(num):04d}"


def _closest_matches(graph: Graph, query: str, n: int = 3) -> list[str]:
    """Suggest close matches for an unknown ID.

    Tiered scoring:
      0. exact match (after upper-case + zero-pad normalization)
      1. prefix match
      2. substring match
      3. for ID-shape queries (ADR/SPEC + number), numeric proximity
         within the same prefix family
    """
    candidates = sorted(graph.nodes.keys())
    qu = query.upper()
    qn = _normalize_id(query)
    q_match = _ID_NUMBER_RE.match(query)
    q_prefix = q_match.group(1).upper() if q_match else None
    q_num = int(q_match.group(2)) if q_match else None

    scored: list[tuple[int, int, str]] = []
    for c in candidates:
        cu = c.upper()
        if cu == qu or cu == qn:
            scored.append((0, 0, c))
            continue
        if cu.startswith(qu) or cu.startswith(qn):
            scored.append((1, 0, c))
            continue
        if qu in cu or qn in cu:
            scored.append((2, 0, c))
            continue
        c_match = _ID_NUMBER_RE.match(c)
        if c_match and q_match and c_match.group(1).upper() == q_prefix:
            c_num = int(c_match.group(2))
            scored.append((3, abs(c_num - q_num), c))
    scored.sort()
    return [c for _, _, c in scored[:n]]




# --- Connector glyphs (U+2500–U+257F block, per SPEC-0018) ---

def _connector(is_last: bool, derived: bool) -> str:
    """Return the branch-and-arrow connector for a child line."""
    branch = "└" if is_last else "├"
    arrow = "─ ─►" if derived else "──►"
    return branch + arrow


def _continuation(is_last: bool) -> str:
    """Return the prefix continuation for a subtree below a child line.

    Per SPEC-0018 § Reproducibility: exactly two spaces of indentation per
    nesting level. The branch glyph occupies one of those when present.
    """
    return "  " if is_last else "│ "


# --- Top-down tree renderer (used by impact, and by chain's lower half) ---


def _render_subtree(
    graph: Graph,
    node_id: str,
    follow: str,  # "authored" or "derived"
    prefix: str,
    out: list[str],
    visited: set[str],
) -> None:
    if follow == "authored":
        children = _outgoing_authored(graph, node_id)
    else:
        children = _outgoing_derived(graph, node_id)
    for i, (child_id, edge_type) in enumerate(children):
        is_last = i == len(children) - 1
        derived = follow == "derived"
        connector = _connector(is_last, derived)
        label = _edge_label(graph, node_id, child_id, edge_type, derived)
        child_node = graph.nodes.get(child_id)
        title = _title_for(child_node) if child_node else child_id
        if child_id in visited:
            out.append(f"{prefix}{connector}{label} {title} (already shown)")
            continue
        visited.add(child_id)
        out.append(f"{prefix}{connector}{label} {title}")
        _render_subtree(graph, child_id, follow, prefix + _continuation(is_last), out, visited)


def render_impact(graph: Graph, target_id: str) -> str:
    """Render top-down tree: target at top, dependents below (SPEC-0018)."""
    target = graph.nodes[target_id]
    if not _outgoing_derived(graph, target_id):
        return (
            f"# /sdd:graph impact {target_id}\n\n"
            f"{_title_for(target)} has no impact — nothing in the graph depends on it.\n"
        )
    out = [f"# /sdd:graph impact {target_id}", "", _title_for(target)]
    visited: set[str] = {target_id}
    _render_subtree(graph, target_id, follow="derived", prefix="", out=out, visited=visited)
    out.append("")
    return "\n".join(out)


# --- Vertical-chain renderer (used by ancestors, and by chain's upper half) ---


def _render_chain_path(
    graph: Graph,
    path: list[tuple[str, str, bool]],
    omit_last_title: bool = False,
) -> str:
    """Render one path as a vertical chain.

    `path` is ordered top-down: most-distant ancestor first, queried target
    last. Each entry is (node_id, edge_type_FROM_THIS_TO_NEXT, derived).
    The last entry has empty edge fields.

    When `omit_last_title=True`, the last node's title line is suppressed
    (used by the chain verb to avoid duplicating the queried-target name —
    the trailing `│` continuation flows visually into the middle section).

    Per SPEC-0018 § Layout rules, the `▼` glyph is reserved for diagnostic
    verbs and MUST NOT appear in traversal output. Vertical flow is shown
    by `│` (authored) or `┆` (derived) glyphs only.
    """
    lines: list[str] = []
    for i, (nid, edge_type_to_next, derived_to_next) in enumerate(path):
        if not (omit_last_title and i == len(path) - 1):
            node = graph.nodes.get(nid)
            lines.append(_title_for(node) if node else nid)
        if i < len(path) - 1:
            next_id = path[i + 1][0]
            label = _edge_label(graph, nid, next_id, edge_type_to_next, derived_to_next)
            line_char = "┆" if derived_to_next else "│"
            lines.append(f"{line_char}{label}")
            lines.append(line_char)
    return "\n".join(lines)


def _enumerate_ancestor_paths(
    graph: Graph,
    target_id: str,
    max_depth: int = 32,
) -> list[list[tuple[str, str, bool]]]:
    """Return paths from target to each leaf, formatted for vertical render.

    Each path is top-down: most-distant ancestor first, target last. Edge
    type and derived flag are stored on the *source* of each edge (i.e.,
    the entry above the arrow), reflecting the visual flow. The final
    (target) entry has empty edge fields.
    """
    raw_paths: list[list[tuple[str, str, bool]]] = []

    def dfs(node: str, path: list[tuple[str, str, bool]]) -> None:
        children = _outgoing_authored(graph, node)
        if not children or len(path) >= max_depth:
            raw_paths.append(list(path))
            return
        for child_id, edge_type in children:
            if any(step[0] == child_id for step in path):
                continue
            path.append((child_id, edge_type, False))
            dfs(child_id, path)
            path.pop()

    # Start from target; collect forward paths target → ancestor1 → ancestor2 → ...
    # Each entry is (node_id, edge_type_to_child, False); the final entry of
    # each leaf path has empty edge fields.
    dfs(target_id, [(target_id, "", False)])
    raw_paths.sort(key=lambda p: tuple((s[0], s[1]) for s in p))

    # Convert each raw forward path into a top-down (ancestor → target) form.
    # Forward path stores edges as (current_id, edge_type_to_child). To
    # render top-down with target at bottom, we reverse, and shift each
    # entry's edge info so that entry[i].edge describes the edge FROM
    # entry[i] TO entry[i+1] in the rendered (top-down) order. Because the
    # rendered direction is the inverse of the forward direction, we
    # convert the original edge type to its derived inverse and mark it as
    # derived (the visual arrow flows ancestor → target, which is the
    # inverse of the authored relationship).
    rendered: list[list[tuple[str, str, bool]]] = []
    for fwd in raw_paths:
        if len(fwd) <= 1:
            continue
        rev = list(reversed(fwd))
        # rev[0] is the leaf (most-distant ancestor); rev[-1] is target.
        # In the forward path, edge_type at fwd[i] refers to the edge
        # fwd[i-1] → fwd[i]. After reversal, that same edge corresponds to
        # rev[i+1] → rev[i] visually — i.e., its inverse.
        out_path: list[tuple[str, str, bool]] = []
        for i, (nid, _et, _d) in enumerate(rev):
            if i == len(rev) - 1:
                out_path.append((nid, "", False))
                continue
            # Edge from rev[i] to rev[i+1] is the inverse of fwd[len-1-i].edge_type.
            forward_edge_type = rev[i][1]  # the original edge type at this raw position
            inverse_type = INVERSE_OF.get(forward_edge_type, forward_edge_type)
            out_path.append((nid, inverse_type, True))
        rendered.append(out_path)
    return rendered


def render_ancestors(graph: Graph, target_id: str) -> str:
    """Render ancestor paths with target at BOTTOM of a single diagram (SPEC-0018).

    Each enumerated path is rendered top-down with its title sequence and
    edge labels, then a shared `│` continuation drops into the queried
    target which appears once at the bottom. For multi-parent cases (the
    queried node has multiple direct ancestors), each ancestor stack is
    visually separated by a blank line above the shared queried-line.

    The spec's "single contiguous diagram" wording is honored by emitting
    the queried node exactly once. The vertical-stack approximation of
    multi-parent fan-in (vs. a side-by-side merging Y) is a tractable
    ASCII-only rendering — see PR description for the trade-off.
    """
    target = graph.nodes[target_id]
    paths = _enumerate_ancestor_paths(graph, target_id)
    if not paths:
        return (
            f"# /sdd:graph ancestors {target_id}\n\n"
            f"{_title_for(target)} has no declared ancestors.\n"
        )
    chunks = [_render_chain_path(graph, p, omit_last_title=True) for p in paths]
    body = "\n\n".join(chunks)
    return (
        f"# /sdd:graph ancestors {target_id}\n\n"
        f"{body}\n"
        f"{_title_for(target)} (queried)\n"
    )


def render_chain(graph: Graph, target_id: str) -> str:
    """Render bidirectional view as a single contiguous diagram.

    Per SPEC-0018 § Layout rules: queried artifact in the middle, ancestors
    above, dependents below. The two regions are separated by a single
    `│` continuation through the queried node — NOT by `▼` and NOT by
    markdown subheadings.

    Layout:
        {ancestor stacks rendered top-down with edge labels}
        {│ continuation}
        {queried artifact (queried)}
        {│ continuation if there is impact}
        {impact tree top-down}
    """
    target = graph.nodes[target_id]
    has_ancestors = bool(_outgoing_authored(graph, target_id))
    has_impact = bool(_outgoing_derived(graph, target_id))

    out: list[str] = [f"# /sdd:graph chain {target_id}", ""]

    if has_ancestors:
        paths = _enumerate_ancestor_paths(graph, target_id)
        for p in paths:
            if len(p) <= 1:
                continue
            out.append(_render_chain_path(graph, p, omit_last_title=True))
            out.append("")  # blank between ancestor stacks

    out.append(f"{_title_for(target)} (queried)")

    if has_impact:
        out.append("│")
        body: list[str] = []
        visited: set[str] = {target_id}
        _render_subtree(graph, target_id, follow="derived", prefix="", out=body, visited=visited)
        out.extend(body)

    out.append("")

    if not has_ancestors and not has_impact:
        # Replace the trailing blank with the leaf message.
        out[-1] = f"{_title_for(target)} is a leaf in the graph (no ancestors, no impact)."
        out.append("")

    return "\n".join(out)


def cmd_traversal(
    graph: Graph,
    verb: str,
    target_id: str,
    fmt: str = "ascii",
) -> tuple[str, int]:
    """Dispatch a traversal verb in the requested output format.

    `fmt` is one of: "ascii" (default DAG render), "table" (markdown
    table), "mermaid" (Mermaid flowchart), "json" (versioned schema).
    Returns (output, exit_code). Errors in JSON mode are surfaced as a
    JSON error envelope (per SPEC-0018 § Output Formats — the contract
    must remain machine-parseable on every code path).
    """
    if target_id not in graph.nodes:
        suggestions = _closest_matches(graph, target_id)
        if fmt == "json":
            return _error_envelope_json(
                verb=verb,
                code="unknown-artifact",
                message=f"unknown artifact `{target_id}`",
                query_id=target_id,
                suggestions=suggestions,
            ), 1
        msg = f"error: unknown artifact `{target_id}`."
        if suggestions:
            msg += f" Closest matches: {', '.join(suggestions)}."
        msg += "\n"
        return msg, 1
    if fmt == "json":
        return _traversal_json(graph, verb, target_id), 0
    if fmt == "mermaid":
        return _traversal_mermaid(graph, verb, target_id), 0
    if fmt == "table":
        return _traversal_table(graph, verb, target_id), 0
    # default: ASCII DAG
    if verb == "ancestors":
        return render_ancestors(graph, target_id), 0
    if verb == "impact":
        return render_impact(graph, target_id), 0
    if verb == "chain":
        return render_chain(graph, target_id), 0
    return f"error: unknown traversal verb `{verb}`.\n", 2


# ---------------------------------------------------------------------------
# Output formats (Story 6): --table, --mermaid, --json
# ---------------------------------------------------------------------------

# JSON schema_version. Bump on breaking changes; document the version's
# shape via a versioned addendum to SPEC-0018 § Output Formats.
JSON_SCHEMA_VERSION = "1"


def _error_envelope_json(
    verb: str,
    code: str,
    message: str,
    query_id: str | None = None,
    suggestions: list[str] | None = None,
) -> str:
    """Stable JSON error envelope. Every JSON error path uses this shape so
    machine consumers can parse failure responses without falling back to
    text scraping. Distinguishable from success responses by the presence
    of a top-level `error` field instead of `results`.
    """
    query: dict[str, object] = {"verb": verb}
    if query_id is not None:
        query["id"] = query_id
    err: dict[str, object] = {"code": code, "message": message}
    if suggestions:
        err["suggestions"] = suggestions
    payload = {
        "schema_version": JSON_SCHEMA_VERSION,
        "query": query,
        "error": err,
    }
    return _stable_json(payload)


def _traversal_visit(
    graph: Graph, verb: str, target_id: str
) -> list[tuple[str, list[Edge]]]:
    """Compute the result set for a traversal verb.

    For each visited node, return the outgoing edges (authored AND
    derived) that target either the queried artifact or another visited
    node. Per SPEC-0018 § Output Formats schema, each result entry's
    `edges[]` describes how the result relates back into the subgraph —
    NOT how the queried artifact reaches it.

    Returns `[(node_id, edges), ...]` in artifact-ID-ascending order;
    edges are sorted by (target, type, derived) for byte-identical
    reproducibility.
    """
    visited: set[str] = set()

    def walk(node_id: str, derived: bool) -> None:
        if derived:
            children = _outgoing_derived(graph, node_id)
        else:
            children = _outgoing_authored(graph, node_id)
        for child_id, _edge_type in children:
            if child_id == target_id or child_id in visited:
                continue
            visited.add(child_id)
            walk(child_id, derived)

    if verb in ("impact", "chain"):
        walk(target_id, derived=True)
    if verb in ("ancestors", "chain"):
        walk(target_id, derived=False)

    in_subgraph = visited | {target_id}
    out: list[tuple[str, list[Edge]]] = []
    for node_id in sorted(visited):
        edges = [
            e for e in graph.edges
            if e.source == node_id and e.target in in_subgraph
        ]
        edges.sort(key=lambda e: (e.target, e.type, e.derived))
        out.append((node_id, edges))
    return out


def _traversal_json(graph: Graph, verb: str, target_id: str) -> str:
    """Emit traversal result in stable, versioned JSON.

    Schema (version 1):
      {
        "schema_version": "1",
        "query": {"verb": <str>, "id": <str>},
        "results": [
          {
            "id": <str>,
            "type": "adr"|"spec"|"code",
            "module": <str|null>,
            "title": <str>,
            "edges": [
              {"type": <str>, "target": <str>, "derived": <bool>}
            ]
          }
        ]
      }
    """
    visits = _traversal_visit(graph, verb, target_id)
    results: list[dict] = []
    for node_id, edges in visits:
        node = graph.nodes.get(node_id)
        results.append(
            {
                "id": node_id,
                "type": node.kind if node else "unknown",
                "module": node.module if node else None,
                "title": node.title if node else "",
                "edges": [
                    {
                        "type": e.type,
                        "target": e.target,
                        "derived": e.derived,
                    }
                    for e in edges
                ],
            }
        )
    payload = {
        "schema_version": JSON_SCHEMA_VERSION,
        "query": {"verb": verb, "id": target_id},
        "results": results,
    }
    return _stable_json(payload)


def _stable_json(obj: object) -> str:
    """Pretty-print JSON deterministically: sort_keys=True, 2-space indent, LF."""
    import json as _json
    return _json.dumps(obj, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def _traversal_mermaid(graph: Graph, verb: str, target_id: str) -> str:
    """Emit a Mermaid flowchart block for the traversal subgraph.

    Direction matches the ASCII layout per SPEC-0018: `ancestors`
    flows BT (bottom-to-top — queried at bottom), `impact` flows TB
    (top-to-bottom — queried at top), `chain` is TB with the queried
    node naturally in the middle of the rendered diagram.

    Authored edges use `-->`; derived edges use `-.->`.
    """
    direction = "BT" if verb == "ancestors" else "TB"
    visits = _traversal_visit(graph, verb, target_id)
    out: list[str] = ["```mermaid", f"flowchart {direction}"]

    # The queried target is always a node.
    target = graph.nodes.get(target_id)
    out.append(f"  {_mermaid_id(target_id)}[\"{_mermaid_label(target)}\"]")

    seen_nodes: set[str] = {target_id}
    for node_id, edges in visits:
        if node_id not in seen_nodes:
            node = graph.nodes.get(node_id)
            out.append(f"  {_mermaid_id(node_id)}[\"{_mermaid_label(node)}\"]")
            seen_nodes.add(node_id)
        for e in edges:
            if e.source not in seen_nodes:
                src = graph.nodes.get(e.source)
                out.append(f"  {_mermaid_id(e.source)}[\"{_mermaid_label(src)}\"]")
                seen_nodes.add(e.source)
            arrow = "-.->|" if e.derived else "-->|"
            label_text = e.type
            if e.derived:
                label_text += " (derived)"
            out.append(
                f"  {_mermaid_id(e.source)} {arrow}\"{label_text}\"| {_mermaid_id(e.target)}"
            )
    out.append("```")
    out.append("")
    return "\n".join(out)


def _mermaid_id(artifact_id: str) -> str:
    """Sanitize an artifact ID for use as a Mermaid node ID.

    Mermaid IDs accept `[A-Za-z0-9_]` — replace `[`, `]`, `/`, `-` with
    `_` so module-prefixed IDs and code paths render as valid graph nodes.
    """
    return re.sub(r"[^A-Za-z0-9_]", "_", artifact_id)


def _mermaid_label(node: Node | None) -> str:
    """Mermaid-safe node label. Escapes `"` and limits length."""
    if node is None:
        return "?"
    label = _title_for(node)
    return label.replace('"', '\\"')


def _traversal_table(graph: Graph, verb: str, target_id: str) -> str:
    """Force a markdown table for a hierarchical traversal verb.

    Per SPEC-0018 § Output Formats Scenario "--table override": columns
    are ID, Type, edge type to the queried artifact, and authored/derived
    indicator. Each row is one (result, edge-back-to-subgraph) pair —
    a result with multiple edges back into the subgraph contributes
    multiple rows.
    """
    target = graph.nodes.get(target_id)
    visits = _traversal_visit(graph, verb, target_id)
    out = [f"# /sdd:graph {verb} {target_id} (table)", ""]
    if not visits:
        out.append(
            f"{_title_for(target) if target else target_id} "
            f"has no traversal results for `{verb}`."
        )
        out.append("")
        return "\n".join(out)
    out.append("| ID | Type | Edge to | Edge type | Authored |")
    out.append("|----|------|---------|-----------|----------|")
    for node_id, edges in visits:
        node = graph.nodes.get(node_id)
        type_ = node.kind if node else "unknown"
        for e in edges:
            authored = "derived" if e.derived else "authored"
            out.append(
                f"| {_md_escape(node_id)} | {type_} "
                f"| {_md_escape(e.target)} | {_md_escape(e.type)} | {authored} |"
            )
    out.append("")
    return "\n".join(out)


# --- Diagnostic JSON renderers ---


def _orphans_json(graph: Graph, root: Path, scope: str | None) -> str:
    payload = {
        "schema_version": JSON_SCHEMA_VERSION,
        "query": {"verb": "orphans", "scope": scope} if scope else {"verb": "orphans"},
        "results": {
            "code_files_without_governing": _orphan_code(graph, root, scope),
            "specs_without_implementing_code": _orphan_specs(graph),
            "adrs_without_implementing_spec": _orphan_adrs(graph),
        },
    }
    return _stable_json(payload)


def _cycles_json(graph: Graph) -> str:
    cycles = [
        {"message": d.message, "code": d.code}
        for d in graph.diagnostics
        if d.code == "cycle"
    ]
    payload = {
        "schema_version": JSON_SCHEMA_VERSION,
        "query": {"verb": "cycles"},
        "results": cycles,
    }
    return _stable_json(payload)


# --- Validate JSON renderer ---


def _validate_json(graph: Graph) -> str:
    n_authored = sum(1 for e in graph.edges if not e.derived)
    n_derived = sum(1 for e in graph.edges if e.derived)
    payload = {
        "schema_version": JSON_SCHEMA_VERSION,
        "query": {"verb": "validate"},
        "results": {
            "nodes": len(graph.nodes),
            "authored_edges": n_authored,
            "derived_edges": n_derived,
            "diagnostics": [
                {
                    "severity": d.severity,
                    "code": d.code,
                    "message": d.message,
                    "source_id": d.source_id,
                    "field": d.field,
                    "target_id": d.target_id,
                }
                for d in graph.diagnostics
            ],
        },
    }
    return _stable_json(payload)


# ---------------------------------------------------------------------------
# Diagnostic verbs (Story 4): orphans, cycles
# ---------------------------------------------------------------------------


def cmd_orphans(graph: Graph, root: Path, scope: str | None = None) -> str:
    """Render orphan diagnostic per SPEC-0018 REQ "Diagnostic Query Verbs".

    Three orphan categories:
      a. Source files with no governing comment block — found via a fresh
         walk of `root` (using the same exclusions as the graph builder).
         These files are NOT graph nodes, per SPEC-0018: they remain
         invisible to traversal queries and surface only here.
      b. Specs with no implementing source files — specs that no code
         file's governing comment references.
      c. ADRs with no implementing spec — ADRs that no spec declares
         `implements:` against.

    A spec-or-ADR is flagged whenever no `Governing:` comment in source
    code references it; comment-less code is invisible by design (per
    the spec scenario). For repos that don't yet attach governing
    comments to source code, expect every spec and ADR to be flagged.

    Output is a flat markdown table per SPEC-0018 (default for flat
    results). Optional `scope` filter restricts category (a) to files
    under the given subtree.
    """
    out: list[str] = ["# /sdd:graph orphans", ""]

    code_orphans = _orphan_code(graph, root, scope)
    spec_orphans = _orphan_specs(graph)
    adr_orphans = _orphan_adrs(graph)

    if not (code_orphans or spec_orphans or adr_orphans):
        out.append("No orphans detected.")
        out.append("")
        return "\n".join(out)

    out.append(
        "Orphans surface artifacts that have no traceability link to code: a spec is "
        "flagged whenever no `Governing:` comment in source code references it, "
        "and an ADR is flagged whenever no spec declares `implements:` against it. "
        "Source files without governing comments are listed separately."
    )
    out.append("")

    if code_orphans:
        out.append("## Source files without governing artifacts")
        out.append("")
        out.append("| File |")
        out.append("|------|")
        for path in code_orphans:
            out.append(f"| `{_md_escape(path)}` |")
        out.append("")

    if spec_orphans:
        out.append("## Specs with no implementing code")
        out.append("")
        out.append("| Spec | Title |")
        out.append("|------|-------|")
        for spec_id in spec_orphans:
            node = graph.nodes[spec_id]
            out.append(f"| {spec_id} | {_md_escape(_node_title_only(node))} |")
        out.append("")

    if adr_orphans:
        out.append("## ADRs with no implementing spec")
        out.append("")
        out.append("| ADR | Title |")
        out.append("|-----|-------|")
        for adr_id in adr_orphans:
            node = graph.nodes[adr_id]
            out.append(f"| {adr_id} | {_md_escape(_node_title_only(node))} |")
        out.append("")

    return "\n".join(out)


def _node_title_only(node: Node) -> str:
    """Return the truncated normalized title without the leading ID prefix."""
    full = _title_for(node)
    if ": " in full:
        return full.split(": ", 1)[1]
    return ""


def _md_escape(s: str) -> str:
    """Escape `|` and backslash for safe inclusion in markdown table cells."""
    return s.replace("\\", "\\\\").replace("|", "\\|")


def _orphan_code(graph: Graph, root: Path, scope: str | None) -> list[str]:
    """Code files without a governing comment block, per SPEC-0018.

    These files are NOT graph nodes (the builder skips files with no
    `Governing:` block to keep traversal queries clean). The walk runs
    fresh here so the verb can surface comment-less files independent of
    what's already in the graph.

    `scope` filters results to a subtree. Empty / `.` / `./` / leading
    `./` are all normalized to "include everything."
    """
    paths = discover_orphan_code(root)
    scope_clean = (scope or "").lstrip("./").rstrip("/")
    rel_paths: list[str] = []
    for p in paths:
        rel = str(p.relative_to(root)) if p.is_relative_to(root) else str(p)
        if scope_clean and not (rel == scope_clean or rel.startswith(scope_clean + "/")):
            continue
        rel_paths.append(rel)
    return rel_paths


def _orphan_specs(graph: Graph) -> list[str]:
    """Specs that no code file governs (no derived governed-by from code)."""
    orphans: list[str] = []
    for node_id, node in sorted(graph.nodes.items()):
        if node.kind != "spec":
            continue
        # An implementing edge would be a derived `governed-by` from a code
        # node TO this spec; equivalently, an authored `governed-by` edge
        # whose target is this spec from a code-kind source.
        has_code_impl = any(
            e.target == node_id
            and e.type == "governed-by"
            and graph.nodes.get(e.source) is not None
            and graph.nodes[e.source].kind == "code"
            for e in graph.edges
        )
        if not has_code_impl:
            orphans.append(node_id)
    return orphans


def _orphan_adrs(graph: Graph) -> list[str]:
    """ADRs that no spec implements (no authored implements TO this ADR)."""
    orphans: list[str] = []
    for node_id, node in sorted(graph.nodes.items()):
        if node.kind != "adr":
            continue
        has_spec_impl = any(
            e.target == node_id
            and e.type == "implements"
            and not e.derived
            and graph.nodes.get(e.source) is not None
            and graph.nodes[e.source].kind == "spec"
            for e in graph.edges
        )
        if not has_spec_impl:
            orphans.append(node_id)
    return orphans


def cmd_cycles(graph: Graph) -> str:
    """List any cycles detected during validation.

    Per SPEC-0018: "If validation passed, returns an empty result."
    Note that this verb runs only after validation passes (the main()
    hard-error gate). Therefore the output is always "No cycles detected."
    in v1 — cycles would have already failed validation. The verb exists
    primarily for tooling that wants to confirm cycle-freeness without
    running full validation.
    """
    cycles = [d for d in graph.diagnostics if d.code == "cycle"]
    out = ["# /sdd:graph cycles", ""]
    if not cycles:
        out.append("No cycles detected.")
        out.append("")
        return "\n".join(out)
    out.append("| Cycle |")
    out.append("|-------|")
    for d in cycles:
        out.append(f"| {d.message} |")
    out.append("")
    return "\n".join(out)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


_ALL_VERBS = ("validate", "impact", "ancestors", "chain", "orphans", "cycles", "backfill")
_TRAVERSAL_VERBS = frozenset({"impact", "ancestors", "chain"})


# ---------------------------------------------------------------------------
# Backfill mode (Story 7)
# ---------------------------------------------------------------------------

# Sections we scan for artifact references, per SPEC-0018 REQ "Backfill Mode".
_BACKFILL_SECTIONS = (
    "Related",
    "More Information",
    "Overview",
    "Decision Outcome",
    "Consequences",
)
_SECTION_HEADING_RE = re.compile(r"^##+\s+(.+?)\s*$", re.MULTILINE)
_ARTIFACT_REF_RE = re.compile(r"\b(ADR|SPEC)-(\d{4})\b")
# Verbs that hint at a stronger relationship than `related`. Priority order
# is fixed by check order in _propose_edges_from_prose: supersedes > extends > enables.
_EXTENDS_HINT_RE = re.compile(
    r"\b(?:extends|extend|modifies|modify|builds on|building on|builds upon|"
    r"builds atop|builds-on|enhances|builds out)\b",
    re.IGNORECASE,
)
_SUPERSEDES_HINT_RE = re.compile(r"\b(?:supersedes|superseded by|replaces|replaced by)\b", re.IGNORECASE)
_ENABLES_HINT_RE = re.compile(r"\b(?:enables|unblocks|paves the way for)\b", re.IGNORECASE)

# Code-fence stripping. Code blocks (```...```) and inline backtick spans
# (`...`) often contain artifact references that are documentation
# examples, not real graph edges (e.g., `/sdd:plan SPEC-0003` invocation
# samples). Strip these before scanning prose.
_FENCED_BLOCK_RE = re.compile(r"```.*?```", re.DOTALL)
_INLINE_CODE_RE = re.compile(r"`[^`\n]*`")

# Allowed target kinds per edge field. Cross-kind violations (e.g., an ADR
# declaring `extends: [SPEC-XXXX]`) are rejected by the backfill heuristic
# so apply can never write a schema-illegal edge.
_FIELD_TARGET_KINDS: dict[tuple[str, str], frozenset[str]] = {
    ("adr", "supersedes"): frozenset({"ADR"}),
    ("adr", "extends"): frozenset({"ADR"}),
    ("adr", "enables"): frozenset({"ADR"}),
    ("adr", "governs"): frozenset({"SPEC"}),
    ("adr", "related"): frozenset({"ADR"}),
    ("spec", "implements"): frozenset({"ADR"}),
    ("spec", "requires"): frozenset({"SPEC"}),
    ("spec", "extends"): frozenset({"SPEC"}),
    ("spec", "supersedes"): frozenset({"SPEC"}),
}

# Field-strength order for de-duplicating same-target proposals: a stronger
# field wins when both are inferred for the same (source, target) pair.
_FIELD_STRENGTH: dict[str, int] = {
    "supersedes": 5,
    "extends": 4,
    "enables": 3,
    "governs": 3,
    "implements": 3,
    "requires": 3,
    "related": 1,
}

_SKIP_FILE_NAME = ".sdd-graph-backfill-skip"


def _strip_code_blocks(text: str) -> str:
    """Replace fenced and inline code spans with whitespace.

    Preserves line numbering by emitting newlines for each newline that was
    inside a stripped fenced block, so window-based regex offsets in the
    caller still align with line context.
    """
    def fenced_repl(m: re.Match) -> str:
        return "\n" * m.group(0).count("\n")
    text = _FENCED_BLOCK_RE.sub(fenced_repl, text)
    text = _INLINE_CODE_RE.sub(lambda m: " " * len(m.group(0)), text)
    return text


@dataclass
class BackfillProposal:
    """One artifact's worth of proposed edges from prose parsing."""

    node_id: str
    path: str
    proposals: list[tuple[str, str]]  # list of (field, target_id)
    rationale: dict[tuple[str, str], str] = field(default_factory=dict)


def _backfill_section_iter(text: str) -> list[tuple[str, str]]:
    """Return [(section_title, section_body), ...] for every ## heading."""
    headings = list(_SECTION_HEADING_RE.finditer(text))
    out: list[tuple[str, str]] = []
    for i, m in enumerate(headings):
        title = m.group(1).strip()
        start = m.end()
        end = headings[i + 1].start() if i + 1 < len(headings) else len(text)
        out.append((title, text[start:end]))
    return out


def _propose_edges_from_prose(
    text: str, node_id: str, kind: str
) -> tuple[list[tuple[str, str]], dict[tuple[str, str], str]]:
    """Parse artifact-reference prose and propose edges per SPEC-0018.

    Returns (proposed_edges, rationale_map):
      - proposed_edges: list of (edge_field, target_id) tuples
      - rationale_map: {(edge_field, target_id): "snippet of source prose"}

    Heuristics (per SPEC-0018 REQ "Backfill Mode" sources):
      - `## Related` / `## More Information` for ADRs:
        - "supersedes X" → supersedes
        - "extends/modifies/builds on X" → extends
        - "enables X" → enables
        - bare reference (no qualifying verb) → related
      - `## Decision Outcome` / `## Consequences` for ADRs:
        - SPEC-XXXX references → governs (the ADR governs that spec)
      - `## Overview` for specs:
        - ADR-XXXX references → implements (the spec realizes the ADR)
        - SPEC-XXXX references → requires (capability dependency)
      - "Supersedes X" anywhere → supersedes
    """
    proposals: list[tuple[str, str]] = []
    rationale: dict[tuple[str, str], str] = {}
    # Track strongest field seen per target so weaker proposals don't
    # accumulate alongside stronger ones (e.g., a target listed in both
    # an "extends X" sentence and a bare "Related: X" line shouldn't
    # produce both `extends:` AND `related:` entries).
    by_target: dict[str, tuple[int, str]] = {}

    def add(field: str, target: str, snippet: str) -> None:
        target = target.strip()
        if target == node_id:
            return
        strength = _FIELD_STRENGTH.get(field, 0)
        prev = by_target.get(target)
        if prev is not None and prev[0] >= strength:
            return  # already have an equal or stronger field for this target
        by_target[target] = (strength, field)
        rationale[(field, target)] = snippet[:200].replace("\n", " ").strip()

    text = _strip_code_blocks(text)
    sections = _backfill_section_iter(text)
    for title, body in sections:
        title_lower = title.lower()
        if title_lower not in {s.lower() for s in _BACKFILL_SECTIONS}:
            continue

        for ref_match in _ARTIFACT_REF_RE.finditer(body):
            ref_kind = ref_match.group(1)
            target = ref_match.group(0)
            # Window around the reference for verb detection.
            window_start = max(0, ref_match.start() - 80)
            window_end = min(len(body), ref_match.end() + 40)
            window = body[window_start:window_end]
            snippet = body[max(0, ref_match.start() - 50):ref_match.end() + 30]

            field: str | None = None
            if _SUPERSEDES_HINT_RE.search(window):
                field = "supersedes"
            elif _EXTENDS_HINT_RE.search(window):
                field = "extends"
            elif _ENABLES_HINT_RE.search(window):
                field = "enables"

            if field is None:
                # No qualifying verb: pick by section + kind defaults.
                if kind == "adr":
                    if title_lower in ("decision outcome", "consequences"):
                        if ref_kind == "SPEC":
                            field = "governs"
                        else:
                            continue  # ADR-to-ADR refs in these sections aren't graph-load-bearing
                    else:
                        # Related / More Information default
                        if ref_kind == "ADR":
                            field = "related"
                        else:
                            field = "governs"  # ADR mentioning a SPEC = it governs it
                elif kind == "spec":
                    if title_lower == "overview":
                        if ref_kind == "ADR":
                            field = "implements"
                        else:
                            field = "requires"
                    else:
                        if ref_kind == "ADR":
                            field = "implements"
                        else:
                            field = "requires"
            if field is None:
                continue

            # Schema enforcement: skip fields that aren't allowed for this
            # kind, AND fields whose target kind doesn't match the rules in
            # _FIELD_TARGET_KINDS (e.g., `extends` is same-kind-only).
            if kind == "adr" and field not in ADR_EDGE_FIELDS:
                continue
            if kind == "spec" and field not in SPEC_EDGE_FIELDS:
                continue
            allowed_target_kinds = _FIELD_TARGET_KINDS.get((kind, field))
            if allowed_target_kinds is not None and ref_kind not in allowed_target_kinds:
                continue
            add(field, target, snippet)

    # Materialize proposals from the per-target strongest-wins map, sorted
    # for byte-identical reproducibility.
    for target, (_strength, field) in sorted(by_target.items()):
        proposals.append((field, target))
    return proposals, rationale


def _load_skip_list(root: Path) -> set[tuple[str, str, str]]:
    """Load `.sdd-graph-backfill-skip` rejection memory.

    File format: one record per line, `node_id|field|target_id`. Lines
    starting with `#` and blank lines are ignored.
    """
    f = root / _SKIP_FILE_NAME
    skip: set[tuple[str, str, str]] = set()
    if not f.is_file():
        return skip
    for line in f.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split("|", 2)
        if len(parts) == 3:
            skip.add((parts[0], parts[1], parts[2]))
    return skip


def _save_skip_list(root: Path, skip: set[tuple[str, str, str]]) -> None:
    f = root / _SKIP_FILE_NAME
    lines = [
        "# Rejected backfill proposals. One per line: <node_id>|<field>|<target_id>",
        "# Generated by /sdd:graph backfill --reject. Clear with --reset.",
    ]
    for node_id, field, target in sorted(skip):
        lines.append(f"{node_id}|{field}|{target}")
    f.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _gather_proposals(graph: Graph, root: Path) -> list[BackfillProposal]:
    """Compute proposals for every ADR and spec in the graph."""
    skip = _load_skip_list(root)
    out: list[BackfillProposal] = []
    # Existing authored edges so we don't re-propose what's already declared.
    existing: set[tuple[str, str, str]] = {
        (e.source, e.type, e.target) for e in graph.edges if not e.derived
    }
    for node_id, node in sorted(graph.nodes.items()):
        if node.kind not in ("adr", "spec"):
            continue
        text = _read_text(Path(node.path))
        edges, rationale = _propose_edges_from_prose(text, node_id, node.kind)
        # Filter out already-authored and skipped.
        filtered: list[tuple[str, str]] = []
        filtered_rationale: dict[tuple[str, str], str] = {}
        for field, target in edges:
            if (node_id, field, target) in existing:
                continue
            if (node_id, field, target) in skip:
                continue
            filtered.append((field, target))
            filtered_rationale[(field, target)] = rationale.get((field, target), "")
        if filtered:
            out.append(
                BackfillProposal(
                    node_id=node_id,
                    path=node.path,
                    proposals=filtered,
                    rationale=filtered_rationale,
                )
            )
    return out


def cmd_backfill_propose(graph: Graph, root: Path) -> str:
    """Render proposals as a human-readable markdown report."""
    proposals = _gather_proposals(graph, root)
    if not proposals:
        return (
            "# /sdd:graph backfill\n\n"
            "No proposals — every artifact's prose-encoded references either "
            "already appear in frontmatter or are recorded in the skip list.\n"
        )
    out = [
        "# /sdd:graph backfill",
        "",
        f"{len(proposals)} artifact(s) have proposed edges. Review each proposal "
        "and run one of:",
        "",
        "- `python3 .../graph.py backfill --apply <ID>` to write the proposed",
        "  frontmatter (merges with any existing edge fields)",
        "- `python3 .../graph.py backfill --reject <ID>` to record a rejection",
        "  in `.sdd-graph-backfill-skip`",
        "- Skip this run; nothing is written without explicit consent.",
        "",
    ]
    for prop in proposals:
        out.append(f"## {prop.node_id}")
        out.append(f"`{prop.path}`")
        out.append("")
        out.append("**Proposed frontmatter additions:**")
        out.append("")
        out.append("```yaml")
        by_field: dict[str, list[str]] = {}
        for field, target in prop.proposals:
            by_field.setdefault(field, []).append(target)
        for f in sorted(by_field):
            tgts = ", ".join(sorted(set(by_field[f])))
            out.append(f"{f}: [{tgts}]")
        out.append("```")
        out.append("")
        out.append("**Rationale (snippets from prose):**")
        out.append("")
        for (field, target) in prop.proposals:
            snippet = prop.rationale.get((field, target), "")
            if snippet:
                out.append(f"- `{field}: {target}` — _\"...{snippet}...\"_")
        out.append("")
    return "\n".join(out)


def cmd_backfill_apply(graph: Graph, root: Path, node_ids: list[str]) -> tuple[str, int]:
    """Apply proposals for the listed artifact IDs.

    Reads existing frontmatter, merges proposed edges into existing edge
    fields (deduping), writes back. Returns a markdown report.
    """
    proposals = {p.node_id: p for p in _gather_proposals(graph, root)}
    out = ["# /sdd:graph backfill --apply", ""]
    exit_code = 0
    for node_id in node_ids:
        prop = proposals.get(node_id)
        if prop is None:
            out.append(f"- `{node_id}`: no pending proposal (already applied, rejected, or unknown ID)")
            exit_code = 1
            continue
        try:
            applied = _apply_to_file(Path(prop.path), prop.proposals)
        except Exception as exc:
            out.append(f"- `{node_id}`: failed to apply — {exc}")
            exit_code = 1
            continue
        out.append(f"- `{node_id}`: wrote {len(applied)} edge(s) to `{prop.path}`")
    out.append("")
    return "\n".join(out), exit_code


def cmd_backfill_reject(graph: Graph, root: Path, node_ids: list[str]) -> tuple[str, int]:
    """Record rejections in the skip list.

    Returns exit code 1 if any requested node ID has no current pending
    proposal — the caller asked for a rejection that records nothing.
    """
    proposals = {p.node_id: p for p in _gather_proposals(graph, root)}
    skip = _load_skip_list(root)
    rejected = 0
    missing: list[str] = []
    for node_id in node_ids:
        prop = proposals.get(node_id)
        if prop is None:
            missing.append(node_id)
            continue
        for field, target in prop.proposals:
            skip.add((node_id, field, target))
            rejected += 1
    _save_skip_list(root, skip)
    out = [f"# /sdd:graph backfill --reject", ""]
    out.append(f"Recorded {rejected} rejected edge(s) in `{_SKIP_FILE_NAME}`.")
    code = 0
    if missing:
        out.append("")
        out.append("Warnings:")
        for m in missing:
            out.append(f"- `{m}`: no pending proposal — nothing recorded for this ID")
        code = 1
    out.append("")
    return "\n".join(out), code


def cmd_backfill_reset(root: Path) -> tuple[str, int]:
    """Clear the skip list."""
    f = root / _SKIP_FILE_NAME
    if f.is_file():
        f.unlink()
    return (
        f"# /sdd:graph backfill --reset\n\n"
        f"Cleared `{_SKIP_FILE_NAME}` (if present).\n",
        0,
    )


def _apply_to_file(file_path: Path, proposals: list[tuple[str, str]]) -> list[tuple[str, str]]:
    """Merge proposals into the file's frontmatter; write the file.

    Returns the list of (field, target) edges actually added (after dedupe
    against the file's existing edge fields).
    """
    text = file_path.read_text(encoding="utf-8")
    m = _FRONTMATTER_RE.match(text)
    if m:
        existing_body = m.group(1)
        rest = text[m.end():]
    else:
        existing_body = ""
        rest = text
    existing_fm = parse_frontmatter(text) if m else {}
    # Build new edges grouped by field, merging with existing lists.
    by_field: dict[str, list[str]] = {}
    applied: list[tuple[str, str]] = []
    for field, target in proposals:
        existing_list = existing_fm.get(field) if isinstance(existing_fm.get(field), list) else None
        existing_set = set(existing_list) if existing_list else set()
        if target in existing_set:
            continue
        applied.append((field, target))
        by_field.setdefault(field, []).append(target)
    if not applied:
        return []
    # Generate new frontmatter text. Preserve every existing line, then
    # append/extend edge fields. For simplicity, we replace edge-field
    # lines outright when we have something to add for that field.
    edge_field_set = ALL_EDGE_FIELDS
    preserved_lines: list[str] = []
    seen_keys: set[str] = set()
    for line in existing_body.splitlines():
        stripped = line.lstrip()
        if not stripped or stripped.startswith("#"):
            preserved_lines.append(line)
            continue
        key = line.split(":", 1)[0].strip() if ":" in line else None
        if key in edge_field_set and key in by_field:
            # We'll re-emit this field with merged values below.
            seen_keys.add(key)
            continue
        preserved_lines.append(line)
    # Emit merged edge-field lines (existing values + new).
    new_field_lines: list[str] = []
    for field in sorted(by_field):
        existing_list = existing_fm.get(field) if isinstance(existing_fm.get(field), list) else []
        merged = sorted(set(list(existing_list or []) + by_field[field]))
        new_field_lines.append(f"{field}: [{', '.join(merged)}]")
    new_body = "\n".join(preserved_lines + new_field_lines)
    # Preserve a single blank line between the closing `---` and the body
    # (or the first character of the body if no leading whitespace existed).
    rest_no_leading_newlines = rest.lstrip("\n")
    new_text = f"---\n{new_body}\n---\n\n{rest_no_leading_newlines}"
    file_path.write_text(new_text, encoding="utf-8")
    return applied


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="graph", description=__doc__)
    parser.add_argument("verb", choices=_ALL_VERBS, help="graph verb to run")
    parser.add_argument(
        "id", nargs="?", help="artifact ID (required for impact, ancestors, chain)"
    )
    parser.add_argument("--root", default=".", help="project root (default: cwd)")
    parser.add_argument("--adr-dir", help="ADR directory (default: <root>/docs/adrs)")
    parser.add_argument("--spec-dir", help="spec directory (default: <root>/docs/openspec/specs)")
    parser.add_argument("--scope", help="restrict orphan code-file detection to a subtree")
    parser.add_argument(
        "--module",
        help=(
            "scope to a single workspace module (per SPEC-0014 § Workspace Detection). "
            "When set, the helper builds only that module's graph with unprefixed IDs. "
            "Has no effect on single-module projects."
        ),
    )
    fmt_group = parser.add_mutually_exclusive_group()
    fmt_group.add_argument(
        "--table", action="store_true",
        help="force markdown table output (overrides default ASCII DAG for hierarchical verbs)",
    )
    fmt_group.add_argument(
        "--mermaid", action="store_true",
        help="emit a Mermaid flowchart block (visual format for embedding)",
    )
    fmt_group.add_argument(
        "--json", action="store_true", dest="json_out",
        help=f"emit a stable, versioned JSON payload (schema_version={JSON_SCHEMA_VERSION!r})",
    )
    # Backfill-specific flags (only meaningful with `backfill` verb).
    backfill_group = parser.add_mutually_exclusive_group()
    backfill_group.add_argument(
        "--apply", nargs="+", metavar="ID",
        help="apply proposed edges for the given artifact IDs (writes frontmatter)",
    )
    backfill_group.add_argument(
        "--reject", nargs="+", metavar="ID",
        help="record rejections for the given artifact IDs in .sdd-graph-backfill-skip",
    )
    backfill_group.add_argument(
        "--reset", action="store_true",
        help="clear the .sdd-graph-backfill-skip file (re-propose previously rejected edges)",
    )
    args = parser.parse_args(argv)

    fmt = (
        "json" if args.json_out
        else "mermaid" if args.mermaid
        else "table" if args.table
        else "ascii"
    )

    # All v1 verbs are now implemented. The not-yet-implemented gate that
    # used to live here for Stories 3-7 in-progress is no longer needed.

    if args.verb in _TRAVERSAL_VERBS and not args.id:
        print(f"error: verb '{args.verb}' requires an artifact ID argument.", file=sys.stderr)
        print(f"usage: python3 graph.py {args.verb} <ADR-XXXX | SPEC-XXXX>", file=sys.stderr)
        return 2

    root = Path(args.root).resolve()
    if not root.is_dir():
        print(f"error: --root {root} is not a directory", file=sys.stderr)
        return 2

    # Workspace mode (Story 5): detect modules; choose build strategy.
    modules = detect_workspace(root)
    explicit_paths = bool(args.adr_dir or args.spec_dir)

    if args.module:
        # --module scopes to a single module with unprefixed IDs.
        # Per SPEC-0018 § Workspace Mode Aggregation Scenario "Single-module
        # project": on non-workspace projects, --module SHALL be silently
        # ignored. On workspace projects, an unknown module name is an error.
        if not modules:
            # Silently fall through to single-module mode.
            adr_dir = Path(args.adr_dir).resolve() if args.adr_dir else root / "docs" / "adrs"
            spec_dir = Path(args.spec_dir).resolve() if args.spec_dir else root / "docs" / "openspec" / "specs"
            g = build_graph(root, adr_dir, spec_dir)
        else:
            chosen = next((m for m in modules if m.name == args.module), None)
            if chosen is None:
                available = ", ".join(m.name for m in modules)
                print(
                    f"error: unknown module `{args.module}`. Available: {available}",
                    file=sys.stderr,
                )
                return 2
            adr_dir = Path(args.adr_dir).resolve() if args.adr_dir else chosen.adr_dir
            spec_dir = Path(args.spec_dir).resolve() if args.spec_dir else chosen.spec_dir
            g = build_graph(chosen.root, adr_dir, spec_dir)
    elif modules and not explicit_paths:
        # Aggregate mode: build per-module and merge with [module]/ID prefixes.
        g = build_aggregate_graph(root, modules)
    else:
        # Single-module: explicit paths or no workspace detected.
        adr_dir = Path(args.adr_dir).resolve() if args.adr_dir else root / "docs" / "adrs"
        spec_dir = Path(args.spec_dir).resolve() if args.spec_dir else root / "docs" / "openspec" / "specs"
        g = build_graph(root, adr_dir, spec_dir)

    if args.verb == "validate":
        if fmt == "json":
            print(_validate_json(g), end="")
        else:
            print_validation(g)
        return 1 if g.has_errors() else 0

    # Hard-error gate: traversal/diagnostic verbs require a clean graph.
    # Backfill is exempt — its whole purpose is migrating prose-only
    # projects whose graphs may be incomplete or partially broken.
    # Within backfill, only `--apply` is gated (writing edges to a graph
    # that already has hard errors would compound state); `propose`,
    # `--reject`, and `--reset` run unconditionally.
    backfill_writes = args.verb == "backfill" and args.apply is not None
    if g.has_errors() and args.verb != "backfill":
        if fmt == "json":
            print(
                _error_envelope_json(
                    verb=args.verb,
                    code="graph-has-errors",
                    message=(
                        "graph has hard errors; query verbs refuse to answer "
                        "until validation is clean. Run `validate` for details."
                    ),
                    query_id=args.id,
                ),
                end="",
            )
        else:
            print("error: graph has hard errors — refusing to answer query verbs.", file=sys.stderr)
            print("run `python3 graph.py validate` to see the errors.", file=sys.stderr)
        return 1
    if g.has_errors() and backfill_writes:
        print(
            "error: graph has hard errors — refuse to apply backfill "
            "writes onto a broken graph. Run `validate` to see the errors, "
            "fix or accept them, then re-run --apply.",
            file=sys.stderr,
        )
        return 1

    if args.verb in _TRAVERSAL_VERBS:
        output, code = cmd_traversal(g, args.verb, args.id, fmt=fmt)
        print(output, end="")
        return code

    if args.verb == "orphans":
        if fmt == "json":
            print(_orphans_json(g, root, args.scope), end="")
        else:
            # Markdown table is default for flat results; --table is a no-op.
            print(cmd_orphans(g, root=root, scope=args.scope), end="")
        return 0
    if args.verb == "cycles":
        if fmt == "json":
            print(_cycles_json(g), end="")
        else:
            print(cmd_cycles(g), end="")
        return 0

    if args.verb == "backfill":
        if args.reset:
            output, code = cmd_backfill_reset(root)
            print(output, end="")
            return code
        if args.apply:
            output, code = cmd_backfill_apply(g, root, args.apply)
            print(output, end="")
            return code
        if args.reject:
            output, code = cmd_backfill_reject(g, root, args.reject)
            print(output, end="")
            return code
        # Default: propose (read-only).
        print(cmd_backfill_propose(g, root), end="")
        return 0

    raise AssertionError(  # pragma: no cover — verbs/dispatch mismatch
        f"verb '{args.verb}' is in _ALL_VERBS but no dispatch path matches"
    )


if __name__ == "__main__":
    sys.exit(main())
