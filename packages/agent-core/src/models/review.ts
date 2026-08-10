import type { McpClient } from "@strands-agents/sdk";
import { z } from "zod";
import type { PRInfoResult } from "./pr-info.js";

/**
 * Project technology stack a reviewer applies to.
 *
 * REACT_TS, ANGULAR, SVELTE, and VUE are wired to concrete reviewers and
 * automatic detection. The remaining members reserve schema-stable
 * extension points for future stacks.
 */
export const ProjectType = z.enum({
  REACT_TS: "react_ts",
  ANGULAR: "angular",
  SVELTE: "svelte",
  VUE: "vue",
  SPRING_BOOT: "spring_boot",
  NEXTJS: "nextjs",
  NUXT: "nuxt",
  WASM: "wasm",
});
export type ProjectType = z.infer<typeof ProjectType>;

/**
 * The lens a reviewer evaluates a change through.
 *
 * TECHNICAL and SECURITY are implemented; the consistency perspectives are
 * declared for future reviewers that will also consume spec or requirement
 * inputs via ReviewContext.
 */
export const ReviewPerspective = z.enum({
  TECHNICAL: "technical",
  SECURITY: "security",
  SPEC_CONSISTENCY: "spec_consistency",
  REQUIREMENTS_CONSISTENCY: "requirements_consistency",
});
export type ReviewPerspective = z.infer<typeof ReviewPerspective>;

/** Severity/priority assigned to an individual finding. */
export const ReviewPriority = z.enum({
  CRITICAL: "critical",
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
});
export type ReviewPriority = z.infer<typeof ReviewPriority>;

/** A single issue raised by a reviewer. */
export const ReviewFindingSchema = z.object({
  filePath: z.string().nullable().default(null),
  line: z.number().int().nullable().default(null),
  comment: z.string(),
  context: z.string().nullable().default(null),
  proposedFix: z.string().nullable().default(null),
  priority: ReviewPriority,
});
export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;

/**
 * The free-form review payload an LLM reviewer produces.
 *
 * This is the schema passed to the structured-output call; it intentionally
 * excludes reviewer metadata, which the reviewer attaches afterwards in
 * ReviewResult.
 */
export const ReviewOutputSchema = z.object({
  summary: z.string(),
  findings: z.array(ReviewFindingSchema).default([]),
});
export type ReviewOutput = z.infer<typeof ReviewOutputSchema>;

/**
 * Input passed to every reviewer.
 *
 * Wraps the PR Info Collector output. `sharedMcpClient` is injected in-process
 * by the review orchestrator and never crosses a JSON boundary, so unlike the
 * other models in this module it is a plain interface, not a Zod schema (see
 * docs/typescript-models-migration-spec.md §2.5).
 */
export interface ReviewContext {
  prInfo: PRInfoResult;
  sharedMcpClient?: McpClient;
}

/** A reviewer's output annotated with its identity and scope. */
export const ReviewResultSchema = z.object({
  reviewerId: z.string(),
  perspective: ReviewPerspective,
  projectType: ProjectType.nullable().default(null),
  output: ReviewOutputSchema,
});
export type ReviewResult = z.infer<typeof ReviewResultSchema>;

/** Record of a reviewer that failed, kept isolated from successes. */
export const ReviewErrorSchema = z.object({
  reviewerId: z.string(),
  perspective: ReviewPerspective,
  message: z.string(),
});
export type ReviewError = z.infer<typeof ReviewErrorSchema>;

/**
 * Aggregated output of the parallel review stage.
 *
 * This is the hand-off to the downstream Lead Engineer synthesis agent.
 */
export const ReviewReportSchema = z.object({
  results: z.array(ReviewResultSchema).default([]),
  errors: z.array(ReviewErrorSchema).default([]),
});
export type ReviewReport = z.infer<typeof ReviewReportSchema>;
