# syntax=docker/dockerfile:1

###############################################################################
# Stage 0: uv バイナリ取得
# ghcr.io/astral-sh/uv:latest — uv の公式イメージからバイナリのみ抽出
# ビルドステージにコピーして使用することで、ランタイムへの混入を防ぐ
###############################################################################
FROM ghcr.io/astral-sh/uv:latest AS uv-binary

###############################################################################
# Stage 1: builder
# cgr.dev/chainguard/python:latest-dev — ランタイムと同一 Wolfi/glibc ベース
# → cryptography / cffi / uvloop 等バイナリ拡張の ABI 互換を保証
# → gcc・glibc・OpenSSL のバージョン差異によるランタイムエラーを排除
###############################################################################
FROM cgr.dev/chainguard/python:latest-dev AS builder

# ビルド操作に root 権限が必要なため一時的に切り替え
USER root

# uv バイナリを標準パスにコピー
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
COPY src/ ./src/

# 本番依存のみをインストールし site-packages を固定パスに抽出
# --frozen : uv.lock を厳密に適用（再現性保証）
# --no-dev : pytest・ruff 等の開発依存を除外
# --no-editable : site-packages へのコピーインストール（runtime に src/ 不要）
# --no-cache : キャッシュをイメージレイヤーに残さない
# venv のシンボリックリンク構造はランタイム不要のため site-packages のみ抽出
RUN uv sync --frozen --no-dev --no-editable --no-cache && \
    mkdir -p /app/pysite && \
    cp -r /app/.venv/lib/python*/site-packages/. /app/pysite/

###############################################################################
# Stage 2: runtime
# cgr.dev/chainguard/python:latest — Wolfi ベース、ゼロ CVE ポリシー、シェルなし
# - nonroot ユーザー (UID 65532) がビルトイン
# - venv を持ち込まないため venv シンボリックリンクの修正が不要
###############################################################################
FROM cgr.dev/chainguard/python:latest AS runtime

WORKDIR /app

# site-packages のみコピー（venv 全体を持ち込まない）
# ビルダーと同一 Chainguard イメージのため Python ABI が完全に一致する
COPY --from=builder --chown=nonroot:nonroot /app/pysite /app/site-packages

# PYTHONPATH: venv なしでパッケージを検索できるようにする
# PYTHONDONTWRITEBYTECODE: 実行時の .pyc 生成を抑制（read-only fs 対応）
# PYTHONUNBUFFERED: stdout/stderr をバッファリングなしで出力（ログ即時反映）
# PYTHONFAULTHANDLER: クラッシュ時にスタックトレースを出力
ENV PYTHONPATH="/app/site-packages" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONFAULTHANDLER=1

USER nonroot

EXPOSE 8000

# シェルなし環境のため exec 形式を使用
# FastAPI サーバー実装後は HTTP エンドポイント (/health) へのリクエストに変更すること
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["/usr/bin/python", "-c", "import code_review_agent"]

# venv を経由しないため Chainguard ランタイムの /usr/bin/python を直接使用
ENTRYPOINT ["/usr/bin/python", "-c", "from code_review_agent import main; main()"]
