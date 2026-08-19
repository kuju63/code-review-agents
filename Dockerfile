# syntax=docker/dockerfile:1

###############################################################################
# Stage 0: uv バイナリ取得
# ghcr.io/astral-sh/uv:0.11.19 — バージョン+ダイジェスト固定で再現性を確保
# Renovate が FROM 行を自動更新する (renovate.json config:recommended)
###############################################################################
FROM ghcr.io/astral-sh/uv:0.12.5@sha256:e85be844203885286c60ffad8a858d48afb6c5a5c237ca0e67f12e74b8f174b1 AS uv-binary

###############################################################################
# Stage 1: builder
# Red Hat Hardened Image の builder variant — ランタイムと同一 UBI/glibc ベース
# - ABI 互換: cryptography / cffi / uvloop 等のバイナリ拡張の互換を保証
# - multi-arch index ダイジェスト固定: amd64 / arm64 を同一参照で提供
###############################################################################
FROM registry.access.redhat.com/hi/python:3.14-builder@sha256:c97487a76b1ec6a672f58a1a53ca69041ca78acbaf3b7b0f562c3b41cd7d0763 AS builder

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
# Stage 2: node-builder (Issue #250 — TypeScript toolchain, coexists with the
# Python stages until Issue #255 removes them)
# Red Hat Hardened Image の Node.js builder variant。
# - corepack は同梱されていないため pnpm は npm 経由で直接インストールする
# - multi-arch index ダイジェスト固定: amd64 / arm64 を同一参照で提供
###############################################################################
FROM registry.access.redhat.com/hi/nodejs:26-builder@sha256:14dfb366a4a1922938177e948d28bc3557d601d27c6b7c2e1eb6d7f32a73c454 AS node-builder

USER root

# packageManager (package.json) と一致させる
RUN npm install --global pnpm@11.20.0

WORKDIR /app

# 依存マニフェストを先にコピーしてレイヤーキャッシュを最大化
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/agent-core/package.json packages/agent-core/
COPY packages/a2a-server/package.json packages/a2a-server/
COPY packages/evaluation/package.json packages/evaluation/

RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json tsconfig.json biome.json vitest.config.ts ./
COPY packages/ packages/

# ビルド検証: lint + 型チェックが通ることをコンテナビルド時にも保証する
# (フルテストスイートは CI 側の別ジョブで実行し、ビルドを遅くしない)
RUN pnpm run lint && pnpm run typecheck

###############################################################################
# Stage 3: node-runtime (Issue #250)
# Red Hat Hardened Image — nonroot UID 65532 がビルトイン。
# 本Sub-Issue時点ではプロダクションのエントリポイントはまだ存在しない
# (agents/api/a2aの移行は #252/#253)。このステージは pnpm install や
# 依存物のコピーが最終形で成立することを確認する「ビルド検証専用」ステージであり、
# `--target node-runtime` を明示しない限りビルドされない。
# registryへのpushはEpic完了(#255)までPython版(`runtime`)に固定する
# (docs/typescript-toolchain-spec.md §4.1、.github/workflows/build-image.yml参照)。
###############################################################################
FROM registry.access.redhat.com/hi/nodejs:26@sha256:dc8ba1234e29543685927688a112679696b0bbd2c219b14fe574a7326f5f308f AS node-runtime

WORKDIR /app

COPY --from=node-builder /app/node_modules ./node_modules
COPY --from=node-builder /app/packages ./packages
COPY --from=node-builder /app/package.json ./package.json

USER 65532

CMD ["node", "-e", "console.log('code-review-agent TypeScript toolchain image (Issue #250)')"]

###############################################################################
# Stage 4: runtime
# Red Hat Hardened Image — UBI ベース、シェルなし
# - nonroot UID 65532 がビルトイン
# - multi-arch index ダイジェスト固定: amd64 / arm64 を同一参照で提供
# - デフォルトターゲット（ファイル末尾）: `docker build .` / `podman build .`
#   は --target 未指定時にこのステージを使う。Epic完了(#255)まで維持する。
###############################################################################
FROM registry.access.redhat.com/hi/python:3.14@sha256:144a7e992726c27ffa18158bac295244f8e8df233beb6b1cb5fc162f3b53287b AS runtime

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
