import { resolve } from "node:path";
import { AgentSkills } from "@strands-agents/sdk/vended-plugins/skills";

/**
 * The skill bundle assets (`SKILL.md`, references) live under
 * `packages/agent-core/skills/`. They used to live under the Python-owned
 * `src/code_review_agent/skills/` and were moved here as part of Issue
 * #255 (removal of the legacy Python assets); see
 * typescript-agents-tools-migration-spec.md section 2.6 for the original
 * decision and its supersession note.
 */
export const SKILLS_DIR = resolve(import.meta.dirname, "../../skills");

function skillPath(name: string): string {
  return resolve(SKILLS_DIR, name);
}

/** Skill bundles available to LLM-backed reviewers. */
export type AgentSkillType =
  | ""
  | "react_review"
  | "web_security_review"
  | "angular_review"
  | "svelte_review"
  | "vue_review";

export const AgentSkillType = {
  NONE: "",
  REACT_REVIEW: "react_review",
  WEB_SECURITY_REVIEW: "web_security_review",
  ANGULAR_REVIEW: "angular_review",
  SVELTE_REVIEW: "svelte_review",
  VUE_REVIEW: "vue_review",
} as const satisfies Record<string, AgentSkillType>;

/**
 * The bundle combines the project's generic frontend review skills with
 * Vercel's React/Next.js skills so the reviewer can apply React-specific
 * performance and composition guidance in addition to framework-agnostic
 * checks.
 */
function buildReactReviewSkills(): string[] {
  return [
    skillPath("reviewing-universal"),
    skillPath("reviewing-languages"),
    skillPath("reviewing-frameworks"),
    skillPath("reviewing-metaframeworks"),
    skillPath("vercel-react-best-practices"),
    skillPath("vercel-composition-patterns"),
  ];
}

/**
 * The bundle pairs the project's generic frontend and language review
 * skills with Angular's official `angular-developer` skill so
 * Angular-specific review criteria are applied without routing Angular
 * changes through the React-oriented reviewer.
 */
function buildAngularReviewSkills(): string[] {
  return [
    skillPath("reviewing-universal"),
    skillPath("reviewing-languages"),
    skillPath("reviewing-frameworks"),
    skillPath("angular-developer"),
  ];
}

/**
 * The bundle pairs the project's generic frontend and language review
 * skills with Svelte's official `svelte-core-bestpractices` skill so
 * Svelte-specific review criteria are applied without routing Svelte
 * changes through the React-oriented reviewer.
 */
function buildSvelteReviewSkills(): string[] {
  return [
    skillPath("reviewing-universal"),
    skillPath("reviewing-languages"),
    skillPath("reviewing-frameworks"),
    skillPath("svelte-core-bestpractices"),
  ];
}

/**
 * Unlike Angular and Svelte, no official Vue skill package is vendored yet
 * (tracked as a follow-up, see docs/seeded-reviewer-stack-routing-spec.md
 * section 4); the bundle relies on the project's generic frontend and
 * language review skills, whose `reviewing-frameworks` bundle already
 * documents Vue-specific conventions.
 */
function buildVueReviewSkills(): string[] {
  return [
    skillPath("reviewing-universal"),
    skillPath("reviewing-languages"),
    skillPath("reviewing-frameworks"),
  ];
}

function buildWebSecurityReviewSkills(): string[] {
  return [skillPath("reviewing-web-security")];
}

/** Create an AgentSkills plugin for a reviewer skill bundle. */
export function createAgentSkills(skillType: AgentSkillType = AgentSkillType.NONE): AgentSkills {
  let skills: string[] = [];
  switch (skillType) {
    case AgentSkillType.REACT_REVIEW:
      skills = buildReactReviewSkills();
      break;
    case AgentSkillType.ANGULAR_REVIEW:
      skills = buildAngularReviewSkills();
      break;
    case AgentSkillType.SVELTE_REVIEW:
      skills = buildSvelteReviewSkills();
      break;
    case AgentSkillType.VUE_REVIEW:
      skills = buildVueReviewSkills();
      break;
    case AgentSkillType.WEB_SECURITY_REVIEW:
      skills = buildWebSecurityReviewSkills();
      break;
    case AgentSkillType.NONE:
      skills = [];
      break;
  }

  return new AgentSkills({ skills });
}
