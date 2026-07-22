# Svelte Agent Skills Review Accuracy Spec

## 1. Purpose

Improve the review accuracy of the parallel review stage for Svelte projects by
adding a dedicated Svelte technical reviewer backed by the official Svelte
`svelte-core-bestpractices` Agent Skill, while preserving the existing reviewer
registry extension model.

The change has three goals:

1. Add a Svelte project type and a Svelte-specific reviewer so Svelte guidance
   does not rely on the coarse React/TypeScript detection path.
2. Vendor the official `svelte-core-bestpractices` skill so the Strands
   AgentSkills progressive-disclosure flow can load detailed rules on demand.
3. Guarantee that when a PR is not a Svelte project, the Svelte reviewer returns
   no findings, so the downstream Lead Engineer agent is not fed irrelevant
   Svelte-specific input.

## 2. Operating Constraints

All implementation work for this feature happens in a dedicated Git worktree
under `.claude/worktrees/`.

Documentation is written and committed before implementation starts. Commits are
split at logical rollback points:

1. Spec baseline plus vendored skill.
2. Empty implementation stubs plus Red tests.
3. Minimal Green implementation.
4. Refactor plus final validation.

The TDD cycle for this feature uses an empty implementation before running the
Red tests. The required order is:

1. Create empty implementation stubs.
2. Add tests that describe the intended behavior.
3. Run tests and confirm they fail against the stubs.
4. Implement the minimum behavior to pass.
5. Run tests and confirm Green.
6. Refactor while preserving behavior.
7. Re-run validation.

Any new or updated Python docstring must use Google Style. No other docstring
format is permitted.

## 3. Current State

The parallel review stage has `FrontendReviewer` (React/TypeScript technical),
`AngularReviewer` (Angular technical), and `SecurityReviewer` (cross-cutting web
security). Project-type detection classifies TypeScript/JavaScript changes or
`package.json` as `ProjectType.REACT_TS`, with Angular taking priority when
`angular.json` or Angular naming conventions are present.

Svelte projects also use TypeScript and `package.json`, so without a dedicated
detection branch a Svelte PR would be misrouted to the React/TypeScript reviewer.

## 4. Target Behavior

### 4.1 Svelte Skill Bundle

A new `AgentSkillType.SVELTE_REVIEW` resolves the following skills:

- `reviewing-universal`
- `reviewing-languages`
- `reviewing-frameworks`
- `svelte-core-bestpractices`

This mirrors the Angular bundle structure, pairing the project's generic
frontend and language review skills with the framework-specific official skill.

### 4.2 Svelte Project Type and Reviewer

Svelte is represented as a separate project type:

- `ProjectType.SVELTE = "svelte"`

A new `SvelteReviewer` is registered for `ProjectType.SVELTE` with the technical
perspective and the `SVELTE_REVIEW` skill bundle.

### 4.3 Svelte Detection

Svelte detection runs after Angular and before the coarse React/TypeScript
heuristic. A PR is classified as Svelte when either signal is present:

- A `.svelte` file appears in changed files.
- A Svelte configuration file (`svelte.config.js` or `svelte.config.ts`) exists
  in repository-level dependency files or appears in changed files.

When Svelte is detected, `ProjectType.REACT_TS` must not be added by the coarse
TypeScript/JavaScript or `package.json` heuristic. This avoids routing Svelte
PRs through React-specific technical review. Angular retains priority over Svelte
in the rare event that both signal sets are present.

### 4.4 Non-Svelte Guard

The Svelte reviewer must produce no findings when the target PR is not a Svelte
project. `SvelteReviewer.review()` re-detects the project type from the PR
information and, when `ProjectType.SVELTE` is absent, returns an empty
`ReviewResult` without invoking the LLM.

This guard lives in the reviewer (not only in orchestrator selection) so the
guarantee holds even when the reviewer is invoked directly through its A2A
endpoint, where orchestrator-level project-type selection does not apply.

### 4.5 Security Reviewer Coverage

The existing security reviewer also applies to `ProjectType.SVELTE` because web
security review is framework-cross-cutting.

### 4.6 Dependency File Recognition

The PR Info Collector treats `svelte.config.js` and `svelte.config.ts` as
dependency files so repository-level Svelte configuration is available to the
detector and reviewers.

## 5. Vendored Skill Source

The upstream skill is vendored with source and license attribution:

| Skill | Upstream repository | License | Local directory |
| --- | --- | --- | --- |
| `svelte-core-bestpractices` | `sveltejs/ai-tools` | MIT | `src/code_review_agent/skills/svelte-core-bestpractices/` |

The local skill directory name is aligned with the `name` field in `SKILL.md`
because `Skill.from_file()` validates that relationship. Its `references` remain
available, but the top-level `SKILL.md` is adapted for review usage so
code-generation-oriented phrasing does not become runtime instructions for the
review agent.

## 6. Tests

The feature is verified by unit tests covering these behaviors:

1. `AgentSkillType.SVELTE_REVIEW` resolves four skills including
   `svelte-core-bestpractices`.
2. The vendored Svelte references are available on disk.
3. The vendored `SKILL.md` is adapted for review.
4. `ProjectType.SVELTE` exists and serializes as `"svelte"`.
5. `detect_project_types()` returns Svelte for a `.svelte` file change.
6. `detect_project_types()` returns Svelte for a `svelte.config.js`/`.ts` signal.
7. Svelte detection suppresses coarse React/TypeScript detection.
8. Angular detection retains priority over Svelte.
9. `SvelteReviewer` is registered and selected for `ProjectType.SVELTE`.
10. `SecurityReviewer` is selected for `ProjectType.SVELTE`.
11. `SvelteReviewer.review()` returns an empty result without invoking the LLM
    for a non-Svelte PR.
12. `PRInfoCollector` treats `svelte.config.js`/`.ts` as dependency files.

## 7. Validation

Final validation runs:

```bash
uv run pytest
uv run ruff check
uv run ruff format --check
```

Coverage must remain at or above 75% for the final quality gate.

## 8. Future Change Points

The Svelte detector relies on file names and configuration path signals because
dependency file contents are not part of `PRInfoResult`. A future enhancement may
parse `package.json` to detect `svelte` and reduce false negatives.

Svelte and SvelteKit may later be split by meta-framework if evaluation data
shows the current project-type granularity is insufficient.
