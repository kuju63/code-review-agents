"""Tests for evaluation/tools/build_seeded_set.py (Issue #224).

Covers marker detection (INTENTIONAL, with and without svelte's SEED-nnn
suffix), new-file line resolution, seeded_pr_targets_{stack}.json loading,
and fail-closed Seeded item construction from real seed-repository PRs
fetched via the GitHub REST API.
"""

from __future__ import annotations

import json
import os
from unittest.mock import patch

import pytest

from tests.evaluation.conftest import load_eval_tool_module

build_seeded_set = load_eval_tool_module("build_seeded_set", "build_seeded_set.py")

split_hunks = build_seeded_set.split_hunks
parse_hunk_new_start = build_seeded_set.parse_hunk_new_start
count_new_lines_before = build_seeded_set.count_new_lines_before
detect_intentional_markers = build_seeded_set.detect_intentional_markers
resolve_defect_line = build_seeded_set.resolve_defect_line
load_targets = build_seeded_set.load_targets
build_seeded_item = build_seeded_set.build_seeded_item
Defect = build_seeded_set.Defect
SeededPrTarget = build_seeded_set.SeededPrTarget
MarkerHit = build_seeded_set.MarkerHit
main = build_seeded_set.main


class TestSplitHunks:
    def test_splits_two_hunks_into_separate_lists(self):
        patch_text = (
            "@@ -1,4 +1,5 @@\n"
            " import a\n"
            " import b\n"
            "+import c\n"
            " import d\n"
            "\n"
            "@@ -10,6 +11,11 @@ export class Foo {\n"
            "   constructor() {}\n"
            "+  bar() {\n"
            "+    return 1;\n"
            "+  }\n"
        )
        hunks = split_hunks(patch_text)
        assert len(hunks) == 2
        assert hunks[0][0].startswith("@@ -1,4 +1,5 @@")
        assert hunks[1][0].startswith("@@ -10,6 +11,11 @@")

    def test_single_hunk_patch_returns_one_element_list(self):
        patch_text = "@@ -1,2 +1,2 @@\n line1\n line2"
        hunks = split_hunks(patch_text)
        assert len(hunks) == 1
        assert hunks[0][0].startswith("@@ -1,2 +1,2 @@")

    def test_no_hunk_header_returns_empty_list(self):
        patch_text = " just some context\n more context"
        assert split_hunks(patch_text) == []


class TestParseHunkNewStart:
    def test_parses_new_start_from_header(self):
        assert parse_hunk_new_start("@@ -10,6 +11,11 @@") == 11

    def test_parses_header_with_trailing_context_text(self):
        assert parse_hunk_new_start("@@ -10,6 +11,11 @@ export class Foo {") == 11

    def test_malformed_header_falls_back_to_one(self):
        assert parse_hunk_new_start("not a hunk header") == 1


class TestCountNewLinesBefore:
    def test_counts_context_and_added_lines(self):
        hunk = [
            "@@ -10,6 +11,11 @@",
            "   constructor() {}",
            "+  bar() {",
            "+    return 1;",
            "+  }",
        ]
        assert count_new_lines_before(hunk, 4) == 4

    def test_excludes_removed_lines(self):
        hunk = [
            "@@ -10,6 +11,11 @@",
            "-  removedLine();",
            "   constructor() {}",
            "+  bar() {",
        ]
        assert count_new_lines_before(hunk, 3) == 2

    def test_zero_when_insertion_idx_is_header(self):
        hunk = ["@@ -10,6 +11,11 @@", "   constructor() {}"]
        assert count_new_lines_before(hunk, 0) == 0


class TestDetectIntentionalMarkers:
    def test_detects_plain_intentional_comment(self):
        patch_text = (
            "@@ -1,2 +1,3 @@\n"
            " const a = 1;\n"
            "+  // INTENTIONAL\n"
            "+  window.location.assign(returnUrl);\n"
        )
        hits = detect_intentional_markers(patch_text)
        assert len(hits) == 1
        assert hits[0].hunk[hits[0].marker_idx] == "+  // INTENTIONAL"

    def test_detects_html_comment_marker(self):
        patch_text = (
            "@@ -1,2 +1,3 @@\n"
            " <div>\n"
            "+  <!-- INTENTIONAL -->\n"
            '+  <div [innerHTML]="raw"></div>\n'
        )
        hits = detect_intentional_markers(patch_text)
        assert len(hits) == 1

    def test_detects_svelte_seed_id_marker(self):
        patch_text = (
            "@@ -1,2 +1,3 @@\n"
            " let x;\n"
            "+  // INTENTIONAL: SEED-101\n"
            "+  localStorage.setItem(KEY, JSON.stringify({email, password}));\n"
        )
        hits = detect_intentional_markers(patch_text)
        assert len(hits) == 1

    def test_no_marker_returns_empty_list(self):
        patch_text = "@@ -1,2 +1,2 @@\n const a = 1;\n+const b = 2;\n"
        assert detect_intentional_markers(patch_text) == []

    def test_detects_multiple_markers_in_same_file(self):
        patch_text = (
            "@@ -1,2 +1,4 @@\n"
            " const props = defineProps<Props>();\n"
            "+  // INTENTIONAL\n"
            "+  const emit = defineEmits(['update']);\n"
            "+  // INTENTIONAL\n"
            "+  props.value = 1;\n"
        )
        hits = detect_intentional_markers(patch_text)
        assert len(hits) == 2

    def test_only_matches_added_lines_not_context(self):
        patch_text = (
            "@@ -1,3 +1,3 @@\n"
            "   // INTENTIONAL leftover context, not an addition\n"
            " const a = 1;\n"
            "+const b = 2;\n"
        )
        assert detect_intentional_markers(patch_text) == []


class TestResolveDefectLine:
    def test_default_offset_is_marker_plus_one(self):
        hunk = [
            "@@ -10,2 +11,3 @@",
            "   const x = 1;",
            "+  // INTENTIONAL",
            "+  window.location.assign(returnUrl);",
        ]
        hit = MarkerHit(hunk=tuple(hunk), marker_idx=2)
        assert resolve_defect_line(hit) == 13

    def test_skips_comment_only_line_after_marker(self):
        # svelte-seeded#6: marker is followed by an eslint-disable comment
        # line before the actual defect -- a +2 case handled by scanning
        # forward, not by hardcoding +2.
        hunk = [
            "@@ -10,3 +11,4 @@",
            "   const x = 1;",
            "+  // INTENTIONAL: SEED-102",
            "+  // eslint-disable-next-line no-unsanitized/property",
            "+  el.innerHTML = raw;",
        ]
        hit = MarkerHit(hunk=tuple(hunk), marker_idx=2)
        assert resolve_defect_line(hit) == 14

    def test_explicit_line_offset_overrides_scan(self):
        # react-seeded#8: marker sits above a JSX `return (` two lines
        # before the actual dangerouslySetInnerHTML defect.
        hunk = [
            "@@ -20,3 +21,4 @@",
            "   const markup = sanitize(title);",
            "+  // INTENTIONAL",
            "+  return (",
            "+    <div dangerouslySetInnerHTML={{ __html: markup }} />",
        ]
        hit = MarkerHit(hunk=tuple(hunk), marker_idx=2)
        assert resolve_defect_line(hit, line_offset=2) == 24

    def test_raises_when_no_added_line_follows_marker(self):
        hunk = [
            "@@ -10,2 +11,2 @@",
            "   const x = 1;",
            "+  // INTENTIONAL",
        ]
        hit = MarkerHit(hunk=tuple(hunk), marker_idx=2)
        with pytest.raises(ValueError, match="no defect line"):
            resolve_defect_line(hit)

    def test_raises_when_explicit_offset_lands_outside_hunk(self):
        hunk = ["@@ -10,1 +11,2 @@", "+  // INTENTIONAL"]
        hit = MarkerHit(hunk=tuple(hunk), marker_idx=1)
        with pytest.raises(ValueError, match="outside an added line"):
            resolve_defect_line(hit, line_offset=5)

    def test_raises_when_explicit_offset_is_negative_and_wraps_around(self):
        # A negative offset must not silently wrap around to the end of
        # hunk via Python's negative indexing.
        hunk = [
            "@@ -10,2 +11,3 @@",
            "   const x = 1;",
            "+  // INTENTIONAL",
            "+  window.location.assign(returnUrl);",
        ]
        hit = MarkerHit(hunk=tuple(hunk), marker_idx=2)
        with pytest.raises(ValueError, match="line_offset must be positive"):
            resolve_defect_line(hit, line_offset=-2)

    def test_raises_when_explicit_offset_is_zero(self):
        # line_offset=0 would resolve to the marker's own comment line,
        # which itself starts with `+` and would otherwise pass the
        # added-line check silently.
        hunk = [
            "@@ -10,2 +11,3 @@",
            "   const x = 1;",
            "+  // INTENTIONAL",
            "+  window.location.assign(returnUrl);",
        ]
        hit = MarkerHit(hunk=tuple(hunk), marker_idx=2)
        with pytest.raises(ValueError, match="line_offset must be positive"):
            resolve_defect_line(hit, line_offset=0)

    def test_raises_when_negative_offset_would_land_on_a_valid_added_line(self):
        # A negative offset that happens to land on a real `+` line
        # *before* the marker must still be rejected, not silently
        # accepted as if it were the defect.
        hunk = [
            "@@ -10,3 +11,4 @@",
            "   const x = 1;",
            "+  const y = 2;",
            "+  // INTENTIONAL",
            "+  window.location.assign(returnUrl);",
        ]
        hit = MarkerHit(hunk=tuple(hunk), marker_idx=3)
        with pytest.raises(ValueError, match="line_offset must be positive"):
            resolve_defect_line(hit, line_offset=-1)

    def test_marker_hit_is_hashable(self):
        # MarkerHit.hunk must be a tuple, not a list: a frozen dataclass
        # with a list field raises TypeError when hashed.
        hunk = ("@@ -1,1 +1,1 @@", "+  // INTENTIONAL")
        hash(MarkerHit(hunk=hunk, marker_idx=1))


class TestLoadTargets:
    def _write(self, tmp_path, name, payload):
        path = tmp_path / name
        path.write_text(json.dumps(payload), encoding="utf-8")
        return str(path)

    def test_loads_single_file_single_pr_single_defect(self, tmp_path):
        payload = {
            "repository": "kuju63/vue-seeded",
            "stack": "vue",
            "prs": [
                {
                    "pr_number": 13,
                    "defects": [
                        {
                            "path": "src/components/UserProfile.vue",
                            "occurrence": 0,
                            "rule_id": "vue_props_direct_mutation",
                            "category": "correctness",
                            "severity": "medium",
                            "summary": "Directly mutates a non-bindable prop.",
                        }
                    ],
                }
            ],
        }
        targets = load_targets([self._write(tmp_path, "vue.json", payload)])
        assert len(targets) == 1
        assert targets[0].repository == "kuju63/vue-seeded"
        assert targets[0].stack == "vue"
        assert targets[0].pr_number == 13
        assert len(targets[0].defects) == 1
        assert targets[0].defects[0].rule_id == "vue_props_direct_mutation"
        assert targets[0].defects[0].line_offset is None

    def test_flattens_multiple_input_files(self, tmp_path):
        vue_payload = {
            "repository": "kuju63/vue-seeded",
            "stack": "vue",
            "prs": [
                {
                    "pr_number": 8,
                    "defects": [
                        {
                            "path": "a.vue",
                            "occurrence": 0,
                            "rule_id": "r1",
                            "category": "security",
                            "severity": "high",
                            "summary": "s",
                        }
                    ],
                }
            ],
        }
        react_payload = {
            "repository": "kuju63/react-seeded",
            "stack": "react",
            "prs": [
                {
                    "pr_number": 9,
                    "defects": [
                        {
                            "path": "b.tsx",
                            "occurrence": 0,
                            "rule_id": "r2",
                            "category": "security",
                            "severity": "high",
                            "summary": "s",
                        }
                    ],
                }
            ],
        }
        paths = [
            self._write(tmp_path, "vue.json", vue_payload),
            self._write(tmp_path, "react.json", react_payload),
        ]
        targets = load_targets(paths)
        assert {t.stack for t in targets} == {"vue", "react"}

    def test_invalid_stack_raises(self, tmp_path):
        payload = {"repository": "kuju63/foo-seeded", "stack": "solid", "prs": []}
        with pytest.raises(ValueError, match="invalid stack"):
            load_targets([self._write(tmp_path, "bad.json", payload)])

    def test_invalid_category_raises(self, tmp_path):
        payload = {
            "repository": "kuju63/vue-seeded",
            "stack": "vue",
            "prs": [
                {
                    "pr_number": 1,
                    "defects": [
                        {
                            "path": "a.vue",
                            "occurrence": 0,
                            "rule_id": "r",
                            "category": "not-a-category",
                            "severity": "high",
                            "summary": "s",
                        }
                    ],
                }
            ],
        }
        with pytest.raises(ValueError, match="invalid category"):
            load_targets([self._write(tmp_path, "bad.json", payload)])

    def test_invalid_severity_raises(self, tmp_path):
        payload = {
            "repository": "kuju63/vue-seeded",
            "stack": "vue",
            "prs": [
                {
                    "pr_number": 1,
                    "defects": [
                        {
                            "path": "a.vue",
                            "occurrence": 0,
                            "rule_id": "r",
                            "category": "security",
                            "severity": "not-a-severity",
                            "summary": "s",
                        }
                    ],
                }
            ],
        }
        with pytest.raises(ValueError, match="invalid severity"):
            load_targets([self._write(tmp_path, "bad.json", payload)])

    def test_pr_with_no_defects_raises(self, tmp_path):
        payload = {
            "repository": "kuju63/vue-seeded",
            "stack": "vue",
            "prs": [{"pr_number": 1, "defects": []}],
        }
        with pytest.raises(ValueError, match="no defects"):
            load_targets([self._write(tmp_path, "bad.json", payload)])


def _files_response(*items):
    return [{"path": path, "patch": patch_text} for path, patch_text in items]


class TestBuildSeededItem:
    def test_builds_item_with_single_marker(self):
        target = SeededPrTarget(
            repository="kuju63/vue-seeded",
            stack="vue",
            pr_number=8,
            defects=[
                Defect(
                    path="src/components/Chat.vue",
                    occurrence=0,
                    rule_id="vue_dom_xss",
                    category="security",
                    severity="critical",
                    summary="Assigns untrusted HTML via innerHTML.",
                )
            ],
        )
        files = _files_response(
            (
                "src/components/Chat.vue",
                "@@ -1,2 +1,3 @@\n"
                " const x = 1;\n"
                "+  // INTENTIONAL\n"
                "+  contextMessage.value.innerHTML = message;\n",
            )
        )
        with patch.object(build_seeded_set, "fetch_pr_files", return_value=files):
            item = build_seeded_item(target, token="fake-token")

        assert item["id"] == "seeded::kuju63/vue-seeded#8"
        assert item["repository"] == "kuju63/vue-seeded"
        assert item["pr_number"] == 8
        assert item["stack"] == "vue"
        assert item["file_changes"] == files
        assert len(item["must_find"]) == 1
        assert item["must_find"][0]["rule_id"] == "vue_dom_xss"
        assert item["must_find"][0]["path"] == "src/components/Chat.vue"
        assert item["must_find"][0]["line"] == 3

    def test_builds_item_with_multiple_markers_same_file(self):
        target = SeededPrTarget(
            repository="kuju63/vue-seeded",
            stack="vue",
            pr_number=13,
            defects=[
                Defect(
                    path="src/components/UserProfile.vue",
                    occurrence=0,
                    rule_id="vue_props_direct_mutation",
                    category="correctness",
                    severity="medium",
                    summary="d1",
                ),
                Defect(
                    path="src/components/UserProfile.vue",
                    occurrence=1,
                    rule_id="vue_state_destructure_loses_reactivity",
                    category="correctness",
                    severity="medium",
                    summary="d2",
                ),
            ],
        )
        files = _files_response(
            (
                "src/components/UserProfile.vue",
                "@@ -1,2 +1,5 @@\n"
                " const props = defineProps<Props>();\n"
                "+  // INTENTIONAL\n"
                "+  props.name = 'x';\n"
                "+  // INTENTIONAL\n"
                "+  const { count } = state;\n",
            )
        )
        with patch.object(build_seeded_set, "fetch_pr_files", return_value=files):
            item = build_seeded_item(target, token="fake-token")

        assert len(item["must_find"]) == 2
        assert item["must_find"][0]["rule_id"] == "vue_props_direct_mutation"
        assert (
            item["must_find"][1]["rule_id"] == "vue_state_destructure_loses_reactivity"
        )

    def test_raises_when_no_marker_found(self):
        target = SeededPrTarget(
            repository="kuju63/vue-seeded",
            stack="vue",
            pr_number=1,
            defects=[
                Defect(
                    path="a.vue",
                    occurrence=0,
                    rule_id="r",
                    category="security",
                    severity="high",
                    summary="s",
                )
            ],
        )
        files = _files_response(
            ("a.vue", "@@ -1,1 +1,2 @@\n const a = 1;\n+const b = 2;\n")
        )
        with patch.object(build_seeded_set, "fetch_pr_files", return_value=files):
            with pytest.raises(ValueError, match="no INTENTIONAL marker"):
                build_seeded_item(target, token="fake-token")

    def test_raises_when_marker_count_does_not_match_metadata(self):
        target = SeededPrTarget(
            repository="kuju63/vue-seeded",
            stack="vue",
            pr_number=13,
            defects=[
                Defect(
                    path="a.vue",
                    occurrence=0,
                    rule_id="r1",
                    category="security",
                    severity="high",
                    summary="s1",
                ),
                Defect(
                    path="a.vue",
                    occurrence=1,
                    rule_id="r2",
                    category="security",
                    severity="high",
                    summary="s2",
                ),
            ],
        )
        files = _files_response(
            (
                "a.vue",
                "@@ -1,1 +1,2 @@\n const a = 1;\n+  // INTENTIONAL\n+const b = 2;\n",
            )
        )
        with patch.object(build_seeded_set, "fetch_pr_files", return_value=files):
            with pytest.raises(ValueError, match="found 1 marker"):
                build_seeded_item(target, token="fake-token")

    def test_raises_when_defect_declares_duplicate_path_occurrence(self):
        target = SeededPrTarget(
            repository="kuju63/vue-seeded",
            stack="vue",
            pr_number=13,
            defects=[
                Defect(
                    path="a.vue",
                    occurrence=0,
                    rule_id="r1",
                    category="security",
                    severity="high",
                    summary="s1",
                ),
                Defect(
                    path="a.vue",
                    occurrence=0,
                    rule_id="r2",
                    category="security",
                    severity="high",
                    summary="s2",
                ),
            ],
        )
        files = _files_response(
            (
                "a.vue",
                "@@ -1,2 +1,5 @@\n"
                " const a = 1;\n"
                "+  // INTENTIONAL\n"
                "+const b = 2;\n"
                "+  // INTENTIONAL\n"
                "+const c = 3;\n",
            )
        )
        with patch.object(build_seeded_set, "fetch_pr_files", return_value=files):
            with pytest.raises(ValueError, match="duplicate defect"):
                build_seeded_item(target, token="fake-token")

    def test_raises_when_marker_not_covered_by_metadata(self):
        # A negative `occurrence` passes the existing `>=len(hits)` bounds
        # check (Python allows negative indices) and would otherwise
        # silently resolve to the wrong marker via wraparound indexing;
        # the post-loop coverage check catches the marker this leaves
        # unclaimed instead.
        target = SeededPrTarget(
            repository="kuju63/vue-seeded",
            stack="vue",
            pr_number=13,
            defects=[
                Defect(
                    path="a.vue",
                    occurrence=-1,
                    rule_id="r1",
                    category="security",
                    severity="high",
                    summary="s1",
                ),
                Defect(
                    path="a.vue",
                    occurrence=0,
                    rule_id="r2",
                    category="security",
                    severity="high",
                    summary="s2",
                ),
            ],
        )
        files = _files_response(
            (
                "a.vue",
                "@@ -1,2 +1,5 @@\n"
                " const a = 1;\n"
                "+  // INTENTIONAL\n"
                "+const b = 2;\n"
                "+  // INTENTIONAL\n"
                "+const c = 3;\n",
            )
        )
        with patch.object(build_seeded_set, "fetch_pr_files", return_value=files):
            with pytest.raises(ValueError, match="not covered by metadata"):
                build_seeded_item(target, token="fake-token")

    def test_raises_when_marker_file_is_excluded_by_pr_info_collector(self):
        # .md is outside pr_info_collector._TARGET_EXTENSIONS, so a marker
        # placed there would never reach a reviewer at evaluation time.
        target = SeededPrTarget(
            repository="kuju63/vue-seeded",
            stack="vue",
            pr_number=1,
            defects=[
                Defect(
                    path="docs/CHANGELOG.md",
                    occurrence=0,
                    rule_id="r",
                    category="security",
                    severity="high",
                    summary="s",
                )
            ],
        )
        files = _files_response(
            (
                "docs/CHANGELOG.md",
                "@@ -1,1 +1,2 @@\n # Changelog\n+// INTENTIONAL\n+const evil = eval(x);\n",
            )
        )
        with patch.object(build_seeded_set, "fetch_pr_files", return_value=files):
            with pytest.raises(ValueError, match="excluded by pr_info_collector"):
                build_seeded_item(target, token="fake-token")


class TestMainCLI:
    def _write_targets(self, tmp_path):
        payload = {
            "repository": "kuju63/vue-seeded",
            "stack": "vue",
            "prs": [
                {
                    "pr_number": 8,
                    "defects": [
                        {
                            "path": "a.vue",
                            "occurrence": 0,
                            "rule_id": "r",
                            "category": "security",
                            "severity": "high",
                            "summary": "s",
                        }
                    ],
                }
            ],
        }
        path = tmp_path / "seeded_pr_targets_vue.json"
        path.write_text(json.dumps(payload), encoding="utf-8")
        return str(path)

    def test_missing_github_token_returns_exit_code_2(self, tmp_path, monkeypatch):
        # Set (not delete) to "": main() calls load_dotenv(), which would
        # otherwise repopulate GITHUB_TOKEN from this worktree's real .env
        # symlink since load_dotenv() doesn't override an unset var either
        # way -- but an explicitly-set empty value is left alone.
        monkeypatch.setenv("GITHUB_TOKEN", "")
        targets_path = self._write_targets(tmp_path)
        argv = [
            "build_seeded_set.py",
            "--targets",
            targets_path,
            "--output",
            str(tmp_path / "out.jsonl"),
        ]
        with patch("sys.argv", argv):
            assert main() == 2

    def test_output_required_unless_print_markers(self, tmp_path, monkeypatch):
        monkeypatch.setenv("GITHUB_TOKEN", "fake-token")
        targets_path = self._write_targets(tmp_path)
        argv = ["build_seeded_set.py", "--targets", targets_path]
        with patch("sys.argv", argv):
            assert main() == 2

    def test_builds_output_jsonl_for_matching_pr(self, tmp_path, monkeypatch):
        monkeypatch.setenv("GITHUB_TOKEN", "fake-token")
        targets_path = self._write_targets(tmp_path)
        output_path = tmp_path / "out.jsonl"
        files = _files_response(
            (
                "a.vue",
                "@@ -1,1 +1,2 @@\n const a = 1;\n+  // INTENTIONAL\n+const b = 2;\n",
            )
        )
        argv = [
            "build_seeded_set.py",
            "--targets",
            targets_path,
            "--output",
            str(output_path),
            "--sleep",
            "0",
        ]
        with (
            patch("sys.argv", argv),
            patch.object(build_seeded_set, "fetch_pr_files", return_value=files),
        ):
            assert main() == 0

        lines = output_path.read_text(encoding="utf-8").strip().splitlines()
        assert len(lines) == 1
        item = json.loads(lines[0])
        assert item["id"] == "seeded::kuju63/vue-seeded#8"

    def test_pr_filter_selects_single_target(self, tmp_path, monkeypatch, capsys):
        monkeypatch.setenv("GITHUB_TOKEN", "fake-token")
        targets_path = self._write_targets(tmp_path)
        files = _files_response(
            (
                "a.vue",
                "@@ -1,1 +1,2 @@\n const a = 1;\n+  // INTENTIONAL\n+const b = 2;\n",
            )
        )
        argv = [
            "build_seeded_set.py",
            "--targets",
            targets_path,
            "--pr",
            "kuju63/vue-seeded#8",
            "--print-markers",
            "--sleep",
            "0",
        ]
        with (
            patch("sys.argv", argv),
            patch.object(build_seeded_set, "fetch_pr_files", return_value=files),
        ):
            assert main() == 0
        out = capsys.readouterr().out
        assert "kuju63/vue-seeded#8" in out
        assert "path=a.vue occurrence=0 line=3" in out

    def test_pr_filter_with_no_match_returns_exit_code_2(self, tmp_path, monkeypatch):
        monkeypatch.setenv("GITHUB_TOKEN", "fake-token")
        targets_path = self._write_targets(tmp_path)
        argv = [
            "build_seeded_set.py",
            "--targets",
            targets_path,
            "--pr",
            "kuju63/does-not-exist#1",
            "--print-markers",
        ]
        with patch("sys.argv", argv):
            assert main() == 2

    def test_stacks_filter_excludes_other_stacks(self, tmp_path, monkeypatch, capsys):
        monkeypatch.setenv("GITHUB_TOKEN", "fake-token")
        targets_path = self._write_targets(tmp_path)
        argv = [
            "build_seeded_set.py",
            "--targets",
            targets_path,
            "--stacks",
            "react",
            "--print-markers",
        ]
        with patch("sys.argv", argv):
            assert main() == 0
        out = capsys.readouterr().out
        assert out == ""

    def test_no_output_file_written_when_a_later_target_fails(
        self, tmp_path, monkeypatch
    ):
        # If target N fails, targets 1..N-1 having already succeeded must
        # not leave a truncated, silently-partial output file on disk.
        monkeypatch.setenv("GITHUB_TOKEN", "fake-token")
        payload = {
            "repository": "kuju63/vue-seeded",
            "stack": "vue",
            "prs": [
                {
                    "pr_number": 8,
                    "defects": [
                        {
                            "path": "a.vue",
                            "occurrence": 0,
                            "rule_id": "r",
                            "category": "security",
                            "severity": "high",
                            "summary": "s",
                        }
                    ],
                },
                {
                    "pr_number": 9,
                    "defects": [
                        {
                            "path": "b.vue",
                            "occurrence": 0,
                            "rule_id": "r",
                            "category": "security",
                            "severity": "high",
                            "summary": "s",
                        }
                    ],
                },
            ],
        }
        targets_path = tmp_path / "seeded_pr_targets_vue.json"
        targets_path.write_text(json.dumps(payload), encoding="utf-8")
        output_path = tmp_path / "out.jsonl"

        good_files = _files_response(
            (
                "a.vue",
                "@@ -1,1 +1,2 @@\n const a = 1;\n+  // INTENTIONAL\n+const b = 2;\n",
            )
        )
        bad_files = _files_response(
            ("b.vue", "@@ -1,1 +1,2 @@\n const a = 1;\n+const b = 2;\n")
        )
        responses = iter([good_files, bad_files])

        argv = [
            "build_seeded_set.py",
            "--targets",
            str(targets_path),
            "--output",
            str(output_path),
            "--sleep",
            "0",
        ]
        with (
            patch("sys.argv", argv),
            patch.object(
                build_seeded_set,
                "fetch_pr_files",
                side_effect=lambda *a, **k: next(responses),
            ),
        ):
            with pytest.raises(ValueError, match="no INTENTIONAL marker"):
                main()

        assert not output_path.exists()

    def test_existing_output_preserved_when_write_fails(self, tmp_path, monkeypatch):
        # A failure while writing the temp file (disk full, I/O error)
        # must not truncate or otherwise touch a pre-existing, previously
        # good output file: the write is staged to a temp file and only
        # published via os.replace() once fully written.
        monkeypatch.setenv("GITHUB_TOKEN", "fake-token")
        targets_path = self._write_targets(tmp_path)
        output_path = tmp_path / "out.jsonl"
        original_content = '{"id": "previous-run"}\n'
        output_path.write_text(original_content, encoding="utf-8")

        files = _files_response(
            (
                "a.vue",
                "@@ -1,1 +1,2 @@\n const a = 1;\n+  // INTENTIONAL\n+const b = 2;\n",
            )
        )

        class _RaisingFile:
            def __init__(self, fd):
                self._fd = fd

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                os.close(self._fd)
                return False

            def write(self, data):
                raise OSError("simulated disk full")

        argv = [
            "build_seeded_set.py",
            "--targets",
            targets_path,
            "--output",
            str(output_path),
            "--sleep",
            "0",
        ]
        with (
            patch("sys.argv", argv),
            patch.object(build_seeded_set, "fetch_pr_files", return_value=files),
            patch.object(
                build_seeded_set.os,
                "fdopen",
                side_effect=lambda fd, *a, **k: _RaisingFile(fd),
            ),
        ):
            with pytest.raises(OSError, match="simulated disk full"):
                main()

        assert output_path.read_text(encoding="utf-8") == original_content
        leftover_tmp_files = [
            p for p in tmp_path.iterdir() if p.name.startswith(".out.jsonl.")
        ]
        assert leftover_tmp_files == []
