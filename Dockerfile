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

USER root

COPY --from=uv-binary /uv /usr/local/bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

WORKDIR /app

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
###############################################################################
FROM cgr.dev/chainguard/python:latest AS runtime

WORKDIR /app

# システム Python の site-packages に直接インストールする
# → PYTHONPATH 非依存: ランタイムで -e PYTHONPATH を上書きされてもパッケージが見つかる
# → site.py がスタートアップ時にこのディレクトリを sys.path に追加する
# NOTE: パスは cgr.dev/chainguard/python:latest の Python バージョンに依存する
#       (現在 Python 3.14)。バージョン変更時は更新が必要。
COPY --from=builder /app/pysite /usr/lib/python3.14/site-packages/

# console script をコピー (シェバン修正済み: #!/usr/bin/python)
# exec 形式 ENTRYPOINT から直接起動されるため sys.argv[0] が正しく設定される
COPY --from=builder /app/bin/code-review-agent /usr/local/bin/code-review-agent

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
