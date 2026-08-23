# `models/` TypeScript移行 設計ドキュメント (Issue #251)

Epic [#249](https://github.com/kuju63/code-review-agents/issues/249)（全面TS化）の Sub-Issue②。
Sub-Issue①(#250, PR #256)が整備した pnpm workspace / Zod導入余地 / vitest / biome
の上に、`src/code_review_agent/models/`(`pr_info.py`, `review.py`, `lead_engineer.py`)
の Pydantic モデルを `packages/agent-core/src/models/` へ Zod スキーマ + 型として
移植する。`docs/typescript-toolchain-spec.md` §2.1 で確定済みの配置方針
(`packages/agent-core/src/models/`) と §7 の申し送り(Stacked PRとしてPR #256の
ブランチから分岐)を引き継ぐ。

Python側の `src/code_review_agent/models/` は削除しない。撤去は #255 の責務。

## 1. 決定済み事項（本Issue着手前に確定していたもの）

| 項目 | 決定 | 出典 |
|---|---|---|
| モデル配置先 | `packages/agent-core/src/models/` | `typescript-toolchain-spec.md` §2.1 |
| ブランチ分岐元 | `feat/ts-migration/250-toolchain`（Stacked PR） | `typescript-toolchain-spec.md` §7 |
| テストランナー/カバレッジ閾値 | vitest、75%(lines/functions/branches/statements) | `vitest.config.ts`（#250で導入済み） |

## 2. 要検討事項（比較表 + 採用/却下理由）

### 2.1 Zodのバージョン

| 選択肢 | 概要 | 採用/却下 | 理由 |
|---|---|---|---|
| ① `zod@^4.1.12`を`packages/agent-core`のdependenciesに追加 | `@strands-agents/sdk@1.12.0`のpeerDependenciesが要求するメジャーバージョンに揃える | **採用** | #252で同SDKの`Agent.structuredOutput`相当APIにこれらのスキーマをそのまま渡す前提であり、今ここでバージョンがずれると`ai-sdk-ollama`(§5)と同種の型不整合事故が起きる。`pnpm install`時点で`peerDependencies`の警告有無を確認済み |
| ② バージョン指定なし(`latest`) | 現時点の最新Zodを何も考えず入れる | 却下 | Zod v5系がリリースされた場合に#252で`@strands-agents/sdk`の要求と衝突するリスクを残す。今のうちに明示ピンする方が安全 |

**採用**: `"zod": "^4.1.12"`。

### 2.2 Enum表現

| 選択肢 | 概要 | 採用/却下 | 理由 |
|---|---|---|---|
| ① `z.enum({ KEY: "value", ... })`（オブジェクト形式） | key→valueのマップを単一のソースとし、スキーマ・TS型・名前付きメンバーアクセス(`.enum.KEY`)・宣言順配列(`.options`)の全てをそこから導出 | **採用** | Zodの標準的な列挙表現で、JSON Schema出力が構造化出力(LLM)にそのまま使える。実機で`.enum`(名前→値)と`.options`(宣言順の値配列)の両方が取得できることを確認済み。`ProjectType.enum.REACT_TS`のようにPython`StrEnum`のメンバーアクセス(`ProjectType.REACT_TS`)に近い書き味を保ちつつ、`FindingSeverity`等のソート順(Python版`list(FindingSeverity).index(...)`相当)は`.options.indexOf(value)`でこの1箇所から導出できる |
| ② `z.enum([...] as const)`（配列形式） | 文字列リテラル配列のみを渡す | 却下 | 値の配列は得られるが名前付きメンバー(`.REACT_TS`等)を持たず、呼び出し側は生文字列リテラルを直接書くことになる。Python版の`Enum.MEMBER`という書き味との差が大きい |
| ③ TS `enum` + `z.nativeEnum` | Pythonの`StrEnum`にAPIとして最も近い | 却下 | TS `enum`はJSON Schema生成・tree-shakingとの相性が悪く、Zodエコシステムでは非推奨気味。`z.nativeEnum`もv4では`z.enum`に統合される方向で、あえて別経路を採る理由がない |

**採用**: 全ての列挙型(`ProjectType`, `ReviewPerspective`, `ReviewPriority`, `DecisionVerdict`,
`FindingSeverity`, `FindingImpact`, `FindingPriority`)をオブジェクト形式の`z.enum({...})`で定義する。
`FindingSeverity`/`FindingPriority`のソート順は、`.options`配列を`indexOf`で参照する形にし、
手書きの並行マップを作らない。

### 2.3 フィールド命名（camelCase化）

| 選択肢 | 概要 | 採用/却下 | 理由 |
|---|---|---|---|
| ① camelCase（TS慣用）に変換 | `file_path`→`filePath`, `reviewer_id`→`reviewerId`, `final_priority`→`finalPriority`等 | **採用** | `evaluation/tools/*.py`・`src/code_review_agent/a2a/models.py`をgrep済みで、これらのフィールド名を外部がJSONキーとして直接パースしている箇所は無い。`LeadEngineerReport.to_evaluation_format`は既に`path`/`line`等へ手動マッピングしており、内部フィールド名から独立した契約になっている。Python↔TS間で生きた越境JSON契約が存在しない一回限りの移植のため、慣用に合わせて良い |
| ② snake_caseをそのまま維持 | Python版と1:1の名前を保つ | 却下 | TS/Zodエコシステムの慣用(camelCase)から外れ、#252以降で書かれる呼び出し側コードが不自然になる。Pydantic⇄Zodは実体としても別スキーマ実装であり、名前を合わせても互換性が生まれるわけではない([[名前と実体を区別せよ]]) |

**採用**: camelCase。ただし`FileChange.filePath`はPython版で既にcamelCaseだったため変更なし。

### 2.4 Nullable値の表現

| 選択肢 | 概要 | 採用/却下 | 理由 |
|---|---|---|---|
| ① `.nullable().default(null)` | Pythonの`X \| None = None`を「キーは常に存在し、値が`null`になりうる」として表現 | **採用** | LLM構造化出力のJSON Schemaで当該キーが`required`のまま維持され、モデルが省略せず`null`を明示的に返しやすくなる。`docs/finding-location-silent-drop-spec.md`が警告する「欠損の暗黙ドロップ」と同種の問題(キー自体が省略されて検出できない)を避けられる |
| ② `.optional()` | キー自体を省略可能にする | 却下 | JSON Schemaで`required`から外れ、フィールドが存在するかどうかの判定が「省略」と「null」の2経路に分かれてしまう。ローカルモデル(gemma等)がキーを丸ごと省略する既知の問題(evaluation運用で確認済み)を助長する |

**採用**: 全ての`X | None = None`相当フィールドに`.nullable().default(null)`を使う。

### 2.5 `ReviewContext.shared_mcp_client`の扱い

| 選択肢 | 概要 | 採用/却下 | 理由 |
|---|---|---|---|
| ① Zodスキーマ化しない。プレーンなTS `interface`とする | `ReviewContext`はプロセス内で組み立てられるオブジェクトとして型のみ定義し、`prInfo`はZodスキーマの推論型を使うが`ReviewContext`自体はZodでparseしない | **採用** | Pydantic側も`arbitrary_types_allowed`+`exclude=True`+`repr=False`で「検証対象外・シリアライズ対象外」と明示しており、この値(MCPクライアント)は一度もJSON境界を越えない。ReviewOrchestrator相当のコード(#252スコープ)がプロセス内で注入するライブオブジェクトであり、Zodでparseする意味がない |
| ② `z.custom<MCPClient>()`でZodオブジェクトに含める | 形だけZodスキーマの一部にする | 却下 | 実質的にランタイム検証を行わないフィールドのためにオブジェクト全体をZod化する理由がない。`ReviewContext`を構造化出力やJSON往復に使う予定もない |

**採用**: `ReviewContext`はプレーンTS `interface`。`prInfo: PRInfoResult`(Zod推論型)は含むが、
`sharedMcpClient?: MCPClient`はSDK側の型を借用し、Zod化しない。

### 2.6 `LeadEngineerReport`の振る舞い(accepted/rejected/to_markdown/to_evaluation_format)

| 選択肢 | 概要 | 採用/却下 | 理由 |
|---|---|---|---|
| ① スタンドアロン関数（`LeadEngineerReport`型を引数に取る） | `acceptedDecisions(report)`, `rejectedDecisions(report)`, `toMarkdown(report)`, `toEvaluationFormat(report, prId)`として実装 | **採用** | Zod/TSの慣用はプレーンオブジェクト+関数群であり、`z.parse()`の戻り値をそのままクラスにラップし直す層を持たない。テストもモックなしで関数呼び出しとして書け、Pydantic BaseModelのインスタンスメソッドを模してクラスを作る二重管理を避けられる |
| ② クラス化してPython版と1:1のAPI形状にする | `class LeadEngineerReport { accepted() {...} }`として`z.infer`型をラップ | 却下 | Zodのparse結果(プレーンオブジェクト)をクラスインスタンスへ変換する層が余計に必要になり、シリアライズ/デシリアライズのたびに変換コストが生まれる。Python版とAPIの見た目を合わせても、実体（Zodスキーマ+関数 vs Pydantic BaseModelのメソッド）は別物であり、名前を揃える利益が薄い |

**採用**: スタンドアロン関数。

### 2.7 ファイル配置とプレースホルダの扱い

| 選択肢 | 概要 | 採用/却下 | 理由 |
|---|---|---|---|
| ① `packages/agent-core/src/models/{pr-info,review,lead-engineer}.ts` + `index.ts`バレル。`src/index.ts`は`./models/index.js`を再エクスポート | Pythonの3モジュール境界を踏襲しつつkebab-caseファイル名 | **採用** | `__init__.py`の`__all__`と同じ役割を`index.ts`バレルが担う。#250の`toolchainVersion`スモークテストは実プロダクションコードが入った時点で役目を終える |
| ② `index.ts`にすべてを直接書く | ファイル分割せず1ファイルにまとめる | 却下 | 3モジュールで15個超のスキーマ/型があり、Pythonの`pr_info.py`/`review.py`/`lead_engineer.py`という責務分割を無くす理由がない |

**採用**: モジュールごとにファイル分割。`packages/agent-core/src/index.ts`/`index.test.ts`の
`toolchainVersion`プレースホルダは削除する。

## 3. Pydantic → Zod 対応表

| Python (`src/code_review_agent/models/`) | TypeScript (`packages/agent-core/src/models/`) |
|---|---|
| `pr_info.py: RepositoryInfo` | `pr-info.ts: RepositoryInfoSchema` |
| `pr_info.py: FileChange` | `pr-info.ts: FileChangeSchema` |
| `pr_info.py: PRInfo` | `pr-info.ts: PRInfoSchema` |
| `pr_info.py: PRInfoResult` | `pr-info.ts: PRInfoResultSchema` |
| `review.py: ProjectType` | `review.ts: ProjectType` (`z.enum`) |
| `review.py: ReviewPerspective` | `review.ts: ReviewPerspective` (`z.enum`) |
| `review.py: ReviewPriority` | `review.ts: ReviewPriority` (`z.enum`) |
| `review.py: ReviewFinding` | `review.ts: ReviewFindingSchema` |
| `review.py: ReviewOutput` | `review.ts: ReviewOutputSchema` |
| `review.py: ReviewContext` | `review.ts: ReviewContext` (プレーンinterface、§2.5) |
| `review.py: ReviewResult` | `review.ts: ReviewResultSchema` |
| `review.py: ReviewError` | `review.ts: ReviewErrorSchema` |
| `review.py: ReviewReport` | `review.ts: ReviewReportSchema` |
| `lead_engineer.py: DecisionVerdict` | `lead-engineer.ts: DecisionVerdict` (`z.enum`) |
| `lead_engineer.py: FindingSeverity` | `lead-engineer.ts: FindingSeverity` (`z.enum`) |
| `lead_engineer.py: FindingImpact` | `lead-engineer.ts: FindingImpact` (`z.enum`) |
| `lead_engineer.py: FindingPriority` | `lead-engineer.ts: FindingPriority` (`z.enum`) |
| `lead_engineer.py: FindingDecisionOutput` | `lead-engineer.ts: FindingDecisionOutputSchema` |
| `lead_engineer.py: LeadEngineerOutput` | `lead-engineer.ts: LeadEngineerOutputSchema` |
| `lead_engineer.py: FindingDecision` | `lead-engineer.ts: FindingDecisionSchema` |
| `lead_engineer.py: LeadEngineerReport` | `lead-engineer.ts: LeadEngineerReportSchema` + `acceptedDecisions`/`rejectedDecisions`/`toMarkdown`/`toEvaluationFormat` |

コミット粒度・PRタイトル規約: [docs/plan/typescript-models-migration-spec.md](plan/typescript-models-migration-spec.md)。

## 4. #252以降への申し送り

- 次のSub-Issueは #252（`agents/`・`tools/`のTS移行）。`ReviewContext`の`sharedMcpClient`型が
  `@strands-agents/sdk`のMCPクライアント型と実際に整合するかは#252着手時に確認する
  （本Issueでは型シグネチャのみ用意し、SDK呼び出しコードは書かない）。
- `zod@^4.1.12`のピン留めは`ai-sdk-ollama`(§5, `typescript-toolchain-spec.md`)と同様、
  Renovate等の自動更新が`@strands-agents/sdk`の対応バージョンを超えて上げないよう
  #252で改めて確認する。
