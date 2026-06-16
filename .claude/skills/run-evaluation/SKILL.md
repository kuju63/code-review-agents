---
name: run-evaluation
description: "Code Review Agentの性能評価を実行するスキル。Gold setとSeeded setを準備し、A2AサーバーをバックグラウンドでKし、評価スクリプトを実行して結果をObsidianに保存する。次のような要求で必ずこのスキルを使うこと: 「評価を実行してください」「性能評価をしてください」「run evaluation」「評価パイプライン」「Agentのスコアを確認したい」「review agentの精度を測りたい」"
---

# run-evaluation スキル

Code Review Agent の性能評価を一貫して実行するためのスキル。
Gold set・Seeded setの準備 → A2Aサーバー起動 → 評価実行 → サーバー終了 → Obsidian保存 を担当する。

## ステップ概要

```text
1. 前提チェック（.env, pr_targets.json の存在）
2. Gold set / Seeded set の準備（なければビルド）
3. A2A サーバーをバックグラウンドで起動（PID を記録）
4. 評価スクリプトを実行
5. A2A サーバーを必ず停止（成功・失敗どちらの場合も）
6. 生成レポートを Obsidian に保存（obsidian-cli スキル経由）
```

---

## Step 1: 前提チェック

作業ディレクトリがリポジトリルートであることを確認する。

```bash
# .env の存在確認（GITHUB_TOKEN, CODE_REVIEW_MODEL_ID が必要）
ls .env
grep -q "GITHUB_TOKEN" .env && echo "OK" || echo "GITHUB_TOKEN not set"

# pr_targets.json（Gold setビルドの入力）の存在確認
ls evaluation/input/pr_targets.json
```

`.env` がなければユーザーに作成を依頼して中断する。

---

## Step 2: Gold set / Seeded set の準備

### 存在確認

```bash
ls evaluation/data/gold_pr_set.jsonl 2>/dev/null && echo "GOLD_EXISTS" || echo "GOLD_MISSING"
ls evaluation/data/seeded_set.jsonl 2>/dev/null && echo "SEEDED_EXISTS" || echo "SEEDED_MISSING"
```

### Gold set のビルド（なければ実行）

```bash
source .venv/bin/activate
python evaluation/tools/build_gold_set.py \
  --input evaluation/input/pr_targets.json \
  --output evaluation/data/gold_pr_set.jsonl
```

完了チェック: `evaluation/data/gold_pr_set.jsonl` が存在し行数が1以上であること。

### Seeded set のビルド（なければ実行）

```bash
python evaluation/tools/build_seeded_set.py \
  --gold evaluation/data/gold_pr_set.jsonl \
  --catalog evaluation/config/seeded_mutations.json \
  --output evaluation/data/seeded_set.jsonl \
  --multiplier 2
```

完了チェック: `evaluation/data/seeded_set.jsonl` が存在し行数が1以上であること。

---

## Step 3: A2A サーバーをバックグラウンドで起動

```bash
source .venv/bin/activate
nohup uv run code-review-agent > /tmp/a2a_server.log 2>&1 &
A2A_PID=$!
echo "A2A server PID: $A2A_PID"
```

**PID は必ず記録する。** 評価後に停止するために使う。

### サーバー起動待機

起動完了を確認してから評価を開始する（最大60秒待つ）:

```bash
for i in $(seq 1 20); do
  sleep 3
  if curl -sf http://localhost:8000/docs > /dev/null 2>&1; then
    echo "A2A server is ready"
    break
  fi
  echo "Waiting for server... ($i/20)"
done
```

20回試行しても応答しない場合はプロセスを停止して中断する:

```bash
kill $A2A_PID 2>/dev/null
echo "ERROR: A2A server did not start within 60s"
```

---

## Step 4: 評価スクリプトの実行

```bash
source .venv/bin/activate
python evaluation/tools/run_agent_evaluation.py \
  --gold evaluation/data/gold_pr_set.jsonl \
  --seeded evaluation/data/seeded_set.jsonl \
  --output evaluation/data/agent_predictions.jsonl
EVAL_EXIT=$?
```

スクリプトは `evaluation/data/` 配下に以下を生成する:

- `agent_predictions.jsonl` — Agentの予測結果
- `report_YYYYMMDD-HHMMSS-<hash>.md` — 評価レポート（Markdown）

---

## Step 5: A2A サーバーを必ず停止

**評価の成功・失敗にかかわらず、Step 3 で起動したサーバーを必ず停止する。**

```bash
kill $A2A_PID 2>/dev/null
echo "A2A server (PID $A2A_PID) stopped"
```

停止後に `EVAL_EXIT` を確認し、0 以外の場合はユーザーにエラーを報告する。
終了コード 1 は一部アイテムの評価失敗（スコアは部分結果）。終了コード 2〜4 は致命的エラー。

---

## Step 6: Obsidian へのレポート保存

`evaluation/data/report_*.md` の最新ファイルを特定する:

```bash
REPORT_PATH=$(ls -t evaluation/data/report_*.md | head -1)
echo "Report: $REPORT_PATH"
```

**obsidian-cli スキルを使い**、以下のパスに保存する:

- **Vault**: `AI box`
- **保存先**: `プロジェクト/code-review-agent/evaluation-report/`
- **ファイル名**: レポートファイル名をそのまま使用（`report_YYYYMMDD-HHMMSS-<hash>.md` → `YYYYMMDD-HHMMSS-<hash>.md` に変換してもよい）

> Obsidian への保存は Python スクリプトからの subprocess 呼び出しではなく、
> 必ず Claude が obsidian-cli スキル経由で行うこと。

---

## 注意事項

- `GITHUB_TOKEN` は `.env` から読み込む。`gh` コマンド等の実作業には使用しない（`.env` の `GITHUB_TOKEN` は評価パイプライン専用）。
- `venv` は `source .venv/bin/activate` で有効化する。
- A2A サーバーのデフォルトポートは `8000`。起動済みの別プロセスがいる場合は `lsof -i:8000` で確認してから起動すること。
- Gold set / Seeded set が既に存在する場合はビルドをスキップして再利用する。
