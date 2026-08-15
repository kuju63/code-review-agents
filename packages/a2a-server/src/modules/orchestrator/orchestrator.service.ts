import {
  type LeadEngineerReport,
  LeadEngineerReportSchema,
  type PRInfoResult,
  PRInfoResultSchema,
  type ReviewContext,
  type ReviewReport,
  ReviewReportSchema,
} from "@code-review-agent/agent-core";
import type { ReviewerConfig } from "@code-review-agent/agent-core/agents/base-reviewer.js";
import { LeadEngineerAgent } from "@code-review-agent/agent-core/agents/lead-engineer.js";
import { PRInfoCollector } from "@code-review-agent/agent-core/agents/pr-info-collector.js";
import { ReviewOrchestrator } from "@code-review-agent/agent-core/agents/review-orchestrator.js";
import { z } from "zod";
import type { A2AMessage, A2APart, A2ASendTaskRequest } from "../a2a/request.model.js";
import type { A2ASendTaskResponse, A2ATask, AgentCard } from "../a2a/response.model.js";
import { A2ATaskSchema } from "../a2a/response.model.js";
import { FullReviewInputSchema } from "./request.model.js";

export const ORCHESTRATOR_TASK_TTL_SECONDS = 1800;

type TaskIdFactory = () => string;
type ScheduleTask = (task: () => Promise<void>) => void;

export type PRInfoCollectorConfig = ConstructorParameters<typeof PRInfoCollector>[0];
export type PRInfoCollectorClass = new (
  config: PRInfoCollectorConfig,
) => {
  collect(owner: string, repo: string, prNumber: number): Promise<PRInfoResult>;
};

export type OrchestratorAgentClass = new (
  config: ReviewerConfig,
) => {
  run(context: ReviewContext): Promise<ReviewReport>;
};

export type LeadEngineerAgentClass = new (
  config: ReviewerConfig,
) => {
  evaluate(report: ReviewReport): Promise<LeadEngineerReport>;
};

export type A2AOrchestratorSettings = {
  modelId: string;
  llmBaseUrl?: string;
  providerType?: "openai" | "ollama";
  maxAgentTurns?: number;
  maxTokens?: number;
  frequencyPenalty?: number;
  reviewerTimeoutSeconds?: number;
  patchTotalCharLimit?: number;
  patchMaxFiles?: number;
  mcpStartupRetryAttempts?: number;
  mcpStartupRetryBackoffSeconds?: number;
  agentBaseUrl?: string;
  agentUrl?: string;
};

export const DEFAULT_ORCHESTRATOR_SETTINGS: A2AOrchestratorSettings = {
  modelId: "gpt-4o",
  agentBaseUrl: "http://localhost:3000",
};

export interface OrchestratorTaskStore {
  create(ownerPrincipalId: string): Promise<A2ATask>;
  get(taskId: string, ownerPrincipalId: string): Promise<A2ATask | null>;
  setWorking(taskId: string): Promise<void>;
  setCompleted(taskId: string, parts: A2APart[]): Promise<void>;
  setFailed(taskId: string, error: string): Promise<void>;
}

export class InMemoryOrchestratorTaskStore implements OrchestratorTaskStore {
  readonly ttlSeconds: number;
  private readonly store = new Map<string, A2ATask>();
  private readonly owners = new Map<string, string>();
  private readonly idFactory: TaskIdFactory;

  constructor({
    ttlSeconds = ORCHESTRATOR_TASK_TTL_SECONDS,
    idFactory = () => crypto.randomUUID(),
  }: { ttlSeconds?: number; idFactory?: TaskIdFactory } = {}) {
    this.ttlSeconds = ttlSeconds;
    this.idFactory = idFactory;
  }

  async create(ownerPrincipalId: string): Promise<A2ATask> {
    const task = A2ATaskSchema.parse({ id: this.idFactory(), status: "submitted" });
    this.store.set(task.id, task);
    this.owners.set(task.id, ownerPrincipalId);
    return task;
  }

  async get(taskId: string, ownerPrincipalId: string): Promise<A2ATask | null> {
    if (this.owners.get(taskId) !== ownerPrincipalId) {
      return null;
    }
    return this.store.get(taskId) ?? null;
  }

  async setWorking(taskId: string): Promise<void> {
    const task = this.store.get(taskId);
    if (task) {
      this.store.set(taskId, { ...task, status: "working" });
    }
  }

  async setCompleted(taskId: string, parts: A2APart[]): Promise<void> {
    const task = this.store.get(taskId);
    if (!task) {
      return;
    }
    this.store.set(taskId, {
      ...task,
      status: "completed",
      message: { role: "agent", parts },
    });
    this.scheduleDelete(taskId);
  }

  async setFailed(taskId: string, error: string): Promise<void> {
    const task = this.store.get(taskId);
    if (!task) {
      return;
    }
    this.store.set(taskId, { ...task, status: "failed", error });
    console.warn(`Task ${taskId} failed: ${error.split(/\r?\n/u).join("\\n")}`);
    this.scheduleDelete(taskId);
  }

  private scheduleDelete(taskId: string): void {
    setTimeout(() => {
      this.store.delete(taskId);
      this.owners.delete(taskId);
    }, this.ttlSeconds * 1000).unref?.();
  }
}

export interface OrchestratorService {
  getAgentCard(): AgentCard;
  sendTask(
    request: A2ASendTaskRequest,
    githubToken: string,
    ownerPrincipalId: string,
  ): Promise<A2ASendTaskResponse>;
  getTask(taskId: string, ownerPrincipalId: string): Promise<A2ATask | null>;
  runPendingTasks(): Promise<void>;
}

export type OrchestratorServiceOptions = {
  settings?: Partial<A2AOrchestratorSettings>;
  store?: OrchestratorTaskStore;
  scheduleTask?: ScheduleTask;
  collectorClass?: PRInfoCollectorClass;
  orchestratorClass?: OrchestratorAgentClass;
  leadEngineerClass?: LeadEngineerAgentClass;
};

export function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/(Bearer\s+|ghp_|github_pat_)[^\s"']+/giu, "[REDACTED]");
}

export function extractData(message: A2AMessage): Record<string, unknown> {
  for (const part of message.parts) {
    if (part.kind === "data") {
      return { ...part.data };
    }
  }
  return {};
}

export function resolveAgentUrl(path: string, settings: A2AOrchestratorSettings): string {
  if (settings.agentUrl) {
    return settings.agentUrl;
  }
  const base = (settings.agentBaseUrl ?? DEFAULT_ORCHESTRATOR_SETTINGS.agentBaseUrl ?? "").replace(
    /\/$/u,
    "",
  );
  return `${base}/${path.replace(/^\//u, "")}`;
}

function jsonSchemaWithOptionalDefaults(schema: z.ZodType): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
  if (Array.isArray(jsonSchema.required)) {
    jsonSchema.required = jsonSchema.required.filter((field) => field !== "modelId");
  }
  return jsonSchema;
}

export function createOrchestratorService({
  settings = {},
  store = new InMemoryOrchestratorTaskStore(),
  scheduleTask,
  collectorClass = PRInfoCollector,
  orchestratorClass = ReviewOrchestrator,
  leadEngineerClass = LeadEngineerAgent,
}: OrchestratorServiceOptions = {}): OrchestratorService {
  const effectiveSettings = { ...DEFAULT_ORCHESTRATOR_SETTINGS, ...settings };
  const pendingTasks: Promise<void>[] = [];
  const enqueue: ScheduleTask =
    scheduleTask ??
    ((task) => {
      pendingTasks.push(task());
    });

  const runTask = async (taskId: string, data: Record<string, unknown>, githubToken: string) => {
    await store.setWorking(taskId);
    try {
      const input = FullReviewInputSchema.parse(data);
      const modelId = input.modelId ?? effectiveSettings.modelId;
      const collector = new collectorClass({
        githubToken,
        modelId,
        llmBaseUrl: effectiveSettings.llmBaseUrl,
        providerType: effectiveSettings.providerType,
        maxAgentTurns: effectiveSettings.maxAgentTurns,
        patchTotalCharLimit: effectiveSettings.patchTotalCharLimit,
        patchMaxFiles: effectiveSettings.patchMaxFiles,
        mcpStartupRetryAttempts: effectiveSettings.mcpStartupRetryAttempts,
        mcpStartupRetryBackoffSeconds: effectiveSettings.mcpStartupRetryBackoffSeconds,
      });
      const prInfo = PRInfoResultSchema.parse(
        await collector.collect(input.owner, input.repo, input.prNumber),
      );
      const reviewerConfig: ReviewerConfig = {
        githubToken,
        modelId,
        llmBaseUrl: effectiveSettings.llmBaseUrl,
        providerType: effectiveSettings.providerType,
        maxAgentTurns: effectiveSettings.maxAgentTurns,
        maxTokens: effectiveSettings.maxTokens,
        frequencyPenalty: effectiveSettings.frequencyPenalty,
        reviewerTimeoutSeconds: effectiveSettings.reviewerTimeoutSeconds,
        mcpStartupRetryAttempts: effectiveSettings.mcpStartupRetryAttempts,
        mcpStartupRetryBackoffSeconds: effectiveSettings.mcpStartupRetryBackoffSeconds,
      };
      const orchestrator = new orchestratorClass(reviewerConfig);
      const reviewReport = ReviewReportSchema.parse(await orchestrator.run({ prInfo }));
      const leadEngineer = new leadEngineerClass(reviewerConfig);
      const result = LeadEngineerReportSchema.parse(await leadEngineer.evaluate(reviewReport));
      await store.setCompleted(taskId, [
        { kind: "data", data: result as unknown as Record<string, unknown> },
      ]);
    } catch (error) {
      await store.setFailed(taskId, sanitizeError(error));
    }
  };

  return {
    getAgentCard: () => ({
      name: "Orchestrator",
      description:
        "Runs the full 3-stage code review pipeline: PR info collection, parallel review, and lead engineer synthesis.",
      url: resolveAgentUrl("orchestrator", effectiveSettings),
      version: "1.0.0",
      capabilities: {
        streaming: false,
        pushNotifications: false,
        stateTransitionHistory: false,
      },
      inputModes: ["data"],
      outputModes: ["data"],
      skills: [
        {
          id: "full_review",
          name: "Full Code Review",
          description:
            "Collects PR information, runs applicable specialist reviewers in parallel, then produces final accept/reject decisions.",
          inputSchema: jsonSchemaWithOptionalDefaults(FullReviewInputSchema),
          outputSchema: jsonSchemaWithOptionalDefaults(LeadEngineerReportSchema),
        },
      ],
    }),
    sendTask: async (request, githubToken, ownerPrincipalId) => {
      const task = await store.create(ownerPrincipalId);
      enqueue(() => runTask(task.id, extractData(request.message), githubToken));
      return { task };
    },
    getTask: (taskId, ownerPrincipalId) => store.get(taskId, ownerPrincipalId),
    runPendingTasks: async () => {
      await Promise.all(pendingTasks.splice(0));
    },
  };
}
