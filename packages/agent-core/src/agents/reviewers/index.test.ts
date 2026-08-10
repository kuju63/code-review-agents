import { describe, expect, it } from "vitest";
import { getRegisteredReviewers } from "../registry.js";
import {
  AngularReviewer,
  ReactReviewer,
  SecurityReviewer,
  SvelteReviewer,
  VueReviewer,
} from "./index.js";

describe("reviewers barrel", () => {
  it("registers every reviewer exactly once as an import side effect", () => {
    const reviewerIds = getRegisteredReviewers().map((cls) => cls.reviewerId);

    expect(reviewerIds).toHaveLength(5);
    expect(new Set(reviewerIds)).toEqual(
      new Set([
        "react-technical",
        "angular-technical",
        "vue-technical",
        "security",
        "svelte-technical",
      ]),
    );
  });

  it("re-exports every reviewer class", () => {
    expect(ReactReviewer.reviewerId).toBe("react-technical");
    expect(AngularReviewer.reviewerId).toBe("angular-technical");
    expect(VueReviewer.reviewerId).toBe("vue-technical");
    expect(SecurityReviewer.reviewerId).toBe("security");
    expect(SvelteReviewer.reviewerId).toBe("svelte-technical");
  });
});
