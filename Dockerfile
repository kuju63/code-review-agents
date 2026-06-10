# syntax=docker/dockerfile:1

# コンテナ内 Python バージョン — base image 更新時に合わせて変更すること
# NOTE: cgr.dev/chainguard/python の free tier は latest タグのみ提供。
#       Python 3.12 固定タグは非対応のため 3.14 を使用している。
#       pyproject.toml の requires-python = ">=3.12" の範囲内であり有効な選択。
#       ダイジスト固定により Python バージョンは凍結されている。
ARG PYTHON_VERSION=3.14

###############################################################################
# Stage 0: uv バイナリ取得
# ghcr.io/astral-sh/uv:0.11.19 — バージョン+ダイジェスト固定で再現性を確保
# Renovate が FROM 行を自動更新する (renovate.json config:recommended)
###############################################################################
FROM ghcr.io/astral-sh/uv:0.11.19@sha256:b46b03ddfcfbf8f547af7e9eaefdf8a39c8cebcba7c98858d3162bd28cf536f6 AS uv-binary

###############################################################################
# Stage 1: builder
# cgr.dev/chainguard/python:latest-dev — ランタイムと同一 Wolfi/glibc ベース
# - ABI 互換: cryptography / cffi / uvloop 等のバイナリ拡張の互換を保証
# - ダイジェスト固定: タグ更新による意図しない Python バージョン変更を防止
###############################################################################
FROM cgr.dev/chainguard/python:latest-dev@sha256:bff523bf62eae383d13fe62fb9e0f2b10fe261020069f022ac788795e3a1d531 AS builder

USER root

COPY --from=uv-binary /uv /usr/local/bin/uv

# UV_COMPILE_BYTECODE: .pyc を事前生成（起動高速化）
# UV_LINK_MODE=copy: ハードリンク非対応環境へのフォールバック
# UV_PYTHON_DOWNLOADS=never: コンテナ内での Python 追加ダウンロードを禁止
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

WORKDIR /app

# 依存ファイルを先にコピーしてレイヤーキャッシュを最大化
# README.md は pyproject.toml の readme フィールドで uv_build が参照するため必須
COPY pyproject.toml uv.lock README.md ./

# Phase 1: 依存パッケージのみ先にインストール（キャッシュ最大化）
# pyproject.toml / uv.lock が変わらない限りこのレイヤーは再利用される
# --no-install-project: プロジェクト自身のインストールを後回しにする
RUN uv sync --frozen --no-dev --no-install-project --no-cache

# src/ を後からコピーすることで依存レイヤーのキャッシュを保護する
COPY src/ ./src/

# Phase 2: プロジェクト本体をインストールして site-packages と bin を抽出
# --no-editable: site-packages へのコピーインストール（runtime に src/ 不要）
RUN uv sync --frozen --no-dev --no-editable --no-cache && \
    mkdir -p /app/pysite /app/bin && \
    cp -r /app/.venv/lib/python*/site-packages/. /app/pysite/ && \
    # console script のシェバンを Chainguard ランタイムの Python パスに修正
    # sys.argv[0] = "/usr/local/bin/code-review-agent" になるため argparse 等が正常動作する
    cp /app/.venv/bin/code-review-agent /app/bin/ && \
    sed -i '1s|.*|#!/usr/bin/python|' /app/bin/code-review-agent && \
    chmod +x /app/bin/code-review-agent

###############################################################################
# Stage 2: runtime
# cgr.dev/chainguard/python:latest — Wolfi ベース、ゼロ CVE ポリシー、シェルなし
# - nonroot ユーザー (UID 65532) がビルトイン
# - ダイジェスト固定: Python バージョン変化による site-packages パス破損を防止
###############################################################################
FROM cgr.dev/chainguard/python:latest@sha256:15c25640085de8df6ea342f0f4a0064b85ebb5c6e1fcc306c59f78724c070c9a AS runtime

# multi-stage ARG スコープ: pre-FROM で宣言した ARG を runtime ステージで再宣言
# base image 更新時は ARG PYTHON_VERSION とダイジェストを合わせて更新すること
ARG PYTHON_VERSION

WORKDIR /app

# システム Python の site-packages に直接インストールする
# → PYTHONPATH 非依存: ランタイムで -e PYTHONPATH を上書きされてもパッケージが見つかる
# → site.py がスタートアップ時にこのディレクトリを sys.path に追加する
COPY --from=builder /app/pysite /usr/lib/python${PYTHON_VERSION}/site-packages/

# console script をコピー (シェバン修正済み: #!/usr/bin/python)
# exec 形式 ENTRYPOINT から直接起動されるため sys.argv[0] が正しく設定される
COPY --from=builder /app/bin/code-review-agent /usr/local/bin/code-review-agent

# PYTHONDONTWRITEBYTECODE: 実行時の .pyc 生成を抑制（read-only fs 対応）
# PYTHONUNBUFFERED: stdout/stderr をバッファリングなしで出力（ログ即時反映）
# PYTHONFAULTHANDLER: クラッシュ時にスタックトレースを出力
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONFAULTHANDLER=1

USER nonroot

EXPOSE 8000

# シェルなし環境のため exec 形式を使用
# FastAPI サーバー実装後は HTTP エンドポイント (/health) へのリクエストに変更すること
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["/usr/bin/python", "-c", "import code_review_agent"]

ENTRYPOINT ["/usr/local/bin/code-review-agent"]
