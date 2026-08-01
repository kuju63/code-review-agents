# LLM生成パラメータの安全弁(max_tokens / frequency_penalty) 設計ドキュメント (Issue #208)

評価対象のローカルOllamaモデルが単一ターンで生成ループに陥り、評価パイプライン全体を数時間
ブロックしていた問題への対応として、`max_tokens`(生成トークン数上限)を安全弁として設定可能
にする。合わせて`frequency_penalty`も設定可能にするが、これは検証済みの効果がある値が
存在しないため、運用者が試行錯誤で調整するためのフックとして提供するに留まる。

## 1. 背景と問題

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

## 2. 調査済み事実(再調査不要)

- `ReviewOrchestrator.run_async()`(`review_orchestrator.py:219-247`)は、各reviewerを
  `asyncio.to_thread`で並行実行し、個々のreviewerが例外を投げても`INFRA_EXCEPTIONS`
  (`agents/exceptions.py`で定義: `EventLoopException`, `MCPClientInitializationError`,
  `ToolProviderException`, `httpx.TransportError`)に該当しなければ自動的に
  `ReviewError(reviewer_id, perspective, message=str(exc))`として隔離し、他reviewerの
  処理を継続する。
- strandsの`MaxTokensReachedException`/`StructuredOutputException`
  (`strands.types.exceptions`)は、`strands/event_loop/event_loop.py`で意図的に
  `EventLoopException`にラップされず生の型のまま伝播する設計であり、`INFRA_EXCEPTIONS`には
  含まれない。したがって`max_tokens`到達時に投げられても、`base_reviewer.py`側で明示的な
  try/exceptを追加しなくても自動的に`ReviewError`として隔離される。**当初検討していた
  「review()内で例外を明示キャッチしてReviewErrorに変換する処理」の追加は不要**と判明した。
- `strands.models.openai.OpenAIModel.format_request()`(`openai.py:505-527`)は、
  `config["params"]`をそのまま`**params`でOpenAI互換リクエストに展開する。すなわち
  `max_tokens`/`frequency_penalty`はOpenAI Chat Completions APIの生パラメータであり、
  strands側での変換・検証は行われない。
- `max_tokens`到達時は`MaxTokensReachedException`が即時送出され、`agent()`呼び出し全体が
  中断される(グレースフルなtruncationではない)。低すぎる値は、健全な長いレビューの結果を
  丸ごと失わせる(0 findings化させる)副作用を持つため、値は当てずっぽうにせず診断ログの
  実測値から決める。

## 3. パラメータ探索の実験結果

`frequency_penalty`について、0(未設定)/0.4/0.6/0.7/0.8/1.0の6点を`ornith:latest`で、
0(未設定)を`gpt-oss:latest`で、`bitwarden/clients#21439`に対して実行した。

再現性のための共通条件:
- 対象: `AngularReviewer`を単体呼び出し(`ReviewOrchestrator`経由ではなく直接
  `reviewer.review(context)`)、`max_agent_turns=6`(スクラッチパッドの診断スクリプト
  `diagnose_reasoning.py`/`diagnose_reasoning_v2.py`)。
- プロンプトリビジョン: 実験はすべてコミット`bf176d4`(`refactor/improve-agent-rules`
  ブランチ、`AngularReviewer`のsystem prompt・`_build_prompt()`が現行実装に変更される前)
  時点のコードに対して実行した。
- ハーネスの外側タイムアウト: シェルの`timeout 600`(600秒)でプロセス自体を打ち切り。
- モデルのタグ/ダイジェスト(`ollama list`で確認): `ornith:latest` = `a75697c14589`
  (5.6GB)、`gpt-oss:latest` = `17052f91a42e`(13GB)。
- 未設定行(1行目)を除く全行で`max_tokens=4000`を併用している(`max_tokens`自体の効果を
  混入させないための固定値。1行目のみ`max_tokens`も未設定の素のベースライン)。

| モデル | max_tokens | frequency_penalty | 結果 | 所要時間 | 到達ターン |
|---|---|---|---|---|---|
| ornith:latest | (未設定) | (未設定) | 繰り返し継続、タイムアウト | 483.7s | 5 |
| ornith:latest | 4000 | 0.4 | `MaxTokensReachedException` | 91.5s | 5 |
| ornith:latest | 4000 | 0.6 | `MaxTokensReachedException` | 126.5s | 4 |
| ornith:latest | 4000 | 0.7 | `MaxTokensReachedException` | 160.9s | 4 |
| ornith:latest | 4000 | 0.8 | `MaxTokensReachedException`(悪化) | 95.2s | 1 |
| ornith:latest | 4000 | 1.0 | `StructuredOutputException` | 51.3s | 4 |
| gpt-oss:latest | 4000 | (未設定) | `MaxTokensReachedException` | 97.4s | 3 |

`frequency_penalty`が変えたのは「暴走が始まるターン番号」だけで「暴走するかどうか」ではなく、
非単調(0.8は0.6/0.7より悪化)でもあった。実績のある`gpt-oss:latest`に切り替えても同様に暴走
したため、モデル固有の弱さではないと判断した。プロンプト側(`_build_prompt()`末尾の
「Retrieve full files from GitHub as needed」という指示の重複、Angular公式スキルのサイズ
[SKILL.md群合計約200行]、実際に取得されたファイルサイズ[`default-collection.service.ts`
11,357バイト・332行]も調査したが、コンテキスト過多となるような明白な欠陥は見つからなかった。

これらを踏まえ、**タスク自体(RxJSの複合observableロジックの意味論を正確に追跡すること)が、
この規模のローカルモデルの推論能力の限界を超えている可能性が高い**と判断し、以下の通りゴールを
緩和した。

## 4. ゴール(緩和後)

1. ~~JSON出力が壊れないこと~~ → 撤回。`MaxTokensReachedException`により`agent()`呼び出しが
   中断され`ReviewError`として隔離されることを、安全弁の正常な動作として受容する。
2. **単一completionの暴走生成が有限時間で中断されること** — これを必須ゴールとする。
   `max_tokens`到達により、暴走した単一のcompletion呼び出しは有限時間(実測1.5〜3分程度)で
   確実に`MaxTokensReachedException`として中断される。

この保証の範囲は「1回のcompletion呼び出し」に限られる。以下は本PRの範囲外であり、
`max_tokens`は保証しない:

- reviewer全体(複数ターンにわたる`agent()`呼び出し)がいつ終わるか。`max_agent_turns`
  (既定30)の範囲内でも、暴走せず各ターンが緩やかに時間を消費するケースでは合計時間は
  数十分に及びうる。
- `ReviewOrchestrator`レベルでの全体終了。`reviewer_timeout_seconds`は既定`None`
  (無期限待機)のままであり、`max_tokens`到達に起因しない要因(ネットワークハング等)で
  reviewerが停止しない場合、`asyncio.wait(timeout=None)`は無期限に待ち続ける。今回の
  評価実行(45件)がタイムアウトなく完走したのは、実測上すべてのreviewerが単一completion
  レベルの暴走(またはターン数上限)で終わったことによる経験的な結果であり、コードレベルで
  保証された性質ではない。
- 評価パイプライン全体(`run_agent_evaluation.py --timeout`)の完走を、コード変更なしに
  将来のあらゆる入力に対して保証すること。

全体終了(オーケストレーターレベル・パイプラインレベル)を必須ゴールにする場合は、
`reviewer_timeout_seconds`を非`None`の値に設定することを必須設定とし、実際に有限時間で
終了することを検証するテスト(例えばモック化した無限ループreviewerに対して
`ReviewOrchestrator.run_async()`が`reviewer_timeout_seconds`経過後に返ることを確認する)を
別途追加する必要がある。本PRではこれを行わず、`max_tokens`による単一completionの安全弁
のみをスコープとする。

`max_tokens`単体でこの(限定された)ゴールは達成できることを確認済み。`frequency_penalty`は
このゴール達成に必須ではないが、ユーザーの要望により設定可能にし、運用者が今後試行錯誤で
調整できるようにする。

## 5. 設計

- `Settings.max_tokens: int | None = None`(`api/config.py`)
- `Settings.frequency_penalty: float | None = None`
- `ReviewerConfig`(`agents/base_reviewer.py`)に同名同型フィールドを追加し、7箇所の
  `ReviewerConfig(...)`構築(`api/agents/{angular,react,vue,svelte,security}_reviewer.py`、
  `api/agents/orchestrator.py`、`api/agents/lead_engineer.py`)で配線する。
- `OpenAIModel`の`params`辞書は「値が`None`でないキーのみ動的に追加」する
  (`None`を明示的に含めると`**params`展開でAPIに`frequency_penalty=null`等がそのまま乗るため、
  フィールド不在と同義に保つ)。
- 分岐ロジック: `llm_base_url`の有無にかかわらず`extra_params`は適用対象にする
  (`llm_base_url`未設定=OpenAI本体利用時にだけ安全弁が効かないのは片手落ちのため)。ただし
  `llm_base_url`未設定かつ`extra_params`が空の場合は現状通り`params`自体を渡さない(既存テスト
  の厳密一致アサーションを壊さないため)。
- `LLMReviewAgent.review()`(241-251行目)と`LeadEngineerAgent.evaluate()`(104-114行目)の
  両方に同型のロジックを適用する(共通ヘルパー化はしない — 両モジュールのテストがそれぞれ
  独立に`OpenAIModel`をpatchしているため、共通化するとpatch対象がずれる)。

## 6. `.env.example`

`CODE_REVIEW_MAX_TOKENS=4000`を有効な値として記載する(全実験で、正常ターンでは到達せず、
暴走ターンのみを確実に打ち切ることを確認済み)。`CODE_REVIEW_FREQUENCY_PENALTY`は検証済みの
デフォルト値が存在しないため、実測結果の要約をコメントとして残しつつコメントアウトのまま
example値のみ示す。

## 7. スコープ外

`agents/pr_info_collector.py`の`_build_model()`(README要約用の1ターン・ツールなし呼び出し)。
`PRInfoCollector.__init__`は`ReviewerConfig`を使わない別経路であり、暴走が未実証の低リスク
経路のため今回は対象外とする。将来拡張の候補として記録するに留める。

## 8. 変更ファイル一覧

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
