# TypeScript開発環境・ツールチェーン整備 設計ドキュメント (Issue #250)

親Epic [#249](https://github.com/kuju63/code-review-agents/issues/249)（全面TS化）の最初のSub-Issueであり、後続の全Sub-Issue(#251〜#255)が乗る土台を整備する。本Sub-Issue単体ではプロダクションロジックの移植は行わず、「PythonとTypeScriptが並存できる開発・CI・コンテナビルド基盤」を確立することが目的である。

## 1. 決定済み事項（Issue #250コメントより。比較検討は不要、決定と理由のみ記録する）

| 項目 | 決定 | 出典 |
|---|---|---|
| 開発環境 | Nix (flake) | #250コメント |
| pre-commit | husky + lint-staged（TS側）※Python側フック(ruff/pyright)は#255まで`.pre-commit-config.yaml`に併存。ただし§2.5の通り、hookエントリポイントのhuskyへの移行自体は#255で撤回され、`.pre-commit-config.yaml`というファイルそのものはPython撤去後も存続する | #250コメント |
| パッケージマネージャ | pnpm | #250コメント |
| テストランナー | vitest（APIモックはMSW） | #250コメント |
| linter/formatter | biome | #250コメント |
| 型チェック | `tsc --noEmit` | #250コメント |
| production/evaluationコードの管理 | 単一pnpm workspace | #250コメント |
| コンテナベースイメージ | `registry.access.redhat.com/hi/nodejs:26` / `:26-builder`（Red Hat Hardened Images） | #250コメント |

## 2. 要検討事項（比較表 + 採用/却下理由）

### 2.1 pnpm workspaceのディレクトリ構成

後続Sub-Issue(#251〜#254)のimportパスに直接影響するため、ここで確定させる。

| 選択肢 | 概要 | 採用/却下 | 理由 |
|---|---|---|---|
| ① `packages/agent-core` + `packages/evaluation`（`apps/*`をworkspaceパターンとして予約） | production(agents/tools/api/a2a/models)を`packages/agent-core`、評価パイプラインを`packages/evaluation`に分離。将来のWebアプリ(#242〜#246、本Epicがブロック中)を`apps/web`として追加できるよう`pnpm-workspace.yaml`のpackagesパターンに`apps/*`を含めておく | **採用** | Sub-Issueの境界(#251:models, #252:agents+tools, #253:api+a2a, #254:evaluation)が`packages/agent-core`(#251〜#253) / `packages/evaluation`(#254)の2パッケージにきれいに対応する。Web化という本Epicの動機（#249背景）を見据え、`apps/*`をworkspaceパターンに含めておくコストはゼロ(ディレクトリ自体は#242以降まで作らない)。 |
| ② 現行`src/code_review_agent/`と並行する`src-ts/`フラット構成 | pnpm workspace化せず単一パッケージとして`src-ts/`配下にPythonと同じ階層を再現 | 却下 | `evaluationとproductionコードはworkspaceで管理する`という決定済み事項(#250コメント)と矛盾する。将来のWeb化でパッケージ分割が結局必要になり手戻りが発生する。 |
| ③ `packages/*`のみ（`apps/*`は今回言及しない） | ①からWeb化予約を外したもの | 却下 | Web化は本Epicが明示的にブロックしている後続作業であり(#249 Related: Blocks #242-246)、今回`pnpm-workspace.yaml`に1行`apps/*`を足すだけで先回りできる。あえて外す理由がない。 |

**採用**: `packages/agent-core`、`packages/evaluation`。`pnpm-workspace.yaml`の`packages`は`["packages/*", "apps/*"]`とする。

### 2.2 CI `pull_request`トリガーの広げ方

Stacked PRの中間ブランチ（例: `#251`のPRが`feat/ts-migration/250-toolchain`をbaseにする）へのPRでもCIを走らせる必要がある。

| 選択肢 | 概要 | 採用/却下 | 理由 |
|---|---|---|---|
| ① `pull_request`の`branches`フィルタを撤廃 | どのブランチをbaseにするPRでもCIを実行 | **採用** | 実装がシンプルで、Sub-Issueごとにブランチ名を追加登録する運用コストが発生しない。PR起点のCIをbaseブランチで絞る強い理由がそもそもなく、既存の制限は見直し対象の副作用である可能性が高い。 |
| ② スタックブランチのglob(`feat/ts-migration/**`)を`branches`に追加 | `main`と`feat/ts-migration/**`の2パターンを許可 | 却下 | Epic期間中は都度メンテが必要で忘れやすい。Epic終了後の削除も追加のタスクになる。 |

**採用**: `.github/workflows/ci.yaml`の`pull_request`セクションから`branches: [main]`を削除する（`push`トリガーの`branches: [main]`はそのまま維持）。

### 2.3 vitestカバレッジ閾値の設定方法

pytestの`--cov-fail-under=75`(CI引数側で指定)と役割を揃える必要がある。

| 選択肢 | 概要 | 採用/却下 | 理由 |
|---|---|---|---|
| ① `vitest.config.ts`の`test.coverage.thresholds`に埋め込み | 設定ファイルに`lines/functions/branches/statements: 75`を記述 | **採用** | ローカル実行でもCIでも同じ閾値が自動的に効き、CIコマンドとconfigファイルの二重管理を避けられる。biome/tsconfigと同じく「設定はファイルに、CIはコマンド実行のみ」という一貫した置き場所になる。 |
| ② CI側`vitest run --coverage.thresholds.lines=75`等の引数指定 | pytestの`--cov-fail-under=75`と同じ流儀をCIコマンドに反映 | 却下 | ローカルで`pnpm test`を実行した際に閾値が効かず、CI専用の隠れた合否基準になってしまう。pytestは元々コマンド引数文化のPythonエコシステムだが、vitestは設定ファイル文化が主流でありツールの流儀に従う方が自然。 |

**採用**: `vitest.config.ts`に`test.coverage.thresholds = { lines: 75, functions: 75, branches: 75, statements: 75 }`を設定する。

### 2.4 CIでのNix利用

| 選択肢 | 概要 | 採用/却下 | 理由 |
|---|---|---|---|
| ① CIでも`cachix/install-nix-action`等を使い`nix develop -c pnpm ...`で実行 | ローカル/CIの環境を完全に一致させる | 却下 | 現行CIはPython側も`actions/setup-python` + `curl`によるuvインストールでありNixを使っていない。対称性の観点でも、Nixインストール自体のCI実行時間・キャッシュ複雑性を考えると、小規模プロジェクトの現時点では投資対効果が低い。 |
| ② CIは`pnpm/setup@v2`（`runtime: node@26`でNode+pnpmを1ステップ導入）で直接実行、Nixはローカル開発の再現性確保専用 | ローカルはNix、CIは既存パターン踏襲 | **採用** | 既存CIパターン(Python側)と対称性が取れ、CI変更差分が最小になる。Nixの主目的である「ローカル開発環境の再現性」は損なわれない。将来的にCIもNix化したくなった場合は独立したタスクとして再検討する。 |

**採用**: CIは`pnpm/setup@v2`(`runtime: node@26`)で実行する。pnpmのバージョンは`package.json`の`packageManager`フィールドから自動検出されるため`version`指定は不要。Nix flakeはローカル開発環境専用。

**実装上の注意**: 当初`actions/setup-node@v5` + `npm install -g pnpm`の順で組んだところ、`actions/setup-node`が`package.json`の`packageManager`フィールドを見てpnpmを自動検出しようとし、その時点ではpnpmが未インストールのため`Unable to locate executable file: pnpm`で失敗した(実PRのCIで確認)。`pnpm/action-setup`も検討したが保守停止のため、後継の`pnpm/setup@v2`（Node/Bun/Denoランタイムのセットアップも兼ねる）に統一した。

### 2.5 git hook（pre-commit）の実行主体: husky vs 既存pre-commitフレームワーク

決定済み事項(§1)の「pre-commit → husky + lint-staged」は文字通りには「git hookの所有権をhuskyに移す」ことを意味するが、実装中に重大な副作用が判明したため、**git hookの所有権そのものは#255までPython側`pre-commit`フレームワークに残す**方針に修正する。

| 選択肢 | 概要 | 採用/却下 | 理由 |
|---|---|---|---|
| ① huskyの`prepare`スクリプトで`core.hooksPath`をhusky管理下に切り替え | `pnpm install`実行時に`git config core.hooksPath .husky/_`が走り、huskyが`.git`の実質的なhookエントリポイントになる | 却下（実装中に発覚した事故から） | `core.hooksPath`は`.git/config`への書き込みであり**リポジトリの全worktreeで共有**される。実際に試したところ、TS移行と無関係な他のworktree(main含む)のpre-commit(シークレット検知・ruff等)まで無条件に無効化された。`pnpm install`を叩くたびに再発するため、Epic期間中(#251〜#254の各worktreeが本ブランチから分岐するたびに`pnpm install`が走る)繰り返しリスクになる。 |
| ② 既存`pre-commit`フレームワークがgit hookの所有権を維持し、`.pre-commit-config.yaml`に`local`フック(`lint-staged (biome)`)を1件追加してTS側を委譲する | `entry: nix develop --command pnpm exec lint-staged`を、既存の`shellcheck`ローカルフックと同じ`language: unsupported`パターンで追加。`.ts`/`.tsx`/`.js`/`.jsx`/`.mjs`/`.cjs`/`.json`にマッチする`files`正規表現(詳細は`.pre-commit-config.yaml`本体を参照)で、対象ファイルが無ければ自動skip | **採用** | worktree間の副作用が一切発生しない。lint-staged(ステージ済みファイルへのbiome適用)という決定事項自体は変更せず、「誰がgit hookのエントリポイントを持つか」だけを変更している。huskyは`.husky/pre-commit`スクリプトとしてリポジトリに存在させておくが、`package.json`に`"prepare": "husky"`は**置かない**(=`pnpm install`では有効化されない)。 |

**採用**: `.pre-commit-config.yaml`の`local`フックとして`lint-staged`を追加(既存`shellcheck`フックと同じ`language: unsupported`パターン)。`core.hooksPath`の切り替え(=huskyへの実質移行)は、Python側`.pre-commit-config.yaml`自体が消える#255のタイミングで改めて実施する。

**#255での最終決定（当初計画からの撤回）**: 上表①を却下した理由——`core.hooksPath`が`.git/config`への書き込みでリポジトリの全worktreeに共有され、無関係なworktreeのpre-commit enforcementを無条件に無効化する——はPythonとTSの共存期間に固有の事情ではなく、worktreeベースの開発フローを採る限り恒久的に成り立つ制約である。したがって#255でPython側フック(ruff-check/ruff-format/pyright)を`.pre-commit-config.yaml`から削除した際、当初計画していた「huskyへのhookエントリポイント移行」は実施せず撤回した。pre-commitフレームワークを恒久的なgit hookエントリポイントとして維持し、`husky`パッケージ自体（`.husky/`ディレクトリ、`package.json`の`devDependencies`)を削除した。`lint-staged`(TSファイルへのbiome適用)は引き続き`.pre-commit-config.yaml`の`local`フック経由で呼び出す。

## 3. Nix flakeに関する運用上の注意（重要）

Nix flakeは**gitの管理下にないファイルを評価対象外として無視する**。`flake.nix`を新規作成した直後に`nix flake check`や`nix develop`を実行しても、`git add`されていなければ評価に反映されない（最悪、ファイルごと存在しないものとして扱われる）。

運用手順:

1. `flake.nix`（+初回`nix flake lock`で生成される`flake.lock`）を書く
2. 直ちに`git add flake.nix flake.lock`する（コミットまでは不要だが、addは必須）
3. `nix flake check`で評価が通ることを確認
4. `nix develop`でdevShellに入り、`node -v` / `pnpm -v`等が期待通りであることを確認
5. 以降、`flake.nix`を変更するたびに 2〜4 を繰り返す

## 4. コンテナビルド方針

### 4.1 Python/Node.js併存とpush対象の固定（ユーザー確認済み決定事項）

既存`Dockerfile`はマルチステージビルドで最終ステージ`runtime`(Python, Red Hat Hardened Image)がデフォルトターゲットになっている。ここに`node-builder` / `node-runtime`ステージを**追加**し、同一Dockerfile内でPython/Node.jsを併存させる。

- `runtime`(Python)をファイル末尾＝デフォルトターゲットのまま維持する。`node-runtime`は`--target node-runtime`を明示しない限りビルドされない。
- `.github/workflows/build-image.yml`の`docker/build-push-action`の各ステップに明示的に`target: runtime`を指定し、Nodeステージ追加後もregistry(quay.io)へpushされるのはPython版のみであることをステージ順に依存しない形で保証する。
- **TypeScript版(`node-runtime`)は#255（旧Python資産撤去）が完了するまでregistryへpushしない。** CI(`ci.yaml`)では`podman build --target node-runtime .`によるビルド検証のみ行う(push無し)。

ローカルでのDockerfile検証コマンドは`docker`ではなく`podman`を使用する（プロジェクト標準）。

> **Update (Issue #313 / #255 Sub-Issue PR4, 2026-08-17):** 上記の「push対象をPython版に固定する」方針は本更新で終了した。`Dockerfile`から`builder`/`runtime`(Python)ステージを削除し、`node-builder`/`node-runtime`のみを残した結果、`node-runtime`がファイル末尾＝デフォルトターゲットになった。`.github/workflows/build-image.yml`の`target: runtime`指定は`target: node-runtime`に変更済みで、registry(quay.io)へpushされるのはTypeScript版になる。あわせて`.github/workflows/ci.yaml`の`ci-check`(Python)ジョブを削除し、新設のTypeScript用ジョブにCodecovアップロード(test_results / coverage、`use_oidc: true`)を統合した。Python資産自体(`src/code_review_agent/`, `pyproject.toml`等)の削除は引き続き#255最終Sub-IssueのPR5で行う。
>
> **Update 2 (Issue #255 PR4、ジョブID修正):** 上記で新設したジョブは当初`ts-ci-check`という名前だったが、`main`ブランチのbranch protection ruleset(`main block`)が必須ステータスチェックとして`ci-check`という名前を固定で要求しているため、ruleset側を変更する代わりにジョブIDを`ci-check`に戻した(実体はTypeScript版のlint/typecheck/test/Dockerビルド検証)。これによりruleset自体には手を加えず、Python版`ci-check`ジョブをそのまま置き換える形でTypeScript版が必須チェックとして機能する。

### 4.2 Node hardened imageの調査結果（`podman`で検証済み）

| 項目 | 値 |
|---|---|
| `registry.access.redhat.com/hi/nodejs:26`（index digest） | `sha256:cef409ce19cab123c46867f4ad5a4e1f2eba139bcec97f03717a894b85731c0a` |
| `registry.access.redhat.com/hi/nodejs:26-builder`（index digest） | `sha256:ff5a04e4f7f5e788759fb91b7212a583f845d780707efb7ec32d0071d2088eda` |
| ベースOS | Hummingbird OS 20251124 |
| Node.jsバージョン | v26.7.0 |
| npm | 11.19.0（同梱済み） |
| corepack | **同梱されていない**（`corepack: command not found`） |
| デフォルトUSER | `65532`(nonroot)。ビルドステージではPython builderと同様`USER root`への切り替えが必要（`uid=0(root) gid=0(root)`は存在確認済み） |
| シェル | `sh`は存在するが`which`等の一部coreutilsは非搭載。パス確認は`command -v`または`ls`で代替する |

**pnpm導入方法**: corepackが同梱されていないため、`node-builder`ステージで`USER root`に切り替えた上で`npm install -g pnpm@11.20.0`を実行する（Python builderステージの`USER root`パターンを踏襲）。pnpmのバージョンは`packageManager`フィールド(`package.json`)にも明記し、CI/ローカル/コンテナビルドで一致させる。Nix flakeの`pnpm`/`nodejs_26`は`nixos-unstable`由来でCI・コンテナと厳密なバージョン一致を保証しない（`flake.lock`でinput自体は固定されるが、パッケージのマイナー/パッチバージョンはCI・コンテナの明示的pinとは独立）。ローカル開発シェルでの多少のバージョン差は許容し、CI・コンテナビルドの`pnpm@11.20.0`/Node 26を実行時の正とする。

## 5. モデルプロバイダ・スパイクの結果

`@strands-agents/sdk`（npm, GA 1.0）はA2Aプロトコル(Server/Client両対応)・Agent Skills・MCP・Bedrock/Anthropic/OpenAI/Ollama等のモデルプロバイダを標準サポートしていることをWeb調査で確認済み。Ollamaは`VercelModel`アダプタ経由でコミュニティプロバイダ`ai-sdk-ollama`を利用する構成（tool calling対応を理由にStrands側が選定）。

現行`model_provider_factory.py`が持つ2経路（OpenAI互換`base_url`指定 / ネイティブOllama `host`指定）がTS SDK上でどう再現されるかを`scripts/spike/model-provider-spike.ts`で実地検証した(型チェック + `node --experimental-strip-types`での実行、いずれも成功)。

### (a) OpenAI互換 `base_url` 指定

`@strands-agents/sdk/models/openai`の`OpenAIModel`が`clientConfig: { baseURL }`を受け付ける。Python版`client_args={"base_url": llm_base_url}`と対応する。

```typescript
new OpenAIModel({
  api: "chat", // Python版はChat Completions相当。デフォルトはResponses APIなので明示指定が必要
  modelId: "gpt-oss-120b",
  clientConfig: { baseURL: "http://localhost:11434/v1" },
});
```

**成立**。`api: "chat"`を明示しないとデフォルトのResponses APIになり、OpenAI互換サーバー(vLLM/Ollamaの`/v1`エンドポイント等)の多くが未対応のため、#252実装時にこの明示指定を引き継ぐ必要がある。

### (b) VercelModel + ai-sdk-ollama経由でのOllama

**成立するが、パッケージバージョンを固定する必要がある(重要な発見)**。

- `@strands-agents/sdk@1.12.0`(2026-08-10時点の最新)は`VercelModel`の`provider`に`@ai-sdk/provider@^3.0.0`ベースの`LanguageModelV3`を要求する(`peerDependencies`で明記)。
- `ai-sdk-ollama`の最新版(`4.1.0`)は`ai@^7.0.31`(`@ai-sdk/provider` V4世代、`LanguageModelV4`)に追従済みで、`VercelModel`に渡すと型エラーになる(`Type 'LanguageModelV4' is not assignable to type 'LanguageModelV3'`)。
- `ai-sdk-ollama@3.8.x`系(`peerDependencies: { ai: "^6.0.197" }`, `@ai-sdk/provider@^3.0.10`)まで下げると`@strands-agents/sdk`の要求と一致し、型チェック・構築ともに成功する。

```typescript
import { VercelModel } from "@strands-agents/sdk/models/vercel";
import { createOllama } from "ai-sdk-ollama"; // ★ "ai-sdk-ollama": "3.8.x" に固定する

// host(baseURL)はプロバイダ側の設定であり、モデル呼び出し側の第2引数では指定できない
const ollamaProvider = createOllama({ baseURL: "http://localhost:11434" });
const model = new VercelModel({ provider: ollamaProvider("gpt-oss-120b") });
```

**#252スコープへの影響**: `ai-sdk-ollama`の依存を`3.8.x`にピン留めする(Renovate等の自動更新が`4.x`へ上げないよう除外設定が必要)。`@strands-agents/sdk`側が将来`@ai-sdk/provider` V4に対応した時点でピン留めを解除できるか再確認する。この制約は#252着手時に`packages/agent-core/package.json`へ引き継ぐ。

### 検証コード

`scripts/spike/model-provider-spike.ts`(リポジトリにコミット済み、ビルド成果物としては#251以降に引き継がれるまでの参照用)。`pnpm run typecheck`の対象(`packages/**`)には含めていない(#250はツールチェーンのみが責務のため、このスパイク自体をCIの継続的なゲートにはしない)。

## 6. Stacked PR運用（`gh` + `gh-stack`）

Epic全体(#249〜#255)を直列のStacked PRとして進めるにあたり、`gh`(GitHub CLI)と拡張機能[`gh-stack`](https://github.com/github/gh-stack)をNix devShell経由で提供する。手動での`git switch -c` + `gh pr create --base <直前のブランチ>` + マージ後の`gh pr edit --base main`付け替えは、ブランチ数が増えるほど付け替え忘れのリスクが高くなるため、`gh-stack`のスタック管理コマンド（`push` / `submit` / `sync` / `rebase` / `up` / `down` / `top` / `bottom`等）に置き換える。

- `flake.nix`の`devShells.default.packages`に`gh`を追加済み（`nix develop`で`gh`が使用可能）。
- `gh-stack`拡張はNixパッケージではなく`gh`のプラグイン機構で管理されるため`packages`には含められないが、**全員が同一の環境になるよう`shellHook`で自動インストールする**。`gh extension list`で未導入の場合のみ`gh extension install github/gh-stack --pin v0.1.0`を実行し(リリースタグに固定、暗黙のアップグレードでpinをすり抜けない)、導入済みの場合はバージョン表示のみで再インストールは行わない(`gh extension install`はデフォルトでは導入済みだと失敗するため、事前チェックで分岐させている)。手動でのインストール手順を案内する必要はなく、`nix develop`するだけで`gh stack`コマンドが使えるようになる。拡張自体を更新する場合は`gh extension upgrade stack`を使い、`--pin`のタグをこのドキュメントとflake.nixの両方で更新する。
- 各Sub-Issueのブランチ作成・PR作成・親ブランチへのリベース/追従は`gh stack`コマンド経由で行う。詳細な運用（コミット粒度・PRタイトル規約等）は#251着手時に確定させる。

## 7. #251以降への申し送り

- 次のSub-Issueは[#251](https://github.com/kuju63/code-review-agents/issues/251)（models/ → TS型 + Zod）。ブランチは本Sub-Issueのブランチ(`feat/ts-migration/250-toolchain`)から分岐する。
- モデル配置先: `packages/agent-core/src/models/`（本ドキュメント§2.1の決定に従う）。
