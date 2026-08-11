import { z } from "zod";

export const HealthResponseSchema = z.object({
  status: z.literal("ok"),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const HealthHttpResponseSchema = z.object({
  status: z.literal(200),
  body: HealthResponseSchema,
});
export type HealthHttpResponse = z.infer<typeof HealthHttpResponseSchema>;
