# Seeded set生成: 専用Seedリポジトリ方式 設計ドキュメント

関連Issue: #224(親)、#225(Angular)、#226(React)、#227(Svelte)、#228(Vue)

## 1. 背景と問題

現行のSeeded set(意図的に脆弱性・バッドプラクティスを混入させた評価用データ)は、
`evaluation/tools/build_seeded_set.py` がGold PRのunified diffパッチに対して
LLM推論/決定論的にmutationを注入するハイブリッド方式で生成していた。この設計の
経緯は `docs/eval-seeded-mutation-injection-design.md` に記録されている。

5件のIssue(#110/#111/#112/#127/#131)と数ヶ月の調整を経てもなお、fallback率は
目標の30%を安定して下回れず、`.d.ts`型定義ファイルへの`eval()`注入や
CSS-in-JSスタイル定義ファイルへの`useEffect`欠陥注入のような、意味的に成立しない
注入がスコアリングの妥当性そのものを汚染する事象が繰り返し確認された(詳細は
Issue #224本文、2026-08-04実行分レポートの分析を参照)。根本原因は
`candidate_files()`が`is_test_file()`によるテストファイル除外のみを行い、
`.d.ts`・`generated/`配下・CSS-in-JS定義ファイルのような「多くのmutationルールが
前提とする実行文脈を持たないファイル」を除外していないことにあった。

本ドキュメントは、Issue #224の決定事項である**専用Seedリポジトリ方式**への
全面移行の設計を記録する。「実際に脆弱性・バッドプラクティスを盛り込んだPRを
専用リポジトリに用意し、それを実際に検知できるかどうかで性能を検証する」方式へ
切り替えることで、到達可能性(R1)・文脈的整合性(R3)・自己完結性(R8)を
構築時点で完全に制御し、`candidate_files()`のような後付けフィルタや
モデル依存のfallback率に頼る必要をなくす。

## 2. 対象Seedリポジトリと59件のPR

対象は現在レビュアーが実装済みの4スタック(Angular/React/Svelte/Vue)。各スタックに
専用のGitHubリポジトリを用意し、実際にopen状態のPRとして欠陥を埋め込む
(GitHub MCP経由での収集を前提とするため、ローカルのdiffファイルだけでは不可)。

| スタック | リポジトリ | PR件数 |
|---|---|---|
| Angular | `kuju63/angular-seeded` | 19 |
| React | `kuju63/react-seeded` | 10 |
| Svelte | `kuju63/svelte-seeded` | 17 |
| Vue | `kuju63/vue-seeded` | 13 |

合計59件。内訳・カテゴリラベルはSub-issue #225〜#228のコメントに記載されたものを
一次情報とする。

### 2.1 Angular (`kuju63/angular-seeded`)

- セキュリティ系: XSS(#5)、認可不備(#6)、CSRF(#7)、token保存(#8)
- バッドプラクティス系: #9〜#23(15件、個別ラベルなし、diffから内容を判定する)

### 2.2 React (`kuju63/react-seeded`)

- セキュリティ系: #8〜#11(4件、ラベルなし)
- バッドプラクティス系: #12〜#17(6件、ラベルなし)

このリポジトリのコメントには「現在Openとなっている全PRが評価用PR」と記載されて
いるが、Dependabot等の無関係なPRが将来紛れ込むリスクを避けるため、**Open PR全件を
動的に走査するのではなく、コメントに列挙された番号を静的リストとして扱う**。

### 2.3 Svelte (`kuju63/svelte-seeded`)

- セキュリティ系: 認証情報平文永続化(#5)、DOM-based XSS(#6)、
  フロントエンド依存の認可制御(#7)、クライアントバンドルへの秘密鍵埋め込み(#8)、
  CSP不備・過剰に緩い設定(#9)
- バッドプラクティス系: $effectを状態同期に誤用(#10)、propsオブジェクトの
  再分割代入(#11)、bindableでないpropsの直接mutate(#12)、
  onMount(async)でクリーンアップ喪失(#13)、DOMイベント登録に$effect/onMount(#14)、
  Propsのany化(#15)、keepFocusオプションの誤用(#16)、$stateの分割代入(#17)、
  deep reactivity性能問題(#18)、ストアsubscribe忘れ(#19)、Props Drilling(#20)、
  God Component(#21)

### 2.4 Vue (`kuju63/vue-seeded`)

- セキュリティ系: #8〜#11(4件、ラベルなし)
- バッドプラクティス系: #12〜#20(9件、ラベルなし)

## 3. マーカー構文とnew-file行番号解決アルゴリズム

### 3.1 マーカーの実態(59件全数調査済み)

全59件のPRについて`gh pr diff`で実データを調査した結果、以下が判明している。

- **59/59件全てに`INTENTIONAL`マーカーコメントが存在**(欠損ゼロ)。
- 構文は言語依存: `.ts`/`.tsx`/`.vue`は`// INTENTIONAL`、`.html`は
  `<!-- INTENTIONAL -->`、`.svelte`は`// INTENTIONAL: SEED-nnn`(svelteは
  全件がID付き)。
- マーカー→欠陥行のオフセットは**ほぼ一律+1**(マーカー直後の追加行が欠陥コード)。
  例外は2件:
  - `svelte-seeded#6`: コメントが2行連続するため+2。
  - `react-seeded#8`: マーカーがJSXの`return (`直前にあり、実際の欠陥
    (`dangerouslySetInnerHTML`)まで+2〜3。
- 複数マーカーを持つPRが3件:
  - `vue-seeded#13`: 同一ファイル内に2箇所。
  - `vue-seeded#14`: 2ファイルにまたがり2箇所。
  - `svelte-seeded#16`: 同一`SEED-107`が3ファイルに横展開、3箇所。
  それ以外の56件は全て1PR=1マーカー。
- **svelteの`SEED-nnn`は2系統で番号が衝突している**: セキュリティ系(#5〜#9)は
  `SEED-101`〜`SEED-105`、バッドプラクティス系(#10〜#21)は独立して`SEED-101`から
  採番し直しており、`SEED-101`が#5と#10で重複する。**`SEED-nnn`はrule_idや
  一意キーとして使用禁止**。パース時は`INTENTIONAL(:\s*SEED-\d+)?`として
  読み飛ばす位置アンカーとしてのみ扱う。
- `.d.ts`・`generated/`配下・CSS/SCSSファイルにマーカーが付与された例はゼロ。
  Issue #224が問題視した「到達不能ファイルへの注入」は本セットには存在しない。

### 3.2 行番号の座標系(最重要制約)

`must_find.line`は**new-file(post-image)行番号**でなければならない。
`evaluation/tools/score_evaluation.py`のマッチング規則(path完全一致 + line差±5)は、
GoldセットのGitHub review comment `line`(GitHub REST APIのdiff新ファイル座標系)を
前提に設計されている。Seeded setの`must_find.line`がこれと異なる座標系(diff相対
行番号やold-file行番号)になっていると、スコアリングは静かに失敗する
(単体テストでは検出されない失敗モードである点に注意)。

既存`build_seeded_set.py`の`parse_hunk_new_start()`(ハンクヘッダー
`@@ -a,b +c,d @@`から`c`を取得)と`count_new_lines_before()`(ヘッダーから
対象行までのcontext/added行数を積算)がこの座標系変換ロジックであり、
`inject_patch()`(Phase 1決定論的注入)と`recompute_injected_line()`(Phase 2
LLM生成の事後検証)の両方で共用されていた。新ツールもこの2関数をそのまま移植し、
「マーカー行のインデックス」から「マーカー直後の欠陥行のインデックス」を求めた上で
同じ計算式(`parse_hunk_new_start(header) + count_new_lines_before(hunk, idx) - 1`)
を適用する。

### 3.3 欠陥行解決アルゴリズム

```text
resolve_defect_line(hunk_lines, marker_idx, line_offset=None):
  if line_offset is not None:
      defect_idx = marker_idx + line_offset
  else:
      defect_idx = マーカー行より後の最初の
          「空行でなく、かつコメント行でない」追加行(+行)のインデックス
          (svelte#6の2行連続コメントはこれで自動的に+2相当になる)
  return parse_hunk_new_start(hunk_lines[0]) + count_new_lines_before(hunk_lines, defect_idx) - 1
```

`line_offset`は`react-seeded#8`のみメタデータで明示指定する(実データで`2`固定)。
それ以外の58件は自動解決に委ねる。

## 4. 入力ファイルスキーマ: `evaluation/input/seeded_pr_targets_{stack}.json`

PR番号一覧とmust_findメタデータは1ファイルに統合する。分離すると
「マーカー検出数」と「メタデータのdefects数」の突き合わせバリデーションが
別途必要になり、キーのずれに気づきにくくなるため。

```json
{
  "repository": "kuju63/vue-seeded",
  "stack": "vue",
  "prs": [
    {
      "pr_number": 13,
      "defects": [
        {
          "path": "src/components/UserProfile.vue",
          "occurrence": 0,
          "rule_id": "vue_props_direct_mutation",
          "category": "correctness",
          "severity": "medium",
          "summary": "Directly mutates a non-bindable prop instead of emitting an update event.",
          "line_offset": null
        }
      ]
    }
  ]
}
```

- `occurrence`: 同一`(pr_number, path)`内でのマーカー出現順(0始まり、diff内での
  出現順)。`vue-seeded#13`(同一ファイル2箇所)の曖昧性をこれで解消する。
  `vue-seeded#14`(2ファイル)・`svelte-seeded#16`(3ファイル)は`path`が
  異なるため各`occurrence=0`のままでよい。
- `line_offset`: 省略(`null`)時は3.3節の自動解決に委ねる。`react-seeded#8`のみ
  明示指定する。
- `rule_id`: `js_eval_injection` / `react_useeffect_missing_dep` のような
  既存`seeded_mutations.json`のスネークケース命名規則を踏襲する。`SEED-nnn`は
  使わない(3.1節の衝突理由による)。
- `category`: `security` / `performance` / `correctness` / `maintainability`
  のいずれか。
- `severity`: `critical` / `high` / `medium` / `low`。

ガイド用に`evaluation/schema/seeded_pr_targets.schema.json`を新設する
(既存の`gold_pr_item.schema.json`/`seeded_item.schema.json`と同様、
実行時バリデーションには使わないドキュメント専用スキーマ)。

## 5. `build_seeded_set.py` のCLIとfail-closed仕様

現行ファイルのmutation注入系関数群(`MutatedPatchOutput`、
`make_llm_mutation_generator`、`inject_patch`、`validate_catalog`、
`render_seeded_item*`、`passes_post_generation_checks`ほか約20関数)を削除する。
`split_hunks`・`parse_hunk_new_start`・`count_new_lines_before`のみ座標系変換
ロジックとして移植する。

新規モジュール `evaluation/tools/github_api.py` に、`build_gold_set.py::_api_get`
と同等のGitHub REST API呼び出し(`GET /repos/{owner}/{repo}/pulls/{pr}/files`)を
抽出し、新ツールから利用する。

### 5.1 主要関数

- `detect_intentional_markers(patch: str) -> list[MarkerHit]`:
  `INTENTIONAL(:\s*SEED-\d+)?`を追加行(`+`で始まる行)に対して言語非依存に
  マッチさせ、ハンク内インデックスを返す。
- `resolve_defect_line(hunk_lines, marker_idx, line_offset=None) -> int`:
  3.3節のアルゴリズム。
- `build_seeded_item(target, token) -> dict`: 1PRを取得し、マーカー検出+行解決+
  メタデータ突合でSeeded item(`must_find`は複数要素配列)を構築する。

### 5.2 fail-closedバリデーション(ここで例外を投げてビルドを止める)

- 対象PRのdiff全体で`INTENTIONAL`マーカーが1つも見つからない。
- 検出されたマーカー数とメタデータの`defects`レコード数が一致しない
  (`(path, occurrence)`で対応付け)。
- メタデータの`defects`レコードに対応するマーカーが見つからない。
- マーカーが乗っているファイルが
  `code_review_agent.agents.pr_info_collector.is_target_file()`でFalseになる
  (本番実行時に除外されるファイルにマーカーを置いている)。これが`.vue`拡張子
  バグのような問題の回帰ガードを兼ねる。

旧パイプラインの失敗モードは「静かに壊れる」ことだった(Issue #224本文の
24件除外事象を参照)。新ツールはここで明示的に失敗させることに価値がある。

### 5.3 CLI

```text
usage: build_seeded_set.py --targets PATH [PATH ...] --output PATH
                            [--stacks react,vue,...] [--pr REPO#NUMBER]
                            [--print-markers] [--sleep 0.2]

--targets        seeded_pr_targets_{stack}.json のパス(複数可)
--output         出力Seeded JSONLパス
--stacks         カンマ区切りでスタックを絞り込む
--pr             "kuju63/vue-seeded#13" 形式で単一PRのみ処理(ライブ検証用)
--print-markers  must_find突合をスキップし、検出マーカー一覧を出力して終了
--sleep          API呼び出し間隔(デフォルト0.2秒、build_gold_set.pyに合わせる)
```

`--gold`/`--catalog`/`--multiplier`/`--model-id`/`--llm-base-url`/
`--provider-type`/`--llm-max-attempts`/`--seed`は全廃止。

### 5.4 出力アイテムのid

`id = f"seeded::{repository}#{pr_number}"`(例: `seeded::kuju63/vue-seeded#13`)。
1 Seeded item = 1 PR、`must_find`が複数要素を持てる。`rule_id`や`path`をidに
含めない。`evaluation/tools/score_evaluation.py`が`pred_by_id[row["id"]]`で
突き合わせるため、`run_agent_evaluation.py`側が生成するidと完全一致させる。

## 6. `evaluate_seeded_item()` の簡略化

`evaluation/tools/run_agent_evaluation.py::evaluate_seeded_item()`は現在、
「実PRメタデータ収集 → `file_changes`をmutation注入版で上書き → stack別技術
レビュアー+SecurityReviewer並列実行 → lead engineer統合」の4段構成だった。

専用Seedリポジトリ方式ではSeed PRが実在するPRであるため、
`pr_info_data["pr_info"]["file_changes"]`を上書きするステップは不要かつ有害
(実PRの中身をわざわざ別データで上書きする理由がない)。pr-info-collectorの
応答をそのまま技術レビュアー+SecurityReviewerに渡すだけでよい。

`evaluate_gold_item()`と構造的に近くなるが、統合はしない。EVALUATION_PLAN.md
§4のRelease Gate要件(「Seeded items must route to the technical reviewer
matching their stack label ... plus SecurityReviewer」)により、stack別
ルーティング + SecurityReviewer限定呼び出しという固有スコープを維持する必要が
あるため。`_technical_reviewer_endpoint`と
`docs/seeded-reviewer-stack-routing-spec.md`(Issue #181で実装済み)のルーティング
設計自体は変更しない。

> **判断の反転（2026-08-08更新、Issue #237）**: 上記「統合はしない」の判断は覆した。
> 理由はその根拠だったEVALUATION_PLAN.md §4のstack別明示ルーティング要件自体を、
> ユーザーが「`detect_project_types`による自動検出のみに一本化する」方針に決定した
> ため。この決定により`evaluate_gold_item()`と`evaluate_seeded_item()`(本節で述べた
> file_changes上書き削除後)は文字通り同一の実装(owner/repo抽出→`/orchestrator`へ
> POST→`_to_predictions`)に帰着するため、両者は`evaluate_item()`に統合された。
> `_technical_reviewer_endpoint`と`docs/seeded-reviewer-stack-routing-spec.md`の
> クライアント側ルーティング設計(§6)は削除・supersededとなった。ただし
> `detect_project_types`の自動検出には既知の誤ルーティング(59件中4件、Issue #238)が
> あり、EVALUATION_PLAN.md §4のhard gate文言自体は変更していないため、この4件は
> 期限付きの既知逸脱としてEVALUATION_PLAN.md §5に記録されている。詳細は
> [docs/eval-seeded-orchestrator-unification-spec.md](eval-seeded-orchestrator-unification-spec.md)
> を参照。

## 7. `seeded_item.schema.json` の変更

`base_source`(「Original Gold item id」の説明、Gold itemが存在しなくなるため
意味を失う)、`generation_source`、`reachability_rationale`を削除する。
`must_find`に`minItems: 1`を追加し、複数要素を許容することを明示する
(vue#13/#14、svelte#16の複数マーカーPRのため)。

このスキーマファイルはコードベースのどこからも実行時バリデーションに使われて
いない(grep確認済み)。ドキュメント専用であり、自由に改訂してよい。

`gold_pr_item.schema.json`はGold系列のため変更しない。

## 8. `pr_info_collector.py` の `.vue` 拡張子追加

`src/code_review_agent/agents/pr_info_collector.py`の`_TARGET_EXTENSIONS`
(現状 `.ts .tsx .js .jsx .css .scss .html .svelte`)に`.vue`が欠落している。
これはIssue #224の直接スコープ外の既存バグだが、Vue Seedリポジトリの一部PRの
欠陥ファイルが本番実行時に除外され、Must-Find Recallが構造的に0になるため、
Vue Seed PRを機能させる前提条件として併せて修正する。

`evaluation/tools/target_criteria.py::ALLOWED_EXTENSIONS`(Gold系列が使う
`is_production_code_file`の実体)には既に`.vue`が含まれており、このバグは
本番`pr_info_collector.py`固有である。

## 9. テスト方針

- `detect_intentional_markers()`: `.ts`/`.tsx`/`.vue`の`// INTENTIONAL`、
  `.html`の`<!-- INTENTIONAL -->`、`.svelte`の`// INTENTIONAL: SEED-nnn`各構文の
  検出、マーカーなしpatchで空リスト、複数マーカー(vue#13/#14、svelte#16相当の
  合成fixture)で複数ヒット。
- `resolve_defect_line()`: 標準+1ケース、`line_offset`未指定での空行/コメント
  スキップ(svelte#6相当)、`line_offset`明示指定(react#8相当)、
  `parse_hunk_new_start`/`count_new_lines_before`との結線を検証する回帰テスト
  (new-file行番号であることを直接アサートする)。
- `build_seeded_item()`: 正常系(1マーカー1defect、モックHTTPレスポンス)、
  マーカー0件でのfail-closed、マーカー数≠defects数でのfail-closed、
  `is_target_file()`がFalseを返すファイルにマーカーがある場合のfail-closed
  (`.vue`バグの回帰ガードそのもの)。
- `github_api.py::fetch_pr_files()`: HTTPモックでの正常系。
- CLI: `--print-markers`モードの出力フォーマット、`--pr`単一PR指定、
  `--stacks`フィルタ。
- `run_agent_evaluation.py`: `evaluate_seeded_item()`が`file_changes`を
  上書きしないことを検証するテストを追加。~~既存のstack別ルーティングテストは
  変更不要。~~ (2026-08-08更新、Issue #237で誤り: `evaluate_seeded_item()`自体が
  `evaluate_item()`に統合されたため、stack別ルーティングテストは削除され
  `TestEvaluateItem`に置き換わった。詳細は
  [docs/eval-seeded-orchestrator-unification-spec.md](eval-seeded-orchestrator-unification-spec.md)。)
- `test_pr_info_collector.py`: `.vue`拡張子ケースを追加。

`tests/evaluation/tools/test_build_seeded_set.py`は全面書き換えとする。

## 10. 移行チェックリスト・作業順序

ツール実装を先行させ、メタデータ作成をその出力(`--print-markers`)に依存させる
順序にする。TDD Red→Green→RefactorのサイクルごとにCLAUDE.mdの規約に従い
コミット(ロールバックポイント)する。

1. 本ドキュメント作成 → コミット。
2. `github_api.py` + `build_seeded_set.py`のマーカー検出/行解決/アイテム構築 +
   テスト(Red→Green) → コミット。この時点でメタデータは未作成、
   `--print-markers`のみで動作確認。
3. メタデータ執筆をスタック単位で4コミット(React → Vue → Angular → Svelte)。
   各コミット後に`build_seeded_set.py --stacks <stack>`でfail-closed
   バリデーションを通過させてからコミットする。
4. `evaluate_seeded_item()`簡略化 + テスト → コミット。
5. `pr_info_collector.py`の`.vue`追加 + テスト → コミット。
6. `run_evaluation_pipeline.sh` + `seeded_item.schema.json` +
   `EVALUATION_PLAN.md` + `RUNBOOK.md` + 廃止ヘッダー2件 → コミット。
7. `seeded_mutations.json`削除、`build_seeded_set.py`の旧mutation関数完全除去 →
   コミット。
8. `uv run pytest` / `uv run ruff check` / `uv run ruff format --check`
   全通過を確認 → 最終コミット。

## 11. 対象外

- Gold set系列(`discover_candidate_prs.py`、`repo_candidates.json`、
  `select_stack_targets.py`、`build_gold_set.py`)は変更しない。
- `docs/seeded-reviewer-stack-routing-spec.md`のstack別ルーティング設計自体は
  変更しない(再利用する)。
- 4スタック以外への拡張は考えない。
- EVALUATION_PLAN.md §4のRelease Gate閾値数値そのものの変更判断は本タスクでは
  行わない(母数変化の注記のみ行う)。
