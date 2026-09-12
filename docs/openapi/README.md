# Review Persistence API (OpenAPI)

Issue #245 のレビュー対象登録・実行・結果保存・close管理、および Issue #335 の
GitHub連携設定 (`/settings/github`, SCR-04) を記述するREST契約です。
OpenAPI 3.1定義の実体は [`reviews.yaml`](./reviews.yaml) にあり、`lint:openapi` の検証対象です。

この`ReviewReport`（OpenAPI）は、`agents/review-orchestrator.ts`が出力する内部処理形式
`ReviewReportSchema`（`packages/agent-core/src/models/review.ts`、`{ results, errors }` —
並列レビューステージからLead Engineerへの受け渡し用）とは別契約です。REST応答の`ReviewReport`は
`PRInfoResult.prInfo.fileChanges`と`LeadEngineerReport.decisions`をファイルパス・行番号で
マッピングした別の形状（`apiVersion`/`reviewId`/`overallSummary`/`files`/`commentCounts`）を持ち、
両者を同一契約として扱ってはいけません。

ADR-0012 §4の決定により、REST契約の正本は `packages/agent-core` に追加・拡張されるREST専用の
Zod schemas（request/response envelope・error taxonomy等）です。前段の内部`ReviewReportSchema`
ではなく、この新設Zod schemasからREST用`ReviewReport`へのマッピング実装が別途必要になります。
`reviews.yaml`（OpenAPI）はこの正本を人間・レビュー向けに文書化したもの（documentation-first）
であり、Contract-First codegenのcanonicalではありません。

## ファイル

- [`reviews.yaml`](./reviews.yaml) — OpenAPI 3.1 定義本体
- [`redocly.yaml`](./redocly.yaml) — Redocly lint 設定 (`reviews@v1` エイリアス)

## 検証

```bash
nix develop --command pnpm run lint:openapi
```
