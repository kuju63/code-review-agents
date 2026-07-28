# syntax=docker/dockerfile:1

###############################################################################
# Stage 0: uv バイナリ取得
# ghcr.io/astral-sh/uv:0.11.19 — バージョン+ダイジェスト固定で再現性を確保
# Renovate が FROM 行を自動更新する (renovate.json config:recommended)
###############################################################################
FROM ghcr.io/astral-sh/uv:0.11.32@sha256:df4cae8f3a96d175e2e5f992e597550000edbe78fdc2594d5cd8de1a217f504c AS uv-binary

###############################################################################
# Stage 1: builder
# Red Hat Hardened Image の builder variant — ランタイムと同一 UBI/glibc ベース
# - ABI 互換: cryptography / cffi / uvloop 等のバイナリ拡張の互換を保証
# - multi-arch index ダイジェスト固定: amd64 / arm64 を同一参照で提供
###############################################################################
FROM registry.access.redhat.com/hi/python:3.14-builder@sha256:6bbc9449f1a42fd50f29b59a28930fcdef79da9b82d1b0d923ff531d795b443b AS builder

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
    # console script のシェバンをランタイムの Python パスに修正
    # sys.argv[0] = "/usr/local/bin/code-review-agent" になるため argparse 等が正常動作する
    cp /app/.venv/bin/code-review-agent /app/bin/ && \
    sed -i '1s|.*|#!/usr/bin/python|' /app/bin/code-review-agent && \
    chmod +x /app/bin/code-review-agent

###############################################################################
# Stage 2: runtime
# Red Hat Hardened Image — UBI ベース、シェルなし
# - nonroot UID 65532 がビルトイン
# - multi-arch index ダイジェスト固定: amd64 / arm64 を同一参照で提供
###############################################################################
FROM registry.access.redhat.com/hi/python:3.14@sha256:a1cf57c4021e835237c14b82f92d46a931f75913c2c4307a72329636cc399124 AS runtime

WORKDIR /app

# システム Python の site-packages に直接インストールする
# → PYTHONPATH 非依存: ランタイムで -e PYTHONPATH を上書きされてもパッケージが見つかる
# → site.py がスタートアップ時にこのディレクトリを sys.path に追加する
COPY --from=builder /app/pysite /usr/lib/python3.14/site-packages/

# console script をコピー (シェバン修正済み: #!/usr/bin/python)
# exec 形式 ENTRYPOINT から直接起動されるため sys.argv[0] が正しく設定される
COPY --from=builder /app/bin/code-review-agent /usr/local/bin/code-review-agent

# PYTHONDONTWRITEBYTECODE: 実行時の .pyc 生成を抑制（read-only fs 対応）
# PYTHONUNBUFFERED: stdout/stderr をバッファリングなしで出力（ログ即時反映）
# PYTHONFAULTHANDLER: クラッシュ時にスタックトレースを出力
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONFAULTHANDLER=1

USER 65532

EXPOSE 8000

# シェルなし環境のため exec 形式を使用
# curl 非搭載のため stdlib urllib.request で HTTP GET を実行
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["/usr/bin/python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"]

ENTRYPOINT ["/usr/local/bin/code-review-agent"]
