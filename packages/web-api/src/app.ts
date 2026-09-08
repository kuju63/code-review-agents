import { OpenAPIHono } from "@hono/zod-openapi";

export const app = new OpenAPIHono();

app.get("/", (c) => {
  return c.text("Hello Hono!");
});
