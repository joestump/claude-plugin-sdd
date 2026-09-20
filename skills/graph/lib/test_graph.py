#!/usr/bin/env python3
# Governing: ADR-0023 (Frontmatter DAG and /sdd:graph Skill), SPEC-0018 REQ "Diagnostic Query Verbs"
"""Unit tests for the graph helper's governing-comment parsing and the
`orphans` verb's classification of source files.

Run with `make test-graph` or:

    python3 -m unittest discover -s skills/graph/lib -p 'test_*.py'

Stdlib only, like graph.py itself. Each test builds a throwaway project
tree under a temp dir so the walk is exercised end to end rather than
through regex fixtures alone.

@joestump 09/03/2026 - Added with the fix for #216: issue-style
`Governing: #24` lines used to suppress a correct artifact-style line
below them, JSDoc `* Governing:` was never recognized, and both cases
were reported as "no governing comment" alongside genuinely comment-less
files.
"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import graph


def _write(root: Path, rel: str, text: str) -> Path:
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def _seed_artifacts(root: Path) -> None:
    """One ADR and two specs, so code edges have something to resolve to."""
    _write(
        root,
        "docs/adrs/ADR-0009-grid.md",
        "---\nstatus: accepted\ndate: 2026-01-01\n---\n\n# ADR-0009: Fixed grid\n",
    )
    _write(
        root,
        "docs/openspec/specs/grid/spec.md",
        "---\nstatus: approved\ndate: 2026-01-01\nimplements: [ADR-0009]\n---\n\n# SPEC-0006: Grid\n",
    )
    _write(
        root,
        "docs/openspec/specs/selectors/spec.md",
        "---\nstatus: approved\ndate: 2026-01-01\n---\n\n# SPEC-0007: Selectors\n",
    )


class GoverningCommentParsingTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        _seed_artifacts(self.root)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _build(self) -> graph.Graph:
        return graph.build_graph(
            self.root,
            self.root / "docs" / "adrs",
            self.root / "docs" / "openspec" / "specs",
        )

    def test_issue_ref_line_does_not_suppress_artifact_line(self) -> None:
        # The reproduction from #216: the first `Governing:` names an issue,
        # a later one names real artifacts. The file must be credited to
        # the artifacts, not filed as comment-less.
        _write(
            self.root,
            "src/grid.js",
            "// Governing: #24 (memoized derived-state selectors)\n"
            "\n"
            "// ... later ...\n"
            "// Governing: ADR-0009, SPEC-0006 REQ \"Equipment Occupies a Fixed Eight-Cell Grid\"\n"
            "export function thing() {}\n",
        )
        edges = graph.discover_code_edges(self.root)
        self.assertEqual([(self.root / "src" / "grid.js", ["ADR-0009", "SPEC-0006"])], edges)
        self.assertEqual([], graph.discover_orphan_code(self.root))
        self.assertEqual([], graph.discover_unrecognized_governing(self.root))

    def test_ids_are_unioned_across_governing_and_implements_lines(self) -> None:
        # The canonical two-line block: IDs come from both lines.
        _write(
            self.root,
            "src/a.py",
            "# Governing: ADR-0009 (grid)\n"
            "# Implements: SPEC-0006 REQ \"Grid\"\n"
            "# Governing: SPEC-0007 REQ \"Selectors\"\n",
        )
        edges = graph.discover_code_edges(self.root)
        self.assertEqual(1, len(edges))
        self.assertEqual(["ADR-0009", "SPEC-0006", "SPEC-0007"], edges[0][1])

    def test_jsdoc_star_opener_is_recognized(self) -> None:
        _write(
            self.root,
            "src/selectors.js",
            "/**\n"
            " * Memoized selectors.\n"
            " *\n"
            " * Governing: ADR-0009, SPEC-0007 REQ \"Selectors\"\n"
            " */\n"
            "export const x = 1;\n",
        )
        edges = graph.discover_code_edges(self.root)
        self.assertEqual([(self.root / "src" / "selectors.js", ["ADR-0009", "SPEC-0007"])], edges)

    def test_block_comment_opener_with_closer_on_same_line(self) -> None:
        _write(self.root, "src/one.c", "/* Governing: ADR-0009 (grid) */\nint x;\n")
        edges = graph.discover_code_edges(self.root)
        self.assertEqual([(self.root / "src" / "one.c", ["ADR-0009"])], edges)

    def test_marker_with_no_ids_is_unrecognized_not_orphan(self) -> None:
        _write(self.root, "src/issue_only.js", "// Governing: #24 (some issue)\nexport const y = 2;\n")
        self.assertEqual([], graph.discover_orphan_code(self.root))
        unrecognized = graph.discover_unrecognized_governing(self.root)
        self.assertEqual(
            [(self.root / "src" / "issue_only.js", graph.UNRECOGNIZED_NO_IDS)], unrecognized
        )

    def test_marker_in_unknown_opener_is_unrecognized_not_orphan(self) -> None:
        # SQL/Lua style `--` is not an accepted opener; the operator should
        # be told the comment exists but cannot be read.
        _write(self.root, "src/schema.sql", "-- Governing: ADR-0009 (grid)\nSELECT 1;\n")
        self.assertEqual([], graph.discover_orphan_code(self.root))
        self.assertEqual([], graph.discover_code_edges(self.root))
        unrecognized = graph.discover_unrecognized_governing(self.root)
        self.assertEqual(
            [(self.root / "src" / "schema.sql", graph.UNRECOGNIZED_OPENER)], unrecognized
        )

    def test_file_without_marker_is_an_orphan(self) -> None:
        _write(self.root, "src/plain.js", "export const z = 3;\n")
        self.assertEqual([self.root / "src" / "plain.js"], graph.discover_orphan_code(self.root))
        self.assertEqual([], graph.discover_unrecognized_governing(self.root))

    def test_validate_warns_on_unrecognized_governing(self) -> None:
        _write(self.root, "src/issue_only.js", "// Governing: #24 (some issue)\n")
        _write(self.root, "src/plain.js", "export const z = 3;\n")
        g = self._build()
        self.assertFalse(g.has_errors())
        codes = [(d.code, d.source_id) for d in g.diagnostics]
        self.assertIn(("governing-unrecognized", "src/issue_only.js"), codes)
        # A genuinely comment-less file is an orphan, not a validation warning.
        self.assertNotIn(("governing-unrecognized", "src/plain.js"), codes)

    def test_validate_json_carries_the_warning(self) -> None:
        _write(self.root, "src/issue_only.js", "// Governing: #24 (some issue)\n")
        payload = json.loads(graph._validate_json(self._build()))
        diags = payload["results"]["diagnostics"]
        self.assertEqual(1, len(diags))
        self.assertEqual("warning", diags[0]["severity"])
        self.assertEqual("governing-unrecognized", diags[0]["code"])


class OrphansVerbTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        _seed_artifacts(self.root)
        _write(self.root, "src/plain.js", "export const z = 3;\n")
        _write(self.root, "src/issue_only.js", "// Governing: #24 (some issue)\n")
        _write(
            self.root,
            "src/grid.js",
            "// Governing: #24 (some issue)\n"
            "// Governing: ADR-0009, SPEC-0006 REQ \"Grid\"\n",
        )
        _write(self.root, "lib/other.js", "// Governing: #99\n")
        self.g = graph.build_graph(
            self.root,
            self.root / "docs" / "adrs",
            self.root / "docs" / "openspec" / "specs",
        )

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_markdown_splits_unrecognized_from_orphans(self) -> None:
        out = graph.cmd_orphans(self.g, root=self.root)
        self.assertIn("## Source files without governing artifacts", out)
        self.assertIn("## Source files with unrecognized governing comments", out)
        without, _, unrecognized = out.partition("## Source files with unrecognized governing comments")
        self.assertIn("`src/plain.js`", without)
        self.assertNotIn("`src/issue_only.js`", without)
        self.assertIn("`src/issue_only.js`", unrecognized)
        self.assertIn(graph.UNRECOGNIZED_NO_IDS, unrecognized)
        # The file credited via its second governing line appears nowhere.
        self.assertNotIn("`src/grid.js`", out)

    def test_spec_referenced_only_after_issue_line_is_not_orphaned(self) -> None:
        out = graph.cmd_orphans(self.g, root=self.root)
        self.assertNotIn("| SPEC-0006 |", out)
        # SPEC-0007 has no implementing code at all and stays flagged.
        self.assertIn("| SPEC-0007 |", out)

    def test_json_has_separate_unrecognized_key(self) -> None:
        payload = json.loads(graph._orphans_json(self.g, self.root, None))
        results = payload["results"]
        self.assertEqual(["src/plain.js"], results["code_files_without_governing"])
        self.assertEqual(
            [
                {"file": "lib/other.js", "reason": graph.UNRECOGNIZED_NO_IDS},
                {"file": "src/issue_only.js", "reason": graph.UNRECOGNIZED_NO_IDS},
            ],
            results["code_files_with_unrecognized_governing"],
        )
        self.assertEqual(["SPEC-0007"], results["specs_without_implementing_code"])

    def test_scope_applies_to_unrecognized_too(self) -> None:
        payload = json.loads(graph._orphans_json(self.g, self.root, "src"))
        results = payload["results"]
        self.assertEqual(
            [{"file": "src/issue_only.js", "reason": graph.UNRECOGNIZED_NO_IDS}],
            results["code_files_with_unrecognized_governing"],
        )
        self.assertEqual(["src/plain.js"], results["code_files_without_governing"])


class CycleValidationTests(unittest.TestCase):
    """Direction-normalized cycle detection (issue #234).

    `enables`/`governs` point downstream while `extends`/`requires`/
    `implements`/`supersedes` point upstream. A semantically-consistent
    mixed pair (A enables B, B extends A) must NOT be reported as a
    cycle, while genuine temporal contradictions still must be.
    """

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _adr(self, id_: str, frontmatter: str) -> None:
        _write(
            self.root,
            f"docs/adrs/{id_}-test.md",
            f"---\nstatus: accepted\ndate: 2026-01-01\n{frontmatter}\n---\n\n# {id_}\n",
        )

    def _build(self) -> graph.Graph:
        return graph.build_graph(
            self.root,
            self.root / "docs" / "adrs",
            self.root / "docs" / "openspec" / "specs",
        )

    def _error_codes(self, g: graph.Graph) -> list[str]:
        return [d.code for d in g.diagnostics if d.severity == "error"]

    def test_mixed_enables_extends_pair_is_not_a_cycle(self) -> None:
        self._adr("ADR-0001", "enables: [ADR-0002]")
        self._adr("ADR-0002", "extends: [ADR-0001]")
        self.assertEqual([], self._error_codes(self._build()))

    def test_dual_governs_implements_authoring_is_not_a_cycle(self) -> None:
        self._adr("ADR-0001", "governs: [SPEC-0001]")
        _write(
            self.root,
            "docs/openspec/specs/one/spec.md",
            "---\nstatus: approved\ndate: 2026-01-01\nimplements: [ADR-0001]\n---\n\n# SPEC-0001\n",
        )
        self.assertEqual([], self._error_codes(self._build()))

    def test_genuine_extends_cycle_is_still_reported(self) -> None:
        self._adr("ADR-0001", "extends: [ADR-0002]")
        self._adr("ADR-0002", "extends: [ADR-0001]")
        self.assertIn("cycle", self._error_codes(self._build()))

    def test_genuine_enables_cycle_is_still_reported(self) -> None:
        self._adr("ADR-0001", "enables: [ADR-0002]")
        self._adr("ADR-0002", "enables: [ADR-0001]")
        self.assertIn("cycle", self._error_codes(self._build()))


class PrdNodeTests(unittest.TestCase):
    """PRDs as a first-class graph node type (ADR-0036, SPEC-0037).

    PRDs are optional: a repository with no PRD directory must build the
    same graph it did before PRDs existed. When present they sit upstream
    of ADRs and specs, author only `governs:` and `related:`, and are
    reported by `orphans` only once they reach `approved` or `shipped`.
    """

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _prd(self, id_: str, status: str = "draft", frontmatter: str = "") -> None:
        extra = f"{frontmatter}\n" if frontmatter else ""
        _write(
            self.root,
            f"docs/prds/{id_}-checkout.md",
            f"---\nstatus: {status}\ndate: 2026-01-01\n{extra}---\n\n# {id_}: Faster checkout\n",
        )

    def _adr(self, id_: str, frontmatter: str = "") -> None:
        extra = f"{frontmatter}\n" if frontmatter else ""
        _write(
            self.root,
            f"docs/adrs/{id_}-test.md",
            f"---\nstatus: accepted\ndate: 2026-01-01\n{extra}---\n\n# {id_}: A decision\n",
        )

    def _spec(self, id_: str, slug: str, frontmatter: str = "") -> None:
        extra = f"{frontmatter}\n" if frontmatter else ""
        _write(
            self.root,
            f"docs/openspec/specs/{slug}/spec.md",
            f"---\nstatus: approved\ndate: 2026-01-01\n{extra}---\n\n# {id_}: A spec\n",
        )

    def _build(self) -> graph.Graph:
        return graph.build_graph(
            self.root,
            self.root / "docs" / "adrs",
            self.root / "docs" / "openspec" / "specs",
            self.root / "docs" / "prds",
        )

    def _codes(self, g: graph.Graph, severity: str) -> list[str]:
        return [d.code for d in g.diagnostics if d.severity == severity]

    # -- discovery ---------------------------------------------------------

    def test_absent_prd_directory_yields_no_prd_nodes(self) -> None:
        """Optionality: the common case is a repo with no PRDs at all."""
        self._adr("ADR-0001")
        g = self._build()
        self.assertEqual([], [n for n in g.nodes.values() if n.kind == "prd"])
        self.assertEqual([], self._codes(g, "error"))

    def test_prd_is_discovered_as_its_own_node_kind(self) -> None:
        self._prd("PRD-0001")
        g = self._build()
        self.assertIn("PRD-0001", g.nodes)
        self.assertEqual("prd", g.nodes["PRD-0001"].kind)
        self.assertEqual("draft", g.nodes["PRD-0001"].status)

    def test_bare_prd_md_is_not_discovered(self) -> None:
        """SPEC-0037 requires PRD-XXXX-slug.md, never a bare prd.md."""
        _write(self.root, "docs/prds/prd.md", "---\nstatus: draft\n---\n\n# Nope\n")
        self.assertEqual([], [n for n in self._build().nodes.values() if n.kind == "prd"])

    def test_duplicate_prd_id_is_an_error(self) -> None:
        self._prd("PRD-0001")
        _write(
            self.root,
            "docs/prds/PRD-0001-other.md",
            "---\nstatus: draft\ndate: 2026-01-01\n---\n\n# PRD-0001: Other\n",
        )
        self.assertIn("duplicate-id", self._codes(self._build(), "error"))

    # -- edges -------------------------------------------------------------

    def test_governs_edge_into_adr_and_spec_resolves(self) -> None:
        self._prd("PRD-0001", "approved", "governs: [ADR-0001, SPEC-0001]")
        self._adr("ADR-0001")
        self._spec("SPEC-0001", "one")
        g = self._build()
        self.assertEqual([], self._codes(g, "error"))
        targets = {e.target for e in g.edges if e.source == "PRD-0001" and e.type == "governs"}
        self.assertEqual({"ADR-0001", "SPEC-0001"}, targets)

    def test_governed_by_inverse_is_derived_not_authored(self) -> None:
        self._prd("PRD-0001", "approved", "governs: [ADR-0001]")
        self._adr("ADR-0001")
        g = self._build()
        inverse = [
            e for e in g.edges
            if e.source == "ADR-0001" and e.target == "PRD-0001" and e.type == "governed-by"
        ]
        self.assertEqual(1, len(inverse))
        self.assertTrue(inverse[0].derived)

    def test_governs_unknown_target_is_an_error(self) -> None:
        """The defect that failed PR #240's lint: governs a nonexistent ID."""
        self._prd("PRD-0001", "approved", "governs: [SPEC-9999]")
        self.assertIn("unresolved-id", self._codes(self._build(), "error"))

    def test_edge_field_outside_the_prd_vocabulary_warns(self) -> None:
        """A PRD never implements or supersedes anything (ADR-0036)."""
        self._prd("PRD-0001", "draft", "implements: [ADR-0001]")
        self._adr("ADR-0001")
        self.assertIn("schema-misuse", self._codes(self._build(), "warning"))

    def test_authored_reverse_edge_warns(self) -> None:
        self._prd("PRD-0001", "draft", "governed-by: [ADR-0001]")
        self._adr("ADR-0001")
        self.assertIn("authored-derived-edge", self._codes(self._build(), "warning"))

    # -- orphans -----------------------------------------------------------

    def test_draft_prd_governing_nothing_is_not_an_orphan(self) -> None:
        self._prd("PRD-0001", "draft")
        self.assertEqual([], graph._orphan_prds(self._build()))

    def test_client_review_prd_governing_nothing_is_not_an_orphan(self) -> None:
        self._prd("PRD-0001", "client-review")
        self.assertEqual([], graph._orphan_prds(self._build()))

    def test_approved_prd_governing_nothing_is_an_orphan(self) -> None:
        self._prd("PRD-0001", "approved")
        self.assertEqual(["PRD-0001"], graph._orphan_prds(self._build()))

    def test_shipped_prd_governing_nothing_is_an_orphan(self) -> None:
        self._prd("PRD-0001", "shipped")
        self.assertEqual(["PRD-0001"], graph._orphan_prds(self._build()))

    def test_approved_prd_with_a_real_governed_artifact_is_not_an_orphan(self) -> None:
        self._prd("PRD-0001", "approved", "governs: [ADR-0001]")
        self._adr("ADR-0001")
        self.assertEqual([], graph._orphan_prds(self._build()))

    def test_orphan_status_match_ignores_case_and_padding(self) -> None:
        self._prd("PRD-0001", " Approved ")
        self.assertEqual(["PRD-0001"], graph._orphan_prds(self._build()))

    def test_orphans_markdown_renders_the_prd_section(self) -> None:
        self._prd("PRD-0001", "approved")
        out = graph.cmd_orphans(self._build(), self.root)
        self.assertIn("Approved or shipped PRDs governing no artifact", out)
        self.assertIn("PRD-0001", out)
        self.assertIn("Faster checkout", out)

    def test_orphans_omits_the_prd_section_when_none_qualify(self) -> None:
        self._prd("PRD-0001", "draft")
        self.assertNotIn(
            "Approved or shipped PRDs", graph.cmd_orphans(self._build(), self.root)
        )

    # -- path resolution ---------------------------------------------------

    def test_prd_directory_is_read_from_claude_md(self) -> None:
        """ADR-0036 commitment 2: the path is declared like the ADR/spec ones."""
        _write(
            self.root,
            "CLAUDE.md",
            "## Architecture Context\n\n"
            "- Architecture Decision Records are in `docs/adrs/`\n"
            "- Specifications are in `docs/openspec/specs/`\n"
            "- Product Requirements Documents are in `product/prds/`\n",
        )
        _, _, prd_dir = graph._read_module_artifact_paths(self.root)
        self.assertEqual((self.root / "product" / "prds").resolve(), prd_dir)

    def test_prd_directory_defaults_when_undeclared(self) -> None:
        _write(self.root, "CLAUDE.md", "## Architecture Context\n\nNothing declared.\n")
        _, _, prd_dir = graph._read_module_artifact_paths(self.root)
        self.assertEqual(self.root / "docs" / "prds", prd_dir)


class TraversalDirectionTests(unittest.TestCase):
    """`impact` / `ancestors` partition by edge DIRECTION, not by the derived flag.

    `governs` and `enables` point downstream while `implements`, `requires`,
    `extends` and `supersedes` point upstream — the same split
    `_validate_no_cycles` has normalized since #237, never applied to the
    traversal verbs. Splitting on `derived` instead made `impact` climb
    upstream through `governed-by` and `ancestors` descend through `governs`.
    """

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _adr(self, id_: str, frontmatter: str = "") -> None:
        extra = f"{frontmatter}\n" if frontmatter else ""
        _write(
            self.root,
            f"docs/adrs/{id_}-test.md",
            f"---\nstatus: accepted\ndate: 2026-01-01\n{extra}---\n\n# {id_}: A decision\n",
        )

    def _spec(self, id_: str, slug: str, frontmatter: str = "") -> None:
        extra = f"{frontmatter}\n" if frontmatter else ""
        _write(
            self.root,
            f"docs/openspec/specs/{slug}/spec.md",
            f"---\nstatus: approved\ndate: 2026-01-01\n{extra}---\n\n# {id_}: A spec\n",
        )

    def _build(self) -> graph.Graph:
        return graph.build_graph(
            self.root,
            self.root / "docs" / "adrs",
            self.root / "docs" / "openspec" / "specs",
        )

    def _down(self, g: graph.Graph, node: str) -> set[str]:
        return {t for t, _type, _d in graph._outgoing_downstream(g, node)}

    def _up(self, g: graph.Graph, node: str) -> set[str]:
        return {t for t, _type, _d in graph._outgoing_upstream(g, node)}

    def test_authored_governs_is_downstream_not_upstream(self) -> None:
        """An ADR's governed spec depends on it, so it belongs to impact."""
        self._adr("ADR-0001", "governs: [SPEC-0001]")
        self._spec("SPEC-0001", "one")
        g = self._build()
        self.assertEqual({"SPEC-0001"}, self._down(g, "ADR-0001"))
        self.assertEqual(set(), self._up(g, "ADR-0001"))

    def test_derived_governed_by_is_upstream_not_downstream(self) -> None:
        self._adr("ADR-0001", "governs: [SPEC-0001]")
        self._spec("SPEC-0001", "one")
        g = self._build()
        self.assertEqual({"ADR-0001"}, self._up(g, "SPEC-0001"))
        self.assertEqual(set(), self._down(g, "SPEC-0001"))

    def test_authored_enables_is_downstream(self) -> None:
        self._adr("ADR-0001", "enables: [ADR-0002]")
        self._adr("ADR-0002")
        g = self._build()
        self.assertEqual({"ADR-0002"}, self._down(g, "ADR-0001"))
        self.assertEqual({"ADR-0001"}, self._up(g, "ADR-0002"))

    def test_authored_implements_stays_upstream(self) -> None:
        self._adr("ADR-0001")
        self._spec("SPEC-0001", "one", "implements: [ADR-0001]")
        g = self._build()
        self.assertEqual({"ADR-0001"}, self._up(g, "SPEC-0001"))
        self.assertEqual({"SPEC-0001"}, self._down(g, "ADR-0001"))

    def test_adr_authoring_only_governs_has_no_ancestors(self) -> None:
        """Regression: its governed specs used to be reported as its ancestors."""
        self._adr("ADR-0001", "governs: [SPEC-0001]")
        self._spec("SPEC-0001", "one")
        out = graph.render_ancestors(self._build(), "ADR-0001")
        self.assertIn("has no declared ancestors", out)

    def test_impact_of_a_spec_does_not_climb_to_its_governing_adr(self) -> None:
        """Regression: impact used to walk upstream through `governed-by`."""
        self._adr("ADR-0001", "governs: [SPEC-0001]")
        self._spec("SPEC-0001", "one")
        out = graph.render_impact(self._build(), "SPEC-0001")
        self.assertIn("has no impact", out)
        self.assertNotIn("ADR-0001", out.split("impact SPEC-0001")[1])

    def test_dual_governs_implements_renders_the_target_once(self) -> None:
        """Parallel same-direction edges collapse instead of printing twice."""
        self._adr("ADR-0001", "governs: [SPEC-0001]")
        self._spec("SPEC-0001", "one", "implements: [ADR-0001]")
        g = self._build()
        self.assertEqual(1, len(graph._outgoing_downstream(g, "ADR-0001")))
        self.assertNotIn("already shown", graph.render_impact(g, "ADR-0001"))

    def test_collapse_prefers_the_authored_edge(self) -> None:
        self._adr("ADR-0001", "governs: [SPEC-0001]")
        self._spec("SPEC-0001", "one", "implements: [ADR-0001]")
        g = self._build()
        (_target, etype, derived) = graph._outgoing_downstream(g, "ADR-0001")[0]
        self.assertEqual("governs", etype)
        self.assertFalse(derived)

    def test_prd_impact_reaches_what_it_governs(self) -> None:
        """SPEC-0037 scenario: impact PRD-XXXX covers its governed closure."""
        _write(
            self.root,
            "docs/prds/PRD-0001-checkout.md",
            "---\nstatus: approved\ndate: 2026-01-01\ngoverns: [ADR-0001]\n---\n\n# PRD-0001: Checkout\n",
        )
        self._adr("ADR-0001", "governs: [SPEC-0001]")
        self._spec("SPEC-0001", "one")
        out = graph.render_impact(self._build(), "PRD-0001")
        self.assertIn("ADR-0001", out)
        self.assertIn("SPEC-0001", out)


if __name__ == "__main__":
    unittest.main()
