---
name: run-evaluation
description: "Code Review Agentの性能評価を実行するスキル。Gold setとSeeded setを準備し、A2Aサーバーをpodmanコンテナで起動し、評価スクリプトを実行して結果をObsidianに保存する。次のような要求で必ずこのスキルを使うこと: 「評価を実行してください」「性能評価をしてください」「run evaluation」「評価パイプライン」「Agentのスコアを確認したい」「review agentの精度を測りたい」"
---

# run-evaluation スキル

Code Review Agent の性能評価を一貫して実行するためのスキル。
Gold set・Seeded setの準備 → A2Aサーバー起動 → 評価実行 → サーバー終了 → Obsidian保存 を担当する。

## ステップ概要

```text
1. 前提チェック（.env, pr_targets_{stack}.json の存在, podman, nix の存在）
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
# .env の存在確認（GITHUB_TOKEN が必要。Gold/Seeded set両方の構築に使う）
if [ ! -f .env ]; then
  echo "ERROR: .env not found. Create it with GITHUB_TOKEN."
  exit 1
fi
set -a
source .env
set +a
[ -n "${GITHUB_TOKEN:-}" ] || { echo "ERROR: GITHUB_TOKEN not set in .env"; exit 1; }
echo ".env OK"

# canonical per-stack target filesの存在確認（Gold set用）
for stack in react vue angular svelte; do
  path="evaluation/input/pr_targets_${stack}.json"
  if [ ! -f "$path" ]; then
    echo "ERROR: $path not found."
    exit 1
  fi
done
echo "per-stack target files OK"

# Seeded PR targets（must_findメタデータ）の存在確認
for stack in react vue angular svelte; do
  path="evaluation/input/seeded_pr_targets_${stack}.json"
  if [ ! -f "$path" ]; then
    echo "ERROR: $path not found."
    exit 1
  fi
done
echo "seeded PR target files OK"

# A2Aサーバーをコンテナで起動するため podman が必要
command -v podman > /dev/null 2>&1 || { echo "ERROR: podman not found."; exit 1; }
# TypeScript evaluation workspace commands require the repository Nix toolchain
command -v nix > /dev/null 2>&1 || { echo "ERROR: nix not found."; exit 1; }
# バイナリの存在だけでなく、rootless実行環境やストレージが初期化済みで
# 実際にコンテナを起動できる状態かをここで検知する（Step 2のデータセット生成に
# 時間をかけた後、Step 3で初めて podman が使えないと判明するのを避けるため）。
podman info > /dev/null 2>&1 || { echo "ERROR: podman is installed but not usable (check rootless setup/storage initialization)."; exit 1; }
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
  nix develop --command pnpm --filter @code-review-agent/evaluation run build-gold-set \
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
  nix develop --command pnpm --filter @code-review-agent/evaluation run build-seeded-set \
    --targets evaluation/input/seeded_pr_targets_react.json \
              evaluation/input/seeded_pr_targets_vue.json \
              evaluation/input/seeded_pr_targets_angular.json \
              evaluation/input/seeded_pr_targets_svelte.json \
    --output evaluation/data/seeded_set.jsonl
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
同名コンテナが既に**稼働中**の場合は、他セッションの評価実行中とみなしてスクリプトは
明示的に失敗する（黙って`--replace`で強制終了させることはしない）。
設計の詳細（`--env-file`を使わない理由、`GITHUB_TOKEN`を渡さない理由、
`--network=host`が必要な理由、同時実行時の扱い）は
[docs/eval-a2a-container-runtime-spec.md](../../../docs/eval-a2a-container-runtime-spec.md)
を参照。

---

## Step 4: 評価スクリプトの実行

`run-agent-evaluation`（TypeScript版、Issue #255で`run_agent_evaluation.py`から移行）は
A2Aサーバーの起動・停止を一切行わない（起動はStep 3、停止はStep 5が担当する）。
`packages/evaluation/package.json`にはまだ`run-agent-evaluation`用のscriptエントリがない
（`main`のIssue #306/#307時点からの既存ギャップで、この移行では未対応）ため、`tsx`を直接呼ぶ。

```bash
nix develop --command pnpm --filter @code-review-agent/evaluation exec tsx \
  src/run-agent-evaluation.ts \
  --gold evaluation/data/gold_pr_set.jsonl \
  --seeded evaluation/data/seeded_set.jsonl \
  --pred evaluation/data/agent_predictions.jsonl \
  --base-url http://localhost:8000 \
  --concurrency 2
EVAL_EXIT=$?
```

`--base-url`は必ず明示すること。コマンド自身の既定値（`http://localhost:3000`、
`packages/a2a-server`固定ポートに合わせたもの）は、Step 3で起動するA2Aコンテナが実際に
公開するポート（`localhost:8000`、旧Python版runnerの既定と同じ）とは異なる。

`--concurrency`は既定で2（Gold/Seededの各項目を最大2件同時に評価）。ハードウェアや外部LLM API・
GitHub MCPのレート制限次第では2が現実的な上限であり、上げる場合はタイムアウト（`--timeout`、既定1800秒）
に達するリスクが増える点に注意する（詳細: [docs/evaluation-pipeline-design.md](../../../docs/evaluation-pipeline-design.md)）。

コマンドは `evaluation/data/` 配下に以下を生成する:

- `agent_predictions.jsonl` — Agentの予測結果
- `agent_predictions.jsonl.failed_ids.json` — 失敗item idのsidecar（常に書き込まれる、0件でも）

旧Python版runnerと異なり、`run-agent-evaluation`はレポート生成・Discord通知を自動実行しない
（`docs/ts-agent-evaluation-runner-spec.md` §2.2で明示的にスコープ外）。続けて明示的に実行する:

```bash
nix develop --command pnpm --filter @code-review-agent/evaluation run generate-evaluation-report \
  --gold evaluation/data/gold_pr_set.jsonl \
  --seeded evaluation/data/seeded_set.jsonl \
  --pred evaluation/data/agent_predictions.jsonl
REPORT_EXIT=$?
```

これが `report_YYYYMMDD-HHMMSS-<hash>.md`（評価レポート、Markdown）を生成する。
`.env` に `DISCORD_WEBHOOK_URL` が設定されていれば、レポート生成直後（Hard Gate の成否を問わず）に自動で Discord へ完了通知が送信される（任意設定。未設定なら何もしない）。

### 実行環境に時間制約がある場合（例: OpenCode の呼び出し単位2時間制約）

旧Python版runnerが持っていた`--shard-index`/`--shard-count`による自動分割は、TypeScript移植の
対象外として明示的に見送られ（`docs/ts-agent-evaluation-runner-spec.md` §2.2）、Issue #255で
`run_agent_evaluation.py`ごと削除された。現時点でTypeScript版に自動分割の代替機能はない。

1回で完走できない場合の回避策（手動）: `gold_pr_set.jsonl`/`seeded_set.jsonl`を自分で複数の
サブセットファイルに分割し、`--pred`を分けて`run-agent-evaluation`をサブセットの数だけ繰り返す
（各回`<pred>.failed_ids.json`sidecarを同じ命名規則で書き込む）。詳細な手順・マージ方法は
[evaluation/RUNBOOK.md §4a](../../../evaluation/RUNBOOK.md#4a-time-constrained-environments-sharded-execution-retired)
を参照。この場合、`merge-predictions`（引き続き利用可能）でオリジナルの完全な`--gold`/`--seeded`
ファイルを渡してマージ・検証し、`generate-evaluation-report`をマージ後の`agent_predictions.jsonl`
に対して実行してからStep 5に進む。

---

## Step 5: A2A サーバーコンテナの停止

`run-agent-evaluation` はサーバーを停止しないため、評価の成功・失敗によらず必ずこの
Stepでコンテナを停止する。定型処理のため `scripts/stop_a2a_container.sh` を呼ぶだけでよい
（`podman stop`。コンテナは`--rm`付きで起動しているため、停止と同時に削除される）。

手動分割実行時（§Step 4「実行環境に時間制約がある場合」）も含め、すべての実行パターンで
このStep 5がサーバー停止の唯一の手段である。分割運用では全パート完了後に1回だけ実行する。

```bash
bash .claude/skills/run-evaluation/scripts/stop_a2a_container.sh
```

終了コードの確認（旧Python版runnerと異なり、`run-agent-evaluation`と
`generate-evaluation-report`は別々のコマンドなので終了コードも別々に確認する。
`EVAL_EXIT`/`REPORT_EXIT`はStep 4で保存したもの）:

`run-agent-evaluation`（`$EVAL_EXIT`）:
- `0`: 全評価成功
- `1`: 一部アイテムの評価失敗（`failed_ids`あり、予測は部分結果）
- `2`: 引数・環境エラー（`GITHUB_TOKEN`未設定、または`--concurrency`/`--poll-interval`/`--timeout`の指定不正）

`generate-evaluation-report`（`$REPORT_EXIT`）:
- `0`: 全評価成功のレポート生成
- `1`: `failed_ids`が存在するレポート生成（スコアは部分結果を含む）
- `2`: 引数エラー
- `4`: スコアリング失敗（`score-evaluation`相当の内部処理が失敗）
- `5`: `failed_ids` sidecarが見つからない（`--pred`単体で実行した場合など。
  `--allow-missing-failed-ids`で許容可能）

---

## Step 6: Obsidian へのレポート保存

手動分割運用時は `generate-evaluation-report`(マージ後に独立実行したもの)が生成した
レポートが対象になる。それ以外は生成物の形式・保存手順に差はない。

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

- **Vault**: `AI Knowledge`（`obsidian vaults`で確認できる実際のVault名。手順書に旧称「AI box」と
  書かれていることがあるが、指定すると`Vault not found.`になるため`AI Knowledge`を使うこと）
- **保存先**: `プロジェクト/code-review-agent/evaluation-report/`
- **ファイル名**: レポートファイル名をそのまま使用（`report_YYYYMMDD-HHMMSS-<hash>.md` → `YYYYMMDD-HHMMSS-<hash>.md` に変換してもよい）

> Obsidian への保存は評価スクリプトからの subprocess 呼び出しではなく、
> 必ず Claude が obsidian-cli スキル経由で行うこと。

---

## 注意事項

- `GITHUB_TOKEN` は `.env` から読み込む。`gh` コマンド等の実作業には使用しない（`.env` の `GITHUB_TOKEN` は評価パイプライン専用）。評価パイプラインのbuild系スクリプト（`select-stack-targets`/`build-gold-set`/`build-seeded-set`等）はIssue #255で全てTypeScript化されており `venv` は不要（`nix develop`のみで完結する）。GitHub MCP呼び出し（レビューAgent自体の動作、`src/code_review_agent/`配下）は引き続き `venv`（`source .venv/bin/activate`）を使う。
- A2A サーバーは `code-review-agent-eval` という固定名のpodmanコンテナとして起動する（デフォルトポートは`8000`、`--network=host`のためホストと同じ`localhost:8000`でアクセスできる）。`--replace`が置き換えるのは**停止済み**の同名コンテナ（前回異常終了時の残骸など）のみで、**稼働中**の同名コンテナがあれば`start_a2a_container.sh`は置き換えずに明示的に起動失敗する（他セッションの評価実行中を誤って停止しないため）。
- `pr_targets.json` / Gold set / Seeded set が既に存在する場合はビルドをスキップして再利用する。
- 既定は`--sample-n 15`によるランダムサンプリング(高速・日常イテレーション用)。全件に近いフル評価が
  必要な場合は、Step 2の変換コマンドを`--limit <n>`(例: 30)に置き換えること。
  `[COVERAGE-WARN]`が出ても処理は継続する(非ブロッキング)。
