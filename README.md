# Code Review Agent

AI を活用してコードレビューの品質を標準化し、レビュー担当者の負荷を下げることを目的としたプロジェクトです。

## Project Status

初期開発フェーズです。  
機能は拡張中であり、実行フローや CLI 仕様は今後更新されます。

## Usage

### Using Podman

1. Build image or pull from registry:

    ```bash
    podman pull quay.io/kuju63/code-review-agent:latest
    # or build locally
    podman build -t code-review-agent .
    ```
2. Create secrets for OpenAI API key and GitHub token:

    ```bash
    cp deploy/secrets.example.yaml deploy/secrets.yaml
    echo -n 'YOUR_OPENAI_API_KEY' | base64
    echo -n 'YOUR_GITHUB_TOKEN' | base64
    # Replace the values in deploy/secrets.yaml with the base64-encoded strings
    ```

3. Edit ConfigMap for environment variables:

    ```bash
    cp deploy/configmap.yaml deploy/configmap.old.yaml
    # Edit deploy/configmap.yaml to set CODE_REVIEW_MODEL_ID, CODE_REVIEW_LLM_BASE_URL, etc.
    ```

4. Deploy with Podman:

    ```bash
    podman play kube deploy/configmap.yaml \
                  deploy/secrets.yaml \
                  deploy/pod.yaml \
                  deploy/service.yaml
    ```

### 環境変数の設定

`.env.example` を `.env` にコピーして必要な値を入力します。

```bash
cp .env.example .env
```

#### 必須

| 変数名              | 説明                                                      |
|------------------|---------------------------------------------------------|
| `OPENAI_API_KEY` | OpenAI API キー（Ollama 等を使う場合は `"ollama"` 等のダミー値でも可）      |
| `GITHUB_TOKEN`   | GitHub personal access token（評価パイプライン・GitHub MCP 接続に必須） |

#### 任意

| 変数名                        | デフォルト値                                        | 説明                                                  |
|----------------------------|-----------------------------------------------|-----------------------------------------------------|
| `CODE_REVIEW_MODEL_ID`     | `gpt-4o`                                      | LLM モデル ID                                          |
| `CODE_REVIEW_LLM_BASE_URL` | —                                             | OpenAI 互換エンドポイント（Ollama / LM Studio / OpenRouter 等） |
| `CODE_REVIEW_HOST`         | `0.0.0.0`                                     | サービスホスト                                             |
| `CODE_REVIEW_PORT`         | `8000`                                        | サービスポート                                             |
| `CODE_REVIEW_LOG_LEVEL`    | `info`                                        | ログレベル                                               |
| `GITHUB_MCP_URL`           | `https://api.githubcopilot.com/mcp/read-only` | GitHub MCP エンドポイント                                  |
| `DISCORD_WEBHOOK_URL`      | —                                             | 設定すると評価パイプライン完了時に Discord へ通知が送信される                   |

詳細は `.env.example` のコメントを参照してください。

### 実行方法

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
