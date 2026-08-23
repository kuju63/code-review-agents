# 並列レビュー段 拡張アーキテクチャ設計

`docs/review-agent-workflow-spec.md` は LangFlow ワークフロー `Review-Agent.json` から
抽出した「由来の記録」です。本ドキュメントはそれを実装に落とすにあたり、将来の拡張に耐える
構造として再設計した**並列レビュー段**のアーキテクチャを定義します。

---

## 1. 背景と狙い

元の仕様は 3 段構成です:
`PR Info Collector → (技術レビュー ∥ セキュリティレビュー) → Lead Engineer`。

このうち本設計が対象とするのは中段の**並列レビュー段**です。単に React 技術レビューと
セキュリティレビューの 2 つを作るのではなく、次の 2 つの直交する軸で拡張できることを要件とします。

- **軸1: プロジェクト種別** — 本設計時点（React/TypeScript のみ）から React・Angular・Vue・Svelte の
  4 フロントエンド種別に拡張済み（2 節のマトリクス参照）。
  将来 Spring Boot(Java) バックエンド、Next.js / Nuxt.js のようなフロント・バックエンド一体型、
  WASM のような「JavaScript 以外で動くフロントエンド」を追加する。
- **軸2: レビュー観点** — 現状は技術・セキュリティのみ。
  将来「仕様と実装の整合性」、さらに上流の「要件との整合性」を追加する。

制約として、各レビュアーは**シーケンシャルではなく並列に**実行できる必要があります。

---

## 2. レビュアーマトリクス（観点 × プロジェクト種別）

レビュアーは「どの観点を」「どのプロジェクト種別に対して」見るかで分類されます。
セルにレビュアーを登録していくマトリクスとして拡張します。

| 観点＼種別             | React/TypeScript | Angular | Vue | Svelte | Spring Boot | WASM |
| ---------------------- | ---------------- | ------- | --- | ------ | ----------- | ---- |
| 技術 (technical)       | ✅ `ReactReviewer` + Vercel Agent Skills | ✅ `AngularReviewer` + Angular公式Agent Skill | ✅ `VueReviewer` | ✅ `SvelteReviewer` + Svelte公式Agent Skill | ⏳ 予定 | ⏳ 予定 |
| セキュリティ (security)| ✅ `SecurityReviewer` | ✅ `SecurityReviewer` | ✅ `SecurityReviewer` | ✅ `SecurityReviewer` | ⏳ 予定 | ⏳ 予定 |
| 仕様整合性 (spec)      | ⏳ 予定 | ⏳ 予定 | ⏳ 予定 | ⏳ 予定 | ⏳ 予定 | ⏳ 予定 |
| 要件整合性 (requirements)| ⏳ 予定 | ⏳ 予定 | ⏳ 予定 | ⏳ 予定 | ⏳ 予定 | ⏳ 予定 |

- ✅ = 実装済。⏳ = enum 値・拡張点のみ用意（未登録）。
- `detect_project_types()` は3段階で判定する（Issue #230）。
  1. `angular.json`/Angular固有のファイル命名、`.svelte`/`svelte.config.*`、`.vue`/`vue.config.*` を
     検出した場合、粗い TypeScript/JavaScript 判定より優先してそれぞれ `ProjectType.ANGULAR` /
     `SVELTE` / `VUE` を返す（ファイル拡張子・manifestファイル名のみで判定、中身は見ない）。
  2. 1.で決まらない場合、収集済みの `package.json`/`package-lock.json`/`pnpm-lock.yaml` の中身
     （直接依存のパッケージ名）から `ANGULAR` → `SVELTE` → `NUXT` → `VUE` → `NEXTJS` → `REACT_TS`
     の優先順で判定する。SvelteKitプロジェクトのように `svelte` パッケージを直接依存に持たず
     `@sveltejs/kit` のみを使うケースも `@sveltejs/` プレフィックスで拾う。
  3. どちらでも決まらない場合、従来の粗いフォールバック（`package.json` の存在または
     `.ts`/`.tsx`/`.js`/`.jsx` の変更）で `REACT_TS` と推定する。
- `ProjectType.NEXTJS`/`NUXT` はメタフレームワーク専用のレビュアーを持たないため、
  `get_reviewer_classes()` が内部的に `NEXTJS`→`REACT_TS`、`NUXT`→`VUE` にフォールバックし、
  基盤フレームワークのレビュアー（+`SecurityReviewer`）をそのまま再利用する。
- React/Angular/Svelte/Vue 混在モノレポでも、この優先順位に従い最初に一致した種別を採用する
  （1つのPRから複数種別を同時に返すことは現時点では対象外）。
- 同一レビュアーを複数種別に登録でき、`SecurityReviewer` は React/TypeScript・Angular・Vue・Svelte で共有する。

---

## 3. コンポーネント構成

```text
PRInfoResult ──▶ ReviewContext ──▶ ReviewOrchestrator
                                      │  registry: detect_project_types() で検出した
                                      │  stack (react_ts/angular/vue/svelte) に
                                      │  対応する技術レビュアーを1つ選択
                                      ├──▶ {Stack}Reviewer   (technical, 検出stackに対応)  ┐
                                      │      React→ReactReviewer / Angular→AngularReviewer │ Promise.all
                                      │      Vue→VueReviewer / Svelte→SvelteReviewer        │ で並列
                                      └──▶ SecurityReviewer (security, 全stack共通)         ┘
                                   ──▶ ReviewReport(results, errors)  ──▶ Lead Engineer
```

### 3.1 入力境界 — `ReviewContext`

オーケストレータおよび各レビュアーの入力を `ReviewContext` で抽象化します。
現状は `pr_info: PRInfoResult`（`PRInfoCollector.collect()` の出力）のみを保持します。

これは伏線です。仕様整合性・要件整合性の観点は PRInfo だけでは判定できず、仕様書や要件定義を
追加入力として必要とします。`ReviewContext` に `spec_documents` / `requirement_documents` を
後から足しても、`review()` のシグネチャ（`review(context: ReviewContext)`）は変わりません。

### 3.2 レビュアー — `ReviewAgent` / `LLMReviewAgent`

- `ReviewAgent`（抽象クラス）: 各サブクラスが `static readonly` で宣言する識別メタデータ
  `reviewerId` / `perspective` / `projectTypes` を持ち、抽象メソッド
  `review(context: ReviewContext, projectType?: ProjectType): Promise<ReviewResult>` を定義する。
- `LLMReviewAgent`: Strands `Agent` + GitHub MCP を使う共通実装。具体レビュアーは
  システムプロンプト等の設定差分のみを与える（設定で振る舞いを変える、コードは共有）。
  任意でスキルディレクトリを設定可能。設定された場合、Agent Skills プラグインと
  ファイル読み取りツールが Agent に追加され、プログレッシブ・ディスクロージャーによる
  スキルの段階的ロードが有効になる。シェル実行ツールは注入しない（スキルのリファレンス
  ファイルはファイル読み取りで十分、かつ任意コマンド実行は最小権限の原則に反する）。
- プロンプト構築処理はパッチ各行に実ファイル行番号を付与する。ただし、この付与は
  `PRInfoResult` に事前収録されたパッチのみに適用される。**現時点の設計上の制限**:
  エージェントが実行中に GitHub MCP 経由でオンデマンド取得したパッチはアノテーション対象外と
  なるため、その場合のエージェントが報告する行番号は `@@` ヘッダーの開始行をそのまま使用する等、
  実ファイル行番号と一致しない場合がある（patch サイズが閾値を超えてパッチ本体を含まない
  形にフォールバックした PR で発生しうる）。
- 各レビュアーの `review()` は Promise を返す非同期実装。3.4節のオーケストレータは
  複数レビュアーの `review()` 呼び出しを直接 `Promise.all`/`Promise.race` で束ねて並列化する
  （スレッドオフロードは不要）。
- 構造化出力は、ターン数上限を使い切った場合に例外を送出せず未定義のまま結果が返ることがある。
  `review()` はこれを明示チェックし `StructuredOutputMissingError` を送出する。3.4 節の
  `ReviewError` 変換により、単一レビュアーのこの失敗が他のレビュアーを巻き込むことはない。詳細は
  [docs/lead-engineer-agent-design.md §8.1](lead-engineer-agent-design.md#81-structured_output-が得られない場合のフェイルファスト)。

### 3.3 レジストリ — `registry`

- `registerReviewer(cls)` でレビュアークラスを登録する（関数呼び出しであり、デコレータでは
  ない — TypeScriptのクラスは型としても値としても使うため、デコレータ構文にすると具象クラスの
  型情報が失われる）。渡すのはインスタンスではなくクラス自体で、設定注入はオーケストレータが行う。
- `getReviewerClasses(projectType, perspectives?)` が、対象種別に適用され観点フィルタに
  合致するレビュアークラス群を返す。**拡張の中心点**であり、新しいセルの追加はクラス追加 +
  登録呼び出しだけで完結する。
- `detectProjectTypes(prInfo)` が変更ファイルの拡張子・manifest、および `manifestContents`
  （`package.json`/`package-lock.json`/`pnpm-lock.yaml` の中身、詳細は2節参照）から種別を推定する。
  `dependencyFiles` は「リポジトリ直下に存在する」manifest（PRでの変更有無を問わない）の
  パス一覧である。`manifestContents` はそのうち中身を取得できたものの実データに加え、ルート
  `package.json` の `workspaces` フィールドから解決されたworkspace配下各パッケージの
  `package.json` の中身も含む（`dependencyFiles` 自体はリポジトリ直下のみでworkspace配下は
  含まない）。両者を組み合わせても決め手がない場合、`src/*.tsx` だけ変更する典型 PR を
  取りこぼさないよう、TS/JS/JSX の変更が
  あれば（package.json 変更がなくても）react_ts と判定する最終フォールバックへ落ちる。
  package.json 単独の変更（依存更新）も単体で該当する。明示指定がない場合のデフォルト選択に使い、
  将来種別の判定分岐はここに足す。

### 3.4 オーケストレータ — `ReviewOrchestrator`

- プロジェクト種別（明示 or `detectProjectTypes`）からレビュアーを選び、共通設定
  `ReviewerConfig` を注入して instantiate。
- 各レビュアーの `review()` 呼び出しを `Promise.all`/`Promise.race` で束ねて**並列実行**する。
  各レビュアーは元々非同期実装のため、スレッドオフロードのような追加の仕組みは不要。
- 例外は `ReviewError` に変換して `ReviewReport.errors` に隔離する。1 つのレビュアーの失敗が
  他のレビュアーを巻き込まない。

### 3.5 出力 — `ReviewReport`

`results: ReviewResult[]` と `errors: ReviewError[]` を持つ集約結果。
これは Lead Engineer 合成エージェント（[docs/lead-engineer-agent-design.md](lead-engineer-agent-design.md)）の
入力にそのままなる形です。

---

## 4. 新しい種別 / 観点を追加する手順

### プロジェクト種別を追加する（例: Spring Boot 技術レビュー）

1. `models/review.ts` の `ProjectType` に値が無ければ追加（`SPRING_BOOT` は宣言済み）。
2. `agents/reviewers/spring-boot.ts` に `LLMReviewAgent` を継承したレビュアークラスを作り、
   `perspective=TECHNICAL`、`projectTypes={ProjectType.SPRING_BOOT}` を `static readonly` で
   宣言し、`registerReviewer(cls)` で登録する。
3. `detectProjectTypes` に判定分岐を追加（例: `pom.xml` / `build.gradle` → SPRING_BOOT）。
4. `agents/reviewers/index.ts` で import して登録副作用を発火。

オーケストレータ・レジストリ本体は無改修。

### レビュー観点を追加する（例: 仕様整合性）

1. `models/review.ts` の `ReviewPerspective` に値が無ければ追加（`SPEC_CONSISTENCY` は宣言済み）。
2. `ReviewContext` に必要な入力（例: 仕様書ドキュメント）を追加。
3. その観点のレビュアークラスを作り `perspective=SPEC_CONSISTENCY` で登録。

---

## 5. 未配線の拡張点（本リリースで意図的に未実装）

- **spec / requirement 入力**: `ReviewContext` の拡張フィールドとして追加予定（4 節参照）。
- **Next.js/Nuxt 専用レビュアー**: `ProjectType.NEXTJS`/`NUXT` は検出できるが、専用の
  `NextReviewer`/`NuxtReviewer` は未実装。現状は `get_reviewer_classes()` のフォールバックで
  `ReactReviewer`/`VueReviewer` を再利用する（2節参照）。
- **モノレポでの複数種別同時検出**: `workspaces` 配下の各パッケージが異なるフレームワークを
  使う場合でも、`detect_project_types()` は単一の `ProjectType` のみを返す（優先順位表に従い
  最初に一致した種別を採用）。1つのPRから複数種別を同時に返す設計は将来課題。
- **マニフェスト収集の範囲制限**: `PRInfoCollector._read_manifest_contents` はルート
  `package.json` の `workspaces` フィールドのみを解決対象とし、`pnpm-workspace.yaml`
  （pnpmの標準的なworkspace宣言方法）は読まない。そのため`pnpm-workspace.yaml`のみで
  workspaceを宣言するpnpmモノレポでは、各パッケージの`package.json`が収集されず検出精度が
  低下する。また`yarn.lock`は直接依存と推移的依存を構造的に区別できないため意図的に取得しない
  （`package.json`/`package-lock.json`/`pnpm-lock.yaml`のみ取得）。いずれも将来課題。

> **実装済みに変更（旧「未配線」、Issue #230）**: 「`ProjectType.NEXTJS` 等は宣言済みだが未配線」
> および「`@angular/core` 依存判定は `package.json` の中身を見ないため `angular.json` とファイル
> 命名のみに頼る」という制限はいずれも解消した。`detect_project_types()` は `PRInfoResult.manifest_contents`
> 経由で `package.json`/`package-lock.json`/`pnpm-lock.yaml` の直接依存パッケージ名を見て
> `NEXTJS`/`NUXT`/`ANGULAR`/`SVELTE`/`VUE`/`REACT_TS` を判定できる（2節参照）。

> **実装済みに変更（旧「未配線」）**: 参照ドキュメント取得は `AgentSkills` と
> `packages/agent-core/skills/` 内のスキルパッケージとして実装した（Issue #255でPython資産の
> 撤去に伴い `src/code_review_agent/skills/` から移動）。`ReactReviewer` は
> `AgentSkillType.REACT_REVIEW`（reviewing-universal / reviewing-languages / reviewing-frameworks
> / reviewing-metaframeworks に加え Vercel の vercel-react-best-practices / vercel-composition-patterns）を、
> `AngularReviewer` は `AgentSkillType.ANGULAR_REVIEW`（reviewing-universal / reviewing-languages /
> reviewing-frameworks に加え Angular公式の angular-developer）を、`VueReviewer` は
> `AgentSkillType.VUE_REVIEW`（reviewing-universal / reviewing-languages / reviewing-frameworks。
> Angular/Svelteと異なりVue公式Agent Skillは未ベンダリングのため、`reviewing-frameworks/references/vue.md`
> の汎用知識に依拠する — 追従課題は docs/plan/seeded-reviewer-stack-routing-spec.md §4 参照）を
> `skill_type` 経由で読み込む。
> いずれも GitHub MCP + `file_read` ツールとともに動作する（`shell` は最小権限の原則から注入しない）。

---

## 6. 関連ドキュメント

- 由来の記録: [docs/review-agent-workflow-spec.md](review-agent-workflow-spec.md)
- レビュー知識(Agent Skills)提供方式の比較検討: [docs/review-knowledge-provisioning-options.md](review-knowledge-provisioning-options.md)
- 要件検証基準: [evaluation/EVALUATION_PLAN.md](../evaluation/EVALUATION_PLAN.md)
- 評価実行手順: [evaluation/RUNBOOK.md](../evaluation/RUNBOOK.md)
