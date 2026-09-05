import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { ErrorResponseSchema } from "./modules/reviews/reviews.schema.js";
import { loadReviewsYamlDoc, normalizeSchema } from "./test-support/reviews-yaml.js";

function buildAppDocument() {
  const app = createApp();
  // Cycle 3 時点では modules/reviews/reviews.route.ts がまだ存在しないため、
  // ErrorResponseSchema を openAPIRegistry に登録するための直接呼び出し。
  // ルート実装後は実際のエラーレスポンスがこの役割を担う想定。
  app.openAPIRegistry.register("ErrorResponse", ErrorResponseSchema);
  return app.getOpenAPI31Document({
    openapi: "3.1.0",
    info: { title: "Review Persistence API", version: "1.0.0" },
  });
}

describe("reviews.yaml contract", () => {
  it("loads reviews.yaml as an OpenAPI 3.1 document", () => {
    const doc = loadReviewsYamlDoc() as { openapi: string; info: { title: string } };
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info.title).toBe("Review Persistence API");
  });

  it("keeps the ErrorResponse schema in sync with reviews.yaml", () => {
    const yamlDoc = loadReviewsYamlDoc();
    const appDoc = buildAppDocument();

    const expected = normalizeSchema("ErrorResponse", yamlDoc);
    const actual = normalizeSchema("ErrorResponse", appDoc);

    expect(actual.properties).toEqual(expected.properties);
    expect(actual.required).toEqual(expected.required);
    expect(actual.nullableProperties).toEqual(expected.nullableProperties);
  });
});
