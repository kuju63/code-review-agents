# SCR-02 レビュー依頼登録画面 実装スペック

関連 Issue: #341（親 #243）。ブランチ: `feature/issue-341`。

## 目的

`packages/web`（React + Vite + Carbon + TanStack）に、`packages/web-api` の
`GET /github/orgs` / `GET /github/repos` / `GET /github/prs` / `POST /reviews` を
消費する SCR-02 レビュー依頼登録画面を実装する。Organization/ユーザー →
リポジトリ → Open PR の3ステップ選択と、選択内容の確認・送信を行う。

## 参照した正本

- 外部設計書: `docs/display-spec/review-request.html`（SCR-02個別仕様）,
  `docs/display-spec/index.html`（COM-*/CB-* 共通仕様）
- API契約: `docs/openapi/reviews.yaml`、実装
  `packages/web-api/src/modules/github/{github.route,github.schema,github.client}.ts`,
  `packages/web-api/src/modules/reviews/{reviews.route,reviews.schema,reviews.store,reviews.enums,reviews.params}.ts`
- 振る舞い参考（設計書優先、モックは参考のみ）:
  `docs/mocks/assets/{app.js,mock-data.js}`
- 先行実装: SCR-01 (`docs/plan/review-list-screen-spec.md`, Issue #340) の
  ディレクトリ構成・状態管理パターン・品質ゲートをそのまま踏襲する。

## `packages/web-api` への変更は不要

Issue #341 の対象は `packages/web` のみ。`/github/orgs`・`/github/repos`・
`/github/prs`（Issue #335）と `POST /reviews`（Issue #？既存実装）は既に
`reviews.yaml` 通りに実装済みであり、本タスクではAPI契約・`reviews.yaml`・
`openapi-contract.test.ts` を変更しない。

## スコープ境界（承認事項）

- **言語切替(COM-02)は実装しない**: Issue本文に「日本語・英語切替をサポート」と
  あるが、`en` locale は存在せず、#340で承認済みのスコープ境界（ja のみ、
  COM-02は作らない）をそのまま継承する。i18nキーは多言語対応可能な構造
  （`public/locales/ja/translation.json`）で用意するにとどめる。
- **Storybookは導入しない**: Issue本文にコンポーネント単位のStorybook
  スナップショットテストの記載があるが、本リポジトリにStorybookは存在しない。
  #340と同様、Vitest + Testing Libraryのコンポーネントテストと
  playwright-cliによる目視比較を代替手段とする。
- **`commitSha`は送信しない**: `RegisterReviewRequestSchema.commitSha`は
  optionalだが、`/github/prs`のレスポンス(`GithubPullRequestSchema`)に
  コミットSHAは含まれない。取得できない値を送信しないため省略する。
  結果としてVL-06（同一最新コミットに対する重複依頼検出）はクライアント側に
  入力を持たず発火しえない。`reviews.store.ts`の`registerReview`も
  organization/repository/pullRequestの組でのみ重複判定しており、コミット
  単位の判定は未実装（次に変化しうる箇所を参照）。
- **PR一覧の「ブランチ」表示は`baseBranch`（マージ先ブランチ）とする**:
  設計書RR-07は「ブランチ」とのみ記載し、モック(`app.js`の`pr.branch`)は
  作業ブランチ（マージ元）を表示する。しかし`GithubPullRequestSchema`が
  提供するのは`baseBranch`（マージ先、例: `main`）のみで、作業ブランチは
  現行API契約に存在しない。名前が同じ「ブランチ」でも実体が異なる値を
  表示すると利用者に誤解を与えるため、本実装ではラベルを「ベースブランチ」
  と明示し、`baseBranch`の値をそのまま表示する。作業ブランチの表示が
  必要な場合は`/github/prs`のAPI契約拡張を伴う別Issueとする。
- **PAT無効/期限切れの検知は`/github/*`の401のみ**: `GET /reviews`と異なり
  `/github/orgs`等はGitHub呼び出し前提のため401を返しうる
  (`github.route.ts`の`unauthorizedResponse`)。ローカルの`hasGithubToken`
  フラグが`true`のまま実際のトークンが無効化されているケース（設計書§4
  「認証情報が無効または期限切れ」）を、ST-01（未設定）ともRR-15汎用エラー
  （§4「候補取得に失敗」）とも別の第3状態として扱う。

## 差異のハンドリング（設計書 vs モック vs API実装、設計書を正とする）

1. **進捗ステップの数え方**: モックの`newPR ? 2 : newRepo ? 1 : 0`は設計書§1.2
   「Organization / ユーザーのみを選択した状態は第1ステップに含める」と一致する
   ため、そのまま踏襲する。
2. **PR一覧はサーバー側で既にOpenのみ**: `github.client.ts`の
   `listGithubPullRequests`は`state=open`をクエリに固定しているため、
   クライアント側でのVL-04フィルタリングは不要（表示前フィルタは冗長な
   二重チェックになるため実装しない）。ただし送信直前にPRがClosedへ変化した
   場合（VL-04）は、送信APIが成功してしまう（`registerReview`はPR状態を
   再検証しない）ため、設計書が要求するサーバー側再検証は未実装である旨を
   「未確定/次に変化しうる箇所」に記録する。
3. **Idempotency-Keyは選択(org, repo, pullRequest)ごとに1回だけ生成**:
   OP-05/ST-06の二重送信防止のため、`crypto.randomUUID()`を選択が変わる
   たびに再生成し、同一選択への再送（ネットワークエラー後の再試行等）では
   同じキーを使い回す（`useReviewRequestSelection.ts`で`useMemo`により
   `[organization, repository, pullRequest]`を依存配列とする）。
4. **`POST /reviews`が200を返す場合（既存レビューへの再登録）は成功として扱う**:
   `reviews.store.ts`の`registerReview`は同一
   organization/repository/pullRequestの組が既存の場合、新規作成せず既存の
   Reviewを200で返す（409を返さない）。これはVL-06の「重複依頼を作成しない」
   要件を部分的に満たす実装のため、クライアントは201/200のどちらも成功として
   扱い、一覧画面へ遷移する。契約上は409（conflict）も定義されているため、
   将来サーバー側にIdempotency-Key照合や有効な依頼の重複検出が実装された
   場合に備え、409レスポンスのハンドリング（既存依頼への案内文言表示）も
   実装するが、現行の`reviews.store.ts`では発火しない。
5. **送信失敗時の状態維持**: モックには送信失敗状態がないが、設計書VL-05/
   §4「送信処理に失敗」に従い、3項目の選択値を維持したままRR-15エラー通知を
   表示し、再送信を可能にする。

## コンポーネント構成（`src/features/review-request/`）

- `reviewRequest.schema.ts` — `reviews.yaml`の`/github/*`・`POST /reviews`に
  対応するクライアント側Zodスキーマ(web-api非import。理由は#340の
  reviews.schema.tsと同じ: web-apiにmain/exports/typesが無くVite解決不可)。
- `reviewRequestApi.ts` — `fetchGithubOrgs()`, `fetchGithubRepositories(org)`,
  `fetchGithubPullRequests(org, repo)`（401/502を`GithubUnauthorizedError`/
  `GithubUpstreamFailureError`として区別してthrow）, `submitReviewRequest()`
  （201/200/409/422/502を判別可能ユニオンで返す、closeReviewと同じパターン）。
- `useReviewRequestSelection.ts` — organization/repository/pullRequestの選択
  状態、上位変更時の下位選択クリア（OP-01/OP-02）、進捗ステップ算出、
  Idempotency-Keyのメモ化。
- `TokenMissingNotice.tsx` — RR-13/RR-14（レビュー依頼登録画面専用の文言。
  review-listの同名コンポーネントとは文言が異なるため独立実装）。
- `PullRequestCard.tsx` — RR-07単一PRカード。`aria-pressed`で選択状態を
  支援技術に伝える（OP-03）。
- `ReviewRequestPage.tsx` — 画面全体（ST-01〜ST-06を統括、送信・キャンセル
  ハンドラ、react-queryによる3段階のカスケードフェッチ）。
- `review-request.module.scss` — 画面固有スタイル。
- 各`*.test.ts(x)` — 対象コードと同ディレクトリに配置。

## テスト方針(TDD, Vitest)

1. `reviewRequest.schema.ts` — スキーマのパース成功/失敗を確認するテストから
   開始。
2. `reviewRequestApi.ts` — `fetch`をモックし、200/401/502（GET系）、
   201/200/409/422/502（POST）を各テストで再現。
3. `useReviewRequestSelection.ts` — org変更時のrepo/PRクリア、repo変更時の
   PRクリア、進捗ステップの算出、同一選択でのIdempotency-Key安定性、選択
   変更時の再生成。
4. `PullRequestCard.tsx` — 選択状態の`aria-pressed`、クリックイベント。
5. `ReviewRequestPage.tsx` — Testing LibraryでST-01〜ST-06を再現
   （`vi.fn()`でfetch層をモック）。401時はST-01と別の通知文言になることを
   検証する。
6. 各サイクルごとに `pnpm --filter web exec vitest run` → 実装 → `lint`/`format`
   → コミット。

## 品質ゲート(完了前に実行)

```bash
nix develop --command pnpm --filter web exec tsc --noEmit -p tsconfig.app.json
nix develop --command pnpm exec biome check packages/web --no-errors-on-unmatched
nix develop --command pnpm --filter web exec vitest run --coverage
```

新規/変更コードのカバレッジ75%以上を維持。完了後`graphify update .`を実行する。

## Playwright-cliでの確認方針

`docs/mocks/review-request.html`（モック）と実装(`http://localhost:5173/review-request`)
をplaywright-cliで比較する。§5「モックアップとの差異」に列挙された9項目
（送信失敗状態・二重送信防止・重複依頼・Open PR 0件時の明示等）はモックに
存在しないため一致確認の対象外とし、モックが実装している状態
（初期表示・Organization選択後・リポジトリ選択後のPR一覧・PR選択後の送信
確認パネル）についてレイアウト・見出し・項目順序・進捗表示の構造的な一致を
確認する。ピクセル単位の一致はCarbon採用（#340と同じ方針）により対象外。

## Playwright-cliでの確認結果

`docs/mocks/review-request.html`（簡易HTTPサーバー経由）と実装
(`http://localhost:5173/review-request`、`packages/web-api`をローカル起動)を
`playwright-cli`で比較した。本環境には実GitHub認証情報が無いため、
Organization/リポジトリ/PR選択後の状態は`playwright-cli route`で
`/api/github/{orgs,repos,prs}`をフィクスチャ応答にモックして再現した。

- **ST-01/§4「未設定」「無効/期限切れ」の2状態が両方到達可能であることを確認**:
  本環境は`packages/web-api`にGitHub認証情報が未設定のため、
  `hasGithubToken`フラグのみ`true`にすると`/github/orgs`が401を返し、
  設計時に区別した「無効/期限切れ」状態（RR-13の「未設定」とは別文言）が
  実際に表示されることを確認した。
- **Carbon `Dropdown`の`selectedItem`にDownshiftの制御/非制御切替バグを検出・
  修正**: `orgs.find(...)`の戻り値（未選択時`undefined`）をそのまま
  `selectedItem`に渡すと、Carbonの`Dropdown.js`は`selectedItem !== undefined`
  の場合のみDownshiftへ値を転送する実装のため、未選択時は非制御、選択後は
  制御という切り替えになり、Downshiftのconsole error
  （"A component has changed the uncontrolled prop 'selectedItem' to be
  controlled"）が発生した。宣言された型は`ItemType | undefined`のみだが、
  実装は`null`を"制御された空選択"として扱うため、`undefined`ではなく`null`を
  渡すよう修正した（`ReviewRequestPage.tsx`、型は`as GithubOrg | undefined`で
  意図的にキャスト）。
- **選択中PRカードのhover時に選択色が消えるCSS詳細度バグを検出・修正**:
  `.prCard:hover`（詳細度0,2,0）が`.prCardSelected`（詳細度0,1,0）より高く、
  選択中カードにカーソルを乗せると非選択色に戻っていた。
  `.prCardSelected:hover`を追加して解決した。
- **進捗ラベルの省略表示(ellipsis)はCarbon既定動作として許容**: `.page`の
  幅をモックの`screen-narrow`と同じ760pxに広げても、長い日本語ラベルは
  Carbon `ProgressStep`の既定CSSで省略される。`title`属性でフルテキストが
  取得できるため、Carbon採用に伴う構造差異として許容し、モック同一幅への
  追従以上の対応はしない。
- レイアウト（ヘッダー/サイドバー/パンくず/タイトル/進捗表示/フィールド行/
  PRカード一覧/送信確認パネル）と項目順序はモックと一致した。

## 未確定/次に変化しうる箇所

- 送信直前のPR状態再検証（VL-04）・所有権限再検証・Idempotency-Key照合による
  リプレイ判定・同一最新コミット単位の重複検出（VL-06）はいずれも
  `packages/web-api`側の未実装であり、別Issueとする。
- 作業ブランチ（head branch）の表示は`/github/prs`のAPI契約拡張が前提のため
  別Issueとする。
- 言語切替・Storybookは#340と同じ理由でスコープ外。
- **`ReviewRequestPage`のPATゲート判定は`localStorage.hasGithubToken`のみで、
  マウント時にサーバーへ照会しない**（coderabbit指摘、#340
  `ReviewListPage`と同じ設計）。設定画面でPATを保存した後の初回訪問など、
  フラグが実際のサーバー状態と一時的にずれる window が理論上ありうる。
  `/github/orgs`が401を返す場合は本画面の「認証情報が無効または期限切れ」
  状態で救済されるが、逆方向（フラグ`false`だがサーバーにPATが設定済み）は
  未対応。`GET /settings/github`の`hasPersonalAccessToken`を正本として画面
  ごとに問い合わせる設計へ変更する場合は、review-listとreview-requestの
  両方を対象に別Issueとして扱う（本タスク単独での修正は#340との実装方針の
  分岐を生むため見送る）。
- **`packages/web-api/src/modules/github/github.client.ts`のページング未対応・
  Organization限定のオーナーモデル**（coderabbit指摘）は本タスク以前に
  マージ済みの既存コードであり、Issue #341の対象（`packages/web`のみ）外。
  100件を超えるOrganization/リポジトリや個人ユーザーの所有物を選択したい
  場合に影響するため、`packages/web-api`側の別Issueとして扱う。
