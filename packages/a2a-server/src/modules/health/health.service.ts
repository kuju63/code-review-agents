import { type HealthResponse, HealthResponseSchema } from "./response.model.js";

export interface HealthService {
  getStatus(): HealthResponse;
}

export function createHealthService(): HealthService {
  const response = HealthResponseSchema.parse({ status: "ok" });

  return {
    getStatus: () => response,
  };
}
