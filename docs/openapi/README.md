# Review Persistence API (OpenAPI)

Issue #245 のレビュー対象登録・実行・結果保存・close管理を記述するREST契約です。
OpenAPI 3.1定義の実体は [`reviews.yaml`](./reviews.yaml) にあり、`lint:openapi` の検証対象です。

契約の正本はADR-0012に従って `packages/agent-core` のZod schemasとし、`reviews.yaml` は
人間・レビュー向けのREST契約文書（documentation-first）として管理します。Contract-First
codegenのcanonicalではありません。

## ファイル

- [`reviews.yaml`](./reviews.yaml) — OpenAPI 3.1 定義本体
- [`redocly.yaml`](./redocly.yaml) — Redocly lint 設定 (`reviews@v1` エイリアス)

## 検証

```bash
nix develop --command pnpm run lint:openapi
```
