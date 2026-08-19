# PR Review Agent — 画面モックアップ (Issue #243)

[Issue #243](https://github.com/kuju63/code-review-agents/issues/243)「レビュー対象の登録とレビュー結果を確認する画面の作成」の受け入れ条件（登録→結果確認→close）を、関係者が合意形成しやすい形で確認するための静的HTMLモックアップです。

**実データ・実APIとは接続していません。** `assets/mock-data.js` に定義したクライアントサイドのモックデータのみで動作する、UI設計レビュー専用のプロトタイプです。

## 開き方

依存ビルド不要です。`docs/mocks/index.html` を **ブラウザで直接（`file://` として）開く** だけで動作します。

```
open docs/mocks/index.html   # macOS
```

## 画面一覧

Issue #243 の受け入れ条件「登録 → 結果確認 → close」に対応する4画面です（ヘルプ画面は中身が未確定のプレースホルダーのため対象外）。

| # | ファイル | 画面 | Issue #243 の対応操作 |
|---|---|---|---|
| 01 | `index.html` | コードレビュー一覧 | フィルタ表示・**close**（対応済みレビューのクローズ） |
| 02 | `review-request.html` | レビュー依頼登録 | **レビュー対象登録**（org → repo → PR選択 → 送信） |
| 03 | `review-result.html` | レビュー結果確認 | **レビュー結果確認**（diffビューア、対象行へのコメント表示、resolve/誤検知/reopen） |
| 04 | `settings.html` | GitHub連携設定 | GitHub URL / Personal Access Token 設定（登録画面からの導線先） |

一連の操作フロー：一覧画面から「+ レビュー依頼を登録」→ org/repo/PR選択 → 送信 → 一覧画面に戻り登録バナー表示 → 一覧からレビュー結果を開いて確認・コメント対応 → 対応完了したものを一覧からclose。

## 設計判断：静的HTML＋依存ゼロで構成した理由

このモックアップの元になったClaude Designプロジェクト（`ソースコードレビューエージェントUI`）には、Carbon Design Systemベースで作り込まれた同等の5画面（`.dc.html`）と、そのエクスポート版（`export/`配下）が存在した。両方を検証した上で、本ディレクトリは依存ゼロの静的HTML/CSS/JSへフラット化する方式を採用した。

| 選択肢 | 内容 | 判定 |
|---|---|---|
| A. Claude Designのエクスポート版（`export/`）をそのままコピー | Claude Design独自ランタイム（`support.js`）と`_ds_bundle.js`（Reactベースのコンポーネント実装）に依存。`support.js`は`window.React`/`window.ReactDOM`前提で動作し、供給元が不明瞭 | 却下 |
| B. 依存ゼロの静的HTML/CSS/JSへフラット化 | Carbon風の見た目・文言・モックデータは踏襲しつつ、ランタイム依存を排除 | **採用** |

採用理由：レビュアーが`git clone`して`index.html`をダブルクリックするだけで確認できることが必須要件だったため。加えて実装中に、**ES modules（`import`/`export`、`<script type="module">`）は`file://`で開いた際にブラウザのCORS制約でロードされない**ことが判明した（Claude Design側の`export/index.html`も同じ理由からモジュールを使わず`window.ReviewData`へのグローバル公開で回避していた）。そのため本ディレクトリのJSも、ESモジュールではなく通常の`<script>`＋グローバルオブジェクト（`window.MockData` / `window.MockPages`）方式で実装している。

以下はClaude Designプロジェクトの成果物からほぼそのまま流用し、フルスクラッチではない：

- `assets/mock-data.js`：元の`review-data.js`を移植（JA/EN文字列テーブル、モックPR一覧・diff行・コメントデータ、`localStorage`ヘルパー等の純粋関数）。
- `assets/tokens.css`：Carbon Design Systemの色・タイポグラフィ・spacing・motionトークンをそのまま流用。
- `assets/icons/`：実際に参照する7種のSVGアイコンのみ抽出（元プロジェクトの全39種は使用していない）。

なお、`tokens.css`はIBM Plexフォントを Google Fonts 経由（`@import url(...)`）で読み込む。オフライン時や`file://`実行時にフォントは取得できないが、`system-ui`等へのフォールバックを指定してあるため表示自体は崩れない。

## 状態の保持

言語切替（JA/EN）、サイドバー開閉、フィルタ、GitHub URL/PAT、コメント対応状況、close済みレビュー等は`localStorage`（`cra_`プレフィックス）に保存される。ブラウザのlocalStorageをクリアすると初期状態に戻る。

## 動作確認したい場合

- 一覧→登録→（送信）→一覧バナー表示→結果確認→closeの一連の画面遷移
- JA/EN切替が全画面で機能すること
- `設定`画面でPersonal Access Tokenを空にすると、一覧・登録画面がエラー通知＋設定画面への導線を表示すること
- レビュー結果画面でコメントのresolve/誤検知/reopenがトグルできること
