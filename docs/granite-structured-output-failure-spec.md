# granite 構造化出力失敗: 可視化と緩和 設計ドキュメント

`granite4.1:8b` を使った評価（commit `8a711e1`, `report_20260707-140657`）で、15項目中4項目が
`StructuredOutputMissingError`（構造化出力エラー）で失敗し、予測ファイルから欠落した。本ドキュメントは
その失敗を「まず可視化し（#4）、次に緩和する（#2）」二段構えの変更を定義する。

---

## 1. 背景と根本原因

### 症状

`report_20260707-140657-8a711e1.md` の「失敗アイテム」4件が `agent_predictions.jsonl` に存在しない:

- `vuetifyjs/vuetify#22788`（gold, orchestrator 経由）
- `seeded::bitwarden/clients#20848::react_useeffect_missing_dep`（frontend reviewer 経由）
- `seeded::bitwarden/clients#20848::frontend_n_plus_one_api`（同上）
- `seeded::vuetifyjs/vuetify#22788::frontend_n_plus_one_api`（同上）

### 根本原因（サーバーログ `/tmp/a2a_server.log` からの再構成）

1. `granite4.1:8b` は構造化スキーマ（`ReviewOutput`）ではなく、絵文字付きの自由形式 Markdown
   レビュー（`### Findings & Recommendations` 表など）を生成する傾向がある。
2. その結果、`max_agent_turns=30` を消費しても構造化出力へ収束できず、Strands が
   `result.structured_output=None` を返す。失敗タスクは実行時間が突出（frontend で最大 456 ポーリング≒23分）。
3. `base_reviewer.py` / `lead_engineer.py` が `StructuredOutputMissingError` を送出。
4. 各 A2A エンドポイントの `except` が `store.set_failed(task_id, sanitize_error(exc))` で握りつぶし、
   **トレースバックも `stop_reason` もログに残らない**（サーバーログに ERROR/Traceback が 0 件）。

同一モデル・同一設定でも 11 件中 7 件は成功しており、ハードな非対応ではなく
「ターン予算内でスキーマに収束できるか」という信頼性・入力依存の問題である。

---

## 2. 変更 #4: 失敗の可視化

### 目的

失敗時に `stop_reason` を含む `StructuredOutputMissingError` メッセージをサーバーログへ出力し、
次回以降このデバッグ（ログの再構成）を不要にする。

### 設計判断

`StructuredOutputMissingError` のメッセージは `base_reviewer.py:216` で
`f"Reviewer '{self.reviewer_id}'"` ＋ `stop_reason` を含む。この文字列は sanitize 済みで
`TaskStore.set_failed(task_id, error)` に渡る。したがって **全失敗が通る単一地点 `set_failed` に
1 行のログを足す**のが最も DRY かつ安全（トークン漏洩なし・reviewer 名と stop_reason を取得）。

- 変更対象: `src/code_review_agent/a2a/task_store.py`
- 内容: モジュールロガーを追加し、`set_failed` が**タスクを実際に failed に更新したときのみ**
  WARNING を出力する（`set_completed` と同じく存在するタスクに対してのみ。未知IDは真の noop）。
- ログする値は改行を潰した `single_line_error = "\n".join(error.splitlines())`。
  一部の例外（pydantic `ValidationError` 等）は `str(exc)` が複数行になり、`grep` 由来の
  失敗件数カウントを壊すため。タスクに**保存する** `error` は full の複数行のまま維持する。

### 検証

- 単体テスト（`caplog`）で、`set_failed` が存在タスクに対し WARNING で `error`（reviewer 名・
  `stop_reason` を含む）を出力すること。
- 複数行エラーが単一ログ行に正規化され、かつ保存 `error` は full のまま保持されること。
- 未知IDに対しては状態変更もログ出力もない（noop）こと。

---

## 3. 変更 #2: 構造化出力のみを返す指示（緩和）

### 目的

reviewer が散文 Markdown レビューを書くのを抑制し、ターン消費を減らして構造化出力へ収束させる。

### 設計判断

出力形式は各 reviewer 固有ではなく横断的関心事のため、reviewer ごとの prompt 定数を個別に
書き換えるのではなく、**`base_reviewer` に一元化**する。共有ディレクティブ定数
`STRUCTURED_OUTPUT_DIRECTIVE`（散文/Markdown レポートを禁止し、最終アクションを構造化出力に
限定）と `compose_system_prompt()` を追加し、`LLMReviewAgent.review()` で
`system_prompt=compose_system_prompt(self.system_prompt)` として全 LLM reviewer に付与する。

- 変更対象: `src/code_review_agent/agents/base_reviewer.py`
- `frontend.py` / `security.py` の `system_prompt` 定数**自体は変更しない**。合成は `review()` の
  実行時に行うため、reviewer には出力形式の指示を重複記述しない（DRY）。

### 検証

- 単体テスト: `compose_system_prompt()` が role prompt 末尾にディレクティブを付与すること、
  および各 reviewer の**合成後**プロンプトにディレクティブが含まれること
  （`tests/agents/test_reviewers.py`）。`review()` が合成後プロンプトで `Agent` を構築すること
  （`tests/agents/test_base_reviewer.py`）。
- 評価②: 失敗件数 / Must-Find Recall / Critical Miss Rate をベースライン（4失敗）と比較。

---

## 4. 検証方針（評価）

`evaluation/EVALUATION_PLAN.md` に従う。granite での評価はハード非対応ではないため、
本変更の合否は「失敗件数の減少」と「Must-Find Recall の改善傾向」で判断する。
モデルの非決定性を踏まえ、断定は避け、実行ログ（`stop_reason`）を根拠として提示する。

---

## 5. 検証結果（granite4.1:8b, gold 5 + seeded 10, `--concurrency 2`）

| 指標 | ベースライン `8a711e1` | 評価① #4 `4c93e0e` | 評価② #4+#2 `12a6c05` | 目標 |
|---|---|---|---|---|
| 失敗項目数 | 4 | 1 | **0** | 0 |
| `StructuredOutputException`（ログ） | （未ログ） | 1 | **0** | 0 |
| 予測できた項目 | 11/15 | 14/15 | **15/15** | 15 |
| Issue Recall | 0.233 | 0.256 | 0.302 | ≥0.70 |
| Issue Precision | 0.400 | 0.423 | 0.371 | ≥0.60 |
| Gold マッチ数 | 10 | 11 | 13 | - |
| Must-Find Recall | 0.200 | 0.200 | 0.200 | ≥0.95 |
| Critical Miss Rate | 1.000 | 1.000 | 1.000 | =0 |
| Hard Gate | FAIL | FAIL | FAIL | PASS |

### 実際の失敗文言（#4 のログが捕捉）

```text
The model failed to invoke the structured output tool even after it was forced.
```

出所は Strands `event_loop/event_loop.py:363-367`。当初推定していた `limit_turns` による
`StructuredOutputMissingError` とは別物で、#4 の可視化により推定が訂正された。

### 結論

- **#2 は構造化出力の失敗モードを解消した**: 失敗 4→1→0、`StructuredOutputException` 0件。
  「散文で `end_turn` して構造化ツールを呼ばない」挙動を直接抑制したことが効いている。
- Issue Recall は単調改善（予測できる項目が増えたため）。
- **ただし Hard Gate は依然 FAIL**: Must-Find Recall（0.2）と Critical Miss Rate（1.0）は不変。
  #2 は「失敗して欠落する」問題を直したが、granite の**検出品質そのものは改善しない**。
- 失敗は非決定的（項目固有でない）。評価②単発の 0件は統計的証明ではないが、
  「0件 + 例外0 + Recall 単調改善 + 機構的裏付け（`event_loop.py`）」が一貫して #2 の有効性を支持する。
