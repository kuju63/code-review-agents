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
- 内容: モジュールロガーを追加し、`set_failed` 内で `logger.warning("Task %s failed: %s", task_id, error)`。

### 検証

- 単体テスト（`caplog`）で、`set_failed` 呼び出し時に WARNING レベルで `error` 文字列が出力されること。

---

## 3. 変更 #2: 構造化出力のみを返す指示（緩和）

### 目的

reviewer が散文 Markdown レビューを書くのを抑制し、ターン消費を減らして構造化出力へ収束させる。

### 設計判断

出力形式は各 reviewer 固有ではなく横断的関心事のため、全 LLM reviewer に効く形で指示を追加する。
frontend / security の両システムプロンプトへ「散文/Markdown レポートを書かず、所見は与えられた
構造化スキーマのフィールドのみに格納する」旨の指示を加える。

- 変更対象: `src/code_review_agent/agents/reviewers/frontend.py`, `.../security.py`
- 既存の「set its priority, describe the context... propose a fix」が散文を誘発しているため、
  構造化スキーマへ直接出力するよう明示する。

### 検証

- 単体テスト: 各 reviewer の `system_prompt` に構造化出力のみを求める指示が含まれること。
- 評価②: 失敗件数 / Must-Find Recall / Critical Miss Rate をベースライン（4失敗）と比較。

---

## 4. 検証方針（評価）

`evaluation/EVALUATION_PLAN.md` に従う。granite での評価はハード非対応ではないため、
本変更の合否は「失敗件数の減少」と「Must-Find Recall の改善傾向」で判断する。
モデルの非決定性を踏まえ、断定は避け、実行ログ（`stop_reason`）を根拠として提示する。
