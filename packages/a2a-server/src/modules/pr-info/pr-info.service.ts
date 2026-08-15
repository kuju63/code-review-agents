import { PRInfoCollector } from "@code-review-agent/agent-core/agents/pr-info-collector.js";
import type { A2AMessage, A2APart, A2ASendTaskRequest } from "../a2a/request.model.js";
import type { A2ASendTaskResponse, A2ATask, AgentCard } from "../a2a/response.model.js";
import { A2ATaskSchema } from "../a2a/response.model.js";
import { CollectPrInfoInputSchema } from "./request.model.js";

export const TASK_TTL_SECONDS = 1800;

type TaskIdFactory = () => string;
type ScheduleTask = (task: () => Promise<void>) => void;

type A2AServerSettings = {
  modelId: string;
  llmBaseUrl?: string;
  providerType?: "openai" | "ollama";
  maxAgentTurns?: number;
  patchTotalCharLimit?: number;
  patchMaxFiles?: number;
  mcpStartupRetryAttempts?: number;
  mcpStartupRetryBackoffSeconds?: number;
  agentPrInfoCollectorUrl?: string;
};

export const DEFAULT_A2A_SERVER_SETTINGS: A2AServerSettings = {
  modelId: "gpt-4o",
};

export interface TaskStore {
  create(ownerPrincipalId: string): Promise<A2ATask>;
  get(taskId: string, ownerPrincipalId: string): Promise<A2ATask | null>;
  setWorking(taskId: string): Promise<void>;
  setCompleted(taskId: string, parts: A2APart[]): Promise<void>;
  setFailed(taskId: string, error: string): Promise<void>;
}

export class InMemoryTaskStore implements TaskStore {
  readonly ttlSeconds: number;
  private readonly store = new Map<string, A2ATask>();
  private readonly owners = new Map<string, string>();
  private readonly deleteTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly idFactory: TaskIdFactory;

  constructor({
    ttlSeconds = TASK_TTL_SECONDS,
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

export interface PrInfoService {
  getAgentCard(): AgentCard;
  sendTask(
    request: A2ASendTaskRequest,
    githubToken: string,
    ownerPrincipalId: string,
  ): Promise<A2ASendTaskResponse>;
  getTask(taskId: string, ownerPrincipalId: string): Promise<A2ATask | null>;
  runPendingTasks(): Promise<void>;
}

type PrInfoServiceOptions = {
  settings?: A2AServerSettings;
  store?: TaskStore;
  scheduleTask?: ScheduleTask;
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

export function createPrInfoService({
  settings = DEFAULT_A2A_SERVER_SETTINGS,
  store = new InMemoryTaskStore(),
  scheduleTask,
}: PrInfoServiceOptions = {}): PrInfoService {
  const effectiveSettings = { ...DEFAULT_A2A_SERVER_SETTINGS, ...settings };
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
      const input = CollectPrInfoInputSchema.parse(data);
      const collector = new PRInfoCollector({
        githubToken,
        modelId: input.modelId ?? effectiveSettings.modelId,
        llmBaseUrl: effectiveSettings.llmBaseUrl,
        providerType: effectiveSettings.providerType,
        maxAgentTurns: effectiveSettings.maxAgentTurns,
        patchTotalCharLimit: effectiveSettings.patchTotalCharLimit,
        patchMaxFiles: effectiveSettings.patchMaxFiles,
        mcpStartupRetryAttempts: effectiveSettings.mcpStartupRetryAttempts,
        mcpStartupRetryBackoffSeconds: effectiveSettings.mcpStartupRetryBackoffSeconds,
      });
      const result = await collector.collect(input.owner, input.repo, input.prNumber);
      await store.setCompleted(taskId, [{ kind: "data", data: result as Record<string, unknown> }]);
    } catch (error) {
      await store.setFailed(taskId, sanitizeError(error));
    }
  };

  return {
    getAgentCard: () => ({
      name: "PR Info Collector",
      description:
        "Collects pull request information from GitHub and returns structured data for downstream review agents.",
      url: effectiveSettings.agentPrInfoCollectorUrl ?? "http://localhost:3000/pr-info-collector",
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
          id: "collect_pr_info",
          name: "Collect PR Information",
          description:
            "Fetches PR metadata, file changes, and project summary from GitHub using MCP.",
          inputSchema: {
            type: "object",
            properties: {
              owner: { type: "string" },
              repo: { type: "string" },
              prNumber: { type: "integer" },
              modelId: { type: "string", default: "gpt-4o" },
            },
            required: ["owner", "repo", "prNumber"],
          },
          outputSchema: { type: "object" },
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
