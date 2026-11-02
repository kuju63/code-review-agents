# syntax=docker/dockerfile:1

###############################################################################
# Stage 1: node-builder (Issue #250 — TypeScript toolchain; the Python
# builder/runtime stages that used to coexist here were removed for Issue #255)
# Red Hat Hardened Image の Node.js builder variant。
# - corepack は同梱されていないため pnpm は npm 経由で直接インストールする
# - multi-arch index ダイジェスト固定: amd64 / arm64 を同一参照で提供
###############################################################################
FROM registry.access.redhat.com/hi/nodejs:26-builder@sha256:55fa253292249f520927d1b66c55635568e2a05ca76eb13e895ce82c06c847a0 AS base

USER root

RUN dnf install -y python3 gcc make g++ \
    && dnf clean all

# packageManager (package.json) と一致させる
RUN npm install --global pnpm@12.16.1

WORKDIR /app

# 依存マニフェストを先にコピーしてレイヤーキャッシュを最大化
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/agent-core/package.json packages/agent-core/
COPY packages/a2a-server/package.json packages/a2a-server/
COPY packages/evaluation/package.json packages/evaluation/
COPY packages/web/package.json packages/web/
COPY packages/web-api/package.json packages/web-api/

RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json tsconfig.json biome.json vitest.config.ts ./

FROM base AS a2a-builder

COPY packages/agent-core/ packages/agent-core/
COPY packages/a2a-server/ packages/a2a-server/

WORKDIR packages/a2a-server
RUN pnpm run build

FROM base AS frontend-builder
COPY packages/web/ packages/web/

WORKDIR packages/web
RUN pnpm run build

FROM base AS api-builder
COPY packages/web-api/ packages/web-api/

WORKDIR packages/web-api
RUN pnpm run build

###############################################################################
# Stage 2: node-runtime (Issue #250)
# Red Hat Hardened Image — nonroot UID 65532 がビルトイン。
# デフォルトターゲット（ファイル末尾のステージ）: `docker build .` /
# `podman build .` は --target 未指定時にこのステージを使う。Issue #255 で
# Python版 (`runtime`) ステージを撤去したため、レジストリへのpush対象も
# node-runtime に切り替わった (.github/workflows/build-image.yml参照)。
###############################################################################
FROM base AS node-runtime

USER 65532

WORKDIR /app

COPY --from=a2a-builder /app/packages/agent-core/dist ./packages/agent-core/dist
COPY --from=a2a-builder /app/packages/a2a-server/dist ./packages/a2a-server/dist

CMD ["node", "/app/packages/a2a-server/dist/index.js"]
