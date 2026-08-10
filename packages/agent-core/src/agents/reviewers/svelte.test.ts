import { describe, expect, it, vi } from "vitest";
import type { ReviewContext, ReviewResult } from "../../models/review.js";
import { ProjectType, ReviewPerspective } from "../../models/review.js";
import { AgentSkillType } from "../../skills/agent-skills-factory.js";
import { LLMReviewAgent } from "../base-reviewer.js";
import { SvelteReviewer } from "./svelte.js";

function makeContext(fileChanges: { filePath: string; patch: string | null }[]): ReviewContext {
  return {
    prInfo: {
      repositoryInfo: { owner: "octocat", repository: "hello" },
      projectSummary: "A demo repo",
      prInfo: { title: "Add feature", prNumber: 1, body: null, labels: [], fileChanges },
      dependencyFiles: [],
      manifestContents: {},
    },
  };
}

describe("SvelteReviewer", () => {
  it("declares its static registry-selection metadata", () => {
    expect(SvelteReviewer.reviewerId).toBe("svelte-technical");
    expect(SvelteReviewer.perspective).toBe(ReviewPerspective.enum.TECHNICAL);
    expect(SvelteReviewer.projectTypes).toEqual(new Set([ProjectType.enum.SVELTE]));
  });

  it("declares the Svelte skill type", () => {
    const reviewer = new SvelteReviewer({ githubToken: "gh-token" });
    // biome-ignore lint/suspicious/noExplicitAny: reaching a protected field for a metadata assertion
    expect((reviewer as any).skillType).toBe(AgentSkillType.SVELTE_REVIEW);
  });

  it("returns an empty result without invoking the LLM for a non-Svelte PR", async () => {
    const superReview = vi.spyOn(LLMReviewAgent.prototype, "review");
    const reviewer = new SvelteReviewer({ githubToken: "gh-token" });

    const context = makeContext([{ filePath: "src/App.tsx", patch: null }]);
    const result = await reviewer.review(context, ProjectType.enum.SVELTE);

    expect(superReview).not.toHaveBeenCalled();
    expect(result).toEqual({
      reviewerId: "svelte-technical",
      perspective: ReviewPerspective.enum.TECHNICAL,
      projectType: ProjectType.enum.SVELTE,
      output: {
        summary: "Not a Svelte project; no Svelte review performed.",
        findings: [],
      },
    });

    superReview.mockRestore();
  });

  it("delegates to LLMReviewAgent.review for a Svelte PR", async () => {
    const sentinel: ReviewResult = {
      reviewerId: "svelte-technical",
      perspective: ReviewPerspective.enum.TECHNICAL,
      projectType: null,
      output: { summary: "looks fine", findings: [] },
    };
    const superReview = vi.spyOn(LLMReviewAgent.prototype, "review").mockResolvedValue(sentinel);
    const reviewer = new SvelteReviewer({ githubToken: "gh-token" });

    const context = makeContext([{ filePath: "src/App.svelte", patch: null }]);
    const result = await reviewer.review(context, ProjectType.enum.SVELTE);

    expect(superReview).toHaveBeenCalledTimes(1);
    expect(superReview).toHaveBeenCalledWith(context, ProjectType.enum.SVELTE);
    expect(result).toBe(sentinel);

    superReview.mockRestore();
  });

  it("re-detects the project type from PR info rather than trusting the passed-in projectType", async () => {
    const superReview = vi.spyOn(LLMReviewAgent.prototype, "review");
    const reviewer = new SvelteReviewer({ githubToken: "gh-token" });

    // projectType argument claims Svelte, but the actual file changes do not.
    const context = makeContext([{ filePath: "src/App.tsx", patch: null }]);
    await reviewer.review(context, ProjectType.enum.SVELTE);

    expect(superReview).not.toHaveBeenCalled();

    superReview.mockRestore();
  });
});
