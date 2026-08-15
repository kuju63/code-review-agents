import { ReviewReportSchema } from "@code-review-agent/agent-core";
import { z } from "zod";

export const LeadEngineerSkillInputSchema = z.object({
  reviewReport: ReviewReportSchema,
  modelId: z.string().optional(),
});
export type LeadEngineerSkillInput = z.infer<typeof LeadEngineerSkillInputSchema>;

export type {
  AgentCardHttpRequest as LeadEngineerAgentCardRequest,
  GetTaskHttpRequest as LeadEngineerGetTaskRequest,
  SendTaskHttpRequest as LeadEngineerSendTaskRequest,
} from "../a2a/request.model.js";
export {
  AgentCardHttpRequestSchema as LeadEngineerAgentCardRequestSchema,
  GetTaskHttpRequestSchema as LeadEngineerGetTaskRequestSchema,
  SendTaskHttpRequestSchema as LeadEngineerSendTaskRequestSchema,
} from "../a2a/request.model.js";
