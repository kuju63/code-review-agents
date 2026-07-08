# ADR-0001: 大規模PRのレビュー除外方針

- Status: Proposed(未実装・レビュー待ち)
- Date: 2026-07-08
- Related: Issue #54, [docs/granite-structured-output-failure-spec.md](../granite-structured-output-failure-spec.md), `evaluation/data/report_20260708-201456-6cc2786.md`(※下記注記参照), [ADR-0002](0002-workflow-externalization-langflow-dify.md)

> **注記**: `evaluation/data/`は`.gitignore`対象(`.gitignore:338`)であり、評価レポート
> (`report_*.md`)はリポジトリにコミットされないローカル生成物。本文中の参照は監査証跡
> としての引用であり、[evaluation/RUNBOOK.md](../../evaluation/RUNBOOK.md)の手順を
> 実行すれば同名ファイルを再生成できる。同様の引用パターンは
> [docs/granite-structured-output-failure-spec.md](../granite-structured-output-failure-spec.md)
> や [docs/eval-concurrent-log-attribution-fix-spec.md](../eval-concurrent-log-attribution-fix-spec.md)
> でも既に使われている。

## Context

Issue #54(`feat: パッチサイズ上限によるトークン過負荷対策`)は、`mui/material-ui#48325`
(46ファイル・約148K文字)のような大規模PRでモデルのコンテキスト処理が失敗し、エージェントが
1800秒タイムアウトに達する問題を報告し、「ファイル単位上限 5,000字 / PR全体上限 40,000字」の
段階的トリミングを提案していた。

その後の実装(`src/code_review_agent/agents/pr_info_collector.py:243-264`)は、Issue #54の
段階的トリミング案とは異なる**二値(binary)フォールバック**として着地している。

```python
total_patch_chars = sum(len(f.get("patch") or "") for f in target_files)
include_patches = (
    len(target_files) <= self._patch_max_files
    and total_patch_chars <= self._patch_total_char_limit
)
```

`patch_total_char_limit=30_000` / `patch_max_files=30` のいずれかを超えると、**レビュー対象
ファイル(`is_target_file`で絞り込まれた`target_files`。ts/tsx/js/jsx/css/scss/html/
package.json)の`patch`が一括で`None`になる**。トリミングではなく全欠落であり、reviewerは
差分をGitHub MCP経由で1ファイルずつ`get_file_contents`して補うしかない設計になっている。

2026-07-08の評価(`report_20260708-201456-6cc2786.md`)で、この二値フォールバックが
実際に障害を引き起こしたことが確認された。5whys分析(系統A)による因果連鎖:

1. Gold `hoppscotch/hoppscotch#6171`(レビュー対象ファイル23件・35,106文字)が
   `patch_total_char_limit=30,000`を超過 → レビュー対象ファイル全件のpatch=Noneに
   フォールバック。
2. reviewerがGitHub MCP経由で個別にファイルを逐次fetch(`Tool #1: get_file_contents`が
   複数回発生、`/tmp/a2a_server.log`で確認)。
3. `skill name does not match parent directory name`というツール名解釈エラーによる
   無駄なリトライがturn予算をさらに圧迫。
4. `granite4.1:8b`が`max_agent_turns=30`以内に`ReviewOutput`スキーマへ収束できず
   `StructuredOutputMissingError`発生(`src/code_review_agent/agents/base_reviewer.py:246-249`)。
5. この例外は`INFRA_EXCEPTIONS`(`src/code_review_agent/agents/exceptions.py`)に含まれないため
   `src/code_review_agent/agents/review_orchestrator.py`が業務エラーとして記録し再raiseしない
   → `ReviewReport.results`が空。
6. `LeadEngineerReport.decisions`が空になり、`to_evaluation_format()`
   (`src/code_review_agent/models/lead_engineer.py:203-237`)が出力する評価用JSON
   (`agent_predictions.jsonl`)の
   `agent_findings`/`lead_decisions`キーも空配列になる。結果として、Gold評価上
   「PRに問題なし」と見分けがつかない`findings=0`として記録される。

この失敗モードは`docs/granite-structured-output-failure-spec.md`で緩和策(#4可視化ログ、
#2構造化出力ディレクティブ)が導入された後も別の入力(より大規模なPR)で再発しており、
6/27(patch=None常態化)→7/7(binary fallback導入、部分改善)→7/8朝(プロンプト緩和策)→
7/8夜(hoppscotch#6171で新規再発)という「対策のたびに失敗モードが移動する」構造がある。

真因はモデル(`granite4.1:8b`)の構造化出力収束信頼性の限界であり、入力側の縮小だけが
確実にコントロールできるレバーである。

## Decision Drivers

- 現状のbinary fallbackは、Issue #54が想定していた「段階的縮退」より粗く、
  かえってMCP fetch stormを誘発しやすい設計になっている(名前は同じ「パッチサイズ対策」でも
  実体が異なる)。
- `PRInfoResult` / `ReviewResult` / `LeadEngineerReport`のいずれにも「レビュー対象から
  除外されたファイル・PRがある」ことを表現するフィールドが存在しない
  (`src/code_review_agent/models/pr_info.py`, `src/code_review_agent/models/review.py`
  確認済み)。このため除外を導入する場合、
  「見て0件だった」のか「そもそも見ていない」のかを区別できるようにしないと、
  系統Aの分析で突き止めた"findings=0の意味的曖昧さ"を再演することになる。
- 評価データセットの層化(`evaluation/EVALUATION_PLAN.md` §2.0 Domain Coverage Policy)
  への影響は、除外の粒度(ファイル単位かPR単位か)で大きく変わる。

## Options Considered

### Option 0 — 現状維持(binary fallback)

変更なし。`include_patches`が偽ならPR全ファイルが`patch=None`になる。

- Pros: 実装コストゼロ。
- Cons: 系統Aで実証済みの失敗モードを放置。同種の大規模PRに当たるたび再発しうる。
- 判定: 却下。

### Option 1 — Issue #54原案: パッチ本文の段階的トリミング

ファイル単位上限(例 5,000字)・PR全体上限(例 40,000字)を超えた分を
`...truncated (N chars omitted)...`に置換する。個々のファイルの`patch`は
**縮退した形で常に残す**(現状のように丸ごと`None`にはしない)。

- Pros:
  - 系統Aの直接因果(`patch=None`フォールバック→MCP fetch storm→turn枯渇)を
    構造的に回避しうる。縮退してもpatchが存在する限り、reviewerが逐次fetchに
    頼る主要因が消える。
  - 「レビューしない」のではなく「縮退してでもレビューする」ため、Option 2/3より
    カバレッジの後退が少ない。
- Cons:
  - トリミング境界をまたぐ変更(閾値ちょうどの位置に重大な脆弱性がある場合)は
    見えなくなる。ただしこれは「見えないことが分かる欠落」ではなく「気づかれない
    部分的欠落」であり、Option 2の除外フラグより発見しにくい。
  - 上限値の根拠(モデルのコンテキスト長・評価精度とのトレードオフ)は
    Issue #54の「検討事項」節のまま未検証。
  - 「変更行数が多いファイルを優先して残す」戦略を伴わない単純truncationだと、
    ファイル出現順に依存した恣意的な情報欠落になる。
- 判定: 有力候補。単独では"何が失われたか"が伝播しない点が残る。

### Option 2 — ユーザー提案A: ファイル単位のレビュー除外

1ファイルのpatchが単体で閾値(例 8,000字)を超える場合、そのファイルをレビュー対象から
除外する。除外は`patch=None`にするのではなく、`FileChange`に除外を明示するフィールド
(例 `excluded: bool` または `omitted_reason: str | None`)を追加して表現する。
他のファイルは通常どおりレビューする。

- Pros:
  - turn予算を消費する主因(超大ファイルの逐次fetch)を狙い撃ちで排除しつつ、
    PR全体は見捨てない。最悪でも1ファイル分の情報が欠けるだけで済む。
  - Option 0(全滅)より確実に良い結果になる。
- Cons:
  - スキーマ変更が前提になる。`FileChange`→`ReviewResult`→`LeadEngineerReport`まで
    「除外されたファイルがある」ことを一貫して伝播させる変更が最低限セットで必要
    (伝播させないと系統Aと同じ曖昧さが残る)。
  - 実装コストはOption 1より高い。
- 判定: 有力候補。Option 1より確実に系統Aの真因(見えない欠落)を潰せるが、
  Option 1と独立に採用するより組み合わせた方が効果的。

### Option 3 — ユーザー提案B: PR全体のレビュー除外

ファイル数または総文字数が閾値を超えるPRそのものをレビュー対象外とし、
reviewerを一切起動せず`out_of_scope`のような明示ステータスを返す。

- Pros:
  - 最もシンプルで、turn予算問題を完全かつ確実に回避する。
  - 「中途半端に見た気になる」リスクがゼロ。除外はfail-safeとして最も誠実。
- Cons:
  - 目的(レビュー負荷削減)に反する可能性がある。依存関係の一括更新や大規模
    リファクタなど、大規模PRほど本来レビューが必要な場面も多い。
  - 評価データセットへの影響が最大。大規模PRが母集団から構造的に脱落すると、
    層化サンプリングの前提(`evaluation/EVALUATION_PLAN.md` §2.0.3)を崩し、
    EVALUATION_PLAN.mdの更新(閾値超過PRを「評価対象外」と明記)が必須になる。
  - 除外閾値の設定次第で、意図せず「評価しやすいPRだけ通す」チェリーピッキングに
    なるリスクがある。
- 判定: 最終防衛線(circuit breaker)として温存。単独採用は時期尚早。

## Decision

段階的多重防御(defense in depth)として **Option 1 → Option 2 の順に実装**し、
**Option 3は現時点で見送り、将来のfail-safeとして予約**する。

1. **第一段(Option 1採用)**: Issue #54原案どおりの段階的トリミングを実装し、
   現状の`include_patches`(binary)ロジックを置き換える。これにより`patch=None`
   フォールバックの発生条件を大きく狭め、MCP fetch stormの経路を断つ。
   *(名前は「パッチサイズ対策」のまま変わらないが、実体が「二値フォールバック」から
   「段階的縮退」に変わる点に注意。)*
2. **第二段(Option 2採用、スキーマ拡張が前提)**: 単体ファイルが極端に大きい場合の
   ファイル単位除外を追加する。`FileChange`に除外フラグを追加し、`PRInfoResult`→
   `ReviewResult`→`LeadEngineerReport`まで一貫して伝播させ、「除外ファイルがある」
   ことをfindings=0と区別可能にする。評価スクリプト(`run_agent_evaluation.py`)にも
   除外ファイル一覧をレポート出力する変更を加える。
3. **Option 3(PR全体除外)は採用しない。** 第一段・第二段を経てもなお
   `max_agent_turns`超過が実証された場合の最終防衛線として、将来Issueに切り出して
   再検討する。閾値は本ADRでは確定せず、評価①(トリミングのみ)・評価②
   (トリミング+ファイル除外)の実測結果で決める(検証方針はIssue #54を踏襲:
   失敗件数・Must-Find Recall・Critical Miss Rateの推移で判定)。

## Consequences

- Issue #54のスコープは「トリミング実装」のまま維持しつつ、既存の`patch_total_char_limit`
  / `patch_max_files`によるbinaryロジックを置き換える(既存実装の破棄を伴う変更)。
- `FileChange`へのフィールド追加はA2A `outputSchema`(`docs/a2a-api-design.md` §4)にも
  波及する。破壊的スキーマ変更ではないが、既存の評価データ(`agent_predictions.jsonl`)
  との互換性はTDDのGreenフェーズで確認する。
- Option 2導入により「除外ファイルの有無」を評価レポートに出力する場合、
  `evaluation/EVALUATION_PLAN.md` §3(Metrics)に軽微な追記が必要になる可能性がある。
  Option 3を見送る限り、Domain Coverage Policy(§2.0)自体の変更は不要。
- 次に変化しうる箇所: 上限値(文字数・ファイル数)は本ADRでは仮値のままなので、
  評価結果次第で本ドキュメントを更新する。
