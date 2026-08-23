# TypeScript開発環境・ツールチェーン整備 実装計画・運用手順 (Issue #250)

設計: [docs/typescript-toolchain-spec.md](../typescript-toolchain-spec.md)

## Nix flakeに関する運用上の注意

Nix flakeは**gitの管理下にないファイルを評価対象外として無視する**。`flake.nix`を新規作成した直後に`nix flake check`や`nix develop`を実行しても、`git add`されていなければ評価に反映されない（最悪、ファイルごと存在しないものとして扱われる）。

運用手順:

1. `flake.nix`（+初回`nix flake lock`で生成される`flake.lock`）を書く
2. 直ちに`git add flake.nix flake.lock`する（コミットまでは不要だが、addは必須）
3. `nix flake check`で評価が通ることを確認
4. `nix develop`でdevShellに入り、`node -v` / `pnpm -v`等が期待通りであることを確認
5. 以降、`flake.nix`を変更するたびに 2〜4 を繰り返す

## Stacked PR運用（`gh` + `gh-stack`）導入手順

- `flake.nix`の`devShells.default.packages`に`gh`を追加済み（`nix develop`で`gh`が使用可能）。
- `gh-stack`拡張はNixパッケージではなく`gh`のプラグイン機構で管理されるため`packages`には含められないが、**全員が同一の環境になるよう`shellHook`で自動インストールする**。`gh extension list`で未導入の場合のみ`gh extension install github/gh-stack --pin v0.1.0`を実行し(リリースタグに固定、暗黙のアップグレードでpinをすり抜けない)、導入済みの場合はバージョン表示のみで再インストールは行わない(`gh extension install`はデフォルトでは導入済みだと失敗するため、事前チェックで分岐させている)。手動でのインストール手順を案内する必要はなく、`nix develop`するだけで`gh stack`コマンドが使えるようになる。拡張自体を更新する場合は`gh extension upgrade stack`を使い、`--pin`のタグをこのドキュメントとflake.nixの両方で更新する。
- 各Sub-Issueのブランチ作成・PR作成・親ブランチへのリベース/追従は`gh stack`コマンド経由で行う。詳細な運用（コミット粒度・PRタイトル規約等）は#251着手時に確定させる。

## #251以降への申し送り（当時のメモ、#249〜#255は完了済み）

- 次のSub-Issueは[#251](https://github.com/kuju63/code-review-agents/issues/251)（models/ → TS型 + Zod）。ブランチは本Sub-Issueのブランチ(`feat/ts-migration/250-toolchain`)から分岐する。
- モデル配置先: `packages/agent-core/src/models/`（`docs/typescript-toolchain-spec.md` §2.1の決定に従う）。
