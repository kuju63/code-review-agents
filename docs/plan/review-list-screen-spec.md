# SCR-01 コードレビュー一覧画面 実装スペック

関連 Issue: #340 (親 #243)。ブランチ: `feature/issue-340-review-list-ui`。

## 目的

`packages/web`（React + Vite + Carbon + TanStack）に、`packages/web-api` の
`GET /reviews` / `POST /reviews/{reviewId}/close` を消費する SCR-01 一覧画面を実装する。

## 参照した正本

- 外部設計書: `docs/display-spec/review-list.html`（SCR-01個別仕様）,
  `docs/display-spec/index.html`（COM-*/CB-* 共通仕様）
- API契約: `docs/openapi/reviews.yaml`、実装
  `packages/web-api/src/modules/reviews/{reviews.route,reviews.schema,reviews.store,reviews.enums,reviews.params}.ts`
- 振る舞い参考（設計書優先、モックは参考のみ）:
  `docs/mocks/assets/{app.js,mock-data.js,tokens.css,shell.css,components.css,pages.css}`

## 実装前に直すバグ（ブロッカー）

1. `src/i18next.ts:9` の完全動的パス `import()` はブラウザで JSON を解決できない。
   `i18next-resources-to-backend` のローダーを `fetch(path).then(r => r.json())` に
   差し替える。加えて `init()` に `react: { useSuspense: false }` を設定しないと
   非同期backend使用時にコンポーネントがsuspendしTesting Libraryで何も描画されない。
   `src/test/setup.ts` で `/locales/*` へのfetchを静的import済みJSONで返すスタブを
   `vi.spyOn(global, "fetch")` で用意する（`reviewsApi.test.ts` 側の fetch モックと
   衝突しないよう、各テストで `mockRestore()` する）。
2. `public/locales/ja/translation.json` が存在しない。本画面の文言キー一式を作成する。
3. Carbon のスタイルが一切読み込まれていない（`src/index.scss` は Vite starter の
   ままで `@carbon/react` の `@use` がない）。`Tag`/`Dropdown`/`Button` 等が無地で
   描画され、design specのタグ配色（グレー#E0E0E0/青#D0E2FF/紫#E8DAFF/緑#A7F0BA/
   赤#FFD7D9 — Carbon白テーマのデフォルトタグ配色と一致）が出ない。`index.scss` に
   `@use "@carbon/react";` を追加し、Vite starter専用のグローバル指定
   （`#root`固定幅中央寄せ、`h1`/`h2`のヒーローサイズ、`:root`のカスタムカラー変数、
   ダークモード分岐）をアプリ全体シェルと衝突するため削除する。`App.tsx`/
   `App.module.scss`/`App.test.tsx` はどのルートからも参照されなくなる（現状も
   `routes/index.tsx` は独自内容で `<App/>` を使っていない）ため変更しない。

## スコープ境界（承認事項）

- **共通シェル(COM-01〜06)は最小限のみ実装**: ヘッダー(ブランド+設定アイコン)、
  サイドバー(一覧/依頼登録/設定リンク+開閉トグル、状態はlocalStorage保持)、
  パンくず。言語切替(COM-02)は作らない（`ja`のみ）。依頼登録(SCR-02)・設定(SCR-04)は
  見出しのみのプレースホルダールートを新設して遷移だけ成立させる
  （TanStack Router flat routingでは `.` がパス区切りになるため、ファイル名は
  `review-request.tsx` / `settings.tsx` とし、`.placeholder.tsx` のような
  ドット区切りサフィックスは使わない）。
- **クローズ操作にUndo(取り消し手段)は実装しない**: `closeReview`は`closed`への
  片方向遷移のみで reopen 相当のエンドポイントが存在しないため、LST-A08の
  「取り消し手段の提示」は現行API契約では実装不能。確認ダイアログ→即時
  `POST /reviews/{reviewId}/close`→成功/失敗通知とする。Undoはreopen API追加が
  前提の別Issueとして切り出す。
- **クローズの404/409ハンドリング**: 409（`commentCounts.open>0`）は行を一覧に
  残したまま「未対応のコメントが残っているためクローズできません」を独自i18nキー
  で表示する（サーバの`message`文字列をそのまま出さない）。404
  （対象がstale＝一覧取得後に削除・変更済み）はLST-V05に従い、操作を中止して
  一覧を再取得し「対象が更新または削除されました」を通知する。
- **PAT設定状態の判定**: `localStorage.getItem('hasGithubToken') === 'true'` の
  真偽フラグのみで判定する（モックの保存形式と一致）。PAT値自体は保存しない
  （CB-05）。ST-03の認証失効による動的切替（サーバ側401判定）は現行APIに
  存在しないため対象外とし、未確定事項として記録する。
- **一覧データの取得方針**: `GET /reviews`は`q`がtitle/PR番号のみ対象で
  branch検索非対応、`reviewStatus`フィルタも単一値のみ。設計書要件
  （リポジトリ絞り込み・状態絞り込み・検索のAND結合、branch含む部分一致、
  リポジトリ単位グルーピング）を満たすため、`includeClosed=false`のみサーバーに
  渡して`perPage=100`（スキーマ上の最大値、現在16件）で全件取得し、絞り込み・
  検索・グルーピングはクライアント側で行う。`pageInfo.totalItems`が
  取得件数を超える場合は切り捨てず警告ログを出す。データ件数が増えたら
  サーバー側`q`にbranch対応を追加してこの判断を押し戻す。

## 差異のハンドリング（設計書 vs モック vs API実装、設計書を正とする）

1. **レビュー状態「完了」**: モック(`STATUS_TAG`)には無いが、APIの
   `ReviewStatusSchema`には`completed`が存在する。緑タグ`tag-green`として表示し、
   状態フィルタの選択肢にも含める（6択: すべて/未実施/レビュー中/対応待ち/完了/
   エラー）。
2. **クローズボタンの表示条件**: モックの`statusInfo.key==='waiting'`ではなく、
   設計書LST-A08通り「reviewStatusが`completed`、またはprStateが`closed`/`merged`
   （ただし`reviewStatus==='error'`の行は除く）」を表示条件にする。
3. **クローズ409の実際的な食い違い**: 表示条件を満たしていても、
   `store.closeReview`は`commentCounts.open>0`なら無条件で409を返す（`prState`と
   `status`は別軸のため、mergedだが未解決コメントが残る行がありうる）。
4. **検索欄のフォーカス維持(LST-A04)**: Reactのcontrolled inputはre-mountされ
   ないため何もしなくても自動的に満たされる。移植不要。

## LST-16/LST-17 の導出ルール（クライアントに`files`が無く`commentCounts`のみ）

- LST-16（コメント列）: `reviewStatus === "error"` → 「エラー」。
  そうでなく `commentCounts.total === 0` → 「—」。それ以外は `` `${total}件` ``。
- LST-17（更新日時）: `updatedAt`（RFC3339、offset付き）を固定のフォーマット基準
  （JST, `YYYY-MM-DD HH:mm`）で表示する。フォーマット関数を単体テストする。

## ST-06（受付完了通知, LST-04/LST-A09）

`/` に `submitted` クエリパラメータ（例: `?submitted=acme-corp%2Fweb-frontend%20%2355`）
が付いている場合、PAT設定済みなら受付完了通知を表示する。閉じる操作
（LST-A09）で非表示にできる。SCR-02側の実装は別タスクだが、この画面側の
受け口（読み取りと通知表示）は本タスクでカバーする。

## 変更ファイル（新規中心）

### packages/web-api 側

変更不要（既存の`GET /reviews`, `POST /reviews/{reviewId}/close`をそのまま利用）。

### packages/web 側

- `src/i18next.ts` — ローダーをfetchベースに修正、`useSuspense: false`を追加
- `src/test/setup.ts` — `/locales/*`向けfetchスタブを追加
- `public/locales/ja/translation.json` — 本画面の文言キー一式
- `src/index.scss` — `@use "@carbon/react";`追加、Vite starter専用グローバル
  スタイルの削除
- `vite.config.ts` — dev server proxy追加:`/api` → `http://localhost:3000`
  （`rewrite`で`/api`prefixを除去）。API呼び出し側は
  `import.meta.env.VITE_API_BASE_URL ?? "/api"`をbase URLにする
- `src/routes/index.tsx` — `"/"`ルートで`<ReviewListPage />`をレンダー
- `src/routes/__root.tsx` — `<AppShell>`でOutletをラップ、存在しない`/about`
  リンクを削除
- `src/routes/review-request.tsx`, `src/routes/settings.tsx` — SCR-02/SCR-04への
  遷移を成立させるだけの空プレースホルダールート(見出しのみ)
- `src/shell/AppShell.tsx` + `AppShell.module.scss` — ヘッダー/サイドバー/
  パンくず(最小限)
- `src/shell/useSidebarCollapsed.ts` — サイドバー開閉状態のlocalStorage永続化
- `src/features/review-list/` 配下（新規ディレクトリ）:
  - `reviews.schema.ts` — `reviews.yaml`に対応するZodスキーマ(web-api非import。
    理由: web-apiにmain/exports/typesが無くVite解決不可、契約の正本はreviews.yaml
    側で双方が独立実装すべきという既存方針のため)
  - `reviewsApi.ts` — `fetchReviews()`, `closeReview(reviewId)`。fetch + zod
  - `reviewStatus.ts` — 純関数: `resolveStatusTag`, `shouldShowCloseButton`,
    `matchesSearch`, `formatCommentCount`(LST-16), `formatUpdatedAt`(LST-17)
  - `useReviewListState.ts` — フィルタ・repoグループ折りたたみ状態管理+
    localStorage永続化(選択肢に無い保存値は「すべて」にフォールバック)
  - `ReviewListPage.tsx` — 画面全体(PATゲート/loading/error/空/通常の各状態を統括)
  - `ReviewRow.tsx`, `RepoGroup.tsx`, `FilterBar.tsx`, `TokenMissingNotice.tsx`
  - 各`*.test.ts(x)` — 対象コードと同ディレクトリに配置

## テスト方針(TDD, Vitest)

1. `i18next`修正確認用の最小コンポーネントテスト(Red→Green)
2. `reviewStatus.ts`のユニットテスト — 完了タグ、クローズボタン条件、branch検索、
   LST-16/17をそれぞれ失敗するテストから開始
3. `reviewsApi.ts` — `fetch`をモックし、正常系/zodパースエラーをテスト
4. `useReviewListState.ts` — フィルタ組み合わせ、localStorage不正値のフォールバック
5. `ReviewListPage.tsx` — Testing LibraryでST-01〜ST-06を再現してレンダー結果を検証
   (`vi.fn()`でfetch層をモック、MSW等は新規導入しない)
6. 各サイクルごとに `pnpm --filter web exec vitest run` → 実装 → `lint`/`format` →
   コミット

## 品質ゲート(完了前に実行)

```bash
nix develop --command pnpm --filter web exec tsc --noEmit -p tsconfig.app.json
nix develop --command pnpm exec biome check packages/web --no-errors-on-unmatched
nix develop --command pnpm --filter web exec vitest run --coverage
```

新規/変更コードのカバレッジ75%以上を維持。完了後`graphify update .`を実行する。

## 未確定/次に変化しうる箇所

- 依頼登録(SCR-02)・設定(SCR-04)のフル実装は別タスク
- クローズのUndoはreopen API追加後に再検討
- PAT有効性のサーバー側検証(ST-01/ST-03の動的切替、401判定)は設定APIの実装待ち
- `packages/web`側のZodスキーマ二重定義は、将来openapi-codegen等で`reviews.yaml`
  から自動生成に置き換える余地あり
- データ増加時は`GET /reviews`の`q`パラメータへbranch検索対応を追加し、
  クライアント全件取得方針を見直す
