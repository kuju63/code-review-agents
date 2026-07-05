---
name: run-evaluation
description: "Code Review Agentの性能評価を実行するスキル。Gold setとSeeded setを準備し、A2Aサーバーをバックグラウンドで起動し、評価スクリプトを実行して結果をObsidianに保存する。次のような要求で必ずこのスキルを使うこと: 「評価を実行してください」「性能評価をしてください」「run evaluation」「評価パイプライン」「Agentのスコアを確認したい」「review agentの精度を測りたい」"
---

# run-evaluation スキル

Code Review Agent の性能評価を一貫して実行するためのスキル。
Gold set・Seeded setの準備 → A2Aサーバー起動 → 評価実行 → サーバー終了 → Obsidian保存 を担当する。

## ステップ概要

```text
1. 前提チェック（.env, pr_targets_b2b2c_tagged.json の存在）
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
if [ ! -f .env ]; then
  echo "ERROR: .env not found. Create it with GITHUB_TOKEN and CODE_REVIEW_MODEL_ID."
  exit 1
fi
grep -q "GITHUB_TOKEN" .env || { echo "ERROR: GITHUB_TOKEN not set in .env"; exit 1; }
echo ".env OK"

# pr_targets_b2b2c_tagged.json（タグ付きPR候補プール、Step2の変換元データ）の存在確認
if [ ! -f evaluation/input/pr_targets_b2b2c_tagged.json ]; then
  echo "ERROR: evaluation/input/pr_targets_b2b2c_tagged.json not found."
  exit 1
fi
echo "pr_targets_b2b2c_tagged.json OK"
```

---

## Step 2: Gold set / Seeded set の準備

### 実行対象リストの生成（なければ実行）

タグ付きPR候補プール（39件、`pr_targets_b2b2c_tagged.json`）を無条件に全件使うと、後段の
評価実行（Step 4）が非常に遅くなる。既定では`--sample-n 15`でランダムにn件（`repo_type`で層化）
に絞り込んでから使う。フル評価（週次/リリースゲート判定）が必要な場合は`--limit`に切り替えること。

```bash
if [ ! -s evaluation/data/pr_targets.json ]; then
  source .venv/bin/activate
  bash evaluation/tools/run_evaluation_pipeline.sh \
    --sample-n 15 \
    --skip-gold \
    --skip-seeded
else
  echo "pr_targets.json already exists, skipping conversion."
fi
```

`[COVERAGE-WARN]`が出力されても非ブロッキングであり、処理は継続する
（詳細: [docs/evaluation-pipeline-design.md](../../../docs/evaluation-pipeline-design.md)）。

### Gold set のビルド（なければ実行）

```bash
if [ ! -s evaluation/data/gold_pr_set.jsonl ]; then
  source .venv/bin/activate
  python evaluation/tools/build_gold_set.py \
    --input evaluation/data/pr_targets.json \
    --output evaluation/data/gold_pr_set.jsonl
else
  echo "Gold set already exists, skipping build."
fi
```

完了チェック: `evaluation/data/gold_pr_set.jsonl` が存在し行数が1以上であること。

### Seeded set のビルド（なければ実行）

```bash
if [ ! -s evaluation/data/seeded_set.jsonl ]; then
  python evaluation/tools/build_seeded_set.py \
    --gold evaluation/data/gold_pr_set.jsonl \
    --catalog evaluation/config/seeded_mutations.json \
    --output evaluation/data/seeded_set.jsonl \
    --multiplier 2
else
  echo "Seeded set already exists, skipping build."
fi
```

完了チェック: `evaluation/data/seeded_set.jsonl` が存在し行数が1以上であること。

---

## Step 3: A2A サーバーをバックグラウンドで起動

```bash
source .venv/bin/activate
nohup uv run code-review-agent > /tmp/a2a_server.log 2>&1 &
A2A_PID=$!
echo "$A2A_PID" > /tmp/a2a_eval.pid
echo "A2A server PID: $A2A_PID"
```

PID を `/tmp/a2a_eval.pid` に書き出す。Bash ツールはツール呼び出しをまたいでシェル変数を保持しないため、Step 5 では `$A2A_PID` が未設定になりうる。PID ファイルにより確実に停止できる。

### サーバー起動待機

起動完了を確認してから評価を開始する（最大60秒待つ）:

```bash
SERVER_READY=0
for i in $(seq 1 20); do
  sleep 3
  if curl -sf http://localhost:8000/docs > /dev/null 2>&1; then
    echo "A2A server is ready"
    SERVER_READY=1
    break
  fi
  echo "Waiting for server... ($i/20)"
done

if [ "$SERVER_READY" -eq 0 ]; then
  kill $A2A_PID 2>/dev/null
  echo "ERROR: A2A server did not start within 60s"
  exit 1
fi
```

---

## Step 4: 評価スクリプトの実行

`--server-pid-file` を渡すことで、評価完了後にスクリプト自身が A2A サーバーを自動停止する（`finally` ブロックで `SIGTERM` 送信）。

```bash
source .venv/bin/activate
python evaluation/tools/run_agent_evaluation.py \
  --gold evaluation/data/gold_pr_set.jsonl \
  --seeded evaluation/data/seeded_set.jsonl \
  --output evaluation/data/agent_predictions.jsonl \
  --server-pid-file /tmp/a2a_eval.pid \
  --concurrency 2
EVAL_EXIT=$?
```

`--concurrency`は既定で2（Gold/Seededの各項目を最大2件同時に評価）。ハードウェアや外部LLM API・
GitHub MCPのレート制限次第では2が現実的な上限であり、上げる場合はタイムアウト（`--timeout`、既定1800秒）
に達するリスクが増える点に注意する（詳細: [docs/evaluation-pipeline-design.md](../../../docs/evaluation-pipeline-design.md)）。

スクリプトは `evaluation/data/` 配下に以下を生成する:

- `agent_predictions.jsonl` — Agentの予測結果
- `report_YYYYMMDD-HHMMSS-<hash>.md` — 評価レポート（Markdown）

`.env` に `DISCORD_WEBHOOK_URL` が設定されていれば、レポート生成直後（Hard Gate の成否を問わず）に自動で Discord へ完了通知が送信される（任意設定。未設定なら何もしない）。

---

## Step 5: サーバー停止の確認（念のためのフォールバック）

`run_agent_evaluation.py` の `--server-pid-file` オプションにより、スクリプト終了時に自動的に SIGTERM が送信される。
スクリプトが異常終了した場合のフォールバックとして、PID ファイルが残っていれば手動停止する。

```bash
if [ -f /tmp/a2a_eval.pid ]; then
  A2A_PID=$(cat /tmp/a2a_eval.pid)
  kill "$A2A_PID" 2>/dev/null
  echo "A2A server (PID $A2A_PID) stopped (fallback)"
  rm -f /tmp/a2a_eval.pid
else
  echo "A2A server already stopped by run_agent_evaluation.py"
fi
```

終了コードの確認:
- `0`: 全評価成功
- `1`: 一部アイテムの評価失敗（スコアは部分結果）
- `2〜4`: 致命的エラー（ユーザーに報告する）

---

## Step 6: Obsidian へのレポート保存

`evaluation/data/report_*.md` の最新ファイルを特定する:

```bash
REPORT_PATH=$(ls -t evaluation/data/report_*.md 2>/dev/null | head -1)
if [ -z "$REPORT_PATH" ]; then
  echo "WARNING: No evaluation report found. Obsidian save skipped."
  exit 1
fi
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
- `pr_targets.json` / Gold set / Seeded set が既に存在する場合はビルドをスキップして再利用する。
- 既定は`--sample-n 15`によるランダムサンプリング(高速・日常イテレーション用)。全件に近いフル評価が
  必要な場合は、Step 2の変換コマンドを`--limit <n>`(例: 30)に置き換えること。
  `[COVERAGE-WARN]`が出ても処理は継続する(非ブロッキング)。
