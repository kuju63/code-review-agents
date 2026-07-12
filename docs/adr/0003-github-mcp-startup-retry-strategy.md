# ADR-0003: MCP起動リトライ戦略

- Status: Proposed(未実装・レビュー待ち)
- Date: 2026-07-12
- Related: Issue #115, [docs/review-orchestrator-infra-exception-propagation-spec.md](../review-orchestrator-infra-exception-propagation-spec.md), [docs/github-mcp-streamable-http-migration-spec.md](../github-mcp-streamable-http-migration-spec.md)

## Context

Issue #115は評価パイプライン実行中にSeeded set 18件中10件がGitHub MCP接続エラー
(`background thread did not start in 30 seconds` / `Connection to the MCP server was closed` /
空ボディのJSONパース失敗)で評価不能になった問題の根本原因分析を既に完了しており、
「1. リトライを入れる」「2. MCPクライアントの使い回し」の2方針で対応を検討する。

Issue本文の原因分析によれば、真因は**同時多重の輻輳**である: `ReviewOrchestrator.run_async`
(`src/code_review_agent/agents/review_orchestrator.py:90-96`)が登録レビュアーを
`asyncio.to_thread`で並列実行し、`PRInfoCollector`と合わせて1PRあたり最大3本のMCPセッションが
立つ。評価の`--concurrency 2`と組み合わせると理論上6本のセッションが同一GitHubトークンで
同時にハンドシェイクを試みる。`MCPClient`(strands `mcp_client.py`)のデフォルト
`startup_timeout=30`秒がこの輻輳下で頻繁に超過し、リトライ・バックオフが皆無なため
一過性の接続失敗がそのままそのレビュアー/評価項目の失敗に直結している。

本ADRは、この方針1(リトライ)の**方式**(何をどう実装するか)と**対象**(どの呼び出し・
どの例外をリトライするか)を確定させるものである。実装そのものは本ADRのスコープ外とし、
別PRでTDDにより実装する(CONTRIBUTING.mdのSpec-Driven原則)。

対象は`create_github_mcp_client`が生成する`MCPClient`(strands `mcp_client.py`)の
起動処理であり、strandsのMCPクライアント一般に適用できる設計とする。現時点で本プロジェクトが
利用するMCP統合はGitHub MCPのみのため、本文の記述・実装例は具体的にはGitHub MCPを指している。

## 対象(リトライを適用する箇所)

`MCPClient.start()`のみを対象とする。呼び出し経路は2つ。

- `src/code_review_agent/agents/pr_info_collector.py:202` — `mcp_client.start()`を直接呼ぶ
- `src/code_review_agent/agents/base_reviewer.py:218-223` — `MCPClient`を`Agent`の`tools`に渡し、
  strands `Agent`が`load_tools()`内で`self.start()`を呼ぶ(strands `mcp_client.py:250-258`)

いずれも失敗時は`MCPClientInitializationError`(前者は直接、後者は`Agent`が
`ToolProviderException`でラップ)。`MCPClient.start()`は失敗時に内部で
`self.stop(None, None, None)`を呼んでから例外送出する設計(strands `mcp_client.py:220,227`)
であることを確認済みなので、状態はリトライ前提でリセットされる。

| 選択肢 | メリット | デメリット |
|---|---|---|
| A. `MCPClient.start()`(起動ハンドシェイク)のみリトライ | Issueの原因分析1〜3(同時セッション過多・30秒タイムアウト・CPU競合)はすべて起動フェーズの話であり、観測された3種のエラーはいずれも`start()`内で発生しうる。呼び出し元(`pr_info_collector.py`/`base_reviewer.py`)を変更せず、`create_github_mcp_client`側の変更だけで両経路を救済できる | セッション確立後に切断するケース(下記Bの障害)には対処できない |
| B. 個別ツール呼び出し(`call_tool_sync`等)もリトライ | GitHub MCPはread-onlyのため冪等で、ツール呼び出し単位のリトライも安全に行える。セッション確立後の切断(`stop()`時に表面化する`RuntimeError("Connection to the MCP server was closed")`, strands `mcp_client.py:402`)にも対処できる | 呼び出し箇所ごとの計装が必要で影響範囲が拡大する。その切断が表面化する時点では既にLLM呼び出しが部分的に進行済みであり、ツール呼び出し1回の再試行だけでは救済しきれないケースがある。「MCPクライアントの使い回し」(item2)の設計次第でこの障害の起きやすさ自体が変わるため、今リトライ実装を固めると手戻りリスクがある |
| C. `reviewer.review()`/`collector.collect()`全体を再試行 | 起動失敗・ツール呼び出し失敗のどちらも一律にカバーできる | LLM呼び出し込みの再実行になるため、トークンコスト・時間コスト(最大30ターンの再実行)が起動リトライと比べて不釣り合いに大きい |

**採用: A。** Issue #115の受け入れ基準(起動起因の失敗を0件/大幅減)に対してはAで十分であり、
Bのメリット(ツール呼び出し単位の耐障害性)はitem2(セッション共有)の設計確定後でないと
計装範囲が定まらないため、現時点ではAに絞ることでスコープを閉じる。Cはコスト超過が明白なため
最初から候補から除外する。BはConsequencesに「次に変化しうる箇所」として記録する。

## 方式1: リトライ間隔の戦略(バックオフ方式)

Issueの原因分析1「1PRあたり最大3本、評価の`--concurrency 2`と合わせて理論上6本のMCP
セッションが同一GitHubトークンで同時にハンドシェイクを試みる」という**同時多重の輻輳**が
真因である以上、リトライ間隔の設計はこの輻輳を緩和するか・再生産するかを左右する。
これを踏まえて4つの間隔戦略を比較した。

| 選択肢 | メリット | デメリット |
|---|---|---|
| A. 即時リトライ(待機なし) | 実装が最も単純。一過性のごく短い瞬間的エラー(例: スレッド生成直後の一瞬のレース)には最速で回復する | 輻輳が原因で失敗した直後に間隔を空けず再試行しても、同じ輻輳状態にほぼ確実に再突入する。CPU競合(原因分析3)がある状況ではリトライ自体がさらにCPUを奪い、事態を悪化させかねない |
| B. 固定間隔リトライ(例: 常に2秒待機) | Aより輻輳回避の効果がある。実装・説明ともに単純で、待機時間の見積もりが立てやすい | 同時刻に失敗した複数セッション(最大6本、原因分析1)の待機がすべて同じ長さになるため、再試行の再開タイミングが揃ってしまい、二次的な輻輳(サンダリングハード)を起こしやすい |
| C. 指数バックオフ(ジッターなし) | 試行を重ねるごとに待機を拡大するため、輻輳が長引くケースでもBより回復の余地を残せる。実装はtenacity標準機能で単純 | 待機時間を広げること自体はBの改善になるが、同時に失敗したセッション群は依然として同じ拡大カーブに乗るため、再試行タイミングの同期という問題自体はBと同様に残る |
| D. 指数バックオフ+ジッター | 指数的に拡大する待機時間に乱数幅を加えることで、同時に失敗した複数セッションの再試行タイミングを時間的に分散させ、Issueの真因である同時多重の輻輳を再生産しにくい。一過性エラー全般に対する業界標準的な対処法でもある | A〜Cと比べてパラメータ(乱数幅の取り方)が増え、挙動がわずかに説明しにくくなる。ただしtenacityの`wait_random_exponential`を使えばパラメータは実質`multiplier`/`max`のみで、実装上のコストは小さい |

**採用: D(指数バックオフ+ジッター)。** 判断根拠はIssueの原因分析1が「同時多重の輻輳」で
あること。A・Bはこの輻輳を再生産する、Cはタイミング同期の問題が残る、という欠点がいずれも
「真因(輻輳)を悪化させるか放置する」方向に働くのに対し、Dだけが輻輳の再生産を積極的に
避けられる。デメリット(パラメータ増)はtenacityの標準機能で吸収できるため、実装コストの
増分は小さいと判断した。最大試行回数3回・初期待機1秒程度を基準値とする。

## 方式2: 実装手段(ライブラリ選定)

戦略(方式1)を確定した上で、それをどう実装するかの選定。

| 選択肢 | メリット | デメリット |
|---|---|---|
| tenacity | `strands-agents`経由で`uv.lock`に既に解決済みであり、新規ダウンロードコストがない(`pyproject.toml`に直接依存として明記するのみ)。`wait_random_exponential`で方式1(指数バックオフ+ジッター)がそのまま実現でき、attempt数管理・ロギングも標準機能で揃う | プロジェクトにとって新しい直接依存が1つ増える(実体は既存の間接依存の昇格だが、`pyproject.toml`上は変更が発生する) |
| backoff | 別の著名リトライライブラリ。`expo`+`backoff.full_jitter`で同様にジッター付き指数バックオフを実現可能 | uv.lockに未解決の新規依存が増える。tenacityと機能が重複し、ジッター付き指数バックオフを実現するためだけに2つ目のリトライライブラリを追加する理由がない |
| 自前実装(sleepループ) | 外部ライブラリへの依存が増えない | 乱数幅の取り方(full jitter/equal jitterなど)・停止条件・ロギングを自前で作り込む必要があり、tenacityが既に依存関係内にある状況ではその実装コストに見合うメリットがない |

**採用: tenacity。** backoffのデメリット(新規未解決依存の追加)、自前実装のデメリット
(車輪の再発明)がいずれも明確な実装コスト増であるのに対し、tenacityのデメリット(直接依存の
増加)は実体を伴わない(既存の間接依存の昇格に過ぎない)ため、コストとして無視できる。

`create_github_mcp_client`が返す`MCPClient`の`start()`をリトライ機構でラップする形で
実装する想定であり、`pr_info_collector.py`/`base_reviewer.py`双方の呼び出し元は無変更で
救済できる見込みである。具体的な実装は別PRでTDDにより確定させる。

### リトライ対象例外と非一過性エラーの扱い

`MCPClientInitializationError`は一過性(タイムアウト・接続断・空ボディ)と
非一過性(認証エラー等)の両方を同じ型でラップする。今回は原因種別で分岐する
精密な判定(`exc.__cause__`の型チェック)は行わず、最大試行回数を3回程度に
抑えることで、非一過性エラーの検知遅延を実害の範囲にとどめる、というシンプルで
堅実な方針を採用する。原因種別による分岐は将来のリファインとしてConsequencesに残す。

### 設定

`src/code_review_agent/api/config.py`の`Settings`に以下を追加し、既存の`CODE_REVIEW_`
プレフィックス命名規則(`max_agent_turns`等と同列)に揃える。

- `mcp_startup_retry_attempts: int = 3`
- `mcp_startup_retry_backoff_seconds: float = 1.0`(ジッター付き指数バックオフの基準値)

バックオフの基準待機を短くしすぎない(1秒程度を確保する)理由・ジッターを必須とする理由は
方式1で述べた通り: Issueの原因1が「同時セッション過多による競合」である以上、間隔が
短い、あるいは複数セッションの再試行タイミングが同期する設計は、同じ競合を再生産して
実効性を失う。

## 関連する既存ギャップの是正(スコープに含める)

`base_reviewer.py`経由の起動失敗はstrands `Agent.load_tools()`が`ToolProviderException`に
ラップし直す(strands `mcp_client.py:256-258`)。この型は`exceptions.py`の
`INFRA_EXCEPTIONS`(`EventLoopException` / `MCPClientInitializationError` /
`httpx.TransportError`、Issue #56で確定)に含まれていないため、リトライを尽くした
最終失敗がreviewer経路でのみ`review_orchestrator.py`にて`ReviewError`(部分失敗)に
格下げされてしまう。これは`docs/review-orchestrator-infra-exception-propagation-spec.md`が
定めた「インフラ障害は握りつぶさず再送出する」方針と矛盾するため、本ADRの実装スコープに
`ToolProviderException`の`INFRA_EXCEPTIONS`への追加を含める。

## Decision

1. `MCPClient.start()`の起動ハンドシェイク失敗のみをリトライ対象とする(ツール呼び出し単位・
   Agent/Collector呼び出し全体の再試行は対象外)。
2. リトライ間隔は指数バックオフ+ジッターとし、最大試行回数3回・基準待機1秒程度とする。
3. 実装手段には`tenacity`(既存の間接依存を直接依存へ昇格)を用いる。
4. リトライ対象例外は`MCPClientInitializationError`とし、非一過性原因との区別は行わず、
   最大試行回数を小さく抑えることで検知遅延を許容範囲にとどめる。
5. `ToolProviderException`を`INFRA_EXCEPTIONS`(`exceptions.py`)に追加し、reviewer経路での
   リトライ尽き後の最終失敗がインフラ障害として正しく再送出されるようにする。
6. 「MCPクライアントの使い回し」(Issue #115 item2、セッション共有)は本ADRのスコープ外とし、
   別Issueとして切り出す。

## Consequences

- リトライにより「1回の起動試行が失敗する確率」は下がるが、Issue原因1の同時セッション数
  過多そのものは解消しない。セッション共有(item2)が実現するまでは、輻輳が強い状況下では
  リトライを重ねても最終的に失敗しうる。
- ツール呼び出し単位のリトライ(対象B)は今回見送った。セッション確立後の切断障害
  (`RuntimeError("Connection to the MCP server was closed")`)は本ADRの対象外のままであり、
  引き続き発生しうる。item2の設計確定後に計装範囲を定めて再検討する。
- リトライ対象例外の非一過性/一過性の判定(`exc.__cause__`の型チェックによる精密化)は
  見送った。将来、認証エラー等の非一過性失敗が誤って複数回リトライされることによる
  遅延が問題になった場合は、この精密化を追加で検討する。
- `pyproject.toml`に`tenacity`を直接依存として追加する必要がある(uv.lockの再解決自体は
  発生しない)。
- 次に変化しうる箇所: item2(セッション共有)の設計が具体化した時点で、本ADRの対象(A)を
  ツール呼び出し単位のリトライ(B)まで拡張するかどうかを再評価する。
