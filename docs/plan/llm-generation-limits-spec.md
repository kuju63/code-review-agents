# LLM生成パラメータの安全弁(max_tokens / frequency_penalty) 実装記録 (Issue #208)

設計（統合後）: [docs/model-provider-factory-spec.md](../model-provider-factory-spec.md) §3

評価対象のローカルOllamaモデルが単一ターンで生成ループに陥り、評価パイプライン全体を数時間
ブロックしていた問題への対応として、`max_tokens`(生成トークン数上限)を安全弁として設定可能
にした。合わせて`frequency_penalty`も設定可能にしたが、これは検証済みの効果がある値が
存在しないため、運用者が試行錯誤で調整するためのフックとして提供するに留まる。

## 1. 背景と問題（Python版実装時点の記録）

`bitwarden/clients#21439`(RxJSの複合observableロジックを含むPR)に対し`LLMReviewAgent.review()`
(`src/code_review_agent/agents/base_reviewer.py`)を実行すると、単一ターンで8分間・約10万文字
にわたりほぼ同一の段落を繰り返し生成し続ける現象が、スクラッチパッドの診断スクリプトによる直接
呼び出しで再現・確認された。原因は、`OpenAIModel`構築時の`params`に`temperature`しか設定して
おらず、生成トークン数の上限も繰り返し抑制も存在しないため、モデルが生成ループに陥っても外部
から止める手段が無いこと。

この暴走は`ReviewOrchestrator`(`agents/review_orchestrator.py`)経由で実行される本番の
A2Aサーバーでも発生し、`reviewer_timeout_seconds`が未設定(`None`)の環境では
`asyncio.wait(timeout=None)`が暴走reviewerを無期限に待ち続けるため、評価パイプライン
(`evaluation/tools/run_agent_evaluation.py`、`--timeout`既定1800秒)全体がタイムアウトする
形で表面化していた。

## 2. 調査済み事実(Python版実装時点)

- `ReviewOrchestrator.run_async()`は、各reviewerを`asyncio.to_thread`で並行実行し、個々の
  reviewerが例外を投げても`INFRA_EXCEPTIONS`に該当しなければ自動的に`ReviewError`として隔離し、
  他reviewerの処理を継続する。
- strandsの`MaxTokensReachedException`/`StructuredOutputException`は、意図的に
  `EventLoopException`にラップされず生の型のまま伝播する設計であり、`INFRA_EXCEPTIONS`には
  含まれない。したがって`max_tokens`到達時に投げられても、明示的なtry/exceptを追加しなくても
  自動的に`ReviewError`として隔離される。
- `max_tokens`到達時は`MaxTokensReachedException`が即時送出され、`agent()`呼び出し全体が
  中断される(グレースフルなtruncationではない)。

## 3. パラメータ探索の実験結果

`frequency_penalty`について、0(未設定)/0.4/0.6/0.7/0.8/1.0の6点を`ornith:latest`で、
0(未設定)を`gpt-oss:latest`で、`bitwarden/clients#21439`に対して実行した。

再現性のための共通条件:
- 対象: `AngularReviewer`を単体呼び出し(`ReviewOrchestrator`経由ではなく直接
  `reviewer.review(context)`)、`max_agent_turns=6`。
- プロンプトリビジョン: 実験はすべてコミット`bf176d4`時点のコードに対して実行した。
- ハーネスの外側タイムアウト: シェルの`timeout 600`(600秒)でプロセス自体を打ち切り。
- モデルのタグ/ダイジェスト(`ollama list`で確認): `ornith:latest` = `a75697c14589`
  (5.6GB)、`gpt-oss:latest` = `17052f91a42e`(13GB)。
- 未設定行(1行目)を除く全行で`max_tokens=4000`を併用している。

| モデル | max_tokens | frequency_penalty | 結果 | 所要時間 | 到達ターン |
|---|---|---|---|---|---|
| ornith:latest | (未設定) | (未設定) | 繰り返し継続、タイムアウト | 483.7s | 5 |
| ornith:latest | 4000 | 0.4 | `MaxTokensReachedException` | 91.5s | 5 |
| ornith:latest | 4000 | 0.6 | `MaxTokensReachedException` | 126.5s | 4 |
| ornith:latest | 4000 | 0.7 | `MaxTokensReachedException` | 160.9s | 4 |
| ornith:latest | 4000 | 0.8 | `MaxTokensReachedException`(悪化) | 95.2s | 1 |
| ornith:latest | 4000 | 1.0 | `StructuredOutputException` | 51.3s | 4 |
| gpt-oss:latest | 4000 | (未設定) | `MaxTokensReachedException` | 97.4s | 3 |

`frequency_penalty`が0.4〜0.8の範囲で変えたのは「暴走が始まるターン番号」だけで「暴走するか
どうか」ではなく、非単調(0.8は0.6/0.7より悪化)でもあった。1.0では暴走そのもの(同一段落の
繰り返し)は止まったが、代わりに終了時の例外が`MaxTokensReachedException`から
`StructuredOutputException`に変わっており、単に暴走ターンが後ろ倒しになっただけでなく
失敗モード自体が変化した点に注意。`gpt-oss:latest`に切り替えても同様に暴走したため、
モデル固有の弱さではないと判断した。プロンプト側の調査も行ったが、コンテキスト過多となる
ような明白な欠陥は見つからなかった。

これらを踏まえ、**タスク自体(RxJSの複合observableロジックの意味論を正確に追跡すること)が、
この規模のローカルモデルの推論能力の限界を超えている可能性が高い**と判断し、ゴールを
「単一completionの暴走生成が有限時間で中断されること」に緩和した(採用値: `max_tokens=4000`)。

## 4. `.env.example`

`CODE_REVIEW_MAX_TOKENS=4000`を有効な値として記載する(全実験で、正常ターンでは到達せず、
暴走ターンのみを確実に打ち切ることを確認済み)。`CODE_REVIEW_FREQUENCY_PENALTY`は検証済みの
デフォルト値が存在しないため、実測結果の要約をコメントとして残しつつコメントアウトのまま
example値のみ示す。

## 5. スコープ外

`agents/pr_info_collector.py`の`_build_model()`(README要約用の1ターン・ツールなし呼び出し)。
`PRInfoCollector.__init__`は`ReviewerConfig`を使わない別経路であり、暴走が未実証の低リスク
経路のため今回は対象外とする。

## 6. 変更ファイル一覧（Python版・完了済み。TS移植は `packages/agent-core/src/agents/model-provider-factory.ts` に統合済み）

- `src/code_review_agent/api/config.py`
- `src/code_review_agent/agents/base_reviewer.py`
- `src/code_review_agent/agents/lead_engineer.py`
- `src/code_review_agent/api/agents/angular_reviewer.py`
- `src/code_review_agent/api/agents/react_reviewer.py`
- `src/code_review_agent/api/agents/vue_reviewer.py`
- `src/code_review_agent/api/agents/svelte_reviewer.py`
- `src/code_review_agent/api/agents/security_reviewer.py`
- `src/code_review_agent/api/agents/orchestrator.py`
- `src/code_review_agent/api/agents/lead_engineer.py`
- `.env.example`
- `tests/api/test_config.py`
- `tests/agents/test_base_reviewer.py`
- `tests/agents/test_lead_engineer.py`
