import { createRoute, z } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

describe("createApp defaultHook", () => {
  it("returns a reviews.yaml-shaped ErrorResponse with 422 on validation failure", async () => {
    const app = createApp();
    const dummyRoute = createRoute({
      method: "get",
      path: "/dummy",
      request: {
        query: z.object({ page: z.coerce.number().int().min(1) }),
      },
      responses: {
        200: {
          description: "ok",
          content: { "application/json": { schema: z.object({ ok: z.boolean() }) } },
        },
      },
    });
    app.openapi(dummyRoute, (c) => c.json({ ok: true }));

    const res = await app.request("/dummy?page=not-a-number");

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body).toMatchObject({
      apiVersion: "1.0.0",
      code: "validation_error",
    });
    expect(typeof body.message).toBe("string");
    expect(typeof body.detail).toBe("string");
  });

  it("does not invoke the defaultHook when validation succeeds", async () => {
    const app = createApp();
    const dummyRoute = createRoute({
      method: "get",
      path: "/dummy-ok",
      request: {
        query: z.object({ page: z.coerce.number().int().min(1) }),
      },
      responses: {
        200: {
          description: "ok",
          content: { "application/json": { schema: z.object({ ok: z.boolean() }) } },
        },
      },
    });
    app.openapi(dummyRoute, (c) => c.json({ ok: true }));

    const res = await app.request("/dummy-ok?page=2");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
