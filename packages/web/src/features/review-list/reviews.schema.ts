import { z } from "zod";

/**
 * Client-side mirror of the subset of `docs/openapi/reviews.yaml` that SCR-01
 * consumes. Deliberately does not import `packages/web-api`'s schema module —
 * that package has no `main`/`exports`/`types` field for Vite to resolve, and
 * the contract's source of truth is `reviews.yaml` itself, which both sides
 * implement independently.
 */
export const ReviewStatusSchema = z.enum([
  "not_started",
  "analyzing",
  "waiting",
  "completed",
  "error",
]);

export const PrStateSchema = z.enum(["open", "closed", "merged"]);

export const CommentCountsSchema = z.object({
  total: z.number().int().min(0),
  open: z.number().int().min(0),
  resolved: z.number().int().min(0),
  falsePositive: z.number().int().min(0),
});

export const ReviewSchema = z.object({
  reviewId: z.string(),
  organization: z.string(),
  repository: z.string(),
  pullRequest: z.number().int().min(1),
  title: z.string().nullable(),
  branch: z.string().nullable(),
  prState: PrStateSchema,
  reviewStatus: ReviewStatusSchema,
  commentCounts: CommentCountsSchema,
  updatedAt: z.string(),
});

export const PageInfoSchema = z.object({
  page: z.number().int().min(1),
  perPage: z.number().int().min(1),
  totalItems: z.number().int().min(0),
  totalPages: z.number().int().min(0),
});

export const ReviewListResponseSchema = z.object({
  apiVersion: z.string(),
  items: z.array(ReviewSchema),
  pageInfo: PageInfoSchema,
});

export type ReviewStatus = z.infer<typeof ReviewStatusSchema>;
export type PrState = z.infer<typeof PrStateSchema>;
export type CommentCounts = z.infer<typeof CommentCountsSchema>;
export type Review = z.infer<typeof ReviewSchema>;
export type PageInfo = z.infer<typeof PageInfoSchema>;
export type ReviewListResponse = z.infer<typeof ReviewListResponseSchema>;
