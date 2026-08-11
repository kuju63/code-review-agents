import { z } from "zod";

export const HealthRequestSchema = z.object({});
export type HealthRequest = z.infer<typeof HealthRequestSchema>;
