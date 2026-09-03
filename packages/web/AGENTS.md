# エージェント開発ガイド — web パッケージ

本 AGENTS.md は `packages/web` フロントエンド パッケージのルールを説明します。
全体アーキテクチャ・品質ゲート・必須チェックリストはリポジトリルートの[AGENTS.md](../../AGENTS.md)を参照してください。
本パッケージ固有の事項は本稿を、それ以外はルート版を優先します。

## 概要

`packages/web` は code-review-agent プロジェクトのブラウザフロントエンドです。
現状は Vite + React の初期状態（Vite の起動画面）であり、
まだ `packages/a2a-server/` に公開されている review-agent に接続されていません。

ビルドツール：

- Vite 8、`@vitejs/plugin-react` と Babel `react-compiler`（`packages/web/vite.config.ts`）
- テストランナー：Vitest、happy-dom（`packages/web/vitest.config.ts`）
- リンター／フォーマッター：Biome（`packages/web/biome.json`）
- 型：TypeScript プロジェクト参照（`tsconfig.json` → `tsconfig.app.json` / `tsconfig.node.json`）

## 技術スタック

- React 19（`react`／`react-dom`）
- Carbon UI：`@carbon/react`（既存 CSS 利用は `App.tsx` を参照）
- TanStack Stack：
  - `@tanstack/react-query`（データフェッチ、開発用は `@tanstack/react-query-devtools`）
  - `@tanstack/react-router`（SPA ルーティング、開発用は `@tanstack/react-router-devtools`）
  - `@tanstack/react-form`（フォーム処理）
- Zod（スキーマ検証、`@tanstack/react-form` パーサー と API ペイロード に使用）
- `@tanstack/markdown`（マークダウン レンダリング）
- スタイル：`sass` 経由 の SCSS（`App.css`／`index.css`）

## 構成（フォルダ構成）

全フォルダ構成は Tanstack Router のファイルルーティングルールに準拠します。
`src/routes/` 配下にルート定義・コンポーネントを配置し、ルーターが自動でルートツリーを生成します。

```
packages/web/
├─ index.html                 # Vite エントリ HTML（#root を差し込み、src/main.tsx をインポート）
├─ src/
│  ├─ main.tsx                # React エントリ（createRoot + StrictMode）
│  ├─ App.tsx                 # ルートコンポーネント（現状 は Vite のスターター UI）
│  ├─ App.test.tsx            # App の コンポーネントテスト
│  ├─ assets/                 # コンポーネントが利用する 画像／アイコン
│  ├─ index.css               # グローバルスタイル
│  ├─ test/
│  │  └─ setup.ts             # vitest セットアップ（@testing-library/jest-dom をインポート）
│  └─ routes/                 # Tanstack Router ルート定義（後述）
│     ├─ __root.tsx           # __root ルート
│     ├─ __root.component.tsx  # __root ルート レイアウトコンポーネント
│     ├─ index.route.tsx       # "/" ルート（現状 は App.tsx を差し込む）
│     └─ *.route.tsx / *.component.tsx
│
├─ vite.config.ts
├─ vitest.config.ts
├─ tsconfig.app.json
├─ tsconfig.node.json
└─ biome.json
```

### routes/ 配下の命名ルール（Tanstack Router ルール）

- `__root.*`：最上位ルート（`__root.tsx`／`__root.component.tsx`／`__root.notFoundComponent.tsx`）
  - `__root.tsx`／`__root.component.tsx` でルート設定 ＋ レイアウトコンポーネントを定義
- `index.route.ts`：`/` のルート
- ディレクトリ：サブルート ＋ レイアウト を構造化する
  - `posts/index.tsx`、`posts/$postId.tsx`、`posts.$postId.edit.tsx`
- パラメータ：`$` は パラメータ を表す（例：`$postId`）
- `_prefix` のない レイアウト：`_layout.tsx`／`_pathlessLayout.a.tsx` 等で URL に影響ないレイアウト をラップ する
- グループ（URL 影響なし）：`（グループ）/` 等のディレクトリでグループ化する

## コマンド

TypeScript ツールチェーンが必要なコマンドは常に `nix develop --command` を前置 してください。
`nix develop` シェル内、または `nix develop --command` プレフィックス付きで実行します
（ルートの AGENTS.md を参照）。
コマンド は本パッケージ の workspace 設定 を解決するため `packages/web/` から実行します。

```bash
# 開発サーバー（Vite）を起動
nix develop --command pnpm --filter web run dev

# Type-check とビルド（tsc -b → vite build）
nix develop --command pnpm --filter web run build

# Vitest 開発サーバー（監視モード）を起動
nix develop --command pnpm --filter web run test

# lint ／ format ／ フルチェック（Biome）
nix develop --command pnpm --filter web run lint
nix develop --command pnpm --filter web run format          # biome format --write
nix develop --command pnpm --filter web run check:write     # biome check --write

# ビルド結果をプレビュー
nix develop --command pnpm --filter web run preview
```

### テストの実行

```bash
nix develop --command pnpm --filter web run test
```

- 環境：happy-dom
- セットアップ ファイル：`src/test/setup.ts`
- テスト ファイル の正規表現：`src/**/*.{test,spec}.{ts,tsx}`
- カバレッジ（v8）：対象 ファイル は `src/**/*.{ts,tsx}`。ただし test/spec ファイル と
  `src/main.tsx` は除外。

テスト は コードと同一ディレクトリ に記述 します。本パッケージのテンプレート は `src/App.test.tsx` です。

## 設計・実装ルール

- 多言語対応：i18next を使用する。
  - ユーザーインターフェースのすべてのラベル、メッセージ、プレースホルダー等には、直書きの文字列を使用せず、すべて多言語共通のキーとして管理すること。
  - 日本語を含む多言語対応を前提とした実装を徹底する。
- [CONTRIBUTING.md](../../CONTRIBUTING.md) とルートの AGENTS.md Development Process／Quality gates を遵守する。
- 新規／変更 コード の カバレッジ を 75% 以上に 維持 する。
- 完了前に 品質 ゲート を 確認 する：
  - `pnpm exec tsc --noEmit`
  - `pnpm exec biome check --no-errors-on-unmatched`
  - `pnpm run test`
- 実装 より先に TypeScript テスト （`*.test.ts` ／ `*.spec.tsx`）を記述（赤）。
  その後最小限の実装を行い（緑）、その後リファクタリングを行う（青）。
  ルートの チェックリスト に準拠 する。
- フォーム入力などの データ境界 に Zod スキーマを検証 に利用 する。
- サーバ状態 の フェッチ は TanStack Query、ナビゲーション は Tanstack Router を優先 する。
  不用意なフェッチ ／ `window.location` ナビゲーション は使わない。
- スタイル は SCSS ファイル に記述 する。既存 の グローバル スタイル は `src/index.css`、
  コンポーネント単位 の スタイル は `コンポーネント名.module.scss` に 配置 する。

## ツールチェーン 備忘

- Biome 設定 はリポジトリ ルート を 展開 する（`packages/web/biome.json` の `"extends": "//"`）。
  本ファイル に宣言 する のは 上書き のみ。リポジトリルール を-package 固有 で再定義 しない。
- React Compiler はビルド／開発時に Babel（`reactCompilerPreset`）経由 で 動作 する。
  メモ化 は コンポーネント に任せ、安定した アイデンティティ／callback 必要 な場合 のみ
  手動 の `useMemo`／`useCallback` を避ける。
