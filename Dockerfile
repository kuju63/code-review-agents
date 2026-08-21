# syntax=docker/dockerfile:1

###############################################################################
# Stage 1: node-builder (Issue #250 — TypeScript toolchain; the Python
# builder/runtime stages that used to coexist here were removed for Issue #255)
# Red Hat Hardened Image の Node.js builder variant。
# - corepack は同梱されていないため pnpm は npm 経由で直接インストールする
# - multi-arch index ダイジェスト固定: amd64 / arm64 を同一参照で提供
###############################################################################
FROM registry.access.redhat.com/hi/nodejs:26-builder@sha256:aea0b7c92f44fbade2ec7646ebe26f650f4139322ec42d2fadf4041551169415 AS node-builder

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
# Stage 2: node-runtime (Issue #250)
# Red Hat Hardened Image — nonroot UID 65532 がビルトイン。
# 本Sub-Issue時点ではプロダクションのエントリポイントはまだ存在しない
# (agents/api/a2aの移行は #252/#253)。このステージは pnpm install や
# 依存物のコピーが最終形で成立することを確認する「ビルド検証専用」ステージである。
# デフォルトターゲット（ファイル末尾のステージ）: `docker build .` /
# `podman build .` は --target 未指定時にこのステージを使う。Issue #255 で
# Python版 (`runtime`) ステージを撤去したため、レジストリへのpush対象も
# node-runtime に切り替わった (.github/workflows/build-image.yml参照)。
###############################################################################
FROM registry.access.redhat.com/hi/nodejs:26@sha256:73a9072d5992e0a3546a58120595d684e4f7c5e911fde901ba93efd679842eed AS node-runtime

WORKDIR /app

COPY --from=node-builder /app/node_modules ./node_modules
COPY --from=node-builder /app/packages ./packages
COPY --from=node-builder /app/package.json ./package.json

USER 65532

CMD ["node", "-e", "console.log('code-review-agent TypeScript toolchain image (Issue #250)')"]
