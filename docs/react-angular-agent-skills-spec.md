# React/Angular Agent Skills Review Accuracy Spec

## 1. Purpose

Improve the review accuracy of the parallel review stage by adding authoritative Agent Skills for React and Angular while preserving the existing reviewer registry extension model.

The change has two independent goals:

1. Strengthen React/Next.js technical review with Vercel-provided React skills.
2. Split Angular technical review into its own project type and reviewer so Angular guidance does not rely on the current coarse React/TypeScript detection path.

## 2. Operating Constraints

All implementation work for this feature must happen in a dedicated Git worktree under `.claude/worktrees/`.

Documentation must be written and committed before implementation starts. Commits must be split at logical rollback points:

1. Spec baseline.
2. Empty implementation stubs plus Red tests.
3. Minimal Green implementation.
4. Refactor plus final validation.

The TDD cycle for this feature must use an empty implementation before running the Red tests. The required order is:

1. Create empty implementation stubs.
2. Add tests that describe the intended behavior.
3. Run tests and confirm they fail against the stubs.
4. Implement the minimum behavior to pass.
5. Run tests and confirm Green.
6. Refactor while preserving behavior.
7. Re-run validation.

Any new or updated Python docstring must use Google Style.

## 3. Current State

The current implementation has one technical frontend reviewer, `FrontendReviewer`, that loads `AgentSkillType.FRONTEND_REVIEW`. That skill bundle contains generic frontend review skills:

- `reviewing-universal`
- `reviewing-languages`
- `reviewing-frameworks`
- `reviewing-metaframeworks`

The project type detector currently treats TypeScript/JavaScript changes or `package.json` as `ProjectType.REACT_TS`. This is useful for React but too coarse for Angular because Angular projects also use TypeScript and `package.json`.

## 4. Target Behavior

### 4.1 React Skill Enhancement

`AgentSkillType.FRONTEND_REVIEW` must include the existing four frontend skills and the following Vercel-provided skills:

- `vercel-react-best-practices`
- `vercel-composition-patterns`

These skills must be vendored under `src/code_review_agent/skills/` with their rule files so the Strands AgentSkills progressive-disclosure flow can load detailed rules via `file_read` only when needed.

### 4.2 Angular Skill Separation

Angular must be represented as a separate project type:

- `ProjectType.ANGULAR = "angular"`

A new `AngularReviewer` must be registered for `ProjectType.ANGULAR` with technical perspective and an Angular-specific skill bundle.

The Angular skill bundle must include:

- `reviewing-universal`
- `reviewing-languages`
- `reviewing-frameworks`
- `angular-developer`

The `angular-developer` skill must be vendored from the official Angular repository. Its references must remain available, but the top-level `SKILL.md` must be adapted for review usage so code-generation-only instructions such as project creation or `ng build` execution do not become runtime instructions for the review agent.

### 4.3 Angular-First Detection

Angular detection must take priority over the existing React/TypeScript heuristic.

The detector must classify a PR as Angular when either of these signals is present:

- `angular.json` exists in repository-level dependency files or appears in changed files.
- Changed file paths include Angular naming conventions such as `.component.ts`, `.service.ts`, `.directive.ts`, or `.pipe.ts`.

When Angular is detected, `ProjectType.REACT_TS` must not be added by the coarse TypeScript/JavaScript or `package.json` heuristic. This avoids routing Angular PRs through React-specific technical review.

This intentionally accepts a known tradeoff: mixed React/Angular monorepos may be routed to Angular when Angular signals are present. This is acceptable for the current feature because the existing React detection is coarse and the user explicitly prefers Angular priority for now.

### 4.4 Security Reviewer Coverage

The existing security reviewer must also apply to `ProjectType.ANGULAR` because web security review is framework-cross-cutting.

## 5. Vendored Skill Sources

The following upstream skills must be vendored with source and license attribution:

| Skill | Upstream repository | License | Local directory |
| --- | --- | --- | --- |
| `vercel-react-best-practices` | `vercel-labs/agent-skills` | MIT | `src/code_review_agent/skills/vercel-react-best-practices/` |
| `vercel-composition-patterns` | `vercel-labs/agent-skills` | MIT | `src/code_review_agent/skills/vercel-composition-patterns/` |
| `angular-developer` | `angular/angular` | MIT | `src/code_review_agent/skills/angular-developer/` |

Each local skill directory must keep its directory name aligned with the `name` field in `SKILL.md`, because `Skill.from_file()` validates that relationship.

## 6. Tests

The feature is verified by unit tests covering these behaviors:

1. `AgentSkillType.FRONTEND_REVIEW` resolves six skills including both Vercel skills.
2. `AgentSkillType.ANGULAR_REVIEW` resolves Angular-specific skills including `angular-developer`.
3. `ProjectType.ANGULAR` exists and serializes as `"angular"`.
4. `detect_project_types()` returns Angular for `angular.json`.
5. `detect_project_types()` returns Angular for Angular file naming conventions.
6. Angular detection suppresses coarse React/TypeScript detection.
7. `AngularReviewer` is registered and selected for `ProjectType.ANGULAR`.
8. `SecurityReviewer` is selected for `ProjectType.ANGULAR`.
9. `PRInfoCollector` treats `angular.json` as a dependency file.

## 7. Validation

Final validation must run:

```bash
uv run pytest
uv run ruff check
uv run ruff format --check
```

Coverage must remain at or above 75% for the final quality gate.

## 8. Future Change Points

The Angular detector currently relies on file names and `angular.json` path signals because dependency file contents are not part of `PRInfoResult`. A future enhancement may parse `package.json` to detect `@angular/core` and reduce false negatives.

React and Angular can later be split further by metaframework or workspace layout if evaluation data shows the current project-type granularity is insufficient.
