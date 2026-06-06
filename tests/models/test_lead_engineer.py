"""Tests for Lead Engineer stage models."""

import pytest
from pydantic import ValidationError

from code_review_agent.models.review import (
    ReviewError,
    ReviewFinding,
    ReviewPerspective,
    ReviewPriority,
)


def _make_decision(
    verdict_str: str = "accept",
    priority: ReviewPriority = ReviewPriority.MEDIUM,
    reviewer_id: str = "react-technical",
    perspective: ReviewPerspective = ReviewPerspective.TECHNICAL,
    comment: str = "Test finding",
    file_path: str | None = "src/App.tsx",
    line: int | None = 10,
):
    from code_review_agent.models.lead_engineer import DecisionVerdict, FindingDecision

    return FindingDecision(
        reviewer_id=reviewer_id,
        perspective=perspective,
        finding=_make_finding(
            comment=comment, priority=priority, file_path=file_path, line=line
        ),
        verdict=DecisionVerdict(verdict_str),
        reason="reason",
        impact="impact",
        final_priority=priority,
    )


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


class TestDecisionVerdict:
    """Tests for DecisionVerdict enum."""

    def test_accept_value(self):
        from code_review_agent.models.lead_engineer import DecisionVerdict

        assert DecisionVerdict.ACCEPT == "accept"
        assert DecisionVerdict.ACCEPT.value == "accept"

    def test_reject_value(self):
        from code_review_agent.models.lead_engineer import DecisionVerdict

        assert DecisionVerdict.REJECT == "reject"
        assert DecisionVerdict.REJECT.value == "reject"


class TestFindingDecisionOutput:
    """Tests for the LLM output schema (finding_index reference style)."""

    def test_required_fields(self):
        from code_review_agent.models.lead_engineer import (
            DecisionVerdict,
            FindingDecisionOutput,
        )

        output = FindingDecisionOutput(
            finding_index=1,
            verdict=DecisionVerdict.ACCEPT,
            reason="Critical security issue.",
            impact="Data breach if not fixed.",
            final_priority=ReviewPriority.CRITICAL,
        )

        assert output.finding_index == 1
        assert output.verdict == DecisionVerdict.ACCEPT
        assert output.reason == "Critical security issue."
        assert output.impact == "Data breach if not fixed."
        assert output.final_priority == ReviewPriority.CRITICAL

    def test_missing_required_field_raises(self):
        from code_review_agent.models.lead_engineer import FindingDecisionOutput

        with pytest.raises(ValidationError):
            # finding_index is intentionally omitted to trigger ValidationError
            FindingDecisionOutput.model_validate(
                {
                    "verdict": "accept",
                    "reason": "ok",
                    "impact": "none",
                    "final_priority": "low",
                }
            )


class TestLeadEngineerOutput:
    """Tests for the top-level LLM output schema."""

    def test_required_fields(self):
        from code_review_agent.models.lead_engineer import LeadEngineerOutput

        output = LeadEngineerOutput(
            overall_summary="PR looks generally safe.",
            decisions=[],
        )

        assert output.overall_summary == "PR looks generally safe."
        assert output.decisions == []

    def test_decisions_default_empty(self):
        from code_review_agent.models.lead_engineer import LeadEngineerOutput

        output = LeadEngineerOutput(overall_summary="ok")
        assert output.decisions == []


class TestFindingDecision:
    """Tests for the resolved FindingDecision object."""

    def test_holds_original_finding(self):
        from code_review_agent.models.lead_engineer import (
            DecisionVerdict,
            FindingDecision,
        )

        finding = _make_finding(
            comment="XSS via innerHTML", priority=ReviewPriority.HIGH
        )
        decision = FindingDecision(
            reviewer_id="react-technical",
            perspective=ReviewPerspective.TECHNICAL,
            finding=finding,
            verdict=DecisionVerdict.ACCEPT,
            reason="High severity XSS vector.",
            impact="User accounts can be compromised.",
            final_priority=ReviewPriority.HIGH,
        )

        assert decision.finding is finding
        assert decision.finding.comment == "XSS via innerHTML"
        assert decision.reviewer_id == "react-technical"
        assert decision.perspective == ReviewPerspective.TECHNICAL
        assert decision.verdict == DecisionVerdict.ACCEPT

    def test_all_fields_present(self):
        from code_review_agent.models.lead_engineer import (
            DecisionVerdict,
            FindingDecision,
        )

        decision = FindingDecision(
            reviewer_id="security",
            perspective=ReviewPerspective.SECURITY,
            finding=_make_finding(),
            verdict=DecisionVerdict.REJECT,
            reason="False positive.",
            impact="None.",
            final_priority=ReviewPriority.LOW,
        )

        assert decision.reason == "False positive."
        assert decision.impact == "None."
        assert decision.final_priority == ReviewPriority.LOW


class TestLeadEngineerReport:
    """Tests for LeadEngineerReport output, sorting, and serialisation."""

    def _make_report(self, decisions=None, errors=None):
        from code_review_agent.models.lead_engineer import LeadEngineerReport

        return LeadEngineerReport(
            overall_summary="Overall OK.",
            decisions=decisions or [],
            reviewer_errors=errors or [],
        )

    def test_accepted_sorted_by_priority(self):
        decisions = [
            _make_decision("accept", ReviewPriority.LOW),
            _make_decision("accept", ReviewPriority.CRITICAL),
            _make_decision("accept", ReviewPriority.MEDIUM),
            _make_decision("accept", ReviewPriority.HIGH),
        ]
        report = self._make_report(decisions=decisions)
        result = report.accepted()

        priorities = [d.final_priority for d in result]
        assert priorities == [
            ReviewPriority.CRITICAL,
            ReviewPriority.HIGH,
            ReviewPriority.MEDIUM,
            ReviewPriority.LOW,
        ]

    def test_rejected_sorted_by_priority(self):
        decisions = [
            _make_decision("reject", ReviewPriority.LOW),
            _make_decision("reject", ReviewPriority.HIGH),
        ]
        report = self._make_report(decisions=decisions)
        result = report.rejected()

        assert result[0].final_priority == ReviewPriority.HIGH
        assert result[1].final_priority == ReviewPriority.LOW

    def test_accepted_excludes_rejected(self):
        decisions = [
            _make_decision("accept", ReviewPriority.HIGH),
            _make_decision("reject", ReviewPriority.CRITICAL),
        ]
        report = self._make_report(decisions=decisions)

        assert len(report.accepted()) == 1
        assert len(report.rejected()) == 1

    def test_to_markdown_contains_accepted_file_and_comment(self):
        decisions = [
            _make_decision(
                "accept",
                ReviewPriority.HIGH,
                comment="XSS issue",
                file_path="src/App.tsx",
                line=42,
            ),
        ]
        report = self._make_report(decisions=decisions)
        md = report.to_markdown()

        assert "src/App.tsx" in md
        assert "XSS issue" in md
        assert "L42" in md

    def test_to_markdown_rejected_in_details_block(self):
        decisions = [
            _make_decision("reject", ReviewPriority.LOW, comment="Minor style issue"),
        ]
        report = self._make_report(decisions=decisions)
        md = report.to_markdown()

        assert "<details>" in md
        assert "Minor style issue" in md

    def test_to_markdown_errors_at_end(self):
        errors = [
            ReviewError(
                reviewer_id="spring-technical",
                perspective=ReviewPerspective.TECHNICAL,
                message="Connection timeout",
            )
        ]
        report = self._make_report(errors=errors)
        md = report.to_markdown()

        assert "spring-technical" in md
        assert "Connection timeout" in md

    def test_to_markdown_no_accepted_shows_placeholder(self):
        report = self._make_report(decisions=[])
        md = report.to_markdown()

        assert "_No findings accepted._" in md

    def test_to_evaluation_format_keys(self):
        report = self._make_report()
        result = report.to_evaluation_format("octocat/hello#1")

        assert result["id"] == "octocat/hello#1"
        assert "agent_findings" in result
        assert "lead_decisions" in result

    def test_to_evaluation_format_agent_findings_accepted_only(self):
        decisions = [
            _make_decision(
                "accept",
                ReviewPriority.HIGH,
                comment="Accepted finding",
                file_path="src/A.tsx",
            ),
            _make_decision(
                "reject",
                ReviewPriority.MEDIUM,
                comment="Rejected finding",
                file_path="src/B.tsx",
            ),
        ]
        report = self._make_report(decisions=decisions)
        result = report.to_evaluation_format("owner/repo#1")

        summaries = [f["summary"] for f in result["agent_findings"]]
        assert "Accepted finding" in summaries
        assert "Rejected finding" not in summaries

    def test_to_evaluation_format_lead_decisions_all(self):
        decisions = [
            _make_decision("accept", file_path="src/A.tsx"),
            _make_decision("reject", file_path="src/B.tsx"),
        ]
        report = self._make_report(decisions=decisions)
        result = report.to_evaluation_format("owner/repo#1")

        assert len(result["lead_decisions"]) == 2
        verdicts = {d["decision"] for d in result["lead_decisions"]}
        assert verdicts == {"accept", "reject"}
