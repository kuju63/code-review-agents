import { PRInfoResultSchema } from "@code-review-agent/agent-core";
import { z } from "zod";

export const ReviewerSkillInputSchema = z.object({
  prInfo: PRInfoResultSchema,
  modelId: z.string().optional(),
});
export type ReviewerSkillInput = z.infer<typeof ReviewerSkillInputSchema>;

export type {
  AgentCardHttpRequest as ReviewerAgentCardRequest,
  GetTaskHttpRequest as ReviewerGetTaskRequest,
  SendTaskHttpRequest as ReviewerSendTaskRequest,
} from "../a2a/request.model.js";
export {
  AgentCardHttpRequestSchema as ReviewerAgentCardRequestSchema,
  GetTaskHttpRequestSchema as ReviewerGetTaskRequestSchema,
  SendTaskHttpRequestSchema as ReviewerSendTaskRequestSchema,
} from "../a2a/request.model.js";
