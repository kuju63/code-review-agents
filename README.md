# Code Review Agent

AI を活用してコードレビューの品質を標準化し、レビュー担当者の負荷を下げることを目的としたプロジェクトです。

## Project Status

初期開発フェーズです。  
機能は拡張中であり、実行フローや CLI 仕様は今後更新されます。

## Usage

TBD

## Build (Developer Setup)

### 0. Requirements

開発時に最低限必要なもの:

- Python 3.12+
- `uv`（推奨）
- `betterleaks`（必須: 開発時のシークレットスキャンに利用）

`pre-commit` は `uv sync` により開発依存としてインストールされます。

#### Install betterleaks (required)

```bash
# Homebrew (recommended)
brew install betterleaks

# If needed, use tap
brew install betterleaks/tap/betterleaks
```

インストール確認:

```bash
betterleaks --version
```

### 1. Clone and enter workspace

```bash
git clone https://github.com/kuju63/code-review-agent.git
cd code-review-agent
```

### 2. Create virtual environment and install package

```bash
uv venv
source .venv/bin/activate
uv sync
```

### 3. Enable Git hooks (pre-commit)

Git フック有効化（リポジトリごとに 1 回実行）:

```bash
pre-commit install
```

手動実行（全ファイル対象）:

```bash
pre-commit run --all-files
```

このプロジェクトでは、betterleaks を pre-commit フック経由で実行しています。

### 4. Build package

```bash
uv build
```

成果物は通常 `dist/` に生成されます。

### 5. Run application

ローカル開発時の最小実行手順:

```bash
# If not activated yet
source .venv/bin/activate

# Run entrypoint via uv
uv run code-review-agent
```

`uv` を使わず仮想環境内で直接実行する場合:

```bash
code-review-agent
```

現時点では、上記コマンドで動作確認用のメッセージ（`Hello from code-review-agent!`）が出力されます。

### 6. Test

```bash
uv run pytest
```

### 7. Lint and format (Ruff)

このプロジェクトでは Ruff を Linter / Formatter として利用します。

```bash
# Lint
uv run ruff check

# Lint + auto-fix (safe fixes by default)
uv run ruff check --fix

# Format
uv run ruff format

# Format check only (CI向け)
uv run ruff format --check
```

## Evaluation Workflow (Current)

評価データセット作成とスコアリングの現行導線:

```bash
# Build targets + Gold + Seeded
bash evaluation/tools/run_evaluation_pipeline.sh

# Score (after generating agent predictions)
python evaluation/tools/score_evaluation.py \
 --gold evaluation/data/gold_pr_set.jsonl \
 --seeded evaluation/data/seeded_set.jsonl \
 --pred evaluation/data/agent_predictions.jsonl
```

詳細は以下を参照:

- `evaluation/RUNBOOK.md`
- `evaluation/EVALUATION_PLAN.md`

## Roadmap

- エージェント実行フローの安定化
- 評価パイプラインの自動化強化
- データセット拡充（Rails / Spring / Front-end）
- しきい値ゲートの継続運用

## Contributing

コントリビューション手順は `CONTRIBUTING.md` を参照してください。  
不具合報告・機能要望は Issue 作成を前提としています。

## Authors

- Jun Kurihara

## License

TBD

## Acknowledgments

- [The ReadME Project](https://github.com/readme)
- [betterleaks](https://github.com/betterleaks/betterleaks)
