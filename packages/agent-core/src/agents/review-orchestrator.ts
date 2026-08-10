/**
 * Parallel review orchestrator.
 *
 * Selects reviewers applicable to a PR (by project type / perspective
 * filter), runs them concurrently, and aggregates their output into a
 * `ReviewReport`. See docs/typescript-agents-tools-migration-spec.md
 * section 5 for the concurrency-model and reference-counting decisions this
 * implementation follows.
 */

import type { PRInfoResult } from "../models/pr-info.js";
import type {
  ProjectType,
  ReviewContext,
  ReviewError,
  ReviewPerspective,
  ReviewReport,
  ReviewResult,
} from "../models/review.js";
import { createGithubMcpClient, GITHUB_MCP_URL } from "../tools/github-mcp.js";
import { SharedMcpClient } from "../tools/shared-mcp-client.js";
import type { ReviewAgent, ReviewerClass, ReviewerConfig } from "./base-reviewer.js";
import { isInfraError } from "./exceptions.js";
import { detectProjectTypes, getReviewerClasses } from "./registry.js";
// Registration side effect: importing this barrel registers all built-in
// reviewers, mirroring Python's `agents/__init__.py`. The orchestrator is
// the sole real consumer that requires reviewers to be registered, so it
// owns this import rather than relying on caller ordering (spec doc 5.5).
import "./reviewers/index.js";

interface SelectedReviewer {
  reviewerClass: ReviewerClass;
  reviewer: ReviewAgent;
  projectType: ProjectType;
}

type ReviewOutcome =
  | { status: "success"; result: ReviewResult }
  | { status: "error"; error: unknown };

export class ReviewOrchestrator {
  constructor(private readonly config: ReviewerConfig) {}

  /**
   * Run every applicable reviewer concurrently and aggregate the results.
   *
   * A reviewer that does not settle before `config.reviewerTimeoutSeconds`
   * elapses is recorded as a timed-out `ReviewError` -- its underlying
   * `review()` call is never cancelled and keeps running in the background
   * (spec doc 5.1), still holding its shared-MCP-client reference until it
   * genuinely finishes. An error classified as infra by `isInfraError`
   * aborts the whole run instead of being isolated.
   */
  async run(
    context: ReviewContext,
    projectType?: ProjectType,
    perspectives?: Iterable<ReviewPerspective>,
  ): Promise<ReviewReport> {
    const selected = this.selectReviewers(context.prInfo, projectType, perspectives);
    if (selected.length === 0) {
      return { results: [], errors: [] };
    }

    let sharedClient: SharedMcpClient | undefined;
    let runContext = context;
    if (selected.some(({ reviewer }) => reviewer.needsGithubMcp)) {
      const rawClient = createGithubMcpClient(
        this.config.githubToken,
        this.config.mcpUrl ?? GITHUB_MCP_URL,
        {
          retryAttempts: this.config.mcpStartupRetryAttempts ?? 3,
          retryBackoffSeconds: this.config.mcpStartupRetryBackoffSeconds ?? 1,
        },
      );
      sharedClient = new SharedMcpClient(rawClient);
      sharedClient.addConsumer(this);
      try {
        // Connects once, up front, so concurrently-dispatched reviewers
        // never race to initialize the same client (spec doc 5.3).
        await rawClient.connect();
      } catch (error) {
        await sharedClient.removeConsumer(this);
        throw error;
      }
      runContext = { ...context, sharedMcpClient: rawClient };
    }

    const outcomes = new Map<SelectedReviewer, ReviewOutcome>();
    let settlers: Promise<void>[];
    try {
      settlers = selected.map((entry) => {
        const placeholder = sharedClient && entry.reviewer.needsGithubMcp ? {} : undefined;
        if (sharedClient && placeholder) {
          sharedClient.addConsumer(placeholder);
        }

        const reviewPromise = entry.reviewer.review(runContext, entry.projectType);

        if (sharedClient && placeholder) {
          // Released only once this specific review() call genuinely
          // settles -- not when a timeout gives up waiting on it -- so a
          // straggler keeps its reference alive until it truly finishes
          // (spec doc 5.1). `.catch()` prevents an unawaited rejection
          // (the original error, or a disconnect failure) from surfacing
          // as an unhandled rejection.
          reviewPromise
            .finally(() => sharedClient?.removeConsumer(placeholder))
            .catch(() => undefined);
        }

        return reviewPromise
          .then((result) => {
            outcomes.set(entry, { status: "success", result });
          })
          .catch((error: unknown) => {
            outcomes.set(entry, { status: "error", error });
          });
      });
    } finally {
      if (sharedClient) {
        await sharedClient.removeConsumer(this);
      }
    }

    const timeoutSeconds = this.config.reviewerTimeoutSeconds;
    if (timeoutSeconds != null) {
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<void>((resolve) => {
        timeoutHandle = setTimeout(resolve, timeoutSeconds * 1000);
      });
      await Promise.race([Promise.all(settlers), timeoutPromise]);
      clearTimeout(timeoutHandle);
    } else {
      await Promise.all(settlers);
    }

    const results: ReviewResult[] = [];
    const errors: ReviewError[] = [];
    for (const entry of selected) {
      const outcome = outcomes.get(entry);
      if (outcome === undefined) {
        errors.push({
          reviewerId: entry.reviewerClass.reviewerId,
          perspective: entry.reviewerClass.perspective,
          message: `Reviewer timed out after ${timeoutSeconds}s`,
        });
        continue;
      }
      if (outcome.status === "error") {
        if (isInfraError(outcome.error)) {
          throw outcome.error;
        }
        errors.push({
          reviewerId: entry.reviewerClass.reviewerId,
          perspective: entry.reviewerClass.perspective,
          message: outcome.error instanceof Error ? outcome.error.message : String(outcome.error),
        });
        continue;
      }
      results.push(outcome.result);
    }
    return { results, errors };
  }

  /**
   * Resolve the applicable reviewer classes and instantiate them.
   *
   * `detectProjectTypes` only ever returns zero or one project type (see
   * registry.ts), so unlike Python's `_select_reviewers` there is no
   * multi-type dedup to perform here (spec doc 5.8).
   */
  private selectReviewers(
    prInfo: PRInfoResult,
    projectType: ProjectType | undefined,
    perspectives: Iterable<ReviewPerspective> | undefined,
  ): SelectedReviewer[] {
    const resolvedType = projectType ?? [...detectProjectTypes(prInfo)][0];
    if (resolvedType === undefined) {
      return [];
    }
    return getReviewerClasses(resolvedType, perspectives).map((reviewerClass) => ({
      reviewerClass,
      reviewer: new reviewerClass(this.config),
      projectType: resolvedType,
    }));
  }
}
