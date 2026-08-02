---
name: run-evaluation
description: "Code Review Agentの性能評価を実行するスキル。Gold setとSeeded setを準備し、A2Aサーバーをpodmanコンテナで起動し、評価スクリプトを実行して結果をObsidianに保存する。次のような要求で必ずこのスキルを使うこと: 「評価を実行してください」「性能評価をしてください」「run evaluation」「評価パイプライン」「Agentのスコアを確認したい」「review agentの精度を測りたい」"
---

# run-evaluation スキル

Code Review Agent の性能評価を一貫して実行するためのスキル。
Gold set・Seeded setの準備 → A2Aサーバー起動 → 評価実行 → サーバー終了 → Obsidian保存 を担当する。

## ステップ概要

```text
1. 前提チェック（.env, pr_targets_{stack}.json の存在, podman の存在）
2. Gold set / Seeded set の準備（なければビルド）
3. A2A サーバーを podman コンテナとして起動
4. 評価スクリプトを実行
5. A2A サーバーコンテナを停止
6. 生成レポートを Obsidian に保存（obsidian-cli スキル経由）
```

---

## Step 1: 前提チェック

作業ディレクトリがリポジトリルートであることを確認する。

```bash
# .env の存在確認（GITHUB_TOKEN と SEEDED_GEN_MODEL_ID が必要）
if [ ! -f .env ]; then
  echo "ERROR: .env not found. Create it with GITHUB_TOKEN and SEEDED_GEN_MODEL_ID."
  exit 1
fi
set -a
source .env
set +a
[ -n "${GITHUB_TOKEN:-}" ] || { echo "ERROR: GITHUB_TOKEN not set in .env"; exit 1; }
[ -n "${SEEDED_GEN_MODEL_ID:-}" ] || { echo "ERROR: SEEDED_GEN_MODEL_ID not set in .env"; exit 1; }
echo ".env OK"

# canonical per-stack target filesの存在確認
for stack in react vue angular svelte; do
  path="evaluation/input/pr_targets_${stack}.json"
  if [ ! -f "$path" ]; then
    echo "ERROR: $path not found."
    exit 1
  fi
done
echo "per-stack target files OK"

# A2Aサーバーをコンテナで起動するため podman が必要
command -v podman > /dev/null 2>&1 || { echo "ERROR: podman not found."; exit 1; }
echo "podman OK"
```

---

## Step 2: Gold set / Seeded set の準備

### 実行対象リストの生成（なければ実行）

4つのスタック別ターゲットファイルを無条件に全件使うと、後段の評価実行（Step 4）が
非常に遅くなる。既定では`--sample-n 15`でランダムにn件（`repo_type`で層化、stackで均衡）
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
  uv run python -u evaluation/tools/build_gold_set.py \
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
  uv run python -u evaluation/tools/build_seeded_set.py \
    --gold evaluation/data/gold_pr_set.jsonl \
    --catalog evaluation/config/seeded_mutations.json \
    --output evaluation/data/seeded_set.jsonl \
    --multiplier 2 \
    --model-id "$SEEDED_GEN_MODEL_ID"
else
  echo "Seeded set already exists, skipping build."
fi
```

完了チェック: `evaluation/data/seeded_set.jsonl` が存在し行数が1以上であること。

---

## Step 3: A2A サーバーを podman コンテナとして起動

公開イメージ `quay.io/kuju63/code-review-agent:latest` を取得し、コンテナ名固定
（`code-review-agent-eval`）で起動する。起動コマンド自体は定型処理のため
`scripts/start_a2a_container.sh` に切り出してあり、ここではそれを呼ぶだけでよい
（`/health` での起動確認・失敗時のログ出力・タイムアウトも同スクリプトが担当する）。

```bash
bash .claude/skills/run-evaluation/scripts/start_a2a_container.sh
```

コンテナ名は起動前から決まっている定数であるため、PIDのように実行時に判明する値を
ファイル経由で受け渡す必要はない（Step 5 は同じ定数名でコンテナを停止するだけでよい）。
設計の詳細（`--env-file`を使わない理由、`GITHUB_TOKEN`を渡さない理由、
`--network=host`が必要な理由）は
[docs/eval-a2a-container-runtime-spec.md](../../../docs/eval-a2a-container-runtime-spec.md)
を参照。

---

## Step 4: 評価スクリプトの実行

`run_agent_evaluation.py` はA2Aサーバーの起動・停止を一切行わない（起動はStep 3、停止は
Step 5が担当する）。

```bash
source .venv/bin/activate
python -u evaluation/tools/run_agent_evaluation.py \
  --gold evaluation/data/gold_pr_set.jsonl \
  --seeded evaluation/data/seeded_set.jsonl \
  --output evaluation/data/agent_predictions.jsonl \
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

### 実行環境に時間制約がある場合（例: OpenCode の呼び出し単位2時間制約）

上記コマンドを1回で完走できない場合は、`--shard-index`/`--shard-count` で評価フェーズを
複数回の呼び出しに分割する。手順・shard数の目安・マージ方法は
[evaluation/RUNBOOK.md §4a](../../../evaluation/RUNBOOK.md#4a-sharded-execution-time-constrained-environments)
を参照。この場合、Step 4のコマンドをshard数だけ繰り返した後、
`evaluation/tools/merge_predictions.py` でマージし、
`evaluation/tools/generate_evaluation_report.py` を実行してから Step 5 に進む
（レポート・Discord通知はこの独立実行で生成されるため、shard実行中の
`run_agent_evaluation.py` はレポート生成をスキップする）。

---

## Step 5: A2A サーバーコンテナの停止

`run_agent_evaluation.py` はサーバーを停止しないため、評価の成功・失敗によらず必ずこの
Stepでコンテナを停止する。定型処理のため `scripts/stop_a2a_container.sh` を呼ぶだけでよい
（`podman stop`。コンテナは`--rm`付きで起動しているため、停止と同時に削除される）。

shard実行時（`--shard-index`/`--shard-count` 指定時）も含め、すべての実行パターンで
このStep 5がサーバー停止の唯一の手段である。shard運用では全shard完了後に1回だけ実行する。

```bash
bash .claude/skills/run-evaluation/scripts/stop_a2a_container.sh
```

終了コードの確認:
- `0`: 全評価成功
- `1`: 一部アイテムの評価失敗（スコアは部分結果）
- `2〜5`: 致命的エラー（ユーザーに報告する）
  - `2`: 引数エラー（`GITHUB_TOKEN`未設定、または`--shard-index`/`--shard-count`の指定不正）
  - `3`: A2Aサーバーに接続できない
  - `4`: スコアリング失敗（`generate_evaluation_report.py`が`score_evaluation.py`の実行に失敗）
  - `5`: `failed_ids` sidecarが見つからない（`generate_evaluation_report.py`を`--pred`単体で
    実行した場合など。`--allow-missing-failed-ids`で許容可能）

非shard実行では`run_agent_evaluation.py`が`generate_evaluation_report.py`をsubprocess呼び出しし、
その終了コード（0/1/4/5のいずれか）をそのまま返す。

---

## Step 6: Obsidian へのレポート保存

shard運用時は `evaluation/tools/generate_evaluation_report.py`(マージ後に独立実行したもの)が
生成したレポートが対象になる。それ以外は生成物の形式・保存手順に差はない。

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

- `GITHUB_TOKEN` は `.env` から読み込む。`gh` コマンド等の実作業には使用しない（`.env` の `GITHUB_TOKEN` は評価パイプライン専用）。GitHub MCP呼び出し・build系スクリプトは引き続き `venv`（`source .venv/bin/activate`）を使う。
- A2A サーバーは `code-review-agent-eval` という固定名のpodmanコンテナとして起動する（デフォルトポートは`8000`、`--network=host`のためホストと同じ`localhost:8000`でアクセスできる）。前回異常終了時に同名コンテナが残っていても`--replace`により自動的に置き換わる。
- `pr_targets.json` / Gold set / Seeded set が既に存在する場合はビルドをスキップして再利用する。
- 既定は`--sample-n 15`によるランダムサンプリング(高速・日常イテレーション用)。全件に近いフル評価が
  必要な場合は、Step 2の変換コマンドを`--limit <n>`(例: 30)に置き換えること。
  `[COVERAGE-WARN]`が出ても処理は継続する(非ブロッキング)。
