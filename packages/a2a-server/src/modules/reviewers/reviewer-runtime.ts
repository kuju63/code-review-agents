import {
  type ReviewContext,
  type ReviewResult,
  ReviewResultSchema,
} from "@code-review-agent/agent-core";
import { z } from "zod";
import type { A2AMessage, A2APart, A2ASendTaskRequest } from "../a2a/request.model.js";
import type { A2ASendTaskResponse, A2ATask, AgentCard, AgentSkill } from "../a2a/response.model.js";
import { A2ATaskSchema } from "../a2a/response.model.js";
import { ReviewerSkillInputSchema } from "./request.model.js";

export const REVIEWER_TASK_TTL_SECONDS = 1800;

type TaskIdFactory = () => string;
type ScheduleTask = (task: () => Promise<void>) => void;

export type ReviewerConfig = {
  githubToken: string;
  modelId?: string;
  mcpUrl?: string;
  llmBaseUrl?: string;
  providerType?: "openai" | "ollama";
  maxAgentTurns?: number;
  maxTokens?: number;
  frequencyPenalty?: number;
  reviewerTimeoutSeconds?: number;
  mcpStartupRetryAttempts?: number;
  mcpStartupRetryBackoffSeconds?: number;
};

export type ReviewerClass = new (
  config: ReviewerConfig,
) => {
  review(context: ReviewContext): Promise<ReviewResult>;
};

export type A2AReviewerSettings = {
  modelId: string;
  llmBaseUrl?: string;
  providerType?: "openai" | "ollama";
  maxAgentTurns?: number;
  maxTokens?: number;
  frequencyPenalty?: number;
  reviewerTimeoutSeconds?: number;
  mcpStartupRetryAttempts?: number;
  mcpStartupRetryBackoffSeconds?: number;
  agentBaseUrl?: string;
  agentUrl?: string;
};

export const DEFAULT_REVIEWER_SETTINGS: A2AReviewerSettings = {
  modelId: "gpt-4o",
  agentBaseUrl: "http://localhost:3000",
};

export interface ReviewerTaskStore {
  create(ownerPrincipalId: string): Promise<A2ATask>;
  get(taskId: string, ownerPrincipalId: string): Promise<A2ATask | null>;
  setWorking(taskId: string): Promise<void>;
  setCompleted(taskId: string, parts: A2APart[]): Promise<void>;
  setFailed(taskId: string, error: string): Promise<void>;
}

export class InMemoryReviewerTaskStore implements ReviewerTaskStore {
  readonly ttlSeconds: number;
  private readonly store = new Map<string, A2ATask>();
  private readonly owners = new Map<string, string>();
  private readonly deleteTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly idFactory: TaskIdFactory;

  constructor({
    ttlSeconds = REVIEWER_TASK_TTL_SECONDS,
    idFactory = () => crypto.randomUUID(),
  }: { ttlSeconds?: number; idFactory?: TaskIdFactory } = {}) {
    this.ttlSeconds = ttlSeconds;
    this.idFactory = idFactory;
  }

  async create(ownerPrincipalId: string): Promise<A2ATask> {
    const task = A2ATaskSchema.parse({ id: this.idFactory(), status: "submitted" });
    this.store.set(task.id, task);
    this.owners.set(task.id, ownerPrincipalId);
    this.scheduleDelete(task.id);
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
    const existingTimer = this.deleteTimers.get(taskId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    const timer = setTimeout(() => {
      this.store.delete(taskId);
      this.owners.delete(taskId);
      this.deleteTimers.delete(taskId);
    }, this.ttlSeconds * 1000);
    timer.unref?.();
    this.deleteTimers.set(taskId, timer);
  }
}

export interface ReviewerService {
  getAgentCard(): AgentCard;
  sendTask(
    request: A2ASendTaskRequest,
    githubToken: string,
    ownerPrincipalId: string,
  ): Promise<A2ASendTaskResponse>;
  getTask(taskId: string, ownerPrincipalId: string): Promise<A2ATask | null>;
  runPendingTasks(): Promise<void>;
}

type ReviewerMetadata = {
  name: string;
  description: string;
  path: string;
  skill: Pick<AgentSkill, "id" | "name" | "description">;
};

export type ReviewerServiceOptions<T extends ReviewerClass = ReviewerClass> = {
  settings?: A2AReviewerSettings;
  store?: ReviewerTaskStore;
  scheduleTask?: ScheduleTask;
  reviewerClass?: T;
};

type CreateReviewerServiceOptions<T extends ReviewerClass> = ReviewerServiceOptions<T> & {
  metadata: ReviewerMetadata;
  defaultReviewerClass: T;
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

export function resolveAgentUrl(path: string, settings: A2AReviewerSettings): string {
  if (settings.agentUrl) {
    return settings.agentUrl;
  }
  const base = (settings.agentBaseUrl ?? DEFAULT_REVIEWER_SETTINGS.agentBaseUrl ?? "").replace(
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

export function createReviewerService<T extends ReviewerClass>({
  metadata,
  defaultReviewerClass,
  reviewerClass = defaultReviewerClass,
  settings = DEFAULT_REVIEWER_SETTINGS,
  store = new InMemoryReviewerTaskStore(),
  scheduleTask,
}: CreateReviewerServiceOptions<T>): ReviewerService {
  const effectiveSettings = { ...DEFAULT_REVIEWER_SETTINGS, ...settings };
  const pendingTasks: Promise<void>[] = [];
  const enqueue: ScheduleTask =
    scheduleTask ??
    ((task) => {
      const pendingTask = task();
      pendingTasks.push(pendingTask);
      const removePendingTask = () => {
        const index = pendingTasks.indexOf(pendingTask);
        if (index >= 0) {
          pendingTasks.splice(index, 1);
        }
      };
      void pendingTask.then(removePendingTask, removePendingTask);
    });

  const runTask = async (taskId: string, data: Record<string, unknown>, githubToken: string) => {
    await store.setWorking(taskId);
    try {
      const input = ReviewerSkillInputSchema.parse(data);
      const modelId = input.modelId ?? effectiveSettings.modelId;
      const reviewer = new reviewerClass({
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
      });
      const result = ReviewResultSchema.parse(await reviewer.review({ prInfo: input.prInfo }));
      await store.setCompleted(taskId, [
        { kind: "data", data: result as unknown as Record<string, unknown> },
      ]);
    } catch (error) {
      await store.setFailed(taskId, sanitizeError(error));
    }
  };

  return {
    getAgentCard: () => ({
      name: metadata.name,
      description: metadata.description,
      url: resolveAgentUrl(metadata.path, effectiveSettings),
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
          ...metadata.skill,
          inputSchema: jsonSchemaWithOptionalDefaults(ReviewerSkillInputSchema),
          outputSchema: jsonSchemaWithOptionalDefaults(ReviewResultSchema),
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
