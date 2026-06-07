# syntax=docker/dockerfile:1

###############################################################################
# Stage 1: builder
# ghcr.io/astral-sh/uv — uv 公式イメージ (astral-sh)、Python 3.14 + uv 同梱
# このステージは最終イメージに含まれないため CVE は問題にならない
###############################################################################
FROM ghcr.io/astral-sh/uv:python3.14-bookworm-slim AS builder

# UV_COMPILE_BYTECODE: .pyc を事前生成（起動高速化）
# UV_LINK_MODE=copy: ハードリンク非対応環境へのフォールバック
# UV_PYTHON_DOWNLOADS=never: コンテナ内での Python 追加ダウンロードを禁止
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

WORKDIR /app

# 依存ファイルを先にコピーしてレイヤーキャッシュを最大化
# src/ はビルドバックエンド (uv_build) のパッケージメタデータ解決に必要
COPY pyproject.toml uv.lock README.md ./
COPY src/ ./src/

# 本番依存のみを .venv にインストール
# --frozen : uv.lock を厳密に適用（再現性保証）
# --no-dev : dependency-groups.dev (pytest, ruff 等) を除外
# --no-editable : site-packages へのコピーインストール（runtime に src/ が不要になる）
# --no-cache : キャッシュをイメージレイヤーに残さない
RUN uv sync --frozen --no-dev --no-editable --no-cache && \
    # Chainguard ランタイムでは Python が /usr/bin/python に存在する。
    # ビルダー(.venv/bin/python -> /usr/local/bin/python3)のシンボリックリンクと
    # pyvenv.cfg の home パスを Chainguard のパスに合わせて修正する。
    ln -sf /usr/bin/python /app/.venv/bin/python && \
    sed -i 's|^home = .*|home = /usr/bin|' /app/.venv/pyvenv.cfg

###############################################################################
# Stage 2: runtime
# cgr.dev/chainguard/python:latest — Chainguard 公式 Python イメージ
# - Wolfi ベース (glibc)、ゼロ CVE ポリシー
# - シェルなし (distroless 相当)、攻撃面を最小化
# - nonroot ユーザー (UID 65532) がビルトイン
###############################################################################
FROM cgr.dev/chainguard/python:latest AS runtime

WORKDIR /app

# builder の .venv のみコピー
# --no-editable によりパッケージは site-packages に格納済みのため src/ は不要
# Wolfi は glibc ベースのため Bookworm でビルドした manylinux ホイールと互換
COPY --from=builder --chown=nonroot:nonroot /app/.venv /app/.venv

# PYTHONDONTWRITEBYTECODE: 実行時の .pyc 生成を抑制（read-only fs 対応）
# PYTHONUNBUFFERED: stdout/stderr をバッファリングなしで出力（ログ即時反映）
# PYTHONFAULTHANDLER: クラッシュ時にスタックトレースを出力
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONFAULTHANDLER=1

USER nonroot

EXPOSE 8000

# シェルなし環境のため exec 形式を使用
# FastAPI サーバー実装後は HTTP エンドポイント (/health) へのリクエストに変更すること
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["/app/.venv/bin/python", "-c", "import code_review_agent"]

# Chainguard のデフォルト ENTRYPOINT (/usr/bin/python) を上書き
# シェルなし環境のため絶対パスで指定
ENTRYPOINT ["/app/.venv/bin/code-review-agent"]
