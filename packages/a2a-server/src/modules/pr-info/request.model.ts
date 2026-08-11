import { z } from "zod";

export const CollectPrInfoInputSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  prNumber: z.number().int(),
  modelId: z.string().default("gpt-4o"),
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
