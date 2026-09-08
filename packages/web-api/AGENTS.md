# エージェント開発ガイド — web-api パッケージ

本 AGENTS.md は `packages/web-api` の開発ルールを説明します。
全体アーキテクチャ、開発プロセス、品質ゲートはリポジトリルートの
[AGENTS.md](../../AGENTS.md) と [CONTRIBUTING.md](../../CONTRIBUTING.md) を参照してください。
本パッケージ固有の事項は本稿を、それ以外はルート版を優先します。

## 概要

`packages/web-api` は `packages/web` から利用する Backend for Frontend (BFF) です。
Node.js 上の Hono アプリケーションとして、レビュー対象の登録、実行、結果参照、コメントの対応状態変更、
キャンセル、クローズを REST API として公開します。

現状の `src/index.ts` は Hono の初期起動確認のみです。以下は段階的に実装する目標構成です。

- REST API: Hono、`@hono/zod-openapi`、Zod
- 永続化: SQLite 3、`better-sqlite3`、Drizzle ORM
- AI Agent 連携: review agent の実行 API を呼び出し、非同期処理の状態を永続化する
- 流量制御: Valkey (`@valkey/valkey-glide`)。依存関係のみ導入済みで、現時点では未使用
- 実行環境: コンテナ化し、Kubernetes 上で稼働することを前提とする
- テスト: Vitest
- lint／format: リポジトリルートの Biome 設定

## API 契約

REST API の設計は [`docs/openapi/reviews.yaml`](../../docs/openapi/reviews.yaml) に準拠します。
パス、HTTP メソッド、operationId、パラメーター、ステータスコード、ヘッダー、request／response schema、
error taxonomy を独自判断で変更しないでください。

内部のユースケース境界とドメイン上の不変条件は
[ADR-0012](../../docs/adr/0012-shared-invocation-boundary.md) に従います。
`reviews.yaml` と内部契約に不一致が見つかった場合は、handler で差分を隠さず、実装前に関連ドキュメントを
更新して合意を取ってください。

### Hono／Zod OpenAPI

- アプリケーションには `OpenAPIHono` を使用する。
- route は `createRoute` で定義し、request と全 response を Zod schema で宣言する。
- path、query、header、JSON body は route schema と Zod OpenAPI middleware で検証する。
- handler 内で未検証の `c.req.param()`、`c.req.query()`、`c.req.json()` の値をそのまま使用しない。
- response body は `reviews.yaml` の schema と status code に一致させる。
- Zod schema、route 定義、handler を重複する型定義の代わりに単一の型推論元として使用する。
- OpenAPI document をアプリケーションから公開または生成する場合も、`reviews.yaml` との契約テストを設け、
  意図しない差分を許容しない。
- query (`GET`) は副作用を持たせず、command (`POST`) との責務を分離する。

### REST の重要な不変条件

- `POST /reviews` と `POST /reviews/{reviewId}/attempts` では `Idempotency-Key` を必須とする。
- 同一キーかつ同一 payload は既存リソースの現在状態を返し、新しい Review／ReviewAttempt を作らない。
- 同一キーで payload が異なる場合は `409 conflict` とする。
- `attemptId`、transport-level `taskId`、queue job identifier は同一値として扱う。
- 非同期処理は受付と実行完了を分離し、attempt の状態は polling で取得できるようにする。
- error response は共通 `ErrorResponse` と taxonomy を使用し、内部例外、stack trace、PAT、接続情報を返さない。
- `Retry-After` が契約で必要な応答ではヘッダーを欠落させない。

## 推奨構成

機能追加時は、起動処理へ route、DB、外部連携を集約せず、責務ごとに分離してください。

```text
packages/web-api/
├─ src/
│  ├─ index.ts                 # Node.js server の起動のみ
│  ├─ app.ts                   # OpenAPIHono の構築、middleware、route 登録
│  ├─ config.ts                # 環境変数の読み込みと Zod 検証
│  ├─ modules/
│  │  └─ reviews/
│  │     ├─ reviews.schema.ts  # request／response の Zod OpenAPI schema
│  │     ├─ reviews.route.ts   # createRoute と HTTP adapter
│  │     ├─ reviews.service.ts # ユースケース調整
│  │     └─ *.test.ts
│  ├─ db/
│  │  ├─ client.ts             # better-sqlite3／Drizzle の初期化
│  │  └─ schema.ts             # Drizzle のテーブル定義
│  └─ integrations/
│     ├─ agent/                # AI Agent 呼び出し adapter
│     └─ valkey/               # 将来の流量制御 adapter
├─ migrations/                 # drizzle-kit が生成する migration
├─ drizzle.config.ts
├─ package.json
└─ tsconfig.json
```

これは責務境界を示す基準です。機能の増加に応じて module 単位で分割し、ファイル名だけを合わせた
空の抽象化は作らないでください。

## 永続化 — SQLite／Drizzle

テーブル定義書は別途管理せず、Drizzle schema をデータ構造の正本とするコードファースト方式を採用します。
ただし、外部 API の正本は DB schema ではなく `reviews.yaml` です。DB row をそのまま API response として
返さず、ドメイン／response model へ明示的に変換してください。

- テーブル、column、index、foreign key、unique constraint は Drizzle schema で宣言する。
- schema 変更は `db:generate` で migration を生成し、生成物をレビュー対象に含める。
- 既存環境の DB を直接変更せず、`db:migrate` で再現可能にする。
- migration は適用済み環境を考慮し、既存 migration を書き換えない。
- Review、ReviewAttempt、report／comment disposition、idempotency、queue/runtime state の責務を混同しない。
- idempotency の確認、容量確認、受付レコード作成など原子性が必要な操作は同一 transaction で行う。
- SQLite の foreign key、busy timeout、journal mode、transaction 境界を起動時に明示的に設定する。
- DB client は request ごとに生成せず、application lifecycle で共有し、テストでは注入可能にする。
- テストでは一時 DB または test ごとに分離した in-memory DB を使い、開発／本番 DB を参照しない。

## AI Agent／Valkey 連携

外部連携は interface と adapter の境界を設け、route handler から SDK client を直接操作しないでください。
タイムアウト、キャンセル、上流エラーを API の attempt status と error taxonomy へ明示的に変換します。

Valkey は将来、AI Agent 呼び出しの流量制御に使用する予定ですが、現時点では未使用です。

- 未使用の Valkey を必須依存として起動経路へ組み込まない。
- 流量制御を実装するまでは SQLite の永続状態を Valkey に二重書きしない。
- 導入時は queue の正本、障害時動作、再試行、TTL、冪等性、SQLite との整合性を先に仕様化する。
- Valkey 障害時に受付を継続するか fail closed とするかを暗黙に決めない。
- connection string や credential は環境変数から取得し、ログや error response に含めない。

## Kubernetes／コンテナ

- process は stateful な singleton を前提にせず、設定は環境変数から受け取る。
- SIGTERM を処理し、新規受付停止、実行中 request の drain、DB／Valkey connection の close を行う。
- liveness と readiness 用 endpoint を分離する。readiness は必要な依存先へ安全に接続できるかを反映する。
- コンテナは non-root user で実行し、書き込み先を SQLite DB と一時ディレクトリに限定する。
- secret を image、manifest、ConfigMap、ログへ埋め込まない。Kubernetes Secret 等から注入する。
- SQLite DB は再起動後も保持する PersistentVolume に配置し、`emptyDir` を永続データに使用しない。
- SQLite file を共有できない複数 node／replica へ水平分割しない。複数 replica が必要になった時点で、
  単一 writer 構成または外部 RDB への移行を設計する。
- schema migration を複数 Pod から競合実行しない。init container、Job、または deployment 手順の
  いずれか一つに実行責務を限定する。
- port、DB path、Agent endpoint、timeout、Valkey endpoint はハードコードしない。

## テスト

実装より先にテストを追加し、Red → Green → Refactor の順序を守ります。
テストは対象コードと同じ module に `*.test.ts` または `*.spec.ts` として配置します。

最低限、変更内容に応じて次を検証してください。

- `app.request()` または Hono の `testClient()` による route の正常系
- path／query／header／body の validation error
- `reviews.yaml` が定める status、header、response schema
- Idempotency-Key replay と payload conflict
- Review／ReviewAttempt の状態遷移と不正遷移
- transaction rollback、unique constraint、foreign key
- upstream timeout／failure／cancel のエラー変換
- secret や内部例外を error response に含めないこと
- process 再起動後にも必要な SQLite 状態を復元できること

新規／変更コードのカバレッジは 75% 以上を維持してください。

## コマンド

TypeScript ツールチェーンを使用するコマンドには `nix develop --command` を前置します。
リポジトリルートから workspace filter を使用してください。

```bash
# 開発サーバー
nix develop --command pnpm --filter web-api run dev

# build／起動
nix develop --command pnpm --filter web-api run build
nix develop --command pnpm --filter web-api run start

# テスト
nix develop --command pnpm --filter web-api exec vitest run

# Drizzle migration
nix develop --command pnpm --filter web-api run db:generate
nix develop --command pnpm --filter web-api run db:migrate

# package 単位の typecheck／Biome
nix develop --command pnpm --filter web-api exec tsc --noEmit
nix develop --command pnpm exec biome check packages/web-api --no-errors-on-unmatched

# OpenAPI 文書
nix develop --command pnpm run lint:openapi
```

完了前には、リポジトリルートの必須品質ゲートも実行してください。

```bash
nix develop --command pnpm exec tsc --noEmit
nix develop --command pnpm exec biome check --no-errors-on-unmatched
nix develop --command pnpm run test
```

## 設計・実装ルール

- feature／bug fix の実装前に Issue と仕様を明確化し、必要な `docs/` をコードより先に更新する。
- route handler は HTTP 変換に限定し、業務ロジックや SQL を直接記述しない。
- service は Hono の `Context` に依存させず、入力と戻り値を明示した TypeScript API にする。
- module は一つの責務に絞り、循環依存を作らない。
- 環境変数は起動時に Zod で検証し、不正な設定のまま request を受け付けない。
- `any`、型 assertion による validation の回避、未検証 JSON の domain model への代入を禁止する。
- 日時は API では RFC 3339、DB では変換規則を統一し、timezone を暗黙に扱わない。
- 識別子、状態、nullable field は `reviews.yaml` と domain model の意味を維持し、名前の一致だけで
  同一概念と判断しない。
- formatter／linter の設定は workspace の `biome.json` に準拠し、package 内で重複定義しない。
- API、DB schema、非同期処理、デプロイ前提を変更した場合は、対応する契約、migration、テスト、
  運用ドキュメントを同じ変更単位で更新する。
