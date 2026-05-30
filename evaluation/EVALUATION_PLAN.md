# Code Review Agent Evaluation Plan

## 1. Goals

This project uses a three-agent review flow:

1. Technical reviewer
2. Security reviewer
3. Lead engineer selector

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

- Ruby on Rails application repositories
- Front-end primary repositories (React/Vue/Svelte)
- Spring Boot based repositories (including enterprise templates such as TERASOLUNA-like stacks)

Target product domain:

- Business applications and B2B2C services

### 2.0 Domain Coverage Policy

Maintain balanced coverage in both Gold and Seeded sets:

- 30% Rails
- 30% Spring Boot
- 40% Front-end (React/Vue/Svelte combined)

Within each stack, include at least:

- 40% security-relevant PRs
- 30% correctness or transaction consistency PRs
- 30% performance or maintainability PRs

### 2.1 Gold PR Set

Definition:

- Real GitHub pull requests with review comments from humans
- Source of truth is normalized from review threads and comments

Purpose:

- Approximation to real review behavior
- Measure precision/recall and severity alignment

Additional recommendation for B2B2C:

- Prefer PRs touching authn/authz, tenant isolation, billing, PII handling, audit logging, and workflow state transitions.

### 2.2 Seeded Set

Definition:

- Synthetic diffs with intentionally injected defects
- Each sample has explicit must-find labels

Purpose:

- Deterministic gate for critical miss prevention
- CI-friendly acceptance criteria

Must include stack-specific traps:

- Rails: mass assignment, SQL interpolation, N+1 queries
- Spring Boot: missing authorization annotations, missing transaction boundaries, sensitive logging
- Front-end: XSS vectors, unsafe dynamic HTML, heavy sequential API calls
- B2B2C common: IDOR/tenant boundary bypass patterns

## 3. Metrics

## 3.1 Gold Metrics

- Issue Recall: matched_gold_issues / all_gold_issues
- Issue Precision: matched_gold_issues / all_agent_issues
- Severity Agreement: matched_severity / matched_gold_issues
- Location Hit Rate: matched_file_line / matched_gold_issues
- Decision Agreement (lead): decisions_matching_human / all_decisions

Matching rule:

- File path must match exactly
- Line tolerance: plus/minus 5 lines
- Semantic match judged by rubric categories

## 3.2 Seeded Metrics

- Must-Find Recall: detected_must_find / all_must_find
- Critical Miss Rate: missed_critical / all_critical
- False Positive Rate (seeded): non_seeded_flags / all_agent_issues

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

- Security Must-Find Recall >= 0.98 for critical/high in Rails and Spring Boot subsets
- Tenant-isolation related misses must be 0 in B2B2C-tagged samples

Soft targets:

- Gold Issue Recall >= 0.70
- Gold Issue Precision >= 0.60
- Severity Agreement >= 0.70
- P95 Latency <= 120 seconds

## 5. Evaluation Workflow

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
