# Seeded評価のスタック別レビュアールーティング仕様

関連Issue: #181

> **一部supersededです（2026-08-08、Issue #237）**: §6（stack→endpointテーブルとクライアント側
> ルーティング）および§8の`run_agent_evaluation.py`関連記述は、Seeded評価が`/orchestrator`単一
> 呼び出しに統合されたことに伴い廃止されました。クライアント側の明示的stackルーティングは
> 存在せず、Gold項目と同じ`detect_project_types`による自動検出に一本化されています。
> 同じ理由で、§2の「Seeded評価をstackに応じた技術レビュアー呼び出しに変更する」という
> スコープ記述、§3の「stackはレビュアー選択という実行時の分岐に直結する」という理由付け
> (データセット生成時のfail-closedバリデーション自体は現在も有効。実行時ルーティングの
> 話ではなくなった点のみが古い)、§7の「Seeded項目内での技術レビュアー・SecurityReviewer
> 間の並列実行は維持する」という記述(クライアント側の個別並列制御自体が消滅したため)も
> 同様にsupersededです。各節にインライン注記を付しています。
> §2〜§5のうちVueReviewer新設・`/vue-reviewer`・`/angular-reviewer`エンドポイント公開・
> `FrontendReviewer`→`ReactReviewer`改名、および§3のstack属性伝播とfail-closedバリデーション
> 自体は、レビュアー実装・データセット生成ロジックとして引き続き有効です。
> 詳細は
> [docs/eval-seeded-orchestrator-unification-spec.md](eval-seeded-orchestrator-unification-spec.md)、
> 既知の誤ルーティング4件は
> [Issue #238](https://github.com/kuju63/code-review-agents/issues/238)を参照してください。

## 1. 背景

`run_agent_evaluation.py`の`evaluate_seeded_item()`は、対象PRのスタックに関わらず常に
`/frontend-reviewer`と`/security-reviewer`を固定で呼び出していた。`FrontendReviewer`は
実体としてReact/TypeScript専用のレビュアーであり(`project_types == {ProjectType.REACT_TS}`)、
Vue・Angular・SvelteのSeeded項目に対しても無関係なReact向けレビュアーが起動していた。

一方Gold項目は`/orchestrator`経由で評価され、`ReviewOrchestrator._select_reviewers`が
`detect_project_types()`の結果に基づいて適切なレビュアーを選ぶ。Gold/Seededで経路が
非対称であることは`docs/evaluation-pipeline-design.md`に既知の制限として記録されていたが、
今回はSeeded側もスタックに応じた技術レビュアーを選択するように是正する。

## 2. スコープ

- Gold/Seededデータセットへ`stack`属性を選定元(`select_stack_targets.py`)から一貫して伝播する。
- ~~Seeded評価を、対象PRのstackに応じた技術レビュアー1つ + `SecurityReviewer`の呼び出しに
  変更する。技術レビュアーとSecurityReviewerは従来通り並列実行する(直列化しない)。~~
  (superseded、Issue #237) Seeded評価は`/orchestrator`単一呼び出しに統合され、この
  スコープ記述は歴史的記録。
- `VueReviewer`を新設し、Vueの技術レビューを担当させる。
- `VueReviewer`・`AngularReviewer`を独立呼び出し可能なA2Aエンドポイントとして公開する
  (`AngularReviewer`は`ReviewOrchestrator`経由でのみ呼ばれており、独立エンドポイントを持っていなかった)。
- `FrontendReviewer`/`frontend-reviewer`を`ReactReviewer`/`react-reviewer`へ改名する。
  実体がReact専用であることを名前に一致させるための破壊的変更であり、互換用エイリアスは設けない。

## 3. スタック属性の伝播

`stack`は`pr_targets_{stack}.json`の生成時点(`discover_candidate_prs.py`)で既に存在するが、
`select_stack_targets.py`の`_to_output()`が`pr_targets.json`書き出し時に捨てていた。
これをGold/Seededまで一貫して保持する。

```text
pr_targets_{stack}.json (stackあり)
    ↓ select_stack_targets.py:_to_output()  ← stackを保持するよう変更
pr_targets.json (stackあり)
    ↓ build_gold_set.py:Target / build_gold_item()  ← stackを必須フィールド化
gold_pr_set.jsonl (stackあり)
    ↓ build_seeded_set.py:render_seeded_item() / render_seeded_item_from_llm()
seeded_set.jsonl (stackあり)
```

- `gold_pr_item.schema.json` / `seeded_item.schema.json` に `stack` を必須フィールドとして追加し、
  値域を `react` / `vue` / `angular` / `svelte` に限定する。
- `stack`欠損・不正値は`severity`/`impact`/`priority`のような`unknown`フォールバックを行わず、
  `build_gold_set.py`/`build_seeded_set.py`が明示的に失敗する(fail-closed)。この
  データセット生成時のバリデーション自体は現在も有効。~~stackはレビュアー選択という実行時の
  分岐に直結するため、不明な値のまま実行するより早期に停止する方が安全である。~~
  (superseded、Issue #237) `evaluate_item()`は`stack`を実行時のレビュアー選択に使わなく
  なったため、この理由付けは古い。`build_gold_set.py`/`build_seeded_set.py`自体は変更
  されていないため、fail-closedバリデーションはデータセット生成時の仕様として現在も
  維持されている(理由は生成時点でのデータ品質保証であり、実行時ルーティングとは無関係)。

## 4. Vueサポートの追加

- `ProjectType`に`VUE = "vue"`を追加する。
- `registry._DETECTION_RULES`に、`.vue`ファイル変更または`vue.config.js`/`vue.config.ts`の
  マニフェスト変更でVueと判定する規則を追加する。Angular/Svelteの規則と同様、coarseな
  React/TypeScript規則より前に評価する。
- `VueReviewer`(`agents/reviewers/vue.py`)を新設し、`perspective=TECHNICAL`,
  `project_types={ProjectType.VUE}`で登録する。
- `SecurityReviewer.project_types`に`ProjectType.VUE`を追加する。
- `AgentSkillType.VUE_REVIEW`を追加する。現時点でAngularの`angular-developer`やSvelteの
  `svelte-core-bestpractices`に相当する公式Vueスキルパッケージは未導入のため、スキル束は
  `reviewing-universal` / `reviewing-languages` / `reviewing-frameworks`
  (Vue規約は`reviewing-frameworks/references/vue.md`に含まれる)のみとする。
  公式Vueスキルパッケージの導入は別Issueのスコープとする。

## 5. A2Aエンドポイントの追加・改名

| 変更前 | 変更後 |
|---|---|
| `/frontend-reviewer` (`FrontendReviewer`) | `/react-reviewer` (`ReactReviewer`) |
| (なし) | `/vue-reviewer` (`VueReviewer`) 新設 |
| (なし) | `/angular-reviewer` (`AngularReviewer`) 新設 |
| `/svelte-reviewer` (`SvelteReviewer`) | 変更なし |
| `/security-reviewer` (`SecurityReviewer`) | 変更なし |

`reviewer_id`も`frontend-technical`から`react-technical`へ改名する。設定値
`CODE_REVIEW_AGENT_FRONTEND_REVIEWER_URL`は`CODE_REVIEW_AGENT_REACT_REVIEWER_URL`へ改名する。
`AgentSkillType.FRONTEND_REVIEW`は`AgentSkillType.REACT_REVIEW`へ改名する。
いずれも互換エイリアスは設けず、旧名は削除する。

## 6. Seeded評価のルーティング変更（superseded、Issue #237で廃止）

> 本節はIssue #237（Seeded評価の`/orchestrator`統合）により廃止されました。以下は歴史的記録
> として残します。

`evaluate_seeded_item()`は、項目の`stack`から技術レビュアーのURLプレフィックスを解決する。

| stack | 技術レビュアー endpoint |
|---|---|
| `react` | `/react-reviewer` |
| `vue` | `/vue-reviewer` |
| `angular` | `/angular-reviewer` |
| `svelte` | `/svelte-reviewer` |

未知のstack値は`ValueError`で明示的に失敗させ、無関係なレビュアーへフォールバックしない。
解決した技術レビュアーと`SecurityReviewer`は、従来通り`ThreadPoolExecutor(max_workers=2)`で
並列実行する。両者は互いの出力に依存しない独立処理であるため、並列実行しても検出内容には
影響しない(この点は変更しない)。

## 7. 影響を受けない設計判断

- Gold項目の経路(`/orchestrator`経由、`ReviewOrchestrator._select_reviewers`によるスタック検出)
  は変更しない。(この記述は現在も正しい。Issue #237後はSeeded項目も同じ経路を通る。)
- ~~Seeded項目内での技術レビュアー・SecurityReviewer間の並列実行は維持する。直列化はしない
  (直列化は資源競合緩和にはなるが、根本原因であるルーティングの誤りを解決しないため見送る)。~~
  (superseded、Issue #237) Seeded項目もGold同様`/orchestrator`単一呼び出しに統合され、
  クライアント側で技術レビュアーとSecurityReviewerを個別に並列呼び出しする制御自体が
  消滅した。並列実行自体は`/orchestrator`内部(`ReviewOrchestrator`)で引き続き行われる。
- `--concurrency`(Gold/Seeded項目間の並列数)は本変更の対象外。

## 8. テスト方針

- `select_stack_targets.py`: `_to_output()`が`stack`を保持することを検証する。
- `build_gold_set.py`: `stack`必須化、既知4スタック以外・欠損時に明示的に失敗することを検証する。
- `build_seeded_set.py`: `render_seeded_item()` / `render_seeded_item_from_llm()`が
  `gold_item["stack"]`をSeeded項目へ引き継ぐことを検証する。
- `registry.py`: Vue検出規則(`.vue`ファイル、`vue.config.{js,ts}`、React規則との優先順位)を検証する。
- `reviewers/vue.py`: `VueReviewer`のメタデータ・スキル束解決を検証する。
- `run_agent_evaluation.py`: ~~stackごとに正しいエンドポイントが呼ばれること、未知stackで
  明示的に失敗すること、技術レビュアーとSecurityReviewerの並列実行が維持されることを検証する。~~
  （superseded、Issue #237）該当テストは削除され、`evaluate_item()`が`/orchestrator`のみを
  呼ぶことを検証するテストに置き換わった。詳細は
  [docs/eval-seeded-orchestrator-unification-spec.md](eval-seeded-orchestrator-unification-spec.md)
  を参照。
- API層: `/react-reviewer`・`/vue-reviewer`・`/angular-reviewer`のagent card・タスク送信・
  ポーリングの一連の振る舞いを既存の`/svelte-reviewer`テストと同様に検証する。
- 改名に伴い、`frontend-technical`/`FrontendReviewer`/`frontend-reviewer`を参照する既存テストは
  `react-technical`/`ReactReviewer`/`react-reviewer`へ更新する。
