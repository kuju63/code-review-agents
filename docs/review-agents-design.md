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

- **軸1: プロジェクト種別** — 現状は React/TypeScript フロントエンドのみ。
  将来 Spring Boot(Java) バックエンド、Next.js / Nuxt.js のようなフロント・バックエンド一体型、
  WASM のような「JavaScript 以外で動くフロントエンド」を追加する。
- **軸2: レビュー観点** — 現状は技術・セキュリティのみ。
  将来「仕様と実装の整合性」、さらに上流の「要件との整合性」を追加する。

制約として、各レビュアーは**シーケンシャルではなく並列に**実行できる必要があります。

---

## 2. レビュアーマトリクス（観点 × プロジェクト種別）

レビュアーは「どの観点を」「どのプロジェクト種別に対して」見るかで分類されます。
セルにレビュアーを登録していくマトリクスとして拡張します。

| 観点＼種別             | フロントエンド (React/Vue/Angular/Svelte/Next.js 等) | Spring Boot | WASM |
| ---------------------- | ---------------------------------------------------- | ----------- | ---- |
| 技術 (technical)       | ✅ 実装済 — `FrontendReviewer` + AgentSkills でフレームワーク検出 | ⏳ 予定 | ⏳ 予定 |
| セキュリティ (security)| ✅ 実装済                                             | ⏳ 予定      | ⏳ 予定 |
| 仕様整合性 (spec)      | ⏳ 予定                                               | ⏳ 予定      | ⏳ 予定 |
| 要件整合性 (requirements)| ⏳ 予定                                             | ⏳ 予定      | ⏳ 予定 |

- ✅ = 実装済。⏳ = enum 値・拡張点のみ用意（未登録）。
- `detect_project_types()` はフロントエンド全プロジェクトを `ProjectType.REACT_TS` として返す（既存設計）。
  Vue/Angular/Svelte/Next.js 等の差分はスキル内部のフレームワーク検出で吸収する。
- 同一レビュアーを複数種別に登録することも可能（例: セキュリティ観点を複数スタックで共有）。

---

## 3. コンポーネント構成

```text
PRInfoResult ──▶ ReviewContext ──▶ ReviewOrchestrator
                                      │  registry: プロジェクト種別から
                                      │  適用レビュアークラスを選択
                                      ├──▶ FrontendReviewer (technical)   ┐
                                      └──▶ SecurityReviewer  (security)   ├ asyncio.gather で並列
                                                                          ┘
                                   ──▶ ReviewReport(results, errors)  ──▶ (将来) Lead Engineer
```

### 3.1 入力境界 — `ReviewContext`

オーケストレータおよび各レビュアーの入力を `ReviewContext` で抽象化します。
現状は `pr_info: PRInfoResult`（`PRInfoCollector.collect()` の出力）のみを保持します。

これは伏線です。仕様整合性・要件整合性の観点は PRInfo だけでは判定できず、仕様書や要件定義を
追加入力として必要とします。`ReviewContext` に `spec_documents` / `requirement_documents` を
後から足しても、`review()` のシグネチャ（`review(context: ReviewContext)`）は変わりません。

### 3.2 レビュアー — `ReviewAgent` / `LLMReviewAgent`

- `ReviewAgent`（ABC）: ClassVar メタデータ `reviewer_id` / `perspective` / `project_types` を持ち、
  抽象メソッド `review(context: ReviewContext) -> ReviewResult` を定義する。
- `LLMReviewAgent`: Strands `Agent` + GitHub MCP を使う共通実装。具体レビュアーは
  `system_prompt` 等の設定差分のみを与える（設定で振る舞いを変える、コードは共有）。
  任意で `skills_dir: Path | None` を設定可能。設定された場合、`AgentSkills(skills=skills_dir)`
  プラグインと `file_read` ツール（`strands-agents-tools`）が Agent に追加され、
  プログレッシブ・ディスクロージャーによるスキルの段階的ロードが有効になる。
  `shell` ツールは注入しない（スキルのリファレンスファイルは `file_read` で十分、かつ任意コマンド実行は最小権限の原則に反する）。
- 各レビュアーの `review()` は**同期**実装で、`PRInfoCollector.collect()` と同じく
  `create_github_mcp_client` を `with` で開いて使う（MCP の同期コンテキストマネージャを
  そのまま扱える）。

### 3.3 レジストリ — `registry`

- `@register_reviewer` でレビュアークラスを登録（インスタンスではなくクラス。設定注入は
  オーケストレータが行う）。
- `get_reviewer_classes(project_type, perspectives=None)` が、対象種別に適用され観点フィルタに
  合致するレビュアークラス群を返す。**拡張の中心点**であり、新しいセルの追加はクラス追加 +
  デコレータ登録だけで完結する。
- `detect_project_types(pr_info)` が変更ファイルの拡張子・manifest から種別を推定する。
  `dependency_files` は「PRで変更された」manifest のみのため、`src/*.tsx` だけ変更する典型 PR を
  取りこぼさないよう、TS/JS/JSX の変更があれば（package.json 変更がなくても）react_ts と判定する。
  package.json 単独の変更（依存更新）も単体で該当する。明示指定がない場合のデフォルト選択に使い、
  将来種別の判定分岐はここに足す。なお現状は PR 変更ファイルのみのヒューリスティックで、
  リポジトリ直下 manifest 等のより確実な signal は将来の入力拡張時に取り込む。

### 3.4 オーケストレータ — `ReviewOrchestrator`

- プロジェクト種別（明示 or `detect_project_types`）からレビュアーを選び、共通設定
  `ReviewerConfig` を注入して instantiate。
- `asyncio.gather(asyncio.to_thread(reviewer.review, context), ...)` で**並列実行**する。
  各レビュアーは同期だが、スレッドにオフロードすることで MCP の同期コンテキストマネージャを
  レビュアー単位で隔離しつつ並列性を得る。
- 例外は `ReviewError` に変換して `ReviewReport.errors` に隔離する。1 つのレビュアーの失敗が
  他のレビュアーを巻き込まない。

### 3.5 出力 — `ReviewReport`

`results: list[ReviewResult]` と `errors: list[ReviewError]` を持つ集約結果。
これは将来の Lead Engineer 合成エージェント（spec 3.4）の入力にそのままなる形です。
Lead Engineer 自体は本リリースの対象外です。

---

## 4. 新しい種別 / 観点を追加する手順

### プロジェクト種別を追加する（例: Spring Boot 技術レビュー）

1. `models/review.py` の `ProjectType` に値が無ければ追加（`SPRING_BOOT` は宣言済み）。
2. `agents/reviewers/spring_boot.py` に `LLMReviewAgent` を継承したレビュアークラスを作り、
   `perspective=TECHNICAL`、`project_types={ProjectType.SPRING_BOOT}` を宣言、`@register_reviewer`。
3. `detect_project_types` に判定分岐を追加（例: `pom.xml` / `build.gradle` → SPRING_BOOT）。
4. `agents/reviewers/__init__.py` で import して登録副作用を発火。

オーケストレータ・レジストリ本体は無改修。

### レビュー観点を追加する（例: 仕様整合性）

1. `models/review.py` の `ReviewPerspective` に値が無ければ追加（`SPEC_CONSISTENCY` は宣言済み）。
2. `ReviewContext` に必要な入力（例: `spec_documents`）を追加。
3. その観点のレビュアークラスを作り `perspective=SPEC_CONSISTENCY` で登録。

---

## 5. 未配線の拡張点（本リリースで意図的に未実装）

- **フレームワーク別 ProjectType**: `ProjectType.NEXTJS` 等は宣言済みだが、`detect_project_types()`
  は現状すべてのフロントエンドプロジェクトを `REACT_TS` として返す。`next.config.*` 等の
  manifest を検出して個別に返すよう拡張可能。
- **spec / requirement 入力**: `ReviewContext` の拡張フィールドとして追加予定（4 節参照）。
- **Lead Engineer 合成**: `ReviewReport` を入力とする合成エージェントを別途実装予定。

> **実装済みに変更（旧「未配線」）**: 参照ドキュメント取得は `AgentSkills` と
> `src/code_review_agent/skills/` 内のスキルパッケージ（reviewing-universal / reviewing-languages
> / reviewing-frameworks / reviewing-metaframeworks）として実装した。`FrontendReviewer` は
> `skills_dir` を設定済みで、GitHub MCP + `file_read` / `shell` ツールとともに動作する。

---

## 6. 関連ドキュメント

- 由来の記録: [docs/review-agent-workflow-spec.md](review-agent-workflow-spec.md)
- 要件検証基準: [evaluation/EVALUATION_PLAN.md](../evaluation/EVALUATION_PLAN.md)
- 評価実行手順: [evaluation/RUNBOOK.md](../evaluation/RUNBOOK.md)
