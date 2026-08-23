# Model Provider Factory と生成パラメータの安全弁 設計ドキュメント

関連Issue: #214（Ollamaネイティブ対応）、#208（生成パラメータ安全弁）

## 1. 背景

本プロジェクトは複数のLLMバックエンド（OpenAI互換API、ローカルOllama）を切り替えて動作する。
各Agent（技術レビュアー、SecurityReviewer、Lead Engineer、評価パイプラインのLLM呼び出し）が
それぞれ個別にモデルインスタンスを組み立てるロジックを持つと、providerの種別分岐・生成パラメータの
扱いが呼び出し箇所ごとに重複し、Ollama対応のような新しい軸を追加するたびに保守コストが箇所数倍で
増える。この重複を解消するため、provider種別に応じて適切な `Model` インスタンスを返す
`createModelProvider` ファクトリ関数に一本化した。

もう一つの背景として、ローカルOllamaモデルが単一ターンで生成ループに陥り、評価パイプライン全体を
数時間ブロックする事象が確認された。原因はモデル構築時に生成トークン数の上限（`max_tokens`）も
繰り返し抑制（`frequency_penalty`）も設定しておらず、モデルが暴走しても外部から止める手段が
無いことだった。この安全弁もモデル構築ロジックと不可分であるため、同じファクトリの責務として
併せて設計する。

## 2. 設計

### 2.1 `createModelProvider(providerType, modelId, options)`

`packages/agent-core/src/agents/model-provider-factory.ts` に実装。provider種別
（`openai` / `ollama`）ごとに分岐し、Strands の `Model` を構築して返す。

- **OpenAI分岐**: OpenAI互換APIとして呼び出す。`llmBaseUrl` が設定されている場合のみ
  `temperature` を送る（未設定時は送らない、という既存挙動を保持）。`maxTokens` /
  `frequencyPenalty` は値が設定されている場合のみリクエストに含める。
- **Ollama分岐**: Vercel AI SDK の Ollama プロバイダ（`ai-sdk-ollama`）経由でモデルを構築する。
  `llmBaseUrl`（未設定時は `http://localhost:11434`）をホストとして使い、末尾が `/v1` の場合は
  防御的に除去する（OpenAI互換エンドポイント向けの値が設定に残っていても404にならないように）。
  `temperature`/`maxTokens` は常に適用する。`frequencyPenalty` はOllama側に相当するパラメータが
  存在しないため無視し、`console.warn` で通知する（黙って握りつぶさない）。
- 未知の `providerType` は例外を送出する。TypeScriptの網羅性チェック（exhaustiveness check）に
  より、新しいproviderを追加した際にこの分岐の更新漏れはコンパイル時に検出される。

provider種別はリクエスト単位のオーバーライドを許可しない。デプロイ時に確定するバックエンド
選択であり、リクエストから切り替えられると接続先/認証情報が意図せず変わるリスクがあるため
（`llmBaseUrl` も同様にオーバーライド不可であり、これと整合させている）。

### 2.2 呼び出し元

各技術レビュアー・`SecurityReviewer`・`LeadEngineerAgent`・`PRInfoCollector` はいずれも
`ReviewerConfig`（`providerType`, `modelId`, `llmBaseUrl`, `maxTokens`,
`frequencyPenalty` を保持）から `createModelProvider` を呼び出してモデルを構築する。
`temperature`は`ReviewerConfig`のフィールドではなく、呼び出し元ごとに固定値
（`base-reviewer.ts`は`0.1`、`lead-engineer.ts`/`pr-info-collector.ts`は`0.3`）を
`createModelProvider`に直接渡している。
評価パイプライン側のLLM呼び出し（意味的判定・seed生成）も同じファクトリに委譲し、
レビュー対象モデルと評価用モデルの設定を独立させたまま（評価バイアス回避の意図を保つため）
provider種別を選べるようにしている。

## 3. 生成パラメータの安全弁

### 3.1 `maxTokens`

生成トークン数の上限。モデルが単一ターンで暴走生成に陥っても、上限到達で強制的に
呼び出しが中断される。値が低すぎると健全な長いレビュー結果ごと失われる（0 findings化する）
副作用があるため、実測値（診断ログ）に基づいて運用者が決める値であり、コード側では
値域の下限を強制しない。

この保証の範囲は**1回のcompletion呼び出し**に限られる。以下は `maxTokens` が保証しない:

- reviewer全体（複数ターンにわたる呼び出し）がいつ終わるか。ターン数上限の範囲内でも、
  暴走せず各ターンが緩やかに時間を消費するケースでは合計時間は数十分に及びうる。
- オーケストレータレベルでの全体終了。個々のreviewerタイムアウトが未設定の環境では、
  `maxTokens` に起因しない要因（ネットワークハング等）でreviewerが停止しない場合、
  待機は無期限に続く。

### 3.2 `frequencyPenalty`

OpenAI Chat Completions APIの繰り返し抑制パラメータ。`-2.0`以上`2.0`以下の範囲外の値は
設定読み込み時に検証エラーとして拒否する（黙ってクランプしない）。効果が検証済みの
デフォルト値は存在しない（範囲内で値を振っても「暴走が始まるターン番号」がずれるだけで、
非単調な影響が観測されている）。運用者が試行錯誤で調整するためのフックとして提供する。

## 4. 関連ドキュメント

- 評価パイプライン全体設計: [docs/evaluation-pipeline-design.md](evaluation-pipeline-design.md)
- 実装計画・変更ファイル一覧・検証手順: [docs/plan/model-provider-factory-spec.md](plan/model-provider-factory-spec.md)、
  [docs/plan/llm-generation-limits-spec.md](plan/llm-generation-limits-spec.md)
