# Code Review Agent Evaluation Plan

## 1. Goals

This project uses a multi-stage review flow:

1. PR Info Collector (produces the structured `PRInfoResult` input)
2. Parallel review stage — an extensible set of reviewers selected per project
   type and run concurrently
3. Lead engineer selector (downstream synthesis; evaluates reviewer findings and
   decides which to accept or reject)

The parallel review stage is organized along two orthogonal axes so reviewers
can be added without changing the orchestration:

- Review perspective: `technical` and `security` are implemented; `spec_consistency`
  and `requirements_consistency` are planned (they require spec/requirement inputs
  in addition to `PRInfoResult`).
- Project type: `react_ts` is implemented; `spring_boot`, `nextjs`, `nuxt`, and
  `wasm` are planned.

See [docs/review-agents-design.md](../docs/review-agents-design.md) for the
extensible architecture (registry + orchestrator + `ReviewContext`).

The evaluation strategy must validate:

- Review quality (does it find important issues?)
- Decision quality (does lead engineer select valid fixes?)
- Operational quality (latency, cost, stability)
- Quality/feature requirement fulfillment (does implementation satisfy user-required behavior with test and coverage gates?)

To avoid overfitting and false confidence, use hybrid evaluation:

- Gold PR set (real-world human review comparison)
- Seeded set (must-find vulnerability and quality traps)

### 1.1 Quality / Feature Requirement Goal

For development quality gates, treat a feature as acceptable only if all of the following are met:

- User feature requirements are satisfied.
- All tests pass.
- Coverage is 75% or higher.

Requirement verification policy:

- User feature requirement satisfaction must be judged against the criteria in this evaluation plan.
- If new tests introduce requirements not currently covered by this document, update this plan (for example metrics, release gates, or dataset/rubric assumptions) so requirement checks remain explicit and reproducible.

Execution link for agents:

- Run evaluation operations by following [evaluation/RUNBOOK.md](evaluation/RUNBOOK.md).

## 2. Dataset Strategy

Target repository families for this project:

- UI Component Library repositories (React/Vue/Angular/Svelte, 5K+ stars, non-bot update within last 30 days)
- Application repositories built with React, Vue, Angular, or Svelte (1K+ stars, continuous updates within last 6 months, non-bot update within last 90 days)

Target product domain:

- Web applications and developer tools using major UI frameworks

### 2.0 Domain Coverage Policy

Maintain balanced coverage in both Gold and Seeded sets:

- 50% UI Component Libraries (React ≥50%, Vue ≥30%, Angular/Svelte remainder)
- 50% Applications built with UI frameworks (React ≥40%, Vue ≥30%, Svelte ≥15%, Angular ≥15%)

Within each category, include at least:

- 40% security-relevant PRs
- 30% correctness or unintended side-effect PRs
- 30% performance or maintainability PRs

### 2.0.3 Known Population Constraints and Sampling Operation

The current tagged candidate pool (`evaluation/input/pr_targets_b2b2c_tagged.json`,
39 entries) has an absolute-count constraint: Angular (3 entries) and Svelte
(2 entries) are scarce, so the Application-side Angular ≥15% / Svelte ≥15%
minimums above cannot be guaranteed for every sample regardless of `--limit`
or `--sample-n`. Similarly, no entry in the pool carries a `priority_themes`
tag that directly names performance or maintainability, so the
performance/maintainability ≥30% minimum is structurally unmet by the pool
today (see `docs/evaluation-pipeline-design.md` for the theme-to-category
mapping used to compute this).

For this reason, `convert_tagged_targets.py` reports composition shortfalls
against the ratios above as **warnings only** (`[COVERAGE-WARN]` on stderr,
non-blocking); the pipeline never fails because of them.

Sampling operation policy:

- Day-to-day local iteration: use
  `run_evaluation_pipeline.sh --sample-n <n>` (default 15), a randomized
  selection stratified ~50/50 by `repo_type`.
- §4 release-gate decisions / §5.1 weekly full run: use `--limit` (the
  deterministic, risk-ranked selection). Do not use a `--sample-n` run as the
  basis for a release-gate decision, since its composition is not guaranteed.
- Durable fix (separate task): grow `pr_targets_b2b2c_tagged.json` with more
  Angular/Svelte and performance/maintainability-themed PR candidates.

### 2.0.1 Repository Selection Criteria

UI Component Libraries must satisfy:

- Stars ≥ 5,000
- At least one non-bot commit within the last 30 days

Applications must satisfy:

- Stars ≥ 1,000
- Continuous updates (≥5 non-bot commits) within the last 6 months
- At least one non-bot commit within the last 90 days

In all cases, prefer repositories with higher star counts and more continuous update activity.

### 2.0.2 PR Quality Selection Criteria

PR selection must satisfy all of the following:

- PR is merged
- Has at least one **inline** review comment (file path + line number via `/pulls/{pr}/comments` API) — PRs with only review body comments (no file/line association) are excluded because location accuracy cannot be evaluated without inline comments
- At least one review comment focuses on **security** (XSS, injection, auth bypass, IDOR, CSRF, sensitive data exposure, etc.) or **unintended side effects** (regression, breaking change, race condition, memory leak, N+1, stale state, infinite loop, etc.)
- PRs where all review comments are solely design or style discussions (architecture, naming, refactoring approach, aesthetic preferences) are excluded
- Infrastructure bot accounts (GitHub Actions Bot, Renovate, Dependabot, Codecov, etc.) are excluded from the review comment count; AI code review bots (CodeRabbit, cubic, greptile, etc.) are NOT excluded and count as reviewers

### 2.1 Gold PR Set

Definition:

- Real GitHub pull requests with review comments from humans
- Source of truth is normalized from review threads and comments

Purpose:

- Approximation to real review behavior
- Measure precision/recall and severity alignment

Additional recommendation:

- Prefer PRs touching authentication/authorization, input validation, XSS vectors, data exposure, performance-impacting patterns, and unintended behavioral regressions.

### 2.2 Seeded Set

Definition:

- Synthetic diffs with intentionally injected defects
- Each sample has explicit must-find labels

Purpose:

- Deterministic gate for critical miss prevention
- CI-friendly acceptance criteria

Must include stack-specific traps:

- React/Vue/Svelte/Angular: XSS vectors (innerHTML, dangerouslySetInnerHTML), eval injection, unsafe dynamic HTML, heavy sequential API calls (N+1)
- React-specific: useEffect missing dependency causing stale state, uncontrolled component to controlled transition
- Common frontend: CSRF on state-mutating requests, sensitive data in localStorage, exposed secrets in client bundle

Backend-stack mutation rules (Rails, Spring Boot) were removed from
`seeded_mutations.json`: with current review resources it isn't realistic to
cover every stack, so Seeded-set generation is scoped to frontend-only traps
for now to focus on improving frontend review accuracy.

## 3. Metrics

## 3.1 Gold Metrics

- Issue Recall: matched_gold_issues / all_gold_issues
- Issue Precision: matched_gold_issues / all_agent_issues
- Severity Agreement: matched_severity / matched_gold_issues
- Location Hit Rate: matched_file_line / matched_gold_issues
  — Among `matched_gold_issues` (pairs that already satisfy the full matching
    rule below, including the ±5 line tolerance), `matched_file_line` counts
    only pairs whose line numbers are exactly equal (diff == 0). This isolates
    how often matches rely on the tolerance window rather than landing exactly,
    so it stays informative even though the denominator is already
    location-matched.
- Decision Agreement (lead): decisions_matching_human / all_decisions

## 3.1.1 Lead Engineer Decision Metrics

These metrics evaluate the quality of the Lead Engineer's accept/reject decisions.

- Decision Precision: (accepted_findings ∩ gold_issues) / accepted_findings
  — measures how often accepted findings correspond to real issues
- Decision Recall: (accepted_findings ∩ gold_issues) / gold_issues
  — measures how many real issues were accepted (not rejected)

No-Speculation Gate (verified against Seeded set):

- All findings in `accepted_findings` must originate from a reviewer in the
  parallel review stage. The Lead Engineer must not introduce new findings not
  present in `ReviewReport.results`.
- Verified by checking that every finding in the evaluation output's
  `agent_findings` matches a finding from the reviewer outputs for that PR.

Matching rule:

- File path must match exactly
- Line tolerance: plus/minus 5 lines
- Semantic match: when both findings carry a non-`unknown` `category`, the
  categories must be equal. In production this rarely gates anything —
  `run_agent_evaluation.py::_to_predictions` normalizes the agent's
  perspective-based categories (`technical`/`security`) to `unknown` (except
  `security`) because they don't share a taxonomy with the Gold/Seeded
  `category` values (`correctness`/`performance`/etc.), so most real pairs
  skip this check entirely.
- Semantic match: LLM-as-judge on `summary` text. Implemented via
  `score_evaluation.py`'s `--semantic-judge` flag (`make_llm_semantic_judge`),
  which asks an OpenAI-compatible model whether two findings' `summary` text
  describes the same underlying defect, once path/line/category above already
  hold. **Off by default** — it adds API cost/latency and non-determinism,
  which would make the Seeded-set hard release gates in §4 flaky. Enable it
  for Gold-set soft-target scoring (§4) where that trade-off is acceptable;
  leave it off for Seeded-set hard-gate runs.

## 3.2 Seeded Metrics

- Must-Find Recall: detected_must_find / all_must_find
- Critical Miss Rate: missed_critical / all_critical
- False Positive Rate (seeded): non_seeded_flags / all_agent_issues
- LLM Adoption Rate (`generation_source`): `llm` count / all seeded items,
  reported overall and broken down by `rule_id`. Computed from the
  `generation_source` field each `seeded_set.jsonl` row already carries (see
  [docs/eval-seeded-mutation-injection-design.md](../docs/eval-seeded-mutation-injection-design.md)
  §3.2.7/§7.7). Measures how often Phase 2 (LLM mutation generation +
  deterministic post-generation checks) is actually adopted versus falling
  back to Phase 1's deterministic logic — a low rate means the R1/R3
  improvement Phase 2 was built for (§3.2 of the design doc) isn't being
  realized. No fixed threshold is set here; per Issue #131 this is
  reported per rebuild and a numeric target is agreed once baseline data
  after the §7.4.2 catalog fix is available.

  Reported as a soft observability metric, not a Hard/Domain hard gate
  (§4): unlike Must-Find Recall/Critical Miss Rate, a low adoption rate
  does not by itself indicate a wrong or unsafe Seeded item — Phase 1
  fallback items remain valid must-find labels (§3.2.3, "both are
  expected, not an error").

## 3.3 Operational Metrics

- P95 Latency per PR
- Total Token Cost per PR
- Tool Failure Rate
- Timeout Rate

## 4. Release Gates

Use hard gates plus soft targets.

Hard gates:

- Critical Miss Rate = 0 on Seeded set
- Must-Find Recall >= 0.95 on Seeded set

Domain hard gates:

- Security Must-Find Recall >= 0.98 for critical/high in ui-library and application subsets
- XSS/injection must-find misses must be 0 in frontend application samples

Soft targets:

- Gold Issue Recall >= 0.70
- Gold Issue Precision >= 0.60
- Severity Agreement >= 0.70
- P95 Latency <= 120 seconds

## 5. Evaluation Workflow

**評価パスの前提（2026-06-27 更新）**:

Gold set は `evaluate_gold_item()` を通じてオーケストレータ経由でパイプライン全体を実行する。
Seeded set は `evaluate_seeded_item()` でセード変異を注入するため個別エンドポイントを呼ぶ。
PR の diff が閾値（`CODE_REVIEW_PATCH_TOTAL_CHAR_LIMIT` chars・`CODE_REVIEW_PATCH_MAX_FILES` ファイル、
デフォルト 30,000 chars・30 ファイル）以内の場合、両評価パスのレビュアーは
`PRInfoResult.file_changes` に含まれる patch を参照する（GitHub MCP フェッチは発生しない）。
閾値超過の PR は引き続き `patch=None` にフォールバックし、レビュアーが MCP フェッチを行う。

**設計上の既知の制限（行番号精度）**: `_build_prompt` が付与する行番号アノテーション（`+L{N}:` 形式）は
`PRInfoResult.file_changes` に含まれる patch にのみ適用される。
レビュアーが実行中に GitHub MCP 経由でオンデマンド取得したパッチはアノテーション対象外のため、
エージェントが報告する行番号が実ファイル行番号と一致しない場合がある。
この問題は `patch=None` フォールバック時（閾値超過 PR）でのみ発生する。
評価上の影響: line tolerance (±5) を超える行番号ズレが生じ、Gold set のマッチングが失敗しうる。

### 5.1 Offline Weekly Run

1. Rebuild Gold snapshots from selected PRs
2. Rebuild Seeded samples from mutation catalog
3. Run agent pipeline on all samples
4. Score using evaluator script
5. Publish report and failures

### 5.2 Online Monitoring (after deployment)

Collect live traces and add sampled failures back into Gold pool.

## 6. Human Annotation Rules

When normalizing human comments, annotate each finding with:

- category: correctness | security | performance | maintainability | style
- severity: critical | high | medium | low
- evidence: path + line + original comment URL

If severity is unclear, set severity to unknown and exclude from Severity Agreement denominator.

## 7. Why This Hybrid Works

- Gold only is realistic but noisy
- Seeded only is deterministic but narrow
- Combined approach gives both realism and safety guarantees
