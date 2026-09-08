import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const REVIEWS_YAML_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../docs/openapi/reviews.yaml",
);

/** `docs/openapi/reviews.yaml` を読み込みパースする。canonical契約の正本。 */
export function loadReviewsYamlDoc(): unknown {
  const raw = readFileSync(REVIEWS_YAML_PATH, "utf-8");
  return parse(raw);
}

export interface NormalizedSchema {
  properties: Set<string>;
  required: Set<string>;
  nullableProperties: Set<string>;
  enumValues?: Set<string>;
}

interface SchemaNode {
  type?: string | string[];
  enum?: unknown[];
  properties?: Record<string, SchemaNode>;
  required?: string[];
  oneOf?: SchemaNode[];
  allOf?: SchemaNode[];
}

/**
 * `type: [T,'null']`（reviews.yaml と @hono/zod-openapi の doc31 出力の共通形）、
 * `oneOf: [$ref, {type:'null'}]`（reviews.yaml の ReviewAttempt.errorCode）、
 * `allOf: [$ref, {type:[...,'null']}]`（named enum を複数箇所で使い回した際の
 * @hono/zod-openapi の doc31 出力）のいずれかで nullable を表現する。
 */
function isNullableNode(node: SchemaNode | undefined): boolean {
  if (!node) return false;
  if (Array.isArray(node.type) && node.type.includes("null")) return true;
  if (Array.isArray(node.oneOf) && node.oneOf.some((n) => n.type === "null")) return true;
  if (
    Array.isArray(node.allOf) &&
    node.allOf.some((n) => Array.isArray(n.type) && n.type.includes("null"))
  ) {
    return true;
  }
  return false;
}

/**
 * `components.schemas[name]` を、比較可能な集合（properties/required/nullable/enum）へ正規化する。
 * `description`/`example(s)` は比較対象から除外する。
 */
export function normalizeSchema(name: string, doc: unknown): NormalizedSchema {
  const node = (doc as { components: { schemas: Record<string, SchemaNode> } }).components.schemas[
    name
  ];
  if (!node) {
    throw new Error(`schema "${name}" not found in document`);
  }

  if (Array.isArray(node.enum)) {
    return {
      properties: new Set(),
      required: new Set(),
      nullableProperties: new Set(),
      enumValues: new Set(node.enum.filter((v): v is string => v !== null)),
    };
  }

  const properties = new Set(Object.keys(node.properties ?? {}));
  const required = new Set(node.required ?? []);
  const nullableProperties = new Set<string>();
  for (const [propName, propNode] of Object.entries(node.properties ?? {})) {
    if (isNullableNode(propNode)) {
      nullableProperties.add(propName);
    }
  }

  return { properties, required, nullableProperties };
}

/**
 * OpenAPI の Path Item Object が持つキーのうち、実際の operation (HTTP method) を
 * 表すもの。`parameters`/`summary`/`description` 等の path-level フィールドは含まない。
 */
export const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "options", "head", "trace"];

export function pathMethodSet(paths: Record<string, Record<string, unknown>>): Set<string> {
  const set = new Set<string>();
  for (const [pathKey, methods] of Object.entries(paths)) {
    for (const method of Object.keys(methods)) {
      if (HTTP_METHODS.includes(method)) {
        set.add(`${method.toUpperCase()} ${pathKey}`);
      }
    }
  }
  return set;
}

interface OperationNode {
  operationId?: string;
  responses?: Record<string, unknown>;
}

export function forEachOperation(
  paths: Record<string, Record<string, unknown>>,
  fn: (operation: OperationNode) => void,
): void {
  for (const methods of Object.values(paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      if (HTTP_METHODS.includes(method)) {
        fn(operation as OperationNode);
      }
    }
  }
}

/** ローカル `#/components/...` 参照のみを解決する (reviews.yaml に外部参照はない)。 */
export function resolveRef<T = unknown>(node: unknown, doc: unknown): T {
  if (node && typeof node === "object" && "$ref" in node && typeof node.$ref === "string") {
    const parts = node.$ref.replace(/^#\//, "").split("/");
    let current: unknown = doc;
    for (const part of parts) {
      current = (current as Record<string, unknown>)[part];
    }
    return current as T;
  }
  return node as T;
}
