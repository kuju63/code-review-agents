# React/Angular Agent Skills Review Accuracy Spec

## 1. Purpose

Improve the review accuracy of the parallel review stage by adding authoritative Agent Skills for React and Angular while preserving the existing reviewer registry extension model.

The change has two independent goals:

1. Strengthen React/Next.js technical review with Vercel-provided React skills.
2. Split Angular technical review into its own project type and reviewer so Angular guidance does not rely on the current coarse React/TypeScript detection path.

Implementation plan (operating constraints, TDD cycle): [docs/plan/react-angular-agent-skills-spec.md](plan/react-angular-agent-skills-spec.md).

## 2. Current State

> This section describes the state before the change. The reviewer has since
> been renamed `FrontendReviewer` → `ReactReviewer` and the skill type
> `FRONTEND_REVIEW` → `REACT_REVIEW` (see
> [docs/plan/seeded-reviewer-stack-routing-spec.md](plan/seeded-reviewer-stack-routing-spec.md) §5).

The current implementation has one technical frontend reviewer, `FrontendReviewer`, that loads `AgentSkillType.FRONTEND_REVIEW`. That skill bundle contains generic frontend review skills:

- `reviewing-universal`
- `reviewing-languages`
- `reviewing-frameworks`
- `reviewing-metaframeworks`

The project type detector currently treats TypeScript/JavaScript changes or `package.json` as `ProjectType.REACT_TS`. This is useful for React but too coarse for Angular because Angular projects also use TypeScript and `package.json`.

## 3. Target Behavior

### 3.1 React Skill Enhancement

`AgentSkillType.FRONTEND_REVIEW` must include the existing four frontend skills and the following Vercel-provided skills:

- `vercel-react-best-practices`
- `vercel-composition-patterns`

These skills must be vendored under `packages/agent-core/skills/` with their rule files so the Strands AgentSkills progressive-disclosure flow can load detailed rules via `file_read` only when needed.

### 3.2 Angular Skill Separation

Angular must be represented as a separate project type:

- `ProjectType.ANGULAR = "angular"`

A new `AngularReviewer` must be registered for `ProjectType.ANGULAR` with technical perspective and an Angular-specific skill bundle.

The Angular skill bundle must include:

- `reviewing-universal`
- `reviewing-languages`
- `reviewing-frameworks`
- `angular-developer`

The `angular-developer` skill must be vendored from the official Angular repository. Its references must remain available, but the top-level `SKILL.md` must be adapted for review usage so code-generation-only instructions such as project creation or `ng build` execution do not become runtime instructions for the review agent.

### 3.3 Angular-First Detection

Angular detection must take priority over the existing React/TypeScript heuristic.

The detector must classify a PR as Angular when either of these signals is present:

- `angular.json` exists in repository-level dependency files or appears in changed files.
- Changed file paths include Angular naming conventions such as `.component.ts`, `.service.ts`, `.directive.ts`, or `.pipe.ts`.

When Angular is detected, `ProjectType.REACT_TS` must not be added by the coarse TypeScript/JavaScript or `package.json` heuristic. This avoids routing Angular PRs through React-specific technical review.

This intentionally accepts a known tradeoff: mixed React/Angular monorepos may be routed to Angular when Angular signals are present. This is acceptable for the current feature because the existing React detection is coarse and the user explicitly prefers Angular priority for now.

### 3.4 Security Reviewer Coverage

The existing security reviewer must also apply to `ProjectType.ANGULAR` because web security review is framework-cross-cutting.

## 4. Vendored Skill Sources

The following upstream skills must be vendored with source and license attribution:

| Skill | Upstream repository | License | Local directory |
| --- | --- | --- | --- |
| `vercel-react-best-practices` | `vercel-labs/agent-skills` | MIT | `packages/agent-core/skills/vercel-react-best-practices/` |
| `vercel-composition-patterns` | `vercel-labs/agent-skills` | MIT | `packages/agent-core/skills/vercel-composition-patterns/` |
| `angular-developer` | `angular/angular` | MIT | `packages/agent-core/skills/angular-developer/` |

Each local skill directory must keep its directory name aligned with the `name` field in `SKILL.md`, because `Skill.from_file()` validates that relationship.

Test plan and validation commands: [docs/plan/react-angular-agent-skills-spec.md](plan/react-angular-agent-skills-spec.md).

## 5. Future Change Points

> The `package.json`-content-based enhancement described below was implemented
> under Issue #230 (see [docs/review-agents-design.md](review-agents-design.md) §5).
> `detectProjectTypes()` now checks `manifestContents` for `@angular/core` as a
> fallback tier, in addition to file-name and `angular.json` signals.

React and Angular can later be split further by metaframework or workspace layout if evaluation data shows the current project-type granularity is insufficient.
