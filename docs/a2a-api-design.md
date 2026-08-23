# A2A API 設計ドキュメント

各 Agent（PR Info Collector・技術レビュアー各種・Security Reviewer・Lead Engineer・全体を束ねる
Orchestrator）を Google A2A（Agent-to-Agent）プロトコル準拠の HTTP API として公開するための設計。

実装は `packages/a2a-server`（Hono ベース）。本ドキュメントは現行 TypeScript 実装を記述する。
実装計画・検証手順・Python版(FastAPI)からの移行経緯は
[docs/plan/a2a-api-design.md](plan/a2a-api-design.md) を参照。

---

## 1. 概要

### 1.1 目的

- 各 Agent を Google A2A プロトコル準拠の HTTP エンドポイントとして公開する
- 「PR Info Collector → 並列レビュー → Lead Engineer」という3段階のレビューワークフローを、
  個別エージェント呼び出しと、それを束ねる Orchestrator 呼び出しの両方から実行可能にする
- LLMプロバイダー（OpenAI互換 / ローカルOllama）を環境変数で切り替え可能にする
  （プロバイダー選択の設計は [docs/model-provider-factory-spec.md](model-provider-factory-spec.md) 参照）

### 1.2 採用プロトコル

各 Agent は以下の3エンドポイントを提供する。

| エンドポイント | メソッド | 説明 |
|---|---|---|
| `/{agent}/.well-known/agent.json` | GET | AgentCard — Agentの能力・スキーマ・URLを公開 |
| `/{agent}/tasks/send` | POST | タスク投入（`202 Accepted` + 初期状態の `A2ATask` を即時返却） |
| `/{agent}/tasks/{taskId}` | GET | 認証済み作成者によるタスク状態確認（ポーリング） |

タスク投入と取得の両方に、同一 GitHub アカウントの `Authorization: Bearer <token>` が必要。
取得時はタスク作成時に記録した GitHub principal ID と照合し、別アカウントからの取得要求は
存在有無に関わらず `404` として扱う（第三者にタスクの存在自体を明かさないため）。

**タスク状態遷移**: `submitted → working → completed / failed`

### 1.3 デプロイ構成

単一プロセス（Honoアプリ1つ）として全Agentを動作させるモノリス構成。AgentCardの`url`は
起動時設定（後述の`agentBaseUrl`/`agentUrl`）で差し替え可能なため、将来のサービス分割にも
対応できる。

```text
http://localhost:3000/
├── /pr-info-collector/...
├── /react-reviewer/...
├── /vue-reviewer/...
├── /angular-reviewer/...
├── /svelte-reviewer/...
├── /security-reviewer/...
├── /lead-engineer/...
└── /orchestrator/...        ← 3段階ワークフロー全体を1リクエストで実行
```

> **本番環境のTLS要件**: 本APIは`Authorization: Bearer <token>`ヘッダーで認証情報を送受信するため、
> 本番環境では必ずTLS termination（リバースプロキシ、Kubernetes Ingress等）を前段に配置し
> HTTPSを使用すること。`http://`での運用はトークンの平文送信につながるため禁止とする。
> 詳細は[§7 セキュリティ設計](#7-セキュリティ設計)を参照。

> **既知の未接続箇所**: `health`モジュール（`modules/health/`）はservice/routeとも実装済みだが、
> `index.ts`へのマウントは意図的に別スライスへ先送りされている（TS/Zod移行時点の設計判断、
> [docs/plan/a2a-api-design.md](plan/a2a-api-design.md) §13.6参照）。評価パイプライン
> ([docs/eval-a2a-container-runtime-spec.md](eval-a2a-container-runtime-spec.md))の
> コンテナ起動スクリプトは`http://localhost:8000/health`をポーリングするが、`index.ts`は
> ポート`3000`をハードコードしている。マウント自体が未実施のため、このヘルスチェックが
> 現在どう成立しているか（コンテナ側のポート/パスマッピングで吸収されているか、あるいは
> 未接続のままか）は本ドキュメントの範囲では確認できていない。評価パイプラインに触れる際は
> 実際に起動確認してから前提とすること。

---

## 2. A2Aプロトコルのデータ形状

Zodスキーマとして`packages/a2a-server/src/modules/a2a/`に定義されている。

| モデル | 役割 | 主なフィールド |
|---|---|---|
| `A2AMessage` | リクエスト/レスポンス双方のペイロード運搬 | `role`（`user`/`agent`）、`parts`（`kind: "data"`のパートの配列、各パートが`data: Record<string, unknown>`を持つ） |
| `A2ASendTaskRequest` | `tasks/send`のボディ | `message: A2AMessage` |
| `A2ATask` | タスクの現在状態 | `id`、`status`（`submitted`/`working`/`completed`/`failed`）、`message`（完了時の出力、既定`null`）、`error`（失敗時のメッセージ、既定`null`） |
| `AgentCard` | `.well-known/agent.json`の応答 | `name`、`description`、`url`、`version`、`capabilities`（streaming/pushNotifications/stateTransitionHistoryはいずれも現状`false`固定）、`inputModes`/`outputModes`（いずれも`["data"]`固定）、`skills`（`AgentSkill`の配列） |
| `AgentSkill` | AgentCard内の個別スキル定義 | `id`、`name`、`description`、`inputSchema`/`outputSchema`（対応するZodスキーマから`z.toJSONSchema()`で自動生成したJSON Schema） |

エラー応答は`{ detail: string }`という共通シェイプ（`HttpErrorResponse`）に統一されている
（`400`/`401`/`404`/`503`いずれも同じ形）。バリデーションエラー（`422`）のみFastAPI由来の
`{ detail: [{type, loc, msg, ...}] }`形状を踏襲しており、リクエスト検証ライブラリ
（`@hono/zod-validator`）の出力形状と互換になっている。

---

## 3. TaskStoreの設計

タスクの状態はモジュールごとに独立したインメモリストア（`Map`）で管理する。単一プロセス内で
完結するため、外部ストア（Redis等）は使わない。

- **所有者チェック**: `get(taskId, ownerPrincipalId)`は、タスク作成時に記録した所有者と一致しない
  場合`null`を返す。呼び出し側はこれを`404`として扱う。
- **TTL**: タスクが`completed`/`failed`になった時点（および作成直後）で30分（1800秒）の削除タイマーを
  仕込む。プロセスの正常終了を妨げないよう、タイマーは`unref()`される。同一タスクへの再スケジュール時は
  既存タイマーをクリアしてから積み直す。
- **エラーサニタイズ**: タスク失敗時に保存するエラーメッセージは、`Bearer <token>`・`ghp_*`・
  `gho_*`・`ghp_*`等のGitHubトークンらしき文字列パターンを`[REDACTED]`に置換してから保存する
  （§7.3参照）。
- **タスク実行の待受**: `sendTask`はタスクをすぐに`submitted`状態で作成して返し、実処理は
  バックグラウンドの`Promise`としてキューに積む。`runPendingTasks()`は積まれた`Promise`をすべて
  `await`する — テストや評価パイプラインが「投入した全タスクの実処理完了」を待ち合わせるための
  フックであり、本番の常時稼働プロセスでは通常呼ばれない。

各モジュール（`pr-info`、`orchestrator`、各技術レビュアー）はこの設計を個別に実装している。
技術レビュアー5種（React/Vue/Angular/Svelte/Security）は`modules/reviewers/reviewer-runtime.ts`の
共通ファクトリ`createReviewerService()`を通じてこのロジックを共有し、各モジュールは対象の
レビュアークラスとAgentCardメタデータ（名前・説明・パス）だけを渡す。PR Info Collector・
Orchestrator・Lead Engineerはそれぞれ専用のTaskStore実装を持つ（構造は共通だが、扱う入出力の
スキーマが異なるため独立している）。

---

## 4. アーキテクチャ

### 4.1 モジュール構成

```text
packages/a2a-server/src/
├── index.ts                  Honoアプリの組み立てとサーバー起動
├── config.ts                 環境変数からのサーバー設定読み込み
└── modules/
    ├── a2a/                  GitHub OAuth認証ミドルウェア、共通リクエスト/レスポンスモデル
    ├── health/                ヘルスチェック（§1.3の未解決事項参照）
    ├── pr-info/               PR Info Collector
    ├── reviewers/             React/Vue/Angular/Svelte/Security の各技術レビュアー
    ├── lead-engineer/         Lead Engineer
    └── orchestrator/          3段階ワークフロー全体
```

各モジュールは`{module}.route.ts`（Honoルーティング + 認証ミドルウェア + バリデーション）と
`{module}.service.ts`（AgentCard生成・タスク実行・TaskStore）に分かれる。ルート層はHTTPの関心事
（ステータスコード、リクエスト検証）のみを扱い、実際のレビューエージェント呼び出しは
サービス層が`@code-review-agent/agent-core`のクラス（`PRInfoCollector`、`ReviewOrchestrator`、
`LeadEngineerAgent`、各技術レビュアークラス）を直接インスタンス化して行う。

### 4.2 Orchestrator（フルワークフロー）

`/orchestrator`は3段階を1タスクとして直列に実行する: `PRInfoCollector.collect()` →
`ReviewOrchestrator.run()`（内部で対象スタックの技術レビュアー + SecurityReviewerを並列実行） →
`LeadEngineerAgent.evaluate()`。各ステージの出力は対応するZodスキーマで`parse()`し、途中の
どのステージで例外が起きてもタスク全体が`failed`になる（部分結果は返さない）。

---

## 5. サーバー構成

`index.ts`が単一のHonoアプリを組み立て、各モジュールのルートを`app.route(prefix, subApp)`で
マウントする。設定（`config.ts`の`loadServerSettingsFromEnv()`）はプロセス起動時に一度だけ
環境変数から読み込み、各モジュールのサービス生成時に注入する。ポートは`3000`固定
（`@hono/node-server`の`serve()`に渡す）。

---

## 6. 環境変数リファレンス

| 変数 | 必須/任意 | 説明 |
|---|---|---|
| `CODE_REVIEW_PROVIDER_TYPE` | 任意（既定`openai`） | `openai` または `ollama`。不正値は起動時エラー |
| `CODE_REVIEW_LLM_BASE_URL` | 任意 | OpenAI互換ベースURL（OpenAI経路）またはOllamaホスト（Ollama経路、`/v1`なし） |
| `CODE_REVIEW_MODEL_ID` | 任意（既定`gpt-4o`） | 使用モデルID |
| `CODE_REVIEW_MAX_TOKENS` | 任意 | 生成トークン数上限（[docs/model-provider-factory-spec.md](model-provider-factory-spec.md) §3.1参照） |
| `CODE_REVIEW_FREQUENCY_PENALTY` | 任意 | OpenAI経路のみ有効（同§3.2参照） |

`GITHUB_TOKEN`はサーバー側の環境変数としては扱わない。各リクエストの`Authorization: Bearer`
ヘッダーから取得し、リクエストごとにダウンストリームのAgentへ転送する（§7.1/§7.3参照）。

AgentCardの`url`フィールドはこの一覧の変数群とは別に、Orchestrator・技術レビュアー各サービスが
受け取る`agentBaseUrl`（既定`http://localhost:3000`）/`agentUrl`（個別上書き）設定から解決される。
現時点でこれらを個別の環境変数として公開する配線は実装されていない
（サービス生成側のオプションとしてのみ存在する）。

Python版時点の網羅的な環境変数一覧・`.env`サンプルは
[docs/plan/a2a-api-design.md](plan/a2a-api-design.md)を参照（Ollama切り替え等の一部記述は
`CODE_REVIEW_PROVIDER_TYPE`導入前の古い方式のため、[docs/model-provider-factory-spec.md](model-provider-factory-spec.md)の
現行方式を優先すること）。

---

## 7. セキュリティ設計

実装前のセキュリティ審査（2026-06-08、Python版設計時）で特定した問題と、各設計判断の記録。
以下はいずれも現行TS実装（`auth.middleware.ts`、各`{module}.service.ts`の`sanitizeError()`）で
確認済みの、現在も有効な設計。

### 7.1 API認証方式

**問題**: `/tasks/send`エンドポイントに認証機構がなく、同一ネットワーク内のすべてのクライアントが
無制限にタスクを投入できる状態だった。

**検討した選択肢**:

| 選択肢 | 採用/却下の理由 |
|---|---|
| X-API-Keyヘッダー | API キーの独自管理（ローテーション・失効管理）コストが発生するため却下 |
| **GitHub OAuth / OIDC（採用）** | GitHubアカウントはPRオーナーの前提として既に存在し、外部IdP依存ゼロ。認証と`github_token`注入を同時に解決できる |
| Entra ID / Auth0 | 追加のIdP依存が増える。主要ユーザーはGitHubユーザーのため過剰 |
| 認証なし（ネットワーク隔離） | ネットワーク設定ミスが全公開に直結するため却下 |

**採用方針**: `Authorization: Bearer <github_access_token>`を`GET https://api.github.com/user`で
検証する（`auth.middleware.ts`）。検証成功時、トークンとGitHub user IDをリクエストコンテキストに
保存し、後続のタスク実行・所有者照合に使う。

### 7.2 `llm_base_url`の扱い（SSRF対策）

**問題**: LLMベースURLをリクエストボディで受け付ける設計では、攻撃者がクラウドメタデータ
サービス（例: AWS IMDSv1の`169.254.169.254`）を指定した場合にサーバーからそこへリクエストが
発行されるリスクがある（SSRF）。

**採用方針**: `CODE_REVIEW_LLM_BASE_URL`はサーバー環境変数のみで設定し、リクエストボディからは
受け付けない。LLMプロバイダー切り替えはデプロイ設定であり、リクエスト単位での変更は不要という
判断（URLバリデーションやallowlistでの防御はDNSリバインディング等で抜け漏れが残るため不採用）。

### 7.3 `github_token`のリクエストボディへの混入回避

**問題**: GitHubトークンをJSONリクエストボディに含める設計では、HTTPアクセスログ
（リバースプロキシ等）にトークンが記録されるリスクがある。

**採用方針**: §7.1のGitHub OAuth採用により、`Authorization: Bearer`ヘッダーから取得した
トークンを内部的に使い回す。トークンをリクエストボディのフィールドとして受け付ける設計は
採らない。

### 7.4 例外メッセージへのトークン漏洩対策

**問題**: 例外メッセージをそのままタスクのエラーとして保存すると、GitHub MCPクライアントが
例外送出時に`Authorization: Bearer <token>`をメッセージに含めるケースで、タスク取得
レスポンスにトークンが露出しうる。

**採用方針**: `sanitizeError()`が`Bearer <token>`・`ghp_*`・`gho_*`・`github_pat_*`パターンを
`[REDACTED]`に置換してから保存する。全モジュールの`service.ts`が共通してこの関数を持つ
（重複実装だが、モジュールごとに独立したTaskStore設計と対称）。

### 7.5 TaskStoreのTTL

**問題**: タスクが完了後もプロセス再起動まで破棄されないと、タスク結果（PR情報等の大量データ）
がメモリに蓄積し続ける。

**採用方針**: 完了・失敗から30分（1800秒）で自動削除する。ポーリング猶予として30分は十分と判断し、
外部KVストアへの移行は現時点では見送っている（インフラ依存を増やさない判断）。

### 7.6 TLS（HTTPS）必須化

本番環境ではTLS termination（リバースプロキシ、Kubernetes Ingress等）を前段に配置しHTTPSを
使用することを必須とする（§1.3参照）。

### 7.7 AgentCardによるサービストポロジーの公開（将来の対応事項）

`.well-known/agent.json`の`url`フィールドには内部サービスのURLが含まれ、認証なしで公開される。
モノリス構成（§1.3）では許容範囲とするが、将来サービス分割する場合は内部URLをAgentCardに
含めず外部公開URLのみにすること。

---

## 8. 関連ドキュメント

- 実装計画・検証手順・Python版からの移行経緯: [docs/plan/a2a-api-design.md](plan/a2a-api-design.md)
- モデルプロバイダー設計: [docs/model-provider-factory-spec.md](model-provider-factory-spec.md)
- 並列レビュー段のアーキテクチャ: [docs/review-agents-design.md](review-agents-design.md)
- Lead Engineer合成ステージ: [docs/lead-engineer-agent-design.md](lead-engineer-agent-design.md)
- 評価パイプラインのコンテナ実行化: [docs/eval-a2a-container-runtime-spec.md](eval-a2a-container-runtime-spec.md)
