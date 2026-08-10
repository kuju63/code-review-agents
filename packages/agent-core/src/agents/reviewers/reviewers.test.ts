import { describe, expect, it } from "vitest";
import { ProjectType, ReviewPerspective } from "../../models/review.js";
import { AgentSkillType } from "../../skills/agent-skills-factory.js";
import { composeSystemPrompt, STRUCTURED_OUTPUT_DIRECTIVE } from "../base-reviewer.js";
import { AngularReviewer } from "./angular.js";
import { ReactReviewer } from "./react.js";
import { SecurityReviewer } from "./security.js";
import { VueReviewer } from "./vue.js";

const reviewers = [
  {
    name: "ReactReviewer",
    Reviewer: ReactReviewer,
    reviewerId: "react-technical",
    perspective: ReviewPerspective.enum.TECHNICAL,
    projectTypes: [ProjectType.enum.REACT_TS],
    skillType: AgentSkillType.REACT_REVIEW,
    promptKeywords: ["front-end"],
  },
  {
    name: "AngularReviewer",
    Reviewer: AngularReviewer,
    reviewerId: "angular-technical",
    perspective: ReviewPerspective.enum.TECHNICAL,
    projectTypes: [ProjectType.enum.ANGULAR],
    skillType: AgentSkillType.ANGULAR_REVIEW,
    promptKeywords: ["Angular"],
  },
  {
    name: "VueReviewer",
    Reviewer: VueReviewer,
    reviewerId: "vue-technical",
    perspective: ReviewPerspective.enum.TECHNICAL,
    projectTypes: [ProjectType.enum.VUE],
    skillType: AgentSkillType.VUE_REVIEW,
    promptKeywords: ["Vue"],
  },
  {
    name: "SecurityReviewer",
    Reviewer: SecurityReviewer,
    reviewerId: "security",
    perspective: ReviewPerspective.enum.SECURITY,
    projectTypes: [
      ProjectType.enum.REACT_TS,
      ProjectType.enum.ANGULAR,
      ProjectType.enum.SVELTE,
      ProjectType.enum.VUE,
    ],
    skillType: AgentSkillType.WEB_SECURITY_REVIEW,
    promptKeywords: ["security"],
  },
] as const;

describe.each(reviewers)(
  "$name",
  ({ Reviewer, reviewerId, perspective, projectTypes, skillType, promptKeywords }) => {
    it("declares its static registry-selection metadata", () => {
      expect(Reviewer.reviewerId).toBe(reviewerId);
      expect(Reviewer.perspective).toBe(perspective);
      expect(Reviewer.projectTypes).toEqual(new Set(projectTypes));
    });

    it("declares the configured skill type", () => {
      const reviewer = new Reviewer({ githubToken: "gh-token" });
      // biome-ignore lint/suspicious/noExplicitAny: reaching a protected field for a metadata assertion
      expect((reviewer as any).skillType).toBe(skillType);
    });

    it("mentions the reviewer's domain in its system prompt", () => {
      const reviewer = new Reviewer({ githubToken: "gh-token" });
      // biome-ignore lint/suspicious/noExplicitAny: reaching a protected field for a metadata assertion
      const systemPrompt: string = (reviewer as any).systemPrompt;
      for (const keyword of promptKeywords) {
        expect(systemPrompt).toContain(keyword);
      }
    });

    it("includes the shared structured-output directive when composed", () => {
      const reviewer = new Reviewer({ githubToken: "gh-token" });
      // biome-ignore lint/suspicious/noExplicitAny: reaching a protected field for a metadata assertion
      const composed = composeSystemPrompt((reviewer as any).systemPrompt);
      expect(composed).toContain(STRUCTURED_OUTPUT_DIRECTIVE);
    });
  },
);

describe("SecurityReviewer", () => {
  it("enables url fetching", () => {
    const reviewer = new SecurityReviewer({ githubToken: "gh-token" });
    // biome-ignore lint/suspicious/noExplicitAny: reaching a protected field for a metadata assertion
    expect((reviewer as any).usesUrlFetch).toBe(true);
  });
});
