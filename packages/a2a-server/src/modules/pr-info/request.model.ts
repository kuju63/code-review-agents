import { z } from "zod";

export const CollectPrInfoInputSchema = z.object({
  owner: z.string().trim().min(1),
  repo: z.string().trim().min(1),
  prNumber: z.number().int().positive(),
  modelId: z.string().trim().min(1).optional(),
});
export type CollectPrInfoInput = z.infer<typeof CollectPrInfoInputSchema>;

export type {
  AgentCardHttpRequest as PrInfoAgentCardRequest,
  GetTaskHttpRequest as PrInfoGetTaskRequest,
  SendTaskHttpRequest as PrInfoSendTaskRequest,
} from "../a2a/request.model.js";
export {
  AgentCardHttpRequestSchema as PrInfoAgentCardRequestSchema,
  GetTaskHttpRequestSchema as PrInfoGetTaskRequestSchema,
  SendTaskHttpRequestSchema as PrInfoSendTaskRequestSchema,
} from "../a2a/request.model.js";
