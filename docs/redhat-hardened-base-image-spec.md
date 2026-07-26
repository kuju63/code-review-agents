# Red Hat Hardened Image への base image 変更 spec

関連 Issue: #155

## 背景

現行のコンテナ base image は Chainguard (`cgr.dev/chainguard/python`) を使用している。
Chainguard は distroless でセキュリティ面の利点がある一方、digest 更新が非常に頻繁
(Renovate による更新が週複数回) に発生し、安定したリリース運用の妨げになっている。

出所が明確で更新頻度が安定した Red Hat Hardened Image (Project Hummingbird,
`registry.access.redhat.com/hi/python`) へ移行する。

## 要件

- builder ステージの base image を `registry.access.redhat.com/hi/python:3.14-builder` に変更する。
- runtime ステージの base image を `registry.access.redhat.com/hi/python:3.14` に変更する。
- 既存慣習に合わせて、両 image を manifest (multi-arch index) digest で固定する。
- CI (build / security scan) のビルド前に、念のため Red Hat レジストリへログインする。
  - login ID: GitHub Secrets `REDHAT_CLIENTID`
  - password: GitHub Secrets `REDHAT_CLIENT_SECRET`
  - registry: `registry.access.redhat.com`
- multi-arch (linux/amd64, linux/arm64) ビルドを維持する。
  - amd64 / arm64 は同一の index digest で参照できることを確認済み。

## 実測結果 (podman による Step 0 調査)

`registry.access.redhat.com/hi/python:3.14` および `:3.14-builder` を実測した結果:

| 項目 | Chainguard (旧) | Red Hat hi/python (新) | 影響 |
|---|---|---|---|
| runtime UID | 65532 (`nonroot`) | 65532 (gid=0, ユーザー名なし) | `USER nonroot` → `USER 65532` |
| python 実行パス | `/usr/bin/python` | `/usr/bin/python` (存在) | 変更不要 |
| site-packages | `/usr/lib/python3.14/site-packages` | 同パスが `sys.path` に存在 | 変更不要 |
| runtime shell | なし | なし (`/bin/sh` なし) | exec 形式を維持 |
| builder の uv | 外部ステージから注入 | 同梱なし | uv-binary ステージを維持 |
| builder の sed / sh | あり | あり (`/usr/sbin`) | shebang 修正を維持 |
| Python バージョン | 3.14 系 | 3.14.5 | `ARG PYTHON_VERSION` は削除し、実測済みの minor version path を使用 |

結論: レジストリ名・イメージの実体 (distroless→UBI 系) は変わるが、runtime が依存する
python 実行パス・site-packages パス・nonroot UID (65532) は互換であり、Dockerfile /
deploy manifest の変更は最小限で済む。

### 固定する digest (multi-arch index)

- runtime: `registry.access.redhat.com/hi/python:3.14`
  index digest = `sha256:e36a6b6597232eb40ff1589d7a329adaed9ec1ea6a44efb55a8d9f8c9a10ae9d`
- builder: `registry.access.redhat.com/hi/python:3.14-builder`
  index digest = `sha256:26331b730e4593b11bc703b8bb31b60be55383ef49aecbc5ef90a1c54d2a1942`

いずれも `application/vnd.oci.image.index.v1+json` で amd64 / arm64 を含む。

## 変更対象

1. `Dockerfile`
   - builder / runtime の `FROM` を Red Hat image + index digest に変更。
   - `USER nonroot` → `USER 65532`。
   - Chainguard 前提のコメントを Red Hat 前提へ更新。
   - uv-binary ステージ・shebang 修正・HEALTHCHECK (exec 形式) は維持。
2. `deploy/pod.yaml`
   - `runAsUser: 65532` は維持 (コメントの Chainguard 記述のみ更新)。
   - liveness / readiness probe の `/usr/bin/python` は維持。
3. `.github/workflows/build-image.yml`
   - build 前に Red Hat レジストリへの login ステップを追加。
4. `.github/workflows/container-security-scan.yml`
   - build 前に Red Hat レジストリへの login ステップを追加。
   - base image に関するコメントを更新。
5. `renovate.json`
   - `registry.access.redhat.com` は匿名 pull 可能であり、Docker datasource が `FROM` を検出できるため変更しない。
6. ドキュメント整合
   - `.serena/memories/tech_stack.md` / 関連設計文書の Chainguard 記述を Red Hat へ更新。

## 受入条件

- `podman build` がローカルで成功する。
- ビルドしたコンテナで `python -c "import code_review_agent"` が成功する
  (site-packages パスが正しいことの実証)。
- `uv run pytest` (coverage >= 75%) / `uv run ruff check` / `uv run ruff format --check`
  / `uv run pyright` が成功する。
- CI の build / security scan で Red Hat login → build が成功する
  (fork からの PR は実行を許可していないため考慮対象外)。

## リスクと留意点

- Red Hat が index digest を更新した場合、Renovate の Docker datasource が追従する必要がある。
  匿名 pull が使えなくなった場合は Renovate 側にもレジストリ認証設定が必要になる。
- `registry.access.redhat.com` は匿名 pull 可能であることを実測で確認したが、
  将来認証必須化された場合に備えて CI に login を残す。
- HEALTHCHECK / probe の python パスは runtime image に依存するため、
  base image 更新時は Dockerfile と pod.yaml の両方を揃えて確認すること。

## ロールバック

- 本 spec のコミットが rollback baseline。
- 問題発生時は Dockerfile / workflow / deploy manifest を Chainguard 版へ revert する。
