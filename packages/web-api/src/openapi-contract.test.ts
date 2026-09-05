import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import {
  AttemptStatusSchema,
  CommentDispositionSchema,
  ErrorCodeSchema,
  FileChangeStatusSchema,
  FindingCategorySchema,
  FindingImpactSchema,
  FindingSeveritySchema,
  PrStateSchema,
  ReviewDomainStatusSchema,
  ReviewStatusSchema,
} from "./modules/reviews/reviews.enums.js";
import {
  CommentCountsSchema,
  DiffLineSchema,
  DispositionRequestSchema,
  ErrorResponseSchema,
  PageInfoSchema,
  RegisterReviewRequestSchema,
  ReviewAttemptSchema,
  ReviewCommentSchema,
  ReviewFileChangeSchema,
  ReviewListResponseSchema,
  ReviewReportSchema,
  ReviewSchema,
  StartAttemptRequestSchema,
} from "./modules/reviews/reviews.schema.js";
import { loadReviewsYamlDoc, normalizeSchema } from "./test-support/reviews-yaml.js";

// Cycle 9 (reviews.route.ts) までは、これらのスキーマがどの createRoute からも
// 参照されないため openAPIRegistry に自然登録されない。ルート実装後は実際の
// request/response 定義がこの役割を担うため、このダミー登録は縮小・撤去する。
const SCHEMAS_TO_REGISTER: ReadonlyArray<[string, { openapi: (name: string) => unknown }]> = [
  ["PrState", PrStateSchema],
  ["ReviewStatus", ReviewStatusSchema],
  ["ReviewDomainStatus", ReviewDomainStatusSchema],
  ["AttemptStatus", AttemptStatusSchema],
  ["ErrorCode", ErrorCodeSchema],
  ["CommentDisposition", CommentDispositionSchema],
  ["FindingCategory", FindingCategorySchema],
  ["FindingSeverity", FindingSeveritySchema],
  ["FindingImpact", FindingImpactSchema],
  ["FileChangeStatus", FileChangeStatusSchema],
  ["CommentCounts", CommentCountsSchema],
  ["ErrorResponse", ErrorResponseSchema],
  ["DiffLine", DiffLineSchema],
  ["ReviewComment", ReviewCommentSchema],
  ["ReviewFileChange", ReviewFileChangeSchema],
  ["Review", ReviewSchema],
  ["ReviewAttempt", ReviewAttemptSchema],
  ["RegisterReviewRequest", RegisterReviewRequestSchema],
  ["StartAttemptRequest", StartAttemptRequestSchema],
  ["DispositionRequest", DispositionRequestSchema],
  ["PageInfo", PageInfoSchema],
  ["ReviewListResponse", ReviewListResponseSchema],
  ["ReviewReport", ReviewReportSchema],
];

function buildAppDocument() {
  const app = createApp();
  for (const [name, schema] of SCHEMAS_TO_REGISTER) {
    app.openAPIRegistry.register(
      name,
      schema as Parameters<typeof app.openAPIRegistry.register>[1],
    );
  }
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

  it.each(SCHEMAS_TO_REGISTER.map(([name]) => name))(
    "keeps the %s schema in sync with reviews.yaml",
    (name) => {
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
    },
  );
});
