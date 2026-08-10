# `agents/` + `tools/` TypeScript移行 設計ドキュメント (Issue #252)

Epic [#249](https://github.com/kuju63/code-review-agents/issues/249)（全面TS化）の Sub-Issue③。
Sub-Issue①(#250, PR #256)が整備した pnpm workspace / TS toolchain と、Sub-Issue②(#251, PR #258)が
`packages/agent-core/src/models/` へ移植した Zod スキーマの上に、`src/code_review_agent/agents/`
(2,595行)と `src/code_review_agent/tools/`(183行)を Strands Agents TypeScript SDK
(`@strands-agents/sdk@1.12.0`)へ移植する。

Issue #252 本文が明示する完了条件は「単体テスト・型チェックが通ること」のみで、`api/` ルーター層は
Python のまま残り、TS化した `agents/` を import して動く統合システムにはしない(E2E動作確認は
Sub-Issue #253 の範囲)。Python側の `src/code_review_agent/agents/`・`tools/` は削除しない。撤去は
#255 の責務。

## 0. スライス分割方針

対象は14ファイル・本体2,595+183行、対応するPythonテストは4,500行超あり、Sub-Issue①・②のように
単独PR化するには大きすぎる。依存順に4スライスへ分割し、それぞれをIssue #252のSub-Issueとして
GitHub上に登録した上でStacked PRとして積む:

| スライス | Sub-Issue | 内容 |
|---|---|---|
| A(本ドキュメント・本PRの対象) | [#259](https://github.com/kuju63/code-review-agents/issues/259) | 基盤: `exceptions` / `model-provider-factory` / `github-mcp`(+参照カウントラッパ) / `tool-result-sanitizer` / `manifest-detection` / `agent-skills-factory` |
| B | [#260](https://github.com/kuju63/code-review-agents/issues/260) | `base-reviewer` / `registry` / `reviewers/*` |
| C | [#261](https://github.com/kuju63/code-review-agents/issues/261) | `review-orchestrator` / `lead-engineer` |
| D | [#262](https://github.com/kuju63/code-review-agents/issues/262) | `pr-info-collector` |

## 1. 決定済み事項（本Issue着手前に確定していたもの）

| 項目 | 決定 | 出典 |
|---|---|---|
| 配置先 | `packages/agent-core/src/{agents,tools,skills}/` | `typescript-toolchain-spec.md` §2.1、`typescript-models-migration-spec.md`の`models/`配置を踏襲 |
| ブランチ分岐元 | `feat/ts-migration/251-models-zod`(Stacked PR) | ユーザー指示 |
| テストランナー/カバレッジ閾値 | vitest、colocated `*.test.ts`、75%(lines/functions/branches/statements) | `vitest.config.ts`(#250で導入済み)、`models/`の実績 |
| api/ とのブリッジ | 作らない | Issue #252本文「単体テスト・型チェックが通ることが完了条件、E2Eは#253」 |

## 2. 要検討事項（比較表 + 採用/却下理由）

### 2.1 共有GitHub MCPクライアントの参照カウント管理

Python版は `strands.tools.mcp.MCPClient` 自体が `add_consumer`/`remove_consumer` という参照カウントAPIを
持ち、`ReviewOrchestrator`(スライスC)が複数レビュアー間で1接続を共有する際に利用している。
`@strands-agents/sdk@1.12.0`の`McpClient`(`node_modules/@strands-agents/sdk/dist/src/mcp/client.d.ts`)
を一次情報として確認したところ、`connect()`/`disconnect()`のみで参照カウント相当のAPIは存在しない。

| 選択肢 | 概要 | 採用/却下 | 理由 |
|---|---|---|---|
| ① `tools/shared-mcp-client.ts`として自前で参照カウントラッパーを実装 | `McpClient`を1つ内部に保持し、`addConsumer(key)`/`removeConsumer(key)`でカウントを管理、0になったら`disconnect()` | **採用** | SDKにAPIが無い以上、Pythonと同等の「複数レビュアーで1接続を共有し、最後の利用者が抜けたら切断する」挙動を再現するには自前実装が必須。スライスC(orchestrator)の消費者だが、単体でテスト可能な葉ノードなのでスライスAに含める |
| ② 参照カウントを諦め、レビュアーごとに個別接続する | Python版のような接続共有をやめる | 却下 | Issue #115由来の「起動時の輻輳を避けるため1接続を共有する」という既存の設計意図(`docs/mcp-connection-stabilization-spec.md`)を後退させることになり、スライスCで再度輻輳問題が再燃するリスクがある |

**採用**: `tools/shared-mcp-client.ts`に`SharedMcpClient`(仮称)を実装。

### 2.2 GitHub MCPクライアントの接続ライフサイクルの所有権

Python版は `Agent(tools=[mcp_client])` で `Agent` に `MCPClient` の所有権を委譲し、`agent.cleanup()`が
参照カウントの減算を含む後始末をする設計だった。TS SDKの `Agent`(`agent/agent.d.ts`)・実装
(`agent/agent.js:368`)を確認したところ、`initialize()`内で`this._mcpClients`を`connect()`するのみで、
`disconnect()`する経路もcleanup/disposeメソッド自体も存在しない。

| 選択肢 | 概要 | 採用/却下 | 理由 |
|---|---|---|---|
| ① 接続の所有権は常に呼び出し側に置く | `McpClient`の生成・`connect()`・`disconnect()`は呼び出し元(スライスB/Cのreviewer/orchestrator)が明示的に行う。`Agent`にはconnect済みのインスタンスを渡すだけ | **採用** | SDKが後始末をしない以上、この設計以外に選択肢がない。Python版の「`agent.cleanup()`経由で参照カウントを減算する」という間接的な仕組みが不要になり、呼び出し側が直接`SharedMcpClient.removeConsumer()`/`McpClient.disconnect()`を呼ぶだけの単純な設計にできる(スライスB/Cで反映) |

**採用**: 呼び出し側所有。本スライスの`shared-mcp-client.ts`・`github-mcp.ts`はこの前提でAPIを設計する。

### 2.3 GitHub MCP接続のretry実装

Python版は`client.start`を`tenacity`でインスタンス単位にmonkey-patchし、`stop_after_attempt`+
`wait_random_exponential`(指数バックオフ+ジッター)を実現している。

| 選択肢 | 概要 | 採用/却下 | 理由 |
|---|---|---|---|
| ① `tools/retry.ts`として自前実装 | 指数バックオフ+ジッターのみを実装した小さなヘルパー関数、`client.connect = withRetry(client.connect.bind(client), opts)`という形でインスタンスプロパティとして差し替える | **採用** | 必要な機能は「N回まで、特定のエラー型のときだけ、指数バックオフ+ジッターで再試行する」のみで15行程度に収まる。`connect`はpublicメソッドでprivateフィールドに依存しないため、Pythonのmonkey-patchと同じ手法(インスタンスプロパティでprototypeメソッドをシャドーする)がそのまま使える |
| ② `p-retry`等のnpmパッケージを新規依存として追加 | 汎用retryライブラリを導入 | 却下 | ジッター付き指数バックオフ+特定エラー型のみリトライ、という要件に対して汎用ライブラリのAPI面(callback, AbortSignal対応等)は過剰。自前実装で十分かつ依存を増やさない |

**採用**: `tools/retry.ts`に`withRetry(fn, { attempts, baseDelayMs, shouldRetry })`を実装。

### 2.4 `OllamaUnsupportedContentSanitizer`のフック登録方式

Python版は`Agent(hooks=[OllamaUnsupportedContentSanitizer()])`のようにコンストラクタ引数として渡す。
TS SDKの`AgentConfig`(`agent/agent.d.ts`)には`hooks`フィールドが存在せず、`agent.addHook(EventType,
callback)`という構築後のメソッド呼び出しのみが提供されている。`AfterToolCallEvent.result`
(`hooks/events.d.ts`)はmutableで、Python版の「`"document"`形状のcontentを検出して除去する」ロジックは
そのまま移植可能。

| 選択肢 | 概要 | 採用/却下 | 理由 |
|---|---|---|---|
| ① `Plugin`として実装し`initAgent`内で`addHook`する | `AgentSkills`と同じ`Plugin`インターフェース(`initAgent(agent)`)を実装し、その中で`agent.addHook(AfterToolCallEvent, ...)`を呼ぶ | **採用** | `AgentConfig.plugins`配列に含めるだけでよく、呼び出し側(スライスB)が`addHook`の呼び出しを書き忘れるリスクがない。`AgentSkills`と同じ`plugins`配列に載せられ、Ollama利用時のみ有効化する既存の分岐(`provider_type == ProviderType.OLLAMA`)ともそのまま整合する |
| ② 呼び出し側で毎回`agent.addHook(...)`を明示的に呼ぶ | Pluginにせず、reviewer側のコードで直接登録 | 却下 | Ollama分岐のたびに`addHook`呼び出しをコピーすることになり、登録忘れのリスクがある。テストもPlugin単体でモックしにくくなる |

**採用**: `tools/tool-result-sanitizer.ts`で`Plugin`インターフェースを実装する`OllamaUnsupportedContentSanitizer`を提供。

### 2.5 GitHub MCPクライアントのtransport構築方法

Python版は`streamable_http_client`+`create_mcp_http_client`を`_github_mcp_transport`という
`asynccontextmanager`で手動組み立てし、30秒/300秒のconnect/SSE-readタイムアウトと
`follow_redirects=True`を明示している。TS SDKの`McpClient`コンストラクタ(`McpClientConfig`)は
`url`/`headers`を直接受け取り、StreamableHTTP transportを自動構築する。

| 選択肢 | 概要 | 採用/却下 | 理由 |
|---|---|---|---|
| ① `new McpClient({ url, headers: { Authorization: ... } })`をそのまま使う | SDKの自動transport構築に任せる | **採用** | 手動でtransportを組み立てる理由(Python側は`streamablehttp_client`が非推奨で内部実装に依存する必要があった)がTS側には存在しない。タイムアウト値の個別指定に対応する設定項目が`McpClientConfig`に見当たらないため、SDKデフォルトを採用し、実装中に挙動が不十分と判明した場合はこのセクションを更新する |
| ② Python版同様に手動でtransportを組み立てる | `@modelcontextprotocol/sdk`の低レベルAPIを直接使う | 却下 | SDKが提供する`url`/`headers`だけで同等の接続が確立でき、複雑さを増やす理由がない |

**採用**: `McpClient({ url, headers })`。タイムアウト値の扱いは実装時に再確認し、必要なら本セクションを更新する。

### 2.6 `skills/`ディレクトリの配置

Issue #252本文は「`src/code_review_agent/skills/**`は言語非依存のためAgentSkillsプラグイン経由で
そのまま読み込み可能と想定(実装時に要検証)」としていた。`@strands-agents/sdk/vended-plugins/skills`
の`AgentSkills`(`vended-plugins/skills/agent-skills.d.ts`)を確認したところ、`skills: SkillSource[]`に
ディレクトリパス文字列(`SKILL.md`を含むディレクトリ、またはその親ディレクトリ)をそのまま渡せる設計になっており、要検証事項は解決した。

| 選択肢 | 概要 | 採用/却下 | 理由 |
|---|---|---|---|
| ① `src/code_review_agent/skills/**`を移動せず、TS側からリポジトリルート相対パスで参照する | 資産(SKILL.md、references等)はそのまま、`agent-skills-factory.ts`が既存パスを指す | **採用** | Issue本文の想定通りSDKが文字列パスを直接受け付けるため、コンテンツを複製・移動する理由がない。Python資産の撤去は#255の責務であり、それまでは両言語から同一ディレクトリを参照する状態が正しい(移行中の一時的な共有) |
| ② `packages/agent-core/skills/`等へコピー・移動する | TS側専用のディレクトリを新設 | 却下 | #255でPython資産を撤去するまでの間、同一内容を2箇所で保守することになり、ドリフトのリスクがある。移動は#255(Python資産撤去)のタイミングで一括して行うのが自然 |

**採用**: 移動しない。`skills/agent-skills-factory.ts`は`src/code_review_agent/skills/`配下を指す。

### 2.7 `model_provider_factory.ts`のプロバイダ表現

| 選択肢 | 概要 | 採用/却下 | 理由 |
|---|---|---|---|
| ① `ProviderType`をunion literal型(`"openai" \| "ollama"`)+ `as const`オブジェクトで表現 | `models/review.ts`のZod enumパターン(オブジェクト形式)とは別に、Zodで検証する必要のない内部設定値として単純なunion型で扱う | **採用** | `ProviderType`は環境変数(`CODE_REVIEW_PROVIDER_TYPE`)から読み込む設定値であり、LLM構造化出力やJSON境界を越える値ではない。`models/`のZod enumパターンをそのまま流用する必然性がなく、単純なunion literalで十分 |
| ② `models/review.ts`と同じ`z.enum({...})`パターンを使う | 一貫性のためZod enumで統一 | 却下 | Zodスキーマは「LLM構造化出力やJSON境界を検証する」ためのものであり、`ProviderType`はそのいずれでもない。一貫性のためだけに不要な依存(Zodのparseコスト)を持ち込む理由がない |

**採用**: `export type ProviderType = "openai" | "ollama";` + `export const ProviderType = { OPENAI: "openai", OLLAMA: "ollama" } as const;`。

## 3. 依存関係の追加

- `packages/agent-core/package.json`: `ai-sdk-ollama@^3.8.8`(`docs/typescript-toolchain-spec.md` §5の
  申し送り通り3.8.x固定。`4.1.0`は`LanguageModelV4`で`@strands-agents/sdk`が要求する`LanguageModelV3`と
  型不整合)、`yaml`(`pnpm-lock.yaml`解析用、Python版`yaml.safe_load`相当)。
- `renovate.json`: `packageRules`に`ai-sdk-ollama`の`allowedVersions`(3.8.x固定)を追加。既存の
  `serena-agent`エントリと同じ形。#256のリスク欄で「#252が実依存として追加する時に守れ」と申し送られていた対応。

## 4. 計画からの逸脱

実装中に本ドキュメントの決定から逸脱した場合は、#258の運用に倣い同一コミットで本ドキュメントも更新する。
