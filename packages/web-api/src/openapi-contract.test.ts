import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { registerReviewsRoutes } from "./modules/reviews/reviews.route.js";
import { registerSettingsRoutes } from "./modules/settings/settings.route.js";
import {
  forEachOperation,
  loadReviewsYamlDoc,
  normalizeSchema,
  pathMethodSet,
  resolveRef,
} from "./test-support/reviews-yaml.js";

const SCHEMA_NAMES = [
  "PrState",
  "ReviewStatus",
  "ReviewDomainStatus",
  "AttemptStatus",
  "ErrorCode",
  "CommentDisposition",
  "FindingCategory",
  "FindingSeverity",
  "FindingImpact",
  "FileChangeStatus",
  "CommentCounts",
  "ErrorResponse",
  "DiffLine",
  "ReviewComment",
  "ReviewFileChange",
  "Review",
  "ReviewAttempt",
  "RegisterReviewRequest",
  "StartAttemptRequest",
  "DispositionRequest",
  "PageInfo",
  "ReviewListResponse",
  "ReviewReport",
  "GithubSettings",
  "UpdateGithubSettingsRequest",
];

interface OpenApiDoc {
  paths: Record<string, Record<string, unknown>>;
}

function buildAppDocument(): OpenApiDoc {
  const app = createApp();
  registerReviewsRoutes(app);
  registerSettingsRoutes(app);
  return app.getOpenAPI31Document({
    openapi: "3.1.0",
    info: { title: "Review Persistence API", version: "1.0.0" },
  }) as unknown as OpenApiDoc;
}

describe("reviews.yaml contract", () => {
  it("loads reviews.yaml as an OpenAPI 3.1 document", () => {
    const doc = loadReviewsYamlDoc() as { openapi: string; info: { title: string } };
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info.title).toBe("Review Persistence API");
  });

  it.each(SCHEMA_NAMES)("keeps the %s schema in sync with reviews.yaml", (name) => {
    const yamlDoc = loadReviewsYamlDoc();
    const appDoc = buildAppDocument();

    const expected = normalizeSchema(name, yamlDoc);
    const actual = normalizeSchema(name, appDoc);

    expect(actual.properties).toEqual(expected.properties);
    expect(actual.required).toEqual(expected.required);
    expect(actual.nullableProperties).toEqual(expected.nullableProperties);
    if (expected.enumValues) {
      expect(actual.enumValues).toEqual(expected.enumValues);
    }
  });

  it("declares exactly the same path+method set as reviews.yaml", () => {
    const yamlDoc = loadReviewsYamlDoc() as OpenApiDoc;
    const appDoc = buildAppDocument();

    expect(pathMethodSet(appDoc.paths)).toEqual(pathMethodSet(yamlDoc.paths));
  });

  it("declares exactly the same operationId set as reviews.yaml", () => {
    const yamlDoc = loadReviewsYamlDoc() as OpenApiDoc;
    const appDoc = buildAppDocument();

    const toOperationIds = (paths: OpenApiDoc["paths"]) => {
      const ids = new Set<string>();
      forEachOperation(paths, (op) => {
        if (op.operationId) ids.add(op.operationId);
      });
      return ids;
    };

    expect(toOperationIds(appDoc.paths)).toEqual(toOperationIds(yamlDoc.paths));
  });

  it("declares exactly the same status code set per operation as reviews.yaml", () => {
    const yamlDoc = loadReviewsYamlDoc() as OpenApiDoc;
    const appDoc = buildAppDocument();

    const toStatusCodesByOperationId = (paths: OpenApiDoc["paths"]) => {
      const map = new Map<string, Set<string>>();
      forEachOperation(paths, (op) => {
        if (op.operationId) {
          map.set(op.operationId, new Set(Object.keys(op.responses ?? {})));
        }
      });
      return map;
    };

    const expected = toStatusCodesByOperationId(yamlDoc.paths);
    const actual = toStatusCodesByOperationId(appDoc.paths);

    expect(actual.size).toBe(expected.size);
    for (const [operationId, expectedCodes] of expected) {
      expect(actual.get(operationId), `missing operationId ${operationId}`).toBeDefined();
      expect(actual.get(operationId)).toEqual(expectedCodes);
    }
  });

  it("declares the required response headers (Location, Retry-After)", () => {
    const yamlDoc = loadReviewsYamlDoc() as OpenApiDoc;
    const appDoc = buildAppDocument();

    const registerReviewPost = yamlDoc.paths["/reviews"].post as {
      responses: Record<string, unknown>;
    };
    const yamlRegisterResponse201 = resolveRef<{ headers?: Record<string, unknown> }>(
      registerReviewPost.responses["201"],
      yamlDoc,
    );
    const appRegisterResponse201 = (
      appDoc.paths["/reviews"].post as {
        responses: Record<string, { headers?: Record<string, unknown> }>;
      }
    ).responses["201"];
    expect(Object.keys(appRegisterResponse201.headers ?? {})).toEqual(
      Object.keys(yamlRegisterResponse201.headers ?? {}),
    );

    const startAttemptPost = yamlDoc.paths["/reviews/{reviewId}/attempts"].post as {
      responses: Record<string, unknown>;
    };
    const yamlQueueOverload503 = resolveRef<{ headers?: Record<string, unknown> }>(
      startAttemptPost.responses["503"],
      yamlDoc,
    );
    const appQueueOverload503 = (
      appDoc.paths["/reviews/{reviewId}/attempts"].post as {
        responses: Record<string, { headers?: Record<string, unknown> }>;
      }
    ).responses["503"];
    expect(Object.keys(appQueueOverload503.headers ?? {})).toEqual(
      Object.keys(yamlQueueOverload503.headers ?? {}),
    );
  });
});
