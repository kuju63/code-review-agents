# a2a-server: undici HTTP/2 アイドルエラーによるプロセス終了の防止 Spec

- 関連 Issue: [#296](https://github.com/kuju63/code-review-agents/issues/296)
- 対象: `packages/a2a-server`

## 1. 背景・現象

`/orchestrator/tasks/send` のタスクが失敗(例: `OPENAI_API_KEY` 未設定)した後、アイドル状態の
HTTP/2 セッションが undici の `socket idle timeout`(`InformationalError`, `code: UND_ERR_INFO`)
を `ClientHttp2Stream` 上で `error` として emit する。そのストリームにリスナーがないため、
Node.js が `Unhandled 'error' event` を投げてプロセス全体が終了する。

## 2. 調査結果(2026-10-20 時点)

| 観点 | 結果 |
|---|---|
| タスク単位の失敗分離 | `runTask` が try/catch で `setFailed` に流す。**既に分離済み**で、Promise 経由のエラーは原因ではない |
| MCP クライアントの切断 | PR info collector (`finally`)、`SharedMcpClient`(参照カウント)、`base-reviewer`(自作分のみ切断)とも、コード上は切断される |
| プロセス全体のハンドラ | `packages/` に `uncaughtException` / `unhandledRejection` のハンドラなし |
| 根本原因 | **未確定**。実接続(`api.githubcopilot.com`)と Node >=24 での再現が必要 |

## 3. 方針の検討

| 案 | 判定 |
|---|---|
| A: HTTP/2 無効の undici dispatcher を渡す | MCP 側は**不可**。`McpClient` の `url` 設定には fetch を渡す口がなく、`transport` を自前で渡すと SDK の再接続(transport 再構築)リトライが効かなくなり、`github-mcp.ts` のリトライ設計を壊す。OpenAI 側は `clientConfig.fetch` で可能だが、原因が OpenAI である証拠がない |
| B: 狭い `uncaughtException` ガード | **採用**。症状への対処であることを明記する |

## 4. 要件(案B)

- R1: `uncaughtException` が **undici のアイドルタイムアウト**(`error.code === "UND_ERR_INFO"` かつ
  メッセージに `socket idle timeout` を含む)の場合のみ、`console.warn` で記録してプロセスを継続する。
- R2: 上記以外の `uncaughtException` は従来どおり致命的として扱う。ハンドラ登録でデフォルトの
  クラッシュ挙動が失われないよう、エラーを記録して `exit(1)` する。
- R3: ガードは `index.ts` の起動時に1回だけ登録する。登録対象(process 相当)と終了関数は注入可能にし、
  テストで実プロセスを巻き込まない。
- R4: 握りつぶしたことを運用で追えるよう、warn ログにエラーの `code` と `message` を含める。

## 5. 非目標

- 根本原因(切断済みセッションにエラーが届く理由)の特定と除去。これは**別途調査**し、判明したら
  このガードを撤去できるかを再評価する。
- `unhandledRejection` の扱い変更。

## 6. 変化しうる箇所(前提が崩れる条件)

- undici / Node のメジャー更新でエラーの `code` やメッセージが変わると、ガードが外れてクラッシュが再発する。
  その場合はテストの判定条件を更新する。
- 根本原因が判明し除去された時点で、このガードは不要になる。
