"""Tests for the Lead Engineer synthesis agent."""

from unittest.mock import MagicMock, patch

from code_review_agent.agents.base_reviewer import ReviewerConfig
from code_review_agent.models.review import (
    ReviewError,
    ReviewFinding,
    ReviewOutput,
    ReviewPerspective,
    ReviewPriority,
    ReviewReport,
    ReviewResult,
)

_MOD = "code_review_agent.agents.lead_engineer"


def _make_finding(
    comment: str = "Test finding",
    priority: ReviewPriority = ReviewPriority.MEDIUM,
    file_path: str | None = "src/App.tsx",
    line: int | None = 10,
) -> ReviewFinding:
    return ReviewFinding(
        file_path=file_path,
        line=line,
        comment=comment,
        priority=priority,
    )


def _make_result(
    reviewer_id: str = "react-technical",
    perspective: ReviewPerspective = ReviewPerspective.TECHNICAL,
    findings: list[ReviewFinding] | None = None,
) -> ReviewResult:
    return ReviewResult(
        reviewer_id=reviewer_id,
        perspective=perspective,
        output=ReviewOutput(
            summary="Review summary.",
            findings=findings or [],
        ),
    )


def _make_report(
    results: list[ReviewResult] | None = None,
    errors: list[ReviewError] | None = None,
) -> ReviewReport:
    return ReviewReport(
        results=results or [],
        errors=errors or [],
    )


def _make_config() -> ReviewerConfig:
    return ReviewerConfig(github_token="test-token", model_id="gpt-4o-mini")


class TestBuildPromptAndIndex:
    """Tests for _build_prompt_and_index prompt generation."""

    def _agent(self):
        from code_review_agent.agents.lead_engineer import LeadEngineerAgent

        return LeadEngineerAgent(_make_config())

    def test_finding_numbered_in_prompt(self):
        findings = [
            _make_finding(comment="XSS issue"),
            _make_finding(comment="SQL injection"),
        ]
        report = _make_report(results=[_make_result(findings=findings)])
        agent = self._agent()

        prompt, index_map = agent._build_prompt_and_index(report)

        assert "Finding #1" in prompt
        assert "Finding #2" in prompt

    def test_index_map_maps_to_reviewer_id_and_finding(self):
        finding = _make_finding(comment="XSS issue")
        report = _make_report(
            results=[_make_result(reviewer_id="react-technical", findings=[finding])]
        )
        agent = self._agent()

        _, index_map = agent._build_prompt_and_index(report)

        assert 1 in index_map
        reviewer_id, perspective, resolved_finding = index_map[1]
        assert reviewer_id == "react-technical"
        assert perspective == ReviewPerspective.TECHNICAL
        assert resolved_finding is finding

    def test_multiple_reviewers_consecutive_numbering(self):
        findings_a = [_make_finding(comment="Finding A")]
        findings_b = [
            _make_finding(comment="Finding B"),
            _make_finding(comment="Finding C"),
        ]
        report = _make_report(
            results=[
                _make_result(reviewer_id="reviewer-a", findings=findings_a),
                _make_result(
                    reviewer_id="reviewer-b",
                    perspective=ReviewPerspective.SECURITY,
                    findings=findings_b,
                ),
            ]
        )
        agent = self._agent()

        prompt, index_map = agent._build_prompt_and_index(report)

        assert len(index_map) == 3
        assert 1 in index_map
        assert 2 in index_map
        assert 3 in index_map
        assert "Finding #1" in prompt
        assert "Finding #2" in prompt
        assert "Finding #3" in prompt

    def test_no_findings_returns_empty_map_and_nonempty_prompt(self):
        report = _make_report(results=[_make_result(findings=[])])
        agent = self._agent()

        prompt, index_map = agent._build_prompt_and_index(report)

        assert index_map == {}
        assert len(prompt) > 0

    def test_empty_report_returns_empty_map_and_nonempty_prompt(self):
        report = _make_report(results=[])
        agent = self._agent()

        prompt, index_map = agent._build_prompt_and_index(report)

        assert index_map == {}
        assert len(prompt) > 0

    def test_finding_comment_and_file_in_prompt(self):
        finding = _make_finding(
            comment="Critical XSS", file_path="src/User.tsx", line=99
        )
        report = _make_report(results=[_make_result(findings=[finding])])
        agent = self._agent()

        prompt, _ = agent._build_prompt_and_index(report)

        assert "Critical XSS" in prompt
        assert "src/User.tsx" in prompt
        assert "99" in prompt


class TestResolveDecisions:
    """Tests for _resolve_decisions index resolution."""

    def _agent(self):
        from code_review_agent.agents.lead_engineer import LeadEngineerAgent

        return LeadEngineerAgent(_make_config())

    def _make_index_map(self, findings: list[ReviewFinding]):
        return {
            i + 1: ("reviewer", ReviewPerspective.TECHNICAL, f)
            for i, f in enumerate(findings)
        }

    def test_valid_index_resolves_to_original_finding(self):
        from code_review_agent.models.lead_engineer import (
            DecisionVerdict,
            FindingDecisionOutput,
        )

        finding = _make_finding(comment="XSS")
        index_map = self._make_index_map([finding])
        raw = [
            FindingDecisionOutput(
                finding_index=1,
                verdict=DecisionVerdict.ACCEPT,
                reason="Critical",
                impact="Data breach",
                final_priority=ReviewPriority.HIGH,
            )
        ]
        agent = self._agent()

        decisions = agent._resolve_decisions(raw, index_map)

        assert len(decisions) == 1
        assert decisions[0].finding is finding
        assert decisions[0].verdict == DecisionVerdict.ACCEPT

    def test_unknown_index_in_llm_output_is_skipped_but_finding_gets_default_reject(
        self,
    ):
        from code_review_agent.models.lead_engineer import (
            DecisionVerdict,
            FindingDecisionOutput,
        )

        finding = _make_finding(
            comment="Uncovered finding", priority=ReviewPriority.HIGH
        )
        index_map = self._make_index_map([finding])
        # LLM returns only index 999 (unknown); index 1 has no decision
        raw = [
            FindingDecisionOutput(
                finding_index=999,
                verdict=DecisionVerdict.ACCEPT,
                reason="ok",
                impact="none",
                final_priority=ReviewPriority.LOW,
            )
        ]
        agent = self._agent()

        decisions = agent._resolve_decisions(raw, index_map)

        # index 1 must get a default REJECT decision
        assert len(decisions) == 1
        assert decisions[0].finding is finding
        assert decisions[0].verdict == DecisionVerdict.REJECT
        # final_priority falls back to the original finding.priority
        assert decisions[0].final_priority == ReviewPriority.HIGH

    def test_duplicate_index_uses_first_occurrence(self):
        from code_review_agent.models.lead_engineer import (
            DecisionVerdict,
            FindingDecisionOutput,
        )

        finding = _make_finding(comment="XSS")
        index_map = self._make_index_map([finding])
        # LLM returns finding_index=1 twice
        raw = [
            FindingDecisionOutput(
                finding_index=1,
                verdict=DecisionVerdict.ACCEPT,
                reason="first occurrence",
                impact="critical",
                final_priority=ReviewPriority.CRITICAL,
            ),
            FindingDecisionOutput(
                finding_index=1,
                verdict=DecisionVerdict.REJECT,
                reason="duplicate — should be ignored",
                impact="none",
                final_priority=ReviewPriority.LOW,
            ),
        ]
        agent = self._agent()

        decisions = agent._resolve_decisions(raw, index_map)

        assert len(decisions) == 1
        assert decisions[0].verdict == DecisionVerdict.ACCEPT
        assert decisions[0].reason == "first occurrence"

    def test_missing_index_gets_default_reject_with_original_priority(self):
        from code_review_agent.models.lead_engineer import (
            DecisionVerdict,
            FindingDecisionOutput,
        )

        finding_a = _make_finding(comment="A", priority=ReviewPriority.CRITICAL)
        finding_b = _make_finding(comment="B", priority=ReviewPriority.LOW)
        index_map = self._make_index_map([finding_a, finding_b])
        # LLM only covers index 1; index 2 is missing
        raw = [
            FindingDecisionOutput(
                finding_index=1,
                verdict=DecisionVerdict.ACCEPT,
                reason="ok",
                impact="high",
                final_priority=ReviewPriority.CRITICAL,
            ),
        ]
        agent = self._agent()

        decisions = agent._resolve_decisions(raw, index_map)

        assert len(decisions) == 2
        accepted = [d for d in decisions if d.verdict == DecisionVerdict.ACCEPT]
        rejected = [d for d in decisions if d.verdict == DecisionVerdict.REJECT]
        assert len(accepted) == 1
        assert accepted[0].finding.comment == "A"
        assert len(rejected) == 1
        assert rejected[0].finding.comment == "B"
        assert (
            rejected[0].final_priority == ReviewPriority.LOW
        )  # falls back to original

    def test_mixed_valid_and_invalid_indexes(self):
        from code_review_agent.models.lead_engineer import (
            DecisionVerdict,
            FindingDecisionOutput,
        )

        findings = [_make_finding(comment="A"), _make_finding(comment="B")]
        index_map = self._make_index_map(findings)
        raw = [
            FindingDecisionOutput(
                finding_index=1,
                verdict=DecisionVerdict.ACCEPT,
                reason="ok",
                impact="none",
                final_priority=ReviewPriority.HIGH,
            ),
            FindingDecisionOutput(
                finding_index=99,
                verdict=DecisionVerdict.REJECT,
                reason="invalid",
                impact="none",
                final_priority=ReviewPriority.LOW,
            ),
            FindingDecisionOutput(
                finding_index=2,
                verdict=DecisionVerdict.REJECT,
                reason="out of scope",
                impact="none",
                final_priority=ReviewPriority.LOW,
            ),
        ]
        agent = self._agent()

        decisions = agent._resolve_decisions(raw, index_map)

        # index 99 unknown → ignored; both valid findings get their LLM decisions
        assert len(decisions) == 2
        comments = {d.finding.comment for d in decisions}
        assert comments == {"A", "B"}

    def test_multiple_reviewers_correct_reviewer_id(self):
        from code_review_agent.models.lead_engineer import (
            DecisionVerdict,
            FindingDecisionOutput,
        )

        finding_a = _make_finding(comment="Finding A")
        finding_b = _make_finding(comment="Finding B")
        index_map = {
            1: ("reviewer-a", ReviewPerspective.TECHNICAL, finding_a),
            2: ("reviewer-b", ReviewPerspective.SECURITY, finding_b),
        }
        raw = [
            FindingDecisionOutput(
                finding_index=1,
                verdict=DecisionVerdict.ACCEPT,
                reason="ok",
                impact="none",
                final_priority=ReviewPriority.HIGH,
            ),
            FindingDecisionOutput(
                finding_index=2,
                verdict=DecisionVerdict.REJECT,
                reason="low value",
                impact="minimal",
                final_priority=ReviewPriority.LOW,
            ),
        ]
        agent = self._agent()

        decisions = agent._resolve_decisions(raw, index_map)

        assert decisions[0].reviewer_id == "reviewer-a"
        assert decisions[0].perspective == ReviewPerspective.TECHNICAL
        assert decisions[1].reviewer_id == "reviewer-b"
        assert decisions[1].perspective == ReviewPerspective.SECURITY


class TestLeadEngineerAgentEvaluate:
    """Tests for LeadEngineerAgent.evaluate() (Strands Agent mocked)."""

    def _agent(self):
        from code_review_agent.agents.lead_engineer import LeadEngineerAgent

        return LeadEngineerAgent(_make_config())

    def test_system_prompt_forbids_speculation(self):
        from code_review_agent.agents.lead_engineer import LeadEngineerAgent

        assert "Do NOT introduce" in LeadEngineerAgent.system_prompt
        assert "speculate" in LeadEngineerAgent.system_prompt

    def test_no_github_mcp_tools_passed(self):
        from code_review_agent.models.lead_engineer import LeadEngineerOutput

        mock_agent = MagicMock()
        mock_agent.structured_output.return_value = LeadEngineerOutput(
            overall_summary="ok", decisions=[]
        )

        with (
            patch(f"{_MOD}.Agent", return_value=mock_agent) as mock_agent_cls,
            patch(f"{_MOD}.OpenAIModel"),
        ):
            self._agent().evaluate(_make_report())

        _, kwargs = mock_agent_cls.call_args
        assert kwargs.get("tools") == []

    def test_structured_output_receives_lead_engineer_output_schema(self):
        from code_review_agent.models.lead_engineer import LeadEngineerOutput

        mock_agent = MagicMock()
        mock_agent.structured_output.return_value = LeadEngineerOutput(
            overall_summary="ok", decisions=[]
        )

        with (
            patch(f"{_MOD}.Agent", return_value=mock_agent),
            patch(f"{_MOD}.OpenAIModel"),
        ):
            self._agent().evaluate(_make_report())

        args, _ = mock_agent.structured_output.call_args
        assert args[0] is LeadEngineerOutput

    def test_returns_lead_engineer_report(self):
        from code_review_agent.models.lead_engineer import (
            LeadEngineerOutput,
            LeadEngineerReport,
        )

        mock_agent = MagicMock()
        mock_agent.structured_output.return_value = LeadEngineerOutput(
            overall_summary="All good.", decisions=[]
        )

        with (
            patch(f"{_MOD}.Agent", return_value=mock_agent),
            patch(f"{_MOD}.OpenAIModel"),
        ):
            result = self._agent().evaluate(_make_report())

        assert isinstance(result, LeadEngineerReport)
        assert result.overall_summary == "All good."

    def test_report_errors_forwarded_to_reviewer_errors(self):
        from code_review_agent.models.lead_engineer import LeadEngineerOutput

        errors = [
            ReviewError(
                reviewer_id="spring-technical",
                perspective=ReviewPerspective.TECHNICAL,
                message="timeout",
            )
        ]
        mock_agent = MagicMock()
        mock_agent.structured_output.return_value = LeadEngineerOutput(
            overall_summary="ok", decisions=[]
        )

        with (
            patch(f"{_MOD}.Agent", return_value=mock_agent),
            patch(f"{_MOD}.OpenAIModel"),
        ):
            result = self._agent().evaluate(_make_report(errors=errors))

        assert len(result.reviewer_errors) == 1
        assert result.reviewer_errors[0].reviewer_id == "spring-technical"

    def test_model_id_passed_to_openai_model(self):
        from code_review_agent.models.lead_engineer import LeadEngineerOutput

        config = ReviewerConfig(github_token="tok", model_id="gpt-4o")
        mock_agent = MagicMock()
        mock_agent.structured_output.return_value = LeadEngineerOutput(
            overall_summary="ok", decisions=[]
        )

        with (
            patch(f"{_MOD}.Agent", return_value=mock_agent),
            patch(f"{_MOD}.OpenAIModel") as mock_model_cls,
        ):
            from code_review_agent.agents.lead_engineer import LeadEngineerAgent

            LeadEngineerAgent(config).evaluate(_make_report())

        mock_model_cls.assert_called_once_with(model_id="gpt-4o")
