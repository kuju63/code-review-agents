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

**追記(Issue #255 PR3で移動実施)**: 上表の却下理由(②)で「移動は#255のタイミングで一括して
行うのが自然」としていた通り、#255のPR3で`src/code_review_agent/skills/`配下のskillディレクトリ群を
`packages/agent-core/skills/`へ`git mv`し、`agent-skills-factory.ts`の`SKILLS_DIR`を
`resolve(import.meta.dirname, "../../skills")`に更新した。Python資産(`agent_skills_factory.py`、
`__init__.py`)は`src/code_review_agent/skills/`に残置しており、その撤去はPR5(#255の後続)の
責務のままである。

### 2.7 `model_provider_factory.ts`のプロバイダ表現

| 選択肢 | 概要 | 採用/却下 | 理由 |
|---|---|---|---|
| ① `ProviderType`をunion literal型(`"openai" \| "ollama"`)+ `as const`オブジェクトで表現 | `models/review.ts`のZod enumパターン(オブジェクト形式)とは別に、Zodで検証する必要のない内部設定値として単純なunion型で扱う | **採用** | `ProviderType`は環境変数(`CODE_REVIEW_PROVIDER_TYPE`)から読み込む設定値であり、LLM構造化出力やJSON境界を越える値ではない。`models/`のZod enumパターンをそのまま流用する必然性がなく、単純なunion literalで十分 |
| ② `models/review.ts`と同じ`z.enum({...})`パターンを使う | 一貫性のためZod enumで統一 | 却下 | Zodスキーマは「LLM構造化出力やJSON境界を検証する」ためのものであり、`ProviderType`はそのいずれでもない。一貫性のためだけに不要な依存(Zodのparseコスト)を持ち込む理由がない |

**採用**: `export type ProviderType = "openai" | "ollama";` + `export const ProviderType = { OPENAI: "openai", OLLAMA: "ollama" } as const;`。

### 2.8 `INFRA_EXCEPTIONS`(インフラ障害の再送出判定)の移植可否

Python版`agents/exceptions.py`の`INFRA_EXCEPTIONS = (EventLoopException, MCPClientInitializationError,
ToolProviderException, TransportError)`は、`review_orchestrator.py`(スライスC)が「業務エラーとして
`ReviewError`に握りつぶすのではなく再送出すべきインフラ障害」を型で判定するためのタプル。
`@strands-agents/sdk`の`errors.d.ts`を確認したところ、`ModelError`系(`ContextWindowOverflowError`/
`MaxTokensError`/`ModelThrottledError`等)は存在するが、Python版の`EventLoopException`・
`ToolProviderException`・`MCPClientInitializationError`に対応する専用クラスは無い。`McpClient.connect()`
の実装(`mcp/client.js`)を確認したところ、接続失敗はプレーンな`Error`として投げられ、業務エラーと型で
区別できない。

| 選択肢 | 概要 | 採用/却下 | 理由 |
|---|---|---|---|
| ① `exceptions.ts`には`StructuredOutputMissingError`のみ移植し、`INFRA_EXCEPTIONS`相当の判定はスライスCへ持ち越す | 本スライスでは判定を作らない。ただし`github-mcp.ts`(本スライス)がretry尽きた接続失敗を独自の`GithubMcpConnectionError`でラップして投げ、スライスCの`review-orchestrator.ts`が`ModelError`(SDK)+`GithubMcpConnectionError`(本スライス)の組み合わせで判定を組み立てられるようにしておく | **採用** | 存在しないSDKクラスを流用したふりをする(=`instanceof Error`のような無意味な判定を作る)よりも、「今の時点で確実に区別できるものだけを型として用意し、区別できないものは判定の責務ごと後段に渡す」方が正直で壊れにくい。`github-mcp.ts`が自前でエラー型を定義するのは、この階層(接続を実際に確立する場所)が「これは接続初期化の失敗である」と最も正確に判定できる箇所だから |
| ② 汎用の`isInfraError(error): boolean`関数を`exceptions.ts`に用意し、`error instanceof Error`のような緩い判定で近似する | 型がなくても関数として判定ロジックを一元化する | 却下 | 緩い判定は「業務エラーもインフラ障害も両方`Error`インスタンス」という前提のもとでは実質的に何も判定しないのと同じで、Python版が型で厳密に区別していた意図(A2Aタスク境界での`except Exception`とは別に、インフラ障害だけをタスク失敗として扱う)を満たせない。誤った安心感を持たせるくらいなら判定自体を持ち越す方がよい |

**採用**: `exceptions.ts`は`StructuredOutputMissingError`のみを本スライスで移植する。`GithubMcpConnectionError`は
`github-mcp.ts`(§2.5参照)で定義し、`INFRA_EXCEPTIONS`相当の組み立てはスライスC(review-orchestrator)の
Sub-Issue [#261](https://github.com/kuju63/code-review-agents/issues/261)側で行う。

## 3. 依存関係の追加

- `packages/agent-core/package.json`: `ai-sdk-ollama@^3.8.8`(`docs/typescript-toolchain-spec.md` §5の
  申し送り通り3.8.x固定。`4.1.0`は`LanguageModelV4`で`@strands-agents/sdk`が要求する`LanguageModelV3`と
  型不整合)、`yaml`(`pnpm-lock.yaml`解析用、Python版`yaml.safe_load`相当)。
- `renovate.json`: `packageRules`に`ai-sdk-ollama`の`allowedVersions`(3.8.x固定)を追加。既存の
  `serena-agent`エントリと同じ形。#256のリスク欄で「#252が実依存として追加する時に守れ」と申し送られていた対応。

## 4. スライスB: `base-reviewer` / `registry` / `reviewers/*`

Sub-Issue [#260](https://github.com/kuju63/code-review-agents/issues/260)。スライスA
(`feat/ts-migration/252-agents-tools-foundation`、PR #263、本ドキュメント執筆時点で未マージ)の
上にStacked PRとして積む。`base_reviewer.py`(416行)・`registry.py`(255行)・
`reviewers/{react,angular,vue,security,svelte}.py`(5ファイル)を移植する。

### 4.1 `review()`の同期→非同期化

Python版`ReviewAgent.review()`/`LLMReviewAgent.review()`は同期メソッドで、`strands.Agent.__call__`も
同期APIだった。`@strands-agents/sdk@1.12.0`の`Agent`(`agent/agent.d.ts:539`)を確認したところ、
`invoke(args: InvokeArgs, options?: InvokeOptions): Promise<AgentResult>`のみが提供され、同期呼び出しの
経路は存在しない。

| 選択肢 | 概要 | 採用/却下 | 理由 |
|---|---|---|---|
| ① `review()`を`Promise<ReviewResult>`を返す非同期メソッドに変更する | `ReviewAgent`/`LLMReviewAgent`の`review()`シグネチャを`async`化し、呼び出し側(スライスC)も`await`する | **採用** | SDKが同期呼び出しAPIを提供していない以上、他に選択肢がない |

**採用**: `abstract review(context: ReviewContext, projectType?: ProjectType): Promise<ReviewResult>`。

### 4.2 GitHub MCPクライアントのcleanup所有権(`review()`自身が負う)

§2.2で「接続の所有権は常に呼び出し側」と決定済みだが、スライスBの`review()`はこの決定の実際の適用箇所となる。
Python版は`agent.cleanup()`が「共有クライアントなら参照カウント減算、専有クライアントなら`stop()`」を
自動判定していたが、TSの`Agent`にはcleanup/disposeメソッド自体が存在しない(§2.2で確認済み)。加えて
`models/review.ts:82`の`ReviewContext.sharedMcpClient`は型が`McpClient`であり、`SharedMcpClient`(参照カウント
ラッパー、スライスA `tools/shared-mcp-client.ts`)そのものではない — つまり`review()`は共有クライアントの
参照カウントを直接操作する手段を持たない。

| 選択肢 | 概要 | 採用/却下 | 理由 |
|---|---|---|---|
| ① `context.sharedMcpClient`が渡された場合は`review()`側で一切disconnectせず、専有クライアント(`createGithubMcpClient`で自前生成した場合)のみ`finally`で`mcpClient.disconnect()`を直接呼ぶ | 参照カウント減算は`ReviewContext.sharedMcpClient`を渡す側(スライスCのorchestrator)の責務とし、`review()`は「共有か専有か」で分岐するだけの単純なtry/finallyにする | **採用** | `review()`のシグネチャ上、共有クライアントを参照カウント付きラッパー越しに受け取る手段がない(受け取るのは生の`McpClient`)以上、参照カウントの減算をこの層で行うことはできない。Python版の「Agent構築失敗時のみ`stop()`にフォールバックする」という条件分岐も、TS版はcleanup経路が最初から1本(`finally`)しかないため不要になる |
| ② `ReviewContext.sharedMcpClient`の型を`SharedMcpClient`に変更し、`review()`が`removeConsumer()`を呼べるようにする | `models/review.ts`のスキーマ自体を変更する | 却下 | `models/review.ts`はスライス完了済み(#251)の資産であり、本スライス(#260)の範囲外。また`ReviewContext`はスライスDの`pr-info-collector`等、レビュアー以外からも参照されうる汎用モデルであり、レビュアー固有の参照カウント管理の都合でモデル層の型を変えるべきではない |

**採用**: `review()`は「`context.sharedMcpClient`があれば触らない、無ければ自前生成し`finally`で`disconnect()`する」の2分岐のみ。参照カウント管理はスライスC側の責務として明確に切り分ける。

### 4.3 レビュアークラスのメタデータ表現(static/instance分割)

Python版は`ClassVar`で選択用メタデータ(`reviewer_id`/`perspective`/`project_types`)と挙動フラグ
(`uses_github_mcp`/`uses_url_fetch`/`skill_type`/`system_prompt`)を区別なく扱い、`registry.get_reviewer_classes`は
インスタンス化せずクラス属性(`cls.project_types`等)で選別する。TSでは`abstract static`メンバーの型付けが
言語機能として煩雑(TS 4.9時点でも構文糖衣が薄く、抽象クラスの静的側を強制する型はユーティリティ型で
回避する必要がある)。

| 選択肢 | 概要 | 採用/却下 | 理由 |
|---|---|---|---|
| ① 選択用メタデータのみ`static readonly`にし、挙動フラグはインスタンスの`readonly`フィールドにする | `registry.ts`は`ReviewerClass`インターフェース(`{ new (config): T; readonly reviewerId; readonly perspective; readonly projectTypes }`)でクラスを型付けし、インスタンス化前に`cls.reviewerId`等を直接読む。`usesGithubMcp`等は`review()`内でのみ`this.usesGithubMcp`として参照する | **採用** | `abstract static`を要求する型を`ReviewAgent`基底クラスに持たせずに済み、`registry.ts`が必要とする「インスタンス化前にクラスから選別できる」という制約と、`review()`が必要とする「`this.`でアクセスできる」という制約を両立できる |
| ② 全メタデータをstaticにし、`review()`内では`(this.constructor as typeof LLMReviewAgent)`でキャストして読む | Pythonの`ClassVar`を可能な限り忠実に再現する | 却下 | `review()`内で毎回`this.constructor`キャストを書くことになり、TSの型安全性の恩恵を失う割に、Pythonとの一致にどれほどの価値があるか不明。挙動フラグは選択ロジックに一切関与しない(=staticである必要がない)ため、素直にインスタンスフィールドにする方が可読性が高い |

**採用**: `ReviewerClass`インターフェース(選択用static) + インスタンス`readonly`フィールド(挙動フラグ)の分割。

### 4.4 `registerReviewer`の実装形式(デコレータではなく関数呼び出し)

Python版は`@register_reviewer`をクラスデコレータとして各reviewerクラスに付与する。

| 選択肢 | 概要 | 採用/却下 | 理由 |
|---|---|---|---|
| ① 各reviewerファイル末尾で`registerReviewer(ReactReviewer);`と素の関数呼び出しにする | クラス定義後、モジュールのトップレベルで登録関数を呼ぶだけ | **採用** | `verbatimModuleSyntax`/`isolatedModules`(`tsconfig.base.json`)が有効な状態でTS 5ネイティブデコレータを抽象基底クラスの具象サブクラスに対して正しく型付けするのは煩雑で、モジュールimport時に登録するという副作用の本質(Pythonの`@register_reviewer`と同じ)は関数呼び出しでも変わらない |
| ② TS 5ネイティブデコレータ構文(`@registerReviewer`)を使う | `(target: Class, context: ClassDecoratorContext) => Class`の形にして`@registerReviewer`と書く | 却下 | Pythonの見た目には近づくが、型定義の複雑さに見合うメリットがない(登録のタイミング・効果は関数呼び出しと完全に同一) |

**採用**: `registerReviewer(cls)`を関数として実装し、各reviewerファイル末尾で呼び出す。

### 4.5 `STRUCTURED_OUTPUT_DIRECTIVE`のフィールド名(`file_path`→`filePath`)

Python版の指示文は`file_path`/`line`という蛇形フィールド名を明示的に言及する。TS版の
`ReviewFindingSchema`(`models/review.ts`)は既に`filePath`(camelCase)で定義済み(#251で確定済み)。

| 選択肢 | 概要 | 採用/却下 | 理由 |
|---|---|---|---|
| ① 指示文中の`file_path`を`filePath`に置き換えて移植する | 文言以外は逐語移植、フィールド名のみモデル層の命名規則に追従させる | **採用** | LLMへの指示文がモデルの実際のフィールド名と食い違うと、モデルが誤った出力形状を生成するリスクがある。`ReviewFindingSchema`側を変更する理由がない以上、指示文側を合わせるのが妥当 |

**採用**: 指示文中の`file_path`/`line`のうち`file_path`を`filePath`に変更。`line`はcamelCase/snake_caseで同一表記のため変更不要。

### 4.6 `annotatePatch`の改行分割(`splitlines()`とのギャップを埋める)

Python版`_annotate_patch`は`patch.splitlines()`で分割・`"\n".join()`で再結合する。`str.splitlines()`は
(a)空文字列→`[]`、(b)末尾改行の有無を区別しない、(c)`\r\n`/`\r`も改行として扱う、という3つの性質を持つ。
JSの`"".split("\n")`は空文字列に対して`[""]`を返し、CRLFも1文字ずつ`\r`が残ってしまうなど、素朴な移植では
Python版の`TestAnnotatePatch`が期待する挙動(特に空パッチ→空文字列)と食い違う。

| 選択肢 | 概要 | 採用/却下 | 理由 |
|---|---|---|---|
| ① 専用の`splitPatchLines`ヘルパーを実装する | 空文字列は即`[]`を返し、`/\r\n\|\r\|\n/`で分割した上で末尾の空要素(末尾改行由来)を1つだけ除去する | **採用** | Python版の`TestAnnotatePatch`が網羅する空文字列・末尾改行あり/なし・複数hunk等のケースを全て同じ結果にするために必要な最小限の差分吸収 |
| ② `"\n"`のみで分割し、CRLFやトレーリング改行の差異を無視する | 素朴な`split("\n")` | 却下 | 空文字列入力で`[""]`が返り、hunkヘッダーにマッチしない1行分の余計な出力(空行1つ)が生成されてしまい、Python版と出力が一致しない |

**採用**: `splitPatchLines`ヘルパーを`annotatePatch`内部に実装し、Python版`splitlines()`相当の挙動に揃える。

### 4.7 URLフェッチツール(SDK標準の`httpRequest`をそのまま使用、独自実装しない)

Python版`SecurityReviewer`は`uses_url_fetch = True`により`strands_tools.http_request`をツールとして
追加する。検討序盤では「TS SDKに相当ツールが存在しない」という誤った仮説のもとで独自実装を計画したが、
`@strands-agents/sdk`の`node_modules`配下`dist/src/vended-tools/http-request/`を直接確認したところ、
`httpRequest: InvokableTool<HttpRequestInput, HttpRequestOutput>`
(`@strands-agents/sdk/vended-tools/http-request`からexport)がGET/POST/PUT/DELETE/PATCH/HEAD/OPTIONSの
全メソッド・ヘッダー・ボディ・タイムアウト(デフォルト30秒)に対応する形で最初から提供されていることを
確認した。

| 選択肢 | 概要 | 採用/却下 | 理由 |
|---|---|---|---|
| ① `@strands-agents/sdk/vended-tools/http-request`の`httpRequest`をそのまま`tools`配列に積む | 独自ツールを作らず、SDK標準ツールをimportして使うだけ | **採用** | Python版`strands_tools.http_request`と同等以上の機能(全HTTPメソッド・タイムアウト対応)を持つ既製品が存在する以上、車輪の再発明をする理由がない。追加の依存やコードは不要 |
| ② 独自の`tools/http-request-tool.ts`を新規実装する(GET/HEAD限定・https限定など制限を加えた最小版) | fetch APIベースの小さなラッパーを自作 | 却下 | SDK標準ツールの存在を見落として一度この方針を検討したが、独自実装はPython版より機能を絞ることになり(Python版はauth設定やドメイン許可リスト等を持つ)、かつSDK標準ツールと同じ土俵の車輪の再発明でしかない。既製品を使う①が明確に優位 |

**採用**: `SecurityReviewer`の`usesUrlFetch`実装は`@strands-agents/sdk/vended-tools/http-request`の`httpRequest`を`tools`配列にそのまま追加する。新規ファイルは作らない。

### 4.8 ファイル読み取りツール(`SKILLS_DIR`限定の最小自作、`fileEditor`+`Sandbox`は不採用)

5つのreviewer全てが`skillType`を`NONE`以外に設定しており、Python版は`strands_tools.file_read`を
`tools`に追加してAgentSkillsが提示する参照ファイルの中身を実際に取得させている。`@strands-agents/sdk`の
`vended-plugins/skills`(`AgentSkills`)を確認したところ、スキル資産のファイル一覧を提示する
アクティベーションツールのみを登録し、ファイル内容そのものは読まない設計であることを確認した。SDKの
`vended-tools`(`bash`/`fileEditor`/`httpRequest`/`notebook`/`sleep`の5つ、`vended-tools/index.d.ts`で全量確認済み)
には単純な読み取り専用ツールが無く、最も近い`fileEditor`は`view`/`create`/`str_replace`/`insert`の
読み書き両対応ツールで、`Sandbox`抽象クラス(`readFile`/`writeFile`/`removeFile`/`listFiles`/`execute`を
実装する必要がある)への依存を要求する(`sandbox/base.d.ts`で確認済み)。

| 選択肢 | 概要 | 採用/却下 | 理由 |
|---|---|---|---|
| ① `tools/file-read-tool.ts`として`SKILLS_DIR`配下に読み取りを限定した最小の読み取り専用ツールを自作する | `path.resolve(SKILLS_DIR, input.path)`で解決したパスが`SKILLS_DIR`外に出ないことを検証し、UTF-8でサイズ上限付きで読む。エラーは例外ではなく文字列で返す(Python版`file_read`の慣習を踏襲) | **採用** | reviewerが必要とするのは「`SKILLS_DIR`配下の参照ファイルを読む」というごく限定された読み取り専用の操作のみで、`fileEditor`が提供する書き込み・編集能力は不要かつレビュアーという役割にそぐわない権限(意図せずファイルを作成・編集できてしまう)を持ち込む。`Sandbox`のセットアップコストに見合う価値もない |
| ② `fileEditor` + カスタム`Sandbox`実装(`SKILLS_DIR`をルートとするローカルファイルシステムSandbox)を採用する | `Sandbox`を自作し`fileEditor`をそのまま使う | 却下 | `fileEditor`は`view`/`create`/`str_replace`/`insert`の4コマンドを持ち、`MakeFileEditorOptions`はname/descriptionのみでコマンド制限の設定項目がない(`file-editor/file-editor.d.ts`で確認済み)ため、読み取り専用に絞ることができない。read-onlyであるべきreviewerに書き込み系ツールを持たせるのは不要なリスクであり、`Sandbox`という重量級抽象(6つの抽象メソッド)を実装するコストにも見合わない |
| ③ ファイル読み取りツール自体を用意せず、`AgentSkills`のアクティベーションツールのみに頼る | `file_read`相当を持たせない | 却下 | `AgentSkills`はスキル資産のファイル一覧を提示するのみで内容を読まないため、これではreviewerがスキル参照資料(`references/`配下のガイドライン等)の実際の内容を一切参照できず、AgentSkills機能自体が実質的に無意味化する |

**採用**: `tools/file-read-tool.ts`に`SKILLS_DIR`限定の最小読み取り専用ツールを新規実装する。前提として`skills/agent-skills-factory.ts`から`SKILLS_DIR`をexportする(1行追加)。

## 5. スライスC: `review-orchestrator` / `lead-engineer`

Sub-Issue [#261](https://github.com/kuju63/code-review-agents/issues/261)。スライスB
(`feat/ts-migration/260-reviewer-chain`、PR #265、本ドキュメント執筆時点で未マージ)の
上にStacked PRとして積む。`review_orchestrator.py`(281行)・`lead_engineer.py`(292行)を移植する。
`models/lead-engineer.ts`(スキーマ・`toMarkdown`・`toEvaluationFormat`)は#251で移植済みのため、本スライスの
対象は両ファイルの**実行ロジック**(`ReviewOrchestrator`クラス・`LeadEngineerAgent`クラス)のみ。

### 5.1 タイムアウト制御(`AbortController`は不採用、stragglerを維持する)

Issue #261本文は`Promise.allSettled`/`AbortController`によるタイムアウト制御を候補に挙げているが、
Python版`_run_reviewer`のdocstringおよび`tests/agents/test_review_orchestrator.py`の
`test_shared_client_not_released_until_pending_reviewer_finishes`・
`test_task_cancellation_does_not_release_placeholder_early`が検証しているのは「タイムアウトに負けた
レビュアー(straggler)はキャンセルされず、共有MCPクライアントの参照カウントを実際に完走するまで
保持し続ける」という契約である。

| 選択肢 | 概要 | 採用/却下 | 理由 |
|---|---|---|---|
| ① `AbortController`でタイムアウト時に`Agent.invoke()`を中断する | タイムアウトに`AbortSignal`を紐付け、期限切れで対象レビュアーのPromiseを実際に中断する | 却下 | straggler契約(タイムアウトはPromiseを止めず、参照カウントはPromise完了時にのみ減る)と直接矛盾する。中断してしまうと、共有クライアントを使用中の他レビュアーとの接続を巻き込んで破壊しかねない |
| ② タイマーは「待つのをやめる」判断にのみ使い、対象Promiseは中断しない | 各レビュアーの`review()`呼び出しを`.catch()`付きでラップして`Map`に結果を格納する非同期関数として起動し、`Promise.race([Promise.all(wrapped), sleep(timeoutMs)])`で「全完了 or タイムアウト」を待つ。ラップ済みPromise自体は中断せず走らせ続け、`Map`に結果が届いた時点で参照カウントの`finally`が発火する | **採用** | Python版の`asyncio.wait(tasks, timeout=...)`(`pending`のタスクを単に待つのをやめるだけでキャンセルしない)と同じ意味論をPromiseベースで再現できる。straggler契約を壊さない |

**採用**: タイムアウトは「待つのをやめる」ためのタイマーとしてのみ実装し、`AbortController`は使わない。タイマーは完了時に必ず`clearTimeout`する(未クリアのタイマーがvitest/Nodeプロセスをハングさせるため)。

### 5.2 `INFRA_EXCEPTIONS`相当の分類(`isInfraError`、`ModelError`は内容起因のサブクラスを除外)

スライスA(§2.8)で「`INFRA_EXCEPTIONS`相当の組み立てはスライスC側で行う」と申し送り済み。Python版
`INFRA_EXCEPTIONS = (EventLoopException, MCPClientInitializationError, ToolProviderException, TransportError)`
に対応するSDK型は存在しない(PR #263本文で確認済み)。`@strands-agents/sdk`の`errors.d.ts`を読んだ結果、
`ModelError`(基底、モデルとの疎通失敗相当)のサブクラスに`ContextWindowOverflowError`・`MaxTokensError`・
`ModelThrottledError`があり、これらは1レビュアーのプロンプト/出力サイズやレート制限に起因する
コンテンツレベルの問題であって、システム全体の疎通異常ではない。

| 選択肢 | 概要 | 採用/却下 | 理由 |
|---|---|---|---|
| ① `instanceof ModelError`を無条件にinfra扱いする | `ModelError`及び全サブクラスをinfra判定に含める | 却下 | `ContextWindowOverflowError`/`MaxTokensError`/`ModelThrottledError`は1レビュアー単位の問題であり、Python版でもこれらに相当する例外は`INFRA_EXCEPTIONS`に含まれず`ReviewError`として分離される。無条件に含めるとバッチ全体を無用に中断させてしまう |
| ② `ModelError`から上記3サブクラスを除外し、`GithubMcpConnectionError`(スライスAの`tools/github-mcp.ts`)を追加してinfra判定する | `agents/exceptions.ts`に`isInfraError(error: unknown): boolean`を追加し、`error instanceof GithubMcpConnectionError \|\| (error instanceof ModelError && !(contentレベル3種のいずれか))`と判定する | **採用** | `GithubMcpConnectionError`は`.connect()`のリトライ枯渇時に投げられる、まさにPython版`TransportError`/`MCPClientInitializationError`相当のもの。`ModelError`から内容起因の3種を除外することで、Python版の「システム疎通異常のみを中断対象にする」という分類方針を維持できる |

**採用**: `agents/exceptions.ts`に`isInfraError(error: unknown): boolean`を追加。`GithubMcpConnectionError`、および`ContextWindowOverflowError`/`MaxTokensError`/`ModelThrottledError`を除く`ModelError`をinfra判定する。`StructuredOutputError`(SDK)・`StructuredOutputMissingError`(スライスA)は`Error`直系で`ModelError`を継承しないため、この判定から自動的に除外される(テストで明示的に確認する)。

### 5.3 共有MCPクライアントの接続責務(オーケストレーターが事前に`connect()`する)

`base-reviewer.ts`の`review()`(4.2で確定済み)は`context.sharedMcpClient`を素通しで`Agent`の`tools`に渡す
だけで、自分では`connect()`を呼ばない。SDK`mcp/client.d.ts`の`connect(reconnect?: boolean): Promise<void>`
のdoc comment: 「Called lazily before any operation that requires a connection」「`reconnect`が`true`
でない限り、既に接続済み/失敗済みなら実質no-op」。

Python版が`shared_client.load_tools()`を全レビュアー起動前に明示的に一度だけ呼ぶのは、複数レビュアーが
同時に同じクライアントへ`start()`しようとするレースを避けるため(`docs/mcp-connection-stabilization-spec.md`
§3.1)。

| 選択肢 | 概要 | 採用/却下 | 理由 |
|---|---|---|---|
| ① オーケストレーターがレビュアー起動前に`sharedClient.mcpClient.connect()`を1回呼ぶ | Python版の`load_tools()`事前呼び出しと同じ位置づけで、`ReviewOrchestrator.run()`内で共有クライアント構築直後に`connect()`する。失敗時は`removeConsumer(this)`してrethrow | **採用** | 複数の`Agent.invoke()`が同時に同じ未接続`McpClient`を初期化しようとするレースを、Python版と同じ理由で避けられる。`connect()`が冪等(lazy/no-op)なドキュメント記載のため、各レビュアーの`Agent`が後から同じクライアントに触れても二重接続エラーにならない |
| ② 各レビュアーの`Agent`に接続を任せ、オーケストレーターは何もしない | 最初に呼ばれた`Agent.invoke()`が`connect()`を暗黙的にトリガーする | 却下 | 複数レビュアーがほぼ同時に起動されるため、どの`Agent`が最初に`connect()`をトリガーするか不定になり、Python版が明示的に避けているレースを再導入してしまう |

**採用**: `ReviewOrchestrator.run()`が共有クライアント構築直後に`await sharedClient.mcpClient.connect()`を1回呼ぶ。

### 5.4 `run`/`run_async`の統合(単一の非同期`run()`のみ)

Python版は同期呼び出し元向けの`run()`(`asyncio.run`ラッパー)と非同期の`run_async()`を分けているが、
JSに同期/非同期の二重APIを持つ意味はない(呼び出し元は常にawaitできる)。

| 選択肢 | 概要 | 採用/却下 | 理由 |
|---|---|---|---|
| ① `run(context, projectType?, perspectives?): Promise<ReviewReport>`単一のasyncメソッドに統合する | Python版`run_async`相当の1メソッドのみを公開する | **採用** | JSに「イベントループの外から呼ぶための同期ラッパー」という概念自体が存在しない。呼び出し元(将来のAPI層、スライス#253)は常に非同期コンテキストにいる |

**採用**: `run()`単一メソッド。副作用として、Python版の`asyncio.run()`が持っていた「プロセス終了前にstragglerの完走を待つ暗黙のdrain」がTS版には無く、`run()`はstragglerが residual で走っている状態のままresolveする(長命なAPIサーバーでは問題にならない。テストでは`deferred` Promiseの完了を`await`でポーリングして参照カウント解放を確認する)。

### 5.5 `reviewers/index.ts`の登録副作用インポート

`agents/`配下には現状バレル(`index.ts`)が無く、`agents/reviewers/index.ts`のみが登録副作用用バレルとして
存在する。Pythonの`agents/__init__.py`が担っていた「レビュアー登録の保証」をTS側で代替する必要がある。

| 選択肢 | 概要 | 採用/却下 | 理由 |
|---|---|---|---|
| ① `review-orchestrator.ts`のモジュール先頭で`import "./reviewers/index.js"`する | オーケストレーターを構築(import)すれば登録が保証される | **採用** | 呼び出し順序への依存を避けられる最も近い代替パターン。`ReviewOrchestrator`はレビュアー登録が必須の唯一の実利用者である |
| ② 呼び出し元(将来のAPI層)にインポート責務を委ねる | `review-orchestrator.ts`自体は登録を仮定しない | 却下 | 呼び出し順序を呼び出し元の規律に頼ることになり、登録忘れによる「レビュアーが1つも選択されない」という静かな不具合を生みやすい |

**採用**: `review-orchestrator.ts`が`import "./reviewers/index.js"`を行う。

### 5.6 共有クライアントのconsumer集合の形(Python版より単純化)

Python版はconsumer集合が`{orchestrator, per-reviewer-placeholder, per-reviewer-Agent自身}`の3種類になりうる
(`agent.cleanup()`が自分自身をconsumerとして登録・解除するため)。TSの`Agent`にはcleanupメソッドが無く、
`ReviewContext.sharedMcpClient`は生の`McpClient`(§4.2で確認済み)なので、Agent自身がconsumer登録することは
構造上あり得ない。TS版のconsumer集合は`{orchestrator, per-reviewer-placeholder}`の2種類のみとなり、
1レビュアーの実行につき`removeConsumer`は正確に2回、という不変条件がPython版よりシンプルになる。この点は
コード変更を要する決定ではないが、テスト設計(呼び出し回数のアサーション)に直接影響するため記録する。

### 5.7 スライスD(`pr-info-collector`)は統合しない

Issue #261本文は「実装量次第でスライスDを本スライスに統合する可能性」に言及している。

| 選択肢 | 概要 | 採用/却下 | 理由 |
|---|---|---|---|
| ① スライスDを統合しない | `pr-info-collector.ts`は別スライスとして独立させる | **採用** | `pr_info_collector.py`は450行超で、既知のツール未使用バグ(structured_output単独呼び出しでMCPツールを使わず幻覚する問題、未修正)を抱えている。スタックは本スライスの時点で既に5段(250→251→252→260→261)に達しており、これ以上スタックを深くすると個々のPRのレビュー容易性が損なわれる |

**採用**: スライスDは統合せず、本スライス完了後に独立したPRとして着手する。

### 5.8 `selectReviewers`の単純化(複数project type dedupは実装しない)

Python版`_select_reviewers`は`detect_project_types`が複数のprojectTypeを返しうる前提で、ソート済み順に走査し
`dict.setdefault`で「同じレビュアークラスが複数typeにマッチしたら最初(最小)のtypeを採用」というdedupeを行う
(`test_multi_type_annotation_is_deterministic`で検証)。一方TS版`detectProjectTypes`(スライスB、`registry.ts`)
は仕様上**常に0件または1件のSetしか返さない**(§149の関数docコメントで確認済み: 「Detecting more than one
project type for a single PR is not supported: exactly one type is returned whenever any tier matches,
otherwise an empty set」)。

| 選択肢 | 概要 | 採用/却下 | 理由 |
|---|---|---|---|
| ① Python版のソート順走査+`Map`によるdedupeをそのまま移植する | 複数typeを想定したロジックを書く | 却下 | `detectProjectTypes`の契約上、この分岐に実際に到達するケースが存在しない。到達不能コードはカバレッジ100%を維持できず(スライスA/Bの新規ファイルは全て100%)、テストで到達させることも仕様上不可能 |
| ② `selectReviewers`は単一の`ProjectType`(明示的に渡されたもの、または`detectProjectTypes`が返すSetの唯一の要素)を解決し、`getReviewerClasses`を1回だけ呼ぶ | dedupeロジック自体を削除する | **採用** | TS版`detectProjectTypes`の契約と整合する最小の実装。`getReviewerClasses`自体が単一projectTypeに対して重複のない`ReviewerClass[]`を返す設計のため、追加のdedupeは元々不要 |

**採用**: `selectReviewers`は単一`ProjectType`のみを扱う。Python版`test_multi_type_annotation_is_deterministic`相当のテストは、対応する前提条件がTS版に存在しないため移植しない。

## 6. 計画からの逸脱

実装中に本ドキュメントの決定から逸脱した場合は、#258の運用に倣い同一コミットで本ドキュメントも更新する。
逸脱の詳細な経緯は [docs/plan/typescript-agents-tools-migration-spec.md](plan/typescript-agents-tools-migration-spec.md) に記録する。結果だけ述べると: 5.8は当初計画のPython版準拠複数type dedupeから
`detectProjectTypes`の実契約(0/1件のみ)に合わせた単純化に変更され、`base-reviewer.ts`には
`ReviewAgent.needsGithubMcp`という公開ゲッターが当初計画になかった追加として入っている
（オーケストレーターが`protected`な`usesGithubMcp`を直接読めないことが実装時に判明したため）。

## 7. スライスD: `pr-info-collector`

Sub-Issue [#262](https://github.com/kuju63/code-review-agents/issues/262)。スライスC
(`feat/ts-migration/261-orchestrator-lead-engineer`、PR #266)の上にStacked PRとして積む。
`pr_info_collector.py`(716行)を`packages/agent-core/src/agents/pr-info-collector.ts`へ移植する。

**5.7の記述に対する訂正**: 本ドキュメント§5.7は「既知のツール未使用バグ(structured_output単独呼び出しで
MCPツールを使わず幻覚する問題、未修正)」をスライスD独立の理由として挙げているが、これは執筆時点で参照した
古い情報に基づく。移植元の現行`pr_info_collector.py`は`docs/pr-info-collector-tooluse-fix-spec.md`が
記録する経緯を経て**既に案E「完全決定論化」へ修正済み**であり、PR情報はLLMのtool-useループやstructured_output
ではなく`mcp_client.call_tool_sync()`の直接呼び出し結果をコードから直接マッピングして取得する。LLMが関与する
のは`project_summary`(READMEの要約)の1箇所のみで、この呼び出しにもツールは渡されない。§5.7の「独立スライス
にする」という結論(スタックの深さ管理)自体は妥当なため覆さないが、理由付けの前提が古いことをここに記録する。

### 7.1 MCP接続の所有権(`SharedMcpClient`は不使用、単独所有の`connect`/`disconnect`)

ADR-0004(`docs/adr/0004-mcp-client-session-sharing.md`) Decision 1(L96)は「MCP接続の共有範囲は並列
レビュアー群の内部のみとし、PR情報収集は対象外とする」と明記している。スライスAの`SharedMcpClient`
(参照カウント方式、`tools/shared-mcp-client.ts`)はレビュアー間の共有を前提にした設計であり、
pr-info-collectorには適用対象がそもそも存在しない。

| 選択肢 | 概要 | 採用/却下 | 理由 |
|---|---|---|---|
| ① `SharedMcpClient`でラップして参照カウント管理する | オーケストレーターと同じ参照カウントパターンを踏襲する | 却下 | pr-info-collectorはMCPクライアントを他の誰とも共有しない唯一の消費者であり、参照カウントは常に1のまま。カウント管理のオーバーヘッドが実体のない抽象化になる。ADR-0004 Decision 1が明示的にスコープ外としている |
| ② `createGithubMcpClient`(`tools/github-mcp.ts`)を直接使い、`collect()`内で`connect()`→`try`→`finally`で`disconnect()`する | `base-reviewer.ts`の「専有クライアント」分岐(`ownsMcpClient`、L270-304)と同型の単純なtry/finallyパターン | **採用** | ADR-0004の設計方針と一致し、実装も既存パターンの再利用で完結する。`connect()`自体が失敗した場合も`disconnect()`が呼ばれることをテストで保証する(Python版の`start`/`stop`保証テストに対応) |

**採用**: `createGithubMcpClient`を直接使う単独所有パターン。`SharedMcpClient`は使わない。

### 7.2 GitHub MCP接続のretry(既存の`createGithubMcpClient`をそのまま再利用)

`createGithubMcpClient`(`tools/github-mcp.ts` L35-61)は生成時に`connect()`を`withRetry`(`tools/retry.ts`、
tenacityの`wait_random_exponential`と同じフルジッター指数バックオフ)でラップ済みで、`retryAttempts`/
`retryBackoffSeconds`オプションを既に公開している。

| 選択肢 | 概要 | 採用/却下 | 理由 |
|---|---|---|---|
| ① pr-info-collector側で独自にretryを組み直す | Python版の`mcp_startup_retry_attempts`/`mcp_startup_retry_backoff_seconds`用に専用のretryラッパーを書く | 却下 | `createGithubMcpClient`が既に同じ意味論(ADR-0003準拠)のretryを内蔵しており、二重実装になる |
| ② `createGithubMcpClient`のオプションへそのままマッピングする | `PRInfoCollectorConfig.mcpStartupRetryAttempts`/`mcpStartupRetryBackoffSeconds`を`retryAttempts`/`retryBackoffSeconds`として渡す | **採用** | 既存実装の再利用のみで、Python版のリトライ挙動(ADR-0003)を落とさず移植できる |

**採用**: `createGithubMcpClient`のオプションをそのまま使う。追加のretry実装はしない。

### 7.3 MCPツール直接呼び出しのAPI形状(`callTool`は`McpTool`インスタンスを要求する)

Python版`mcp_client.call_tool_sync(tool_use_id, name, arguments)`はツール名を文字列で直接渡せるが、
`@strands-agents/sdk`の`McpClient.callTool(tool: McpTool, args: JSONValue, options?): Promise<JSONValue>`
(`dist/src/mcp/client.d.ts` L214、`node_modules`の型定義を一次情報として確認済み)は`McpTool`インスタンスを
要求し、ツール名文字列は受け付けない。`McpTool`は`listTools(): Promise<McpTool[]>`(同ファイル L193)からのみ
取得できる。

| 選択肢 | 概要 | 採用/却下 | 理由 |
|---|---|---|---|
| ① 呼び出しの都度`listTools()`し直して名前で検索する | 各`_readXxx`メソッドが個別に`listTools()`を呼ぶ | 却下 | 同一接続内でツール一覧は変わらないため、毎回のリスト取得は無駄なラウンドトリップになる |
| ② `connect()`直後に一度だけ`listTools()`し、`Map<string, McpTool>`を構築して以降の全呼び出しで再利用する。名前解決に失敗したら明示的なエラーを投げるヘルパー(Python版`_tool_text_blocks`相当の結果テキスト抽出も同じヘルパーに寄せる)を用意する | `collect()`冒頭で1回だけ`listTools()`し、内部ヘルパー`callMcpTool(name, args)`が`Map`から`McpTool`を解決して`client.callTool(tool, args)`を呼ぶ | **採用** | ラウンドトリップを1回に抑えられ、Python版の「ツール名文字列で直接呼ぶ」という呼び出し側の見た目をヘルパー経由で再現できる。未知のツール名は`Map.get`が`undefined`を返すため、フェイルファストなエラーにしやすい |

**採用**: `collect()`冒頭で`await client.listTools()`を1回実行し`Map<string, McpTool>`を構築、`callMcpTool(name, args)`ヘルパー経由で全MCP呼び出しを行う。`McpClient.callTool`の戻り値(`JSONValue`)は実体としてMCP標準の`{content: [...], isError?}`形状(`_client.callTool`の生の戻り値、`dist/src/mcp/client.js` L281で確認済み)なので、Python版`_tool_text_blocks`と同じ`content[].text`抽出ロジックを同ヘルパー内に実装する。

### 7.4 `collect()`の非同期化

Python版`PRInfoCollector.collect()`は同期メソッドで、呼び出し元`api/agents/pr_info_collector.py`が
`asyncio.to_thread`で包んでいる。

| 選択肢 | 概要 | 採用/却下 | 理由 |
|---|---|---|---|
| ① 同期メソッドとして実装する | Node上で同期I/Oはそもそも成立しない(`McpClient`のAPIは全てPromiseベース) | 却下 | TSでは技術的に不可能。SDKのAPIが非同期のみ |
| ② `async collect(owner, repository, prNumber): Promise<PRInfoResult>`として実装する | スライスCの`run`/`run_async`統合(§5.4)と同じ方針 | **採用** | JSに「イベントループの外から呼ぶ同期ラッパー」という概念は存在しない。A2Aルーター側の実際の結線(`asyncio.to_thread`相当の扱いが不要になる点を含む)は#253のスコープで、本スライスの対象外 |

**採用**: `async collect(owner, repository, prNumber): Promise<PRInfoResult>`のみを公開する。

### 7.5 インフラエラー判定(既存の`isInfraError`をそのまま再利用)

Python版はMCP呼び出し箇所ごとに`except INFRA_EXCEPTIONS: raise`(インフラ障害は再送出、それ以外は
フォールバック値で握りつぶし事実データを失わない)というパターンを繰り返す。TS版の`isInfraError`
(`agents/exceptions.ts`、§5.2で確定済み)は`GithubMcpConnectionError`と内容起因3種を除く`ModelError`を
infra判定するもので、スライスCがレビュアー/モデル呼び出し向けに定義したものだが、`GithubMcpConnectionError`
の判定はpr-info-collectorのMCP呼び出し失敗にもそのまま当てはまる。

| 選択肢 | 概要 | 採用/却下 | 理由 |
|---|---|---|---|
| ① pr-info-collector専用の新しいエラー分類を追加する | Python版`INFRA_EXCEPTIONS`(`EventLoopException`/`MCPClientInitializationError`/`ToolProviderException`/`TransportError`)に1:1対応する新規判定関数を作る | 却下 | これらのPython例外はいずれもMCP接続/ツールプロバイダ層の失敗で、TS版では`createGithubMcpClient`が失敗を全て`GithubMcpConnectionError`に集約済み(§2.3/§2.8)。新規分類を追加しても`isInfraError`の`GithubMcpConnectionError`分岐と重複するだけ |
| ② 既存の`isInfraError`をそのまま再利用する | MCP呼び出しヘルパー(`callMcpTool`)やREADME要約の`Agent.invoke()`の失敗を`isInfraError`で判定し、true→再送出、false→フォールバック値(空配列/null/空文字)で握りつぶす | **採用** | 新規実装ゼロで済み、スライスCとの一貫性も保たれる。`isInfraError`は判定対象が`GithubMcpConnectionError`/`ModelError`系であり、pr-info-collectorが投げうるエラーの種類(MCP接続失敗、README要約のモデル呼び出し失敗)をカバーしている |

**採用**: 既存`isInfraError`をそのまま再利用する。新規のエラー分類は追加しない。

### 7.6 クラス設計(`ReviewAgent`/`LLMReviewAgent`を継承しない独立クラス)

`base-reviewer.ts`の両基底クラスは「`ReviewContext`を受け取り`ReviewResult`を返す」「LLMの`structuredOutputSchema`
を必ず使う」という契約を持つ。

| 選択肢 | 概要 | 採用/却下 | 理由 |
|---|---|---|---|
| ① `LLMReviewAgent`を継承する | 既存レビュアーと同じ基底クラスに寄せる | 却下 | 戻り値型が`ReviewResult`ではなく`PRInfoResult`、MCP呼び出しがLLM経由(`Agent`の`tools`配列)ではなく直接呼び出し、LLMは`structuredOutputSchema`を使わないREADME要約1箇所のみ、という3点いずれも基底クラスの契約と合わない |
| ② 独立クラス`PRInfoCollector`として新規実装する | `ReviewAgent`/`LLMReviewAgent`を継承しない | **採用** | Python版`PRInfoCollector`も`ReviewAgent`相当の基底クラスを継承しない独立クラスであり、契約の不一致を無理に埋めない方が実体に忠実 |

**採用**: `PRInfoCollector`は独立クラスとして実装する。`models/pr-info.ts`(Zodスキーマ)は流用のみで変更しない。
