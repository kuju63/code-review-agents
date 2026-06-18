"""Lead Engineer synthesis agent.

Evaluates the aggregated outputs of the parallel review stage and produces
a final accept/reject decision for each finding.  The lead engineer does NOT
perform additional analysis beyond what the reviewers reported — its role is
to triage and prioritise, not to extend the review.
"""

import logging
from typing import ClassVar, cast

from strands import Agent
from strands.models.openai import OpenAIModel

from ..models.lead_engineer import (
    DecisionVerdict,
    FindingDecision,
    FindingDecisionOutput,
    LeadEngineerOutput,
    LeadEngineerReport,
)
from ..models.review import ReviewFinding, ReviewPerspective, ReviewReport
from .base_reviewer import ReviewerConfig

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT = """\
You are a lead engineer responsible for triaging and prioritising code review
findings raised by a team of specialist reviewers.

Your sole task is to evaluate each finding submitted by the reviewers and
decide whether to accept it (the developer must address it) or reject it
(false positive, out of scope, or too low value to act on).

Decision criteria — consider all three axes:
1. Severity: How serious is the issue as reported by the reviewer?
2. Impact: What is the consequence of NOT fixing this issue?
3. Priority: How urgent is the fix relative to the PR goal?

Rules — you MUST follow every rule without exception:
- Base your decisions ONLY on the findings listed in the input.
- Do NOT introduce new issues, add inferred problems, or speculate beyond
  what the reviewers explicitly reported.
- Do NOT reference specific framework names or technology stacks in your
  reasoning unless a reviewer explicitly mentioned them.
- Every Finding in the input MUST receive a decision.
- Return the finding_index exactly as shown in the Finding # label.
- Assign final_priority; it may differ from the reviewer's original priority
  when the overall PR context justifies it.
- Provide a concise reason for each decision and an impact assessment.
"""


class LeadEngineerAgent:
    """Evaluates parallel reviewer outputs and produces final decisions.

    Consumes a :class:`~code_review_agent.models.review.ReviewReport` and
    returns a :class:`~code_review_agent.models.lead_engineer.LeadEngineerReport`
    with an accept/reject decision for every finding.

    The agent does NOT use GitHub MCP tools — its inputs are entirely derived
    from the reviewer outputs already collected.

    Args:
        config: Shared runtime configuration.  ``github_token`` is present for
            interface consistency but unused by this agent; ``model_id`` selects
            the LLM.
    """

    system_prompt: ClassVar[str] = _SYSTEM_PROMPT

    def __init__(self, config: ReviewerConfig) -> None:
        self._config = config

    def evaluate(self, report: ReviewReport) -> LeadEngineerReport:
        """Evaluate all reviewer findings and produce a final report.

        Args:
            report: Aggregated output from the parallel review stage.

        Returns:
            Final report with accept/reject decisions for every finding.
        """
        prompt, index_map = self._build_prompt_and_index(report)
        if self._config.llm_base_url:
            model = OpenAIModel(
                model_id=self._config.model_id,
                client_args={"base_url": self._config.llm_base_url},
            )
        else:
            model = OpenAIModel(model_id=self._config.model_id)
        agent = Agent(model=model, system_prompt=self.system_prompt, tools=[])
        output: LeadEngineerOutput = cast(
            LeadEngineerOutput,
            agent(
                prompt,
                structured_output_model=LeadEngineerOutput,
                limits={"turns": self._config.max_agent_turns},
            ).structured_output,
        )
        decisions = self._resolve_decisions(output.decisions, index_map)
        return LeadEngineerReport(
            overall_summary=output.overall_summary,
            decisions=decisions,
            reviewer_errors=report.errors,
        )

    def _build_prompt_and_index(
        self, report: ReviewReport
    ) -> tuple[str, dict[int, tuple[str, ReviewPerspective, ReviewFinding]]]:
        """Build the evaluation prompt and a finding-index map simultaneously.

        Each finding is assigned a 1-based index (``Finding #N``) so the LLM
        can reference it by number without reproducing the full finding object.
        The index map allows the agent code to look up the original finding
        after receiving the LLM's ``FindingDecisionOutput``.

        Args:
            report: Aggregated output from the parallel review stage.

        Returns:
            A tuple of (prompt string, index map).  The index map has the form
            ``{N: (reviewer_id, perspective, finding)}``.
        """
        lines: list[str] = [
            "Below are the findings from the parallel review stage.",
            "Evaluate each finding and produce a FindingDecision.",
            "",
        ]
        index_map: dict[int, tuple[str, ReviewPerspective, ReviewFinding]] = {}

        if not report.results:
            lines += [
                "No reviewer findings were submitted.",
                "",
                "Produce an overall_summary noting the absence of findings "
                "and an empty decisions list.",
            ]
            return "\n".join(lines), index_map

        n = 1
        for result in report.results:
            lines.append(
                f"=== Reviewer: {result.reviewer_id} "
                f"(perspective: {result.perspective.value}) ==="
            )
            lines.append(f"Reviewer summary: {result.output.summary}")
            lines.append("")

            if not result.output.findings:
                lines.append("  (no findings reported by this reviewer)")
                lines.append("")
                continue

            for finding in result.output.findings:
                index_map[n] = (result.reviewer_id, result.perspective, finding)
                lines.append(f"Finding #{n}")
                lines.append(f"  reviewer_id: {result.reviewer_id}")
                lines.append(f"  perspective: {result.perspective.value}")
                if finding.file_path:
                    lines.append(f"  file: {finding.file_path}")
                if finding.line:
                    lines.append(f"  line: {finding.line}")
                lines.append(f"  priority: {finding.priority.value}")
                lines.append(f"  comment: {finding.comment}")
                if finding.context:
                    lines.append(f"  context: {finding.context}")
                if finding.proposed_fix:
                    lines.append(f"  proposed_fix: {finding.proposed_fix}")
                lines.append("")
                n += 1

        lines.append(
            f"Produce exactly {len(index_map)} FindingDecision(s) — one per "
            "Finding listed above.  Do NOT add decisions for findings not listed."
        )
        return "\n".join(lines), index_map

    def _resolve_decisions(
        self,
        raw: list[FindingDecisionOutput],
        index_map: dict[int, tuple[str, ReviewPerspective, ReviewFinding]],
    ) -> list[FindingDecision]:
        """Resolve LLM output indexes to original findings.

        Normalises the LLM output to guarantee exactly one decision per finding
        in ``index_map``:

        1. Unknown indexes (not in ``index_map``) are logged and skipped.
        2. Duplicate indexes use only the first occurrence; later duplicates are
           logged and discarded.
        3. Findings with no LLM decision receive a deterministic default:
           ``REJECT`` with ``final_priority`` set to the original
           ``finding.priority``.

        Args:
            raw: LLM-generated decision outputs using finding indexes.
            index_map: Map from finding index to (reviewer_id, perspective,
                finding) built by :meth:`_build_prompt_and_index`.

        Returns:
            Resolved decisions with exactly one entry per finding in
            ``index_map``.
        """
        decisions: list[FindingDecision] = []
        seen: set[int] = set()

        for d in raw:
            entry = index_map.get(d.finding_index)
            if entry is None:
                logger.warning(
                    "LeadEngineerAgent: unknown finding_index %d — skipped",
                    d.finding_index,
                )
                continue
            if d.finding_index in seen:
                logger.warning(
                    "LeadEngineerAgent: duplicate finding_index %d — using first occurrence",
                    d.finding_index,
                )
                continue
            seen.add(d.finding_index)
            reviewer_id, perspective, finding = entry
            decisions.append(
                FindingDecision(
                    reviewer_id=reviewer_id,
                    perspective=perspective,
                    finding=finding,
                    verdict=d.verdict,
                    reason=d.reason,
                    impact=d.impact,
                    final_priority=d.final_priority,
                )
            )

        for idx, (reviewer_id, perspective, finding) in index_map.items():
            if idx not in seen:
                logger.warning(
                    "LeadEngineerAgent: finding_index %d has no LLM decision — defaulting to REJECT",
                    idx,
                )
                decisions.append(
                    FindingDecision(
                        reviewer_id=reviewer_id,
                        perspective=perspective,
                        finding=finding,
                        verdict=DecisionVerdict.REJECT,
                        reason="No decision provided by lead engineer.",
                        impact="Unknown — no evaluation provided.",
                        final_priority=finding.priority,
                    )
                )

        return decisions
