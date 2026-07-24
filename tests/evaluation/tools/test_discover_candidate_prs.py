"""Tests for evaluation/tools/discover_candidate_prs.py.

Covers the per-stack gold-set target selection behavior (see
docs/goldset-per-stack-spec.md):

- review-comment presence (human / AI-bot / both / none),
- change-size filter (<=20 files, <=1000 lines) boundary,
- production-code detection (test/doc-only excluded),
- recent-release filter (6-month boundary),
- LLM 3-axis assessor (mocked) and fail-closed skip,
- per-stack output file routing.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

from tests.evaluation.conftest import load_eval_tool_module

discover = load_eval_tool_module("discover_candidate_prs", "discover_candidate_prs.py")

RepoCandidate = discover.RepoCandidate
GitHubClient = discover.GitHubClient
has_review_comments = discover.has_review_comments
is_test_file = discover.is_test_file
is_doc_file = discover.is_doc_file
has_production_code_change = discover.has_production_code_change
within_change_limits = discover.within_change_limits
has_recent_release = discover.has_recent_release
validate_repo = discover.validate_repo
build_target = discover.build_target
ReviewAssessment = discover.ReviewAssessment
make_llm_assessor = discover.make_llm_assessor
write_stack_outputs = discover.write_stack_outputs
collect_review_texts = discover.collect_review_texts
main = discover.main


class TestHasReviewComments:
    def test_human_only(self):
        inline = [{"user": {"login": "alice"}, "body": "please fix"}]
        assert has_review_comments(inline, []) is True

    def test_ai_bot_only(self):
        inline = [{"user": {"login": "coderabbitai[bot]"}, "body": "nit"}]
        assert has_review_comments(inline, []) is True

    def test_both(self):
        inline = [
            {"user": {"login": "alice"}, "body": "please fix"},
            {"user": {"login": "coderabbitai[bot]"}, "body": "nit"},
        ]
        assert has_review_comments(inline, []) is True

    def test_review_body_only(self):
        reviews = [{"user": {"login": "bob"}, "body": "looks risky here"}]
        assert has_review_comments([], reviews) is True

    def test_none(self):
        assert has_review_comments([], []) is False

    def test_empty_bodies_do_not_count(self):
        inline = [{"user": {"login": "alice"}, "body": ""}]
        reviews = [{"user": {"login": "bob"}, "body": "   "}]
        assert has_review_comments(inline, reviews) is False


class TestCollectReviewTexts:
    def test_aggregates_inline_and_review_bodies(self):
        inline = [{"user": {"login": "a"}, "body": "comment one"}]
        reviews = [{"user": {"login": "b"}, "body": "comment two"}]
        texts = collect_review_texts(inline, reviews)
        assert "comment one" in texts
        assert "comment two" in texts

    def test_skips_blank(self):
        inline = [{"user": {"login": "a"}, "body": "  "}]
        texts = collect_review_texts(inline, [])
        assert texts == []


class TestIsTestFile:
    def test_detects_test_paths(self):
        assert is_test_file("src/foo.test.ts") is True
        assert is_test_file("src/__tests__/foo.ts") is True
        assert is_test_file("tests/test_foo.py") is True

    def test_non_test_path(self):
        assert is_test_file("src/foo.ts") is False


class TestIsDocFile:
    def test_detects_docs(self):
        assert is_doc_file("README.md") is True
        assert is_doc_file("docs/guide.mdx") is True
        assert is_doc_file("CHANGELOG.md") is True

    def test_non_doc(self):
        assert is_doc_file("src/foo.ts") is False


class TestHasProductionCodeChange:
    def test_true_when_prod_file_present(self):
        files = [
            {"filename": "src/foo.ts"},
            {"filename": "src/foo.test.ts"},
        ]
        assert has_production_code_change(files) is True

    def test_false_when_only_tests(self):
        files = [{"filename": "src/foo.test.ts"}]
        assert has_production_code_change(files) is False

    def test_false_when_only_docs(self):
        files = [{"filename": "README.md"}]
        assert has_production_code_change(files) is False

    def test_false_when_empty(self):
        assert has_production_code_change([]) is False


class TestWithinChangeLimits:
    def test_within(self):
        pr = {"changed_files": 20, "additions": 500, "deletions": 500}
        assert within_change_limits(pr, max_files=20, max_lines=1000) is True

    def test_too_many_files(self):
        pr = {"changed_files": 21, "additions": 1, "deletions": 0}
        assert within_change_limits(pr, max_files=20, max_lines=1000) is False

    def test_too_many_lines(self):
        pr = {"changed_files": 3, "additions": 600, "deletions": 401}
        assert within_change_limits(pr, max_files=20, max_lines=1000) is False

    def test_boundary_lines_exact(self):
        pr = {"changed_files": 1, "additions": 1000, "deletions": 0}
        assert within_change_limits(pr, max_files=20, max_lines=1000) is True


class TestHasRecentRelease:
    def _client_with_releases(self, published_at):
        client = MagicMock()
        client.list_releases.return_value = (
            [{"published_at": published_at}] if published_at else []
        )
        client.list_tags_with_dates.return_value = []
        return client

    def test_recent_release_within_window(self):
        now = datetime(2026, 7, 1, tzinfo=timezone.utc)
        recent = (now - timedelta(days=30)).strftime("%Y-%m-%dT%H:%M:%SZ")
        client = self._client_with_releases(recent)
        assert has_recent_release(client, "o/r", now, days=180) is True

    def test_old_release_outside_window(self):
        now = datetime(2026, 7, 1, tzinfo=timezone.utc)
        old = (now - timedelta(days=400)).strftime("%Y-%m-%dT%H:%M:%SZ")
        client = self._client_with_releases(old)
        assert has_recent_release(client, "o/r", now, days=180) is False

    def test_falls_back_to_tags_when_no_releases(self):
        now = datetime(2026, 7, 1, tzinfo=timezone.utc)
        recent = (now - timedelta(days=10)).strftime("%Y-%m-%dT%H:%M:%SZ")
        client = MagicMock()
        client.list_releases.return_value = []
        client.list_tags_with_dates.return_value = [recent]
        assert has_recent_release(client, "o/r", now, days=180) is True

    def test_false_when_no_releases_and_no_tags(self):
        now = datetime(2026, 7, 1, tzinfo=timezone.utc)
        client = MagicMock()
        client.list_releases.return_value = []
        client.list_tags_with_dates.return_value = []
        assert has_recent_release(client, "o/r", now, days=180) is False


class TestReviewAssessmentModel:
    def test_valid(self):
        a = ReviewAssessment(
            severity="high",
            impact="security",
            priority="high",
            rationale="auth bypass",
        )
        assert a.severity == "high"
        assert a.impact == "security"
        assert a.priority == "high"


class TestMakeLlmAssessor:
    def _agent_returning(self, assessment):
        result = MagicMock()
        result.structured_output = assessment
        agent = MagicMock(return_value=result)
        return agent

    def test_returns_assessment_on_success(self):
        assessment = ReviewAssessment(
            severity="medium",
            impact="correctness",
            priority="medium",
            rationale="off-by-one",
        )
        with (
            patch.object(discover, "OpenAIModel"),
            patch.object(
                discover, "Agent", return_value=self._agent_returning(assessment)
            ),
        ):
            assessor = make_llm_assessor("gpt-4o")
            out = assessor("PR title", ["some review comment"])
        assert out is assessment

    def test_returns_none_on_exception(self):
        agent = MagicMock(side_effect=RuntimeError("boom"))
        with (
            patch.object(discover, "OpenAIModel"),
            patch.object(discover, "Agent", return_value=agent),
        ):
            assessor = make_llm_assessor("gpt-4o")
            out = assessor("PR title", ["comment"])
        assert out is None

    def test_returns_none_when_structured_output_none(self):
        result = MagicMock()
        result.structured_output = None
        agent = MagicMock(return_value=result)
        with (
            patch.object(discover, "OpenAIModel"),
            patch.object(discover, "Agent", return_value=agent),
        ):
            assessor = make_llm_assessor("gpt-4o")
            out = assessor("PR title", ["comment"])
        assert out is None

    def test_passes_base_url_when_set(self):
        assessment = ReviewAssessment(
            severity="low", impact="maintainability", priority="low", rationale="style"
        )
        with (
            patch.object(discover, "OpenAIModel") as model_cls,
            patch.object(
                discover, "Agent", return_value=self._agent_returning(assessment)
            ),
        ):
            make_llm_assessor("gpt-4o", "http://localhost:11434/v1")
        model_cls.assert_called_once()
        _, kwargs = model_cls.call_args
        assert kwargs["client_args"] == {"base_url": "http://localhost:11434/v1"}


class TestWriteStackOutputs:
    def test_routes_targets_by_stack(self, tmp_path):
        targets = [
            {
                "repository": "o/react-app",
                "pr_number": 1,
                "stack": "react",
                "repo_type": "application",
                "severity": "high",
                "impact": "security",
                "priority": "high",
            },
            {
                "repository": "o/vue-app",
                "pr_number": 2,
                "stack": "vue",
                "repo_type": "application",
                "severity": "low",
                "impact": "maintainability",
                "priority": "low",
            },
        ]
        write_stack_outputs(targets, str(tmp_path))
        react = json.loads((tmp_path / "pr_targets_react.json").read_text())
        vue = json.loads((tmp_path / "pr_targets_vue.json").read_text())
        assert len(react) == 1 and react[0]["repository"] == "o/react-app"
        assert len(vue) == 1 and vue[0]["pr_number"] == 2

    def test_empty_stack_produces_empty_file(self, tmp_path):
        write_stack_outputs([], str(tmp_path), stacks=["react", "vue"])
        for stack in ("react", "vue"):
            data = json.loads((tmp_path / f"pr_targets_{stack}.json").read_text())
            assert data == []

    def test_stack_outside_default_still_written(self, tmp_path):
        targets = [
            {
                "repository": "o/solid-app",
                "pr_number": 3,
                "stack": "solid",
                "repo_type": "application",
                "severity": "low",
                "impact": "correctness",
                "priority": "low",
            }
        ]
        write_stack_outputs(targets, str(tmp_path), stacks=["react"])
        solid = json.loads((tmp_path / "pr_targets_solid.json").read_text())
        assert len(solid) == 1


def _fake_client(**overrides):
    client = MagicMock()
    client.get_repo.return_value = {"stargazers_count": 10000, "archived": False}
    client.list_releases.return_value = []
    client.list_tags_with_dates.return_value = []
    for key, value in overrides.items():
        getattr(client, key).return_value = value
    return client


class TestValidateRepo:
    def _candidate(self):
        return RepoCandidate(repository="o/r", repo_type="application", stack="react")

    def test_ok_when_stars_and_recent_release(self):
        now = datetime(2026, 7, 1, tzinfo=timezone.utc)
        recent = (now - timedelta(days=10)).strftime("%Y-%m-%dT%H:%M:%SZ")
        client = _fake_client(list_releases=[{"published_at": recent}])
        ok, reason = validate_repo(client, self._candidate(), now)
        assert ok is True
        assert "recent_release=yes" in reason

    def test_repo_not_found(self):
        now = datetime(2026, 7, 1, tzinfo=timezone.utc)
        client = _fake_client(get_repo=None)
        ok, reason = validate_repo(client, self._candidate(), now)
        assert ok is False
        assert "not found" in reason

    def test_archived(self):
        now = datetime(2026, 7, 1, tzinfo=timezone.utc)
        client = _fake_client(get_repo={"stargazers_count": 99999, "archived": True})
        ok, reason = validate_repo(client, self._candidate(), now)
        assert ok is False
        assert "archived" in reason

    def test_too_few_stars(self):
        now = datetime(2026, 7, 1, tzinfo=timezone.utc)
        client = _fake_client(get_repo={"stargazers_count": 100, "archived": False})
        ok, reason = validate_repo(client, self._candidate(), now)
        assert ok is False
        assert "stars=" in reason

    def test_no_recent_release(self):
        now = datetime(2026, 7, 1, tzinfo=timezone.utc)
        client = _fake_client()  # no releases, no tags
        ok, reason = validate_repo(client, self._candidate(), now)
        assert ok is False
        assert "no release" in reason


class TestBuildTarget:
    def _candidate(self):
        return RepoCandidate(repository="o/r", repo_type="application", stack="react")

    def _assessor(self, assessment):
        return lambda title, texts: assessment

    def _good_assessment(self):
        return ReviewAssessment(
            severity="high", impact="security", priority="high", rationale="x"
        )

    def test_accepts_valid_pr(self):
        client = MagicMock()
        client.get_pr.return_value = {
            "changed_files": 3,
            "additions": 10,
            "deletions": 5,
        }
        client.list_pr_files.return_value = [{"filename": "src/app.ts"}]
        client.list_review_comments.return_value = [
            {"user": {"login": "alice"}, "body": "fix this"}
        ]
        client.list_pr_reviews.return_value = []
        target = build_target(
            client,
            self._candidate(),
            {"number": 42, "title": "t"},
            self._assessor(self._good_assessment()),
        )
        assert target == {
            "repository": "o/r",
            "pr_number": 42,
            "stack": "react",
            "repo_type": "application",
            "severity": "high",
            "impact": "security",
            "priority": "high",
        }

    def test_skips_when_pr_detail_missing(self):
        client = MagicMock()
        client.get_pr.return_value = None
        target = build_target(
            client,
            self._candidate(),
            {"number": 1, "title": "t"},
            self._assessor(self._good_assessment()),
        )
        assert target is None

    def test_skips_when_too_large(self):
        client = MagicMock()
        client.get_pr.return_value = {
            "changed_files": 50,
            "additions": 10,
            "deletions": 0,
        }
        target = build_target(
            client,
            self._candidate(),
            {"number": 1, "title": "t"},
            self._assessor(self._good_assessment()),
        )
        assert target is None

    def test_skips_when_no_production_code(self):
        client = MagicMock()
        client.get_pr.return_value = {
            "changed_files": 1,
            "additions": 1,
            "deletions": 0,
        }
        client.list_pr_files.return_value = [{"filename": "README.md"}]
        target = build_target(
            client,
            self._candidate(),
            {"number": 1, "title": "t"},
            self._assessor(self._good_assessment()),
        )
        assert target is None

    def test_skips_when_no_review_comments(self):
        client = MagicMock()
        client.get_pr.return_value = {
            "changed_files": 1,
            "additions": 1,
            "deletions": 0,
        }
        client.list_pr_files.return_value = [{"filename": "src/app.ts"}]
        client.list_review_comments.return_value = []
        client.list_pr_reviews.return_value = []
        target = build_target(
            client,
            self._candidate(),
            {"number": 1, "title": "t"},
            self._assessor(self._good_assessment()),
        )
        assert target is None

    def test_skips_when_assessment_fails(self):
        client = MagicMock()
        client.get_pr.return_value = {
            "changed_files": 1,
            "additions": 1,
            "deletions": 0,
        }
        client.list_pr_files.return_value = [{"filename": "src/app.ts"}]
        client.list_review_comments.return_value = [
            {"user": {"login": "a"}, "body": "fix"}
        ]
        client.list_pr_reviews.return_value = []
        target = build_target(
            client,
            self._candidate(),
            {"number": 1, "title": "t"},
            self._assessor(None),
        )
        assert target is None


class TestGitHubClient:
    def _client(self, responses):
        """Build a GitHubClient with a stubbed HTTP session.

        Args:
            responses: list of (status_code, json_body) to return in order.

        Returns:
            A GitHubClient whose session yields the given responses.
        """
        client = GitHubClient("tok")
        calls = iter(responses)

        def fake_get(url, params=None, timeout=None):
            status, body = next(calls)
            resp = MagicMock()
            resp.status_code = status
            resp.json.return_value = body
            resp.text = ""
            resp.raise_for_status = MagicMock()
            return resp

        client._session.get = fake_get  # type: ignore[method-assign]
        return client

    def test_get_returns_json_on_200(self):
        client = self._client([(200, {"ok": True})])
        assert client.get_repo("o/r") == {"ok": True}

    def test_get_returns_none_on_404(self):
        client = self._client([(404, None)])
        assert client.get_repo("o/r") is None

    def test_list_releases_empty(self):
        client = self._client([(200, [])])
        assert client.list_releases("o/r") == []

    def test_list_tags_with_dates(self):
        responses = [
            (200, [{"commit": {"sha": "abc"}}]),
            (200, {"commit": {"committer": {"date": "2026-01-01T00:00:00Z"}}}),
        ]
        client = self._client(responses)
        dates = client.list_tags_with_dates("o/r")
        assert dates == ["2026-01-01T00:00:00Z"]

    def test_list_merged_prs_filters_unmerged(self):
        responses = [
            (
                200,
                [
                    {
                        "number": 1,
                        "merged_at": "2026-06-01T00:00:00Z",
                        "updated_at": "2026-06-02T00:00:00Z",
                    },
                    {
                        "number": 2,
                        "merged_at": None,
                        "updated_at": "2026-06-02T00:00:00Z",
                    },
                ],
            ),
        ]
        client = self._client(responses)
        prs = client.list_merged_prs("o/r", since="2026-01-01T00:00:00Z")
        assert [p["number"] for p in prs] == [1]


class TestMain:
    def test_returns_1_without_token(self, tmp_path, monkeypatch):
        monkeypatch.delenv("GITHUB_TOKEN", raising=False)
        monkeypatch.setattr(discover, "load_dotenv", lambda: None)
        repos = tmp_path / "repos.json"
        repos.write_text("[]")
        monkeypatch.setattr(
            sys,
            "argv",
            [
                "discover_candidate_prs.py",
                "--repos",
                str(repos),
                "--output-dir",
                str(tmp_path),
            ],
        )
        assert main() == 1

    def test_generates_outputs_end_to_end(self, tmp_path, monkeypatch):
        monkeypatch.setenv("GITHUB_TOKEN", "tok")
        monkeypatch.setattr(discover, "load_dotenv", lambda: None)

        now_recent = datetime.now(timezone.utc) - timedelta(days=5)
        recent_iso = now_recent.strftime("%Y-%m-%dT%H:%M:%SZ")

        fake_client = MagicMock()
        fake_client.get_repo.return_value = {
            "stargazers_count": 10000,
            "archived": False,
        }
        fake_client.list_releases.return_value = [{"published_at": recent_iso}]
        fake_client.list_merged_prs.return_value = [{"number": 7, "title": "t"}]
        fake_client.get_pr.return_value = {
            "changed_files": 2,
            "additions": 5,
            "deletions": 5,
        }
        fake_client.list_pr_files.return_value = [{"filename": "src/app.ts"}]
        fake_client.list_review_comments.return_value = [
            {"user": {"login": "a"}, "body": "fix"}
        ]
        fake_client.list_pr_reviews.return_value = []

        assessment = ReviewAssessment(
            severity="high", impact="security", priority="high", rationale="x"
        )

        repos = tmp_path / "repos.json"
        repos.write_text(
            json.dumps(
                [
                    {
                        "repository": "o/react-app",
                        "repo_type": "application",
                        "stack": "react",
                    }
                ]
            )
        )
        monkeypatch.setattr(
            sys,
            "argv",
            [
                "discover_candidate_prs.py",
                "--repos",
                str(repos),
                "--output-dir",
                str(tmp_path),
            ],
        )
        with (
            patch.object(discover, "GitHubClient", return_value=fake_client),
            patch.object(
                discover, "make_llm_assessor", return_value=lambda t, x: assessment
            ),
            patch.object(discover.time, "sleep", lambda *a: None),
        ):
            rc = main()
        assert rc == 0
        react = json.loads((tmp_path / "pr_targets_react.json").read_text())
        assert len(react) == 1
        assert react[0]["pr_number"] == 7
        assert react[0]["severity"] == "high"
