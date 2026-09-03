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


if __name__ == "__main__":
    unittest.main()
