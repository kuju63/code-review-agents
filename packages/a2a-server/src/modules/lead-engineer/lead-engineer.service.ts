import {
  type LeadEngineerReport,
  LeadEngineerReportSchema,
  type ReviewReport,
  ReviewReportSchema,
} from "@code-review-agent/agent-core";
import { LeadEngineerAgent } from "@code-review-agent/agent-core/agents/lead-engineer.js";
import { z } from "zod";
import type { A2AMessage, A2APart, A2ASendTaskRequest } from "../a2a/request.model.js";
import type { A2ASendTaskResponse, A2ATask, AgentCard } from "../a2a/response.model.js";
import { A2ATaskSchema } from "../a2a/response.model.js";
import { LeadEngineerSkillInputSchema } from "./request.model.js";

export const LEAD_ENGINEER_TASK_TTL_SECONDS = 1800;

type TaskIdFactory = () => string;
type ScheduleTask = (task: () => Promise<void>) => void;

export type LeadEngineerConfig = ConstructorParameters<typeof LeadEngineerAgent>[0];

export type LeadEngineerAgentClass = new (
  config: LeadEngineerConfig,
) => {
  evaluate(report: ReviewReport): Promise<LeadEngineerReport>;
};

export type A2ALeadEngineerSettings = {
  modelId: string;
  llmBaseUrl?: string;
  providerType?: "openai" | "ollama";
  maxAgentTurns?: number;
  maxTokens?: number;
  frequencyPenalty?: number;
  agentBaseUrl?: string;
  agentUrl?: string;
};

export const DEFAULT_LEAD_ENGINEER_SETTINGS: A2ALeadEngineerSettings = {
  modelId: "gpt-4o",
  agentBaseUrl: "http://localhost:3000",
};

export interface LeadEngineerTaskStore {
  create(ownerPrincipalId: string): Promise<A2ATask>;
  get(taskId: string, ownerPrincipalId: string): Promise<A2ATask | null>;
  setWorking(taskId: string): Promise<void>;
  setCompleted(taskId: string, parts: A2APart[]): Promise<void>;
  setFailed(taskId: string, error: string): Promise<void>;
}

export class InMemoryLeadEngineerTaskStore implements LeadEngineerTaskStore {
  readonly ttlSeconds: number;
  private readonly store = new Map<string, A2ATask>();
  private readonly owners = new Map<string, string>();
  private readonly idFactory: TaskIdFactory;

  constructor({
    ttlSeconds = LEAD_ENGINEER_TASK_TTL_SECONDS,
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

export interface LeadEngineerService {
  getAgentCard(): AgentCard;
  sendTask(
    request: A2ASendTaskRequest,
    githubToken: string,
    ownerPrincipalId: string,
  ): Promise<A2ASendTaskResponse>;
  getTask(taskId: string, ownerPrincipalId: string): Promise<A2ATask | null>;
  runPendingTasks(): Promise<void>;
}

export type LeadEngineerServiceOptions<T extends LeadEngineerAgentClass = LeadEngineerAgentClass> =
  {
    settings?: Partial<A2ALeadEngineerSettings>;
    store?: LeadEngineerTaskStore;
    scheduleTask?: ScheduleTask;
    agentClass?: T;
  };

export function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/(Bearer\s+|gh[oprsu]_|github_pat_)[^\s"']+/giu, "[REDACTED]");
}

export function extractData(message: A2AMessage): Record<string, unknown> {
  for (const part of message.parts) {
    if (part.kind === "data") {
      return { ...part.data };
    }
  }
  return {};
}

export function resolveAgentUrl(path: string, settings: A2ALeadEngineerSettings): string {
  if (settings.agentUrl) {
    return settings.agentUrl;
  }
  const base = (settings.agentBaseUrl ?? DEFAULT_LEAD_ENGINEER_SETTINGS.agentBaseUrl ?? "").replace(
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

export function createLeadEngineerService({
  settings = {},
  store = new InMemoryLeadEngineerTaskStore(),
  scheduleTask,
  agentClass = LeadEngineerAgent,
}: LeadEngineerServiceOptions = {}): LeadEngineerService {
  const effectiveSettings = { ...DEFAULT_LEAD_ENGINEER_SETTINGS, ...settings };
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
      const input = LeadEngineerSkillInputSchema.parse(data);
      const modelId = input.modelId ?? effectiveSettings.modelId;
      const agent = new agentClass({
        githubToken,
        modelId,
        llmBaseUrl: effectiveSettings.llmBaseUrl,
        providerType: effectiveSettings.providerType,
        maxAgentTurns: effectiveSettings.maxAgentTurns,
        maxTokens: effectiveSettings.maxTokens,
        frequencyPenalty: effectiveSettings.frequencyPenalty,
      });
      const result = LeadEngineerReportSchema.parse(
        await agent.evaluate(ReviewReportSchema.parse(input.reviewReport)),
      );
      await store.setCompleted(taskId, [
        { kind: "data", data: result as unknown as Record<string, unknown> },
      ]);
    } catch (error) {
      await store.setFailed(taskId, sanitizeError(error));
    }
  };

  return {
    getAgentCard: () => ({
      name: "Lead Engineer",
      description:
        "Evaluates reviewer findings and produces final accept/reject decisions for each issue.",
      url: resolveAgentUrl("lead-engineer", effectiveSettings),
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
          id: "evaluate_findings",
          name: "Evaluate Findings",
          description:
            "Triages and prioritises code review findings from the parallel review stage.",
          inputSchema: jsonSchemaWithOptionalDefaults(LeadEngineerSkillInputSchema),
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
