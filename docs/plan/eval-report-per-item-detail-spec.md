# 評価レポートへの個別PR詳細（Human Review vs Agent指摘）追加 設計ドキュメント

評価レポート（`evaluation/data/report_*.md`）が集計スコアと失敗アイテムIDの列挙しか出力せず、
個別PR単位で「人間レビュアーが何を指摘し、Agentが何を見つけ／見逃したか」がわからないため
次のアクションを判断しづらい問題を解消する設計を定義する。

---

## 1. 背景と問題

`evaluation/tools/run_agent_evaluation.py::_build_report` が生成する現行レポートは、Gold/Seeded
両セットとも以下の集計指標のみを表示する。

- Gold set: Issue Recall / Issue Precision / Severity Agreement / Location Hit Rate
- Seeded set: Must-Find Recall / Critical Miss Rate
- 失敗アイテム: エラーになったアイテムIDの列挙のみ（理由・部分スコアなし）

`evaluation/tools/score_evaluation.py::match_findings()` は実際には各PR/アイテムごとに「どの
findingがどのfindingとペアになったか」を貪欲マッチングの過程で計算しているが、集計カウント
（`matched, severity_matched, exact_line_matched`）に潰した時点でその詳細を捨てている。

この詳細を保持してレポートに載せることで、「どのPRのどの指摘をAgentが見逃したか」「Agentが独自に
指摘した内容は何か」を個別に確認できるようにし、レビュアー/プロンプト改善の次アクションを判断しやすく
する。

## 2. 修正方針

### 2.1 `score_evaluation.py`

`match_findings()`（既存シグネチャ `(gold, pred, semantic_judge=None) -> tuple[int,int,int]`）は
変更しない。既存15件のテストがこの戻り値を直接検証しているため。代わりに詳細を保持する下位関数を
新設し、`match_findings` はそのラッパーとする。

```python
@dataclass(frozen=True)
class MatchedPair:
    gold: Finding
    pred: Finding
    severity_match: bool
    exact_line: bool

@dataclass(frozen=True)
class MatchResult:
    pairs: list[MatchedPair]
    missed_gold: list[Finding]
    unmatched_pred: list[Finding]

def match_findings_detailed(gold, pred, semantic_judge=None) -> MatchResult: ...

def match_findings(gold, pred, semantic_judge=None) -> tuple[int, int, int]:
    r = match_findings_detailed(gold, pred, semantic_judge=semantic_judge)
    return (
        len(r.pairs),
        sum(1 for p in r.pairs if p.severity_match),
        sum(1 for p in r.pairs if p.exact_line),
    )
```

`score_gold`/`score_seeded` は行ごとに `match_findings_detailed` を **1回だけ** 呼び、既存の集計
カウントと新設の per-item detail の両方をその1回の結果から導出する（`--semantic-judge` 有効時に
LLM呼び出しを二重発行しないための必須条件）。

生findingは `asdict(Finding)` ではなく**元の生dictをそのまま**保持する。`Finding` は
`category/severity/path/line/summary` の5フィールドしか持たないため、そのまま `asdict` すると
Gold の `human_findings[].source`（元のGitHub reviewコメントへのURL）や Seeded の
`must_find[].rule_id` が黙って失われ、「今後のアクションが取りづらい」という問題意識に反する。
`Finding` オブジェクトと元dictの対応付けは `id()` ベースの辞書で行う（frozen dataclassは値が同じ
でも別レコードでありうるため、構造的等価性で引くと重複findingを取り違える）。

```python
def _build_item_detail(item_id, expected, raw_expected, predicted, raw_predicted, result):
    raw_by_id = {id(f): raw for f, raw in zip(expected, raw_expected)}
    raw_by_id.update({id(f): raw for f, raw in zip(predicted, raw_predicted)})
    return {
        "id": item_id,
        "matched": [
            {"expected": raw_by_id[id(p.gold)], "agent": raw_by_id[id(p.pred)],
             "severity_match": p.severity_match, "exact_line": p.exact_line}
            for p in result.pairs
        ],
        "missed": [raw_by_id[id(f)] for f in result.missed_gold],
        "unmatched_agent": [raw_by_id[id(f)] for f in result.unmatched_pred],
        "expected_total": len(expected),
        "agent_total": len(predicted),
    }
```

`score_gold`/`score_seeded` の戻り値には **`"items": items` を追加するだけ**で、既存キー
（`issue_recall`/`must_find_recall`/`counts` 等）は変更しない。生dictはJSON化可能なので `main()`
の `json.dumps(report, ...)` に変更は不要。

`score_seeded` のcritical miss判定ループ（`for mf in must_find: ... any(is_match(...) for p in
pred_findings)`）は変更しない。これは貪欲マッチングの消費順序に依存しない「全predプールに対する
非貪欲チェック」であり、Hard Gateの `critical_miss_rate` の数値的挙動を今回の表示追加で変えない
ため。`seeded_detected`（`must_find_recall`用）だけを `len(result.pairs)` から取得するよう置き
換える（値は従来と同一）。

### 2.2 `run_agent_evaluation.py`

`_build_report` のシグネチャは変更しない。新設ヘルパー：

- `_sanitize_cell(text, max_len=100)`: 改行/タブを空白に潰し、`|` をエスケープし、長文は省略記号で
  切る（既存の `title[:50]` 切り詰めパターンの一般化）。
- `_ref_cell(raw: dict) -> str`: `source` があれば `[source](url)`、なければ `rule_id` があれば
  `` `rule_id` ``、どちらも無ければ `-`。Gold/Seededで分岐せずに済む共通ヘルパー。
- `_finding_row(kind, raw) -> str`: 1行分のMarkdownテーブル行。
- `_render_item_detail(item, heading, expected_label) -> str`: `matched`/`missed`/
  `unmatched_agent` を1つのテーブルにまとめ、件数サマリを付ける。Gold/Seeded共通。
- `_gold_heading`/`_seeded_heading`: 見出し文字列。Seededは `base_source` 経由でGoldの `title`
  を逆引きして併記する。

`## 評価スコア` の直後・`## Hard Gate 判定` の直前に以下2セクションを追加する（既存の
`## 評価対象 PR`・`## 評価スコア`・`## Hard Gate 判定`・`## 失敗アイテム` は不変・追加のみ）。

- `## Gold Set 詳細（PR ごとの人間レビュー指摘 vs Agent 指摘）`
- `## Seeded Set 詳細（項目ごとの Must-Find vs Agent 指摘）`

Seeded側のセクションには「人間レビュー」という文言・概念を一切含めない（Seededスキーマに
`human_findings` は存在しないため、実装しない・捏造しない）。

既存の `## 評価対象 PR`（全体像の一覧）はそのまま残す。集計スコアの直後に詳細ドリルダウンを続ける
構成は、まず全体像→次に個別詳細という読み手の理解順序に合わせている。

## 3. 対象外（今回やらないこと）

- `discord_notify.py` の通知内容（集計のみのまま）
- Hard Gate判定ロジック・しきい値
- `evaluation/EVALUATION_PLAN.md` / `RUNBOOK.md` の更新（メトリクス定義・データセット前提・実行
  手順は変更していないため）
- Seeded findingへの「人間レビュー」ラベル付与

## 4. テスト

`tests/evaluation/tools/test_score_evaluation.py`:
- `match_findings_detailed` のマッチ/見逃し/unmatched_predの内訳、貪欲消費の回帰、
  `match_findings` ラッパーとの整合性
- `score_gold`/`score_seeded` の `items`（id・matched・missed・unmatched_agentの中身、生dictの
  source/rule_id保持、既存集計キーが不変であることの回帰、critical_miss_rateが貪欲消費の影響を
  受けないことの回帰）

`tests/evaluation/tools/test_build_report.py`（新規）:
- 既存セクションが不変であること
- Gold詳細セクションにmatched/missed/unmatched行が出ること
- Seeded詳細セクションに「人間レビュー」文言が含まれないこと
- `_sanitize_cell`/`_ref_cell` の単体テスト

## 5. 検証手順

```bash
uv run pytest
uv run ruff check
uv run ruff format --check
```

加えて、`evaluation/data/agent_predictions.jsonl` の既存サンプルを使い
`score_evaluation.py` を単体実行して `items` の中身・source/rule_id保持を目視確認する。次に
`run_evaluation_pipeline.sh` を実データで実行し、生成されたMarkdownレポートのテーブル崩れ
（改行/`|`のエスケープ漏れ）が無いことを確認する。
