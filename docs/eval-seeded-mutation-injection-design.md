# Seeded set生成: mutation注入ロジック 要件と設計ドキュメント

2026-07-08評価 (`evaluation/data/report_*.md`; `evaluation/data/` は `.gitignore` の
`evaluation/data/` エントリで除外される生成物のためリポジトリには含まれず、
`bash evaluation/tools/run_evaluation_pipeline.sh` 等の再実行で再現できる) で
Critical Miss Rate = 1.000 となった要因分析 (5whys) の結果、
Seeded set側の見逃し (`js_eval_injection` ×2件) の真因は
個別ルールの不備ではなく、`evaluation/tools/build_seeded_set.py` の mutation 注入ロジック
(`inject_patch()` / `get_snippet_for_lang()`) が持つ構造的な限界であることが分かった。
本ドキュメントはこの注入ロジックが満たすべき要件と、決定論的アプローチ・LLM推論的アプローチを
組み合わせたハイブリッド設計を定義する。

**実装ステータス**: Issue #110 (親) / #111 (Phase1) / #112 (Phase2) で管理。
Phase1 (3.1節: `language_snippets`必須化、挿入位置ヒューリスティック改善、行番号再計算) は
実装済み。Phase2 (3.2節: LLM推論 + 決定論的事後検証) も実装済み (Issue #112)。
`evaluation/tools/build_seeded_set.py` に `MutatedPatchOutput` / `make_llm_mutation_generator` /
`verify_diff_parses` (V1) / `verify_only_additions_changed` (V2) / `verify_required_tokens` (V3) /
`verify_runtime_consistency` (V4) / `recompute_injected_line` / `passes_post_generation_checks` /
`render_seeded_item_from_llm` / `render_seeded_item_with_generation` を追加し、
`evaluation/config/seeded_mutations.json` の全5ルールに `required_tokens` を追加した。
`tests/evaluation/tools/test_build_seeded_set.py` に対応するテスト (hoppscotch#6171相当の
LLM経路/フォールバック経路ゴールデンテストを含む) を追加済み。3.2.5節の差分再生成スキップ
(既存seeded itemの再生成をスキップするキャッシュ機構) は本実装のスコープ外とし、
将来のフォローアップ課題として残す。

---

## 1. 背景と問題

**注記**: 本節 (1.1〜1.4) は2026-07-08評価で発覚した根本原因分析であり、
Phase1着手前の状態を記述している。1.2の挿入位置ロジックの問題、および1.3の
`language_snippets`未定義・`window.location`混入は、いずれもPhase1実装
(Issue #111、3.1節参照) で解消済み。以下は「なぜPhase1が必要だったか」の
記録として現在時制のまま残す。

### 1.1 発覚した事象

`evaluation/data/seeded_set.jsonl` の `js_eval_injection` (severity: critical) 2件について、
Agentが対象ファイルの脆弱性注入行を一度も指摘できなかった。

- `seeded::hoppscotch/hoppscotch#6171::js_eval_injection::.../published-docs.resolver.ts`:
  Agentは17件のfindingsを返したが、全て mutation 対象外のファイル (`infra-config.service.ts`
  等、元PR本来の変更) に関するものだった。
- `seeded::vuetifyjs/vuetify#22788::js_eval_injection::.../VDataTableFooter.tsx`:
  Agentは対象ファイル自体には言及したが、注入行 (13行目) とは異なる行 (74/120/26/36/92等)
  を指摘し、severityも全てlowだった。

両者はいずれも7/7評価の同一パターンと一致しており、単発の失敗ではなく再現性のある問題である。

### 1.2 直接原因: `inject_patch()` の挿入位置ロジック

`evaluation/tools/build_seeded_set.py:78-103`

```python
def inject_patch(
    original_patch: str,
    line_snippet: str,
    context_lines: list[str] | None = None,
) -> tuple[str, int]:
    patch_lines = original_patch.splitlines()
    if not patch_lines:
        return original_patch, 1

    # Find a reasonable injection point after first hunk header.
    insert_idx = 1 if patch_lines[0].startswith("@@") else 0
    ...
```

挿入位置 (`insert_idx`) は、パッチの先頭行がhunkヘッダー (`@@` 始まり) であればその直後
(`insert_idx=1`)、そうでなければパッチの先頭 (`insert_idx=0`) に固定されている。実データ
(`gold_pr_set.jsonl` の全31 file_changes) ではpatchは常に `@@` 始まりであるため実質的に
前者のケースのみが発生するが、実装上はこの条件分岐が存在する。いずれの場合も多くは
import文の並びであり、コードの意味的文脈 (関数本体・条件分岐・実際に到達可能な処理フロー) を
一切考慮しない。実データで確認すると、`published-docs.resolver.ts` では import文の途中に
割り込む形で構文的に浮いたコードとして挿入されている。

このロジックは `js_eval_injection` 専用ではなく、`seeded_mutations.json` の5ルール
(`js_eval_injection` / `frontend_innerhtml_xss` / `react_useeffect_missing_dep` /
`frontend_n_plus_one_api` / `b2b2c_idor_hint`) すべてが `render_seeded_item()` 経由で共有して
いる (`b2b2c_idor_hint` も `language_snippets` の有無に関わらず挿入位置は同じ `inject_patch()`
に従うため対象から除外できない)。つまり今回可視化されたのは氷山の一角であり、
**mutation注入パイプライン全体が抱える構造的限界**として扱う必要がある。

### 1.3 副次的原因: `language_snippets` 未定義によるランタイム不整合

`evaluation/config/seeded_mutations.json` の `js_eval_injection` ルールには
`language_snippets` が定義されておらず、`get_snippet_for_lang()`
(`evaluation/tools/build_seeded_set.py:106-108`) は対象言語を問わず単一の `line_snippet` を
流用する。

```json
{
  "context_lines": ["const userInput = new URLSearchParams(window.location.search).get('q');"],
  "line_snippet": "const result = eval(userInput);"
}
```

`window.location` はブラウザのグローバルオブジェクトであり、NestJS (Node.jsサーバーサイド) の
`published-docs.resolver.ts` には存在し得ない。5ルール中 `b2b2c_idor_hint` のみ
`language_snippets` を定義済みで、残り4ルール (`js_eval_injection` 含む) は未定義のままである。

### 1.4 制約: 入力はunified diff patchのみ

`evaluation/data/gold_pr_set.jsonl` の `file_changes` は `path` と `patch` (unified diff) のみを
持ち、full file content・ASTは持たない。

```python
>>> list(file_changes[0].keys())
['path', 'patch']
```

このため、決定論的ロジック単体では「関数境界」「実行パス上の到達可能性」を正確に判定する情報が
原理的に不足する。これは後述の設計方針 (決定論だけで完全解決は困難、LLM推論の併用が必要) の
直接的な根拠になる。

---

## 2. 要件: mutation注入ロジックが満たすべき性質

| # | 性質 | 説明 | 現状 |
|---|---|---|---|
| R1 | 到達可能性 | 注入コードが実行されうる制御フロー上に存在すること。未使用の孤立文であってはならない | 不充足 (1.2) |
| R2 | 意味的整合性 | 変数・スコープ・対象言語のランタイム (ブラウザ/Node.js/等) に矛盾がないこと | 不充足 (1.3) |
| R3 | 文脈的自然さ | PRが実際に触れている変更ブロックの一部として現れ、唐突なグローバルAPI呼び出しの浮遊行にならないこと | 不充足 (1.2) |
| R4 | must_find行番号の正確性 | 挿入位置がどこであっても、挿入後patchにおける行番号を機械的に再計算できること | **不充足** (下記注参照) |
| R5 | 検出難易度の妥当性 | 実際の脆弱性が持つ「見つけやすさ」の分布に近いこと。過度な埋没・過度な露出のどちらも評価の妥当性を損なう | 未評価 (指標なし) |
| R6 | 再現性 | 同じ `--seed` で同じ結果になること | 充足 (現行の `rnd.shuffle` ベース、LLM併用時は別途担保が必要) |
| R7 | カタログ完全性 | 全ルールが対象言語ごとの妥当なsnippetを持つこと | 不充足 (1.3、5ルール中1のみ定義。ただし後述の注釈参照) |

R1〜R3は1.4の制約により決定論的ヒューリスティックのみでは限界がある。R7は決定論のみで解決可能。
R5は今回の分析で発見された新規の観点であり、既存の評価指標体系 (`EVALUATION_PLAN.md`) には
含まれていないため、本設計のスコープ外だが将来的な指標追加候補として記録する。

**R4に関する注 (レビューで発見)**: 現行の行番号計算式

```python
injected_line = base_line + len(context_lines or [])
```

は `insert_idx` が常に「hunkヘッダー直後」(`insert_idx=1`) に固定されていることを暗黙の前提と
している。実際に手計算で検証すると、挿入点がhunkヘッダーからN行離れた位置に動く場合、この式は
破綻する。正しくは、ヘッダーから挿入点までの新ファイル側の行数
(コンテキスト行 `" "` と追加行 `"+"` の合計。削除行 `"-"` は新ファイルの行番号を消費しないため
数えない) を積算した上で `base_line` に加算する必要がある。3.1.2 (挿入位置ヒューリスティック
改善) を導入する場合、この行番号再計算ロジックの書き換えが**必須の一部**であり、独立した改善では
ない。3.1.2で改めて扱う。

**R7に関する注 (レビューで発見)**: 唯一 `language_snippets` を定義済みの `b2b2c_idor_hint` は、
実際には全言語 (js/jsx/ts/tsx/vue/svelte) に同一文字列を複製しているだけで、ランタイム別に
内容を分岐させた実例にはなっていない。「既存の良い先例」として扱うのは誤りであり、Phase 1
実装時にゼロから設計する必要がある。

---

## 3. ハイブリッド設計

決定論的アプローチだけでは R1-R3 を十分に満たせない (1.4) 一方、LLM推論のみに依存すると
再現性 (R6) とコスト・レイテンシの問題が生じる。そのため2フェーズに分割し、
決定論的処理をLLM生成物の**事後検証・安全網**として使う構成とする。

### 3.1 Phase 1: 決定論的改善 (即座に着手可能) — 実装済み (Issue #111)

`evaluation/tools/build_seeded_set.py` に `split_hunks` / `select_target_hunk` /
`find_insertion_point` / `parse_hunk_new_start` / `count_new_lines_before` /
`validate_catalog` を追加し、`inject_patch()` を書き換えた。
`evaluation/config/seeded_mutations.json` の全5ルールに `language_snippets` /
`runtime` を追加し、`window.` / `document.` 参照を排除した (`b2b2c_idor_hint` は
フレームワーク別イディオムでゼロから再設計)。`tests/evaluation/tools/test_build_seeded_set.py`
に回帰テスト (hoppscotch#6171 published-docs.resolver.ts 相当の2hunkサンプル、
`must_find` 行番号の手検算一致を含む) を追加済み。

#### 3.1.1 `language_snippets` の必須化 (R7)

- `seeded_mutations.json` の全ルールに `language_snippets` を必須項目とする。
- ルールに `runtime: "browser" | "node" | "universal"` メタデータを追加し、
  対象言語ごとにランタイムに矛盾しないsnippetを用意する
  (例: `js_eval_injection` のNode向けは `window.location` の代わりに
  `req.query.q` 相当のNode.js的な入力源を使う)。
- `build_seeded_set.py` に起動時バリデーションを追加し、`languages` に含まれる言語のうち
  `language_snippets` が欠けているものがあれば生成をエラー終了させる
  (現状のように黙って `line_snippet` にフォールバックしない)。

#### 3.1.2 挿入位置ヒューリスティックの改善 (R1・R3の部分対応)

- **hunk選択**: 実データで確認した通り、gold PRのfile_changesの21ファイルは複数hunk構成
  (例: `hoppscotch/hoppscotch#6171` の `onboarding.dto.ts` は4hunk)。現行 `inject_patch()` は
  `patch_lines[0]` のみを見て常に最初のhunkに注入しているが、これは「importの変更だけの
  hunk」を選んでしまう可能性がある。改善後は、各hunkの追加行 (`+`) 数が最も多いもの
  (= 実質的な変更が集中しているhunk) を優先的に選択する。
- **hunk内の挿入位置**: 選んだhunk内で追加された (`+`) 行のうち、文の終端パターン
  (`;` 終わりの式文、`{` 直後など) にマッチする行の直後に注入する簡易構文チェックに置き換える。
- **行番号再計算 (R4対応、必須)**: 挿入位置が変わることで、上記「R4に関する注」の通り
  現行の `base_line + len(context_lines)` は使えなくなる。選択したhunkのヘッダーから挿入点
  までを走査し、コンテキスト行 (`" "`) と追加行 (`"+"`) の数を積算して新ファイル側の行番号を
  求める処理に置き換える。複数hunkパッチの場合は、選択したhunk自身のヘッダー
  (`@@ -a,b +c,d @@`) の `c` を起点にする。
- 実行パスの正確な到達可能性までは保証できないが、「import文の合間に浮く」という
  最も分かりやすい異常は解消できる。

#### 3.1.3 限界

full ASTがない制約 (1.4) により、Phase 1はあくまで「明らかな異常の除去」に留まる。
R1 (到達可能性) と R3 (文脈的自然さ) の本質的な改善にはPhase 2が必要、というのが
本分析の結論である。

### 3.2 Phase 2: LLM推論 + 決定論的事後検証

#### 3.2.1 生成フロー

1. **入力**: 対象file_changeのpatch全文、rule定義 (`rule_id` / `summary` / 脅威パターンの意図)。
2. **LLMへの指示**: 「このdiffのhunk内に脆弱性パターンを自然に挿入せよ。ただし
   (a) 既存の実行フローに組み込み孤立文にしない、
   (b) 対象言語のランタイムに矛盾しないAPIを使う、
   (c) 周辺コードと変数名・スコープを整合させる、
   (d) unified diff形式 (追加行のみ) を厳密に守る」。
3. **出力**: 構造化出力 (Pydanticスキーマ) で「変更後patch全文」「挿入行番号」
   「到達可能と判断した根拠」を返させる (フィールド定義は3.2.2)。
4. **事後検証**: 3.2.3の4項目を機械的にチェックし、不合格ならPhase 1ロジックへ
   フォールバックする (3.2.3)。
5. **確定**: 合格したLLM生成物、またはフォールバックしたPhase 1生成物を
   `seeded_set.jsonl` に書き出す。どちらの経路で生成されたかはitemごとに
   メタデータとして残す (3.2.7)。

以下は上記フローの俯瞰図である。

```mermaid
flowchart TD
    A["file_change × rule\n(patch全文 + rule定義)"] --> B["LLM生成\n(構造化出力)"]
    B --> C{"事後検証\n(3.2.3の4項目)"}
    C -- 全項目合格 --> D["LLM生成物を採用\n生成元: llm"]
    C -- いずれか不合格 --> E["Phase 1決定論ロジックへ\nフォールバック (再生成なし)"]
    E --> F["Phase 1生成物を採用\n生成元: deterministic_fallback"]
    D --> G["seeded_set.jsonl に確定\n(ビルド時1回限り、以後キャッシュ)"]
    F --> G
```

#### 3.2.2 構造化出力スキーマ (フィールド定義)

LLMには以下の3フィールドを持つ構造化出力を返させる (Pydanticモデルとしての実装は
実装フェーズで行うため、本節ではフィールドの意味・型・制約のみを定義する)。

| フィールド | 型 | 意味 | 生成時の制約 |
|---|---|---|---|
| `mutated_patch` | 文字列 (unified diff全文) | 脆弱性パターンを注入した後のpatch全文 | 元patchの各hunkに対する変更は追加行 (`+`) の挿入のみであること (hunkヘッダー `@@ ... @@` 自体は挿入位置に応じて書き換わってよい)。既存の削除行・コンテキスト行の書き換えを含んではならない (3.2.3で機械検証) |
| `injected_line` | 整数 (新ファイル側の1始まり行番号) | 注入したコードが新ファイル上で位置する行番号 | `must_find` の算出に用いるため、`mutated_patch` 中の実際の追加行位置と一致すること |
| `reachability_rationale` | 文字列 (自由記述、簡潔な説明) | なぜその挿入位置が実行パス上到達可能と判断したか | 空文字列を許容しない。事後検証では機械的に真偽判定しない (人手レビュー・ログ用途の記録項目) |

`reachability_rationale` は事後検証の合否判定には使わない (自由記述をルールベースで
検証するのは非現実的なため)。到達可能性 (R1) の担保は「LLMへの指示」と
「事後検証で明らかな異常を排除すること」の組み合わせで行い、本フィールドは
生成過程の説明可能性を残すための記録に留める。

**`injected_line` に関する注 (実装時に発見)**: 上表は「`mutated_patch` 中の実際の
追加行位置と一致すること」を生成時の制約として課しているが、これはLLMへの指示に
すぎず、3.2.3のV1〜V4のいずれもこの一致を機械的に検証していない。`injected_line`は
未検証のLLM自己申告値であり、これをそのまま`must_find`に採用すると、
R4 (must_find行番号の正確性、2節の要件表および「R4に関する注」参照) がLLM経路では
再び担保されないまま出荷される — まさに本ドキュメント全体の発端となった
行番号ズレ問題を一段階上で再発させることになる。そのため実装では`injected_line`を
`must_find`の算出に用いず、`mutated_patch`と元patchの差分から新規追加行のブロックを
特定した上で、Phase1の`parse_hunk_new_start`/`count_new_lines_before`
(3.1.2実装済み) を用いて新ファイル側の行番号を決定論的に再計算する
(`recompute_injected_line()`、V2で確立した「追加行のみの差分」であることを前提に
動作する)。変更されたhunkが一意に特定できない場合、または新規追加行が非連続な
場合はNoneを返し、Phase1へのフォールバックとして扱う。`injected_line`自体は
構造化出力のフィールドとしては残すが、LLMの推論過程を記録する目的
(`reachability_rationale`と同様の位置づけ) にとどめ、`must_find`の算出には使わない。

#### 3.2.3 決定論的事後検証 (安全網、必須)

LLM生成物はそのまま採用せず、以下4項目を機械的に検証する。**いずれか1つでも不合格なら
Phase 1の決定論ロジックにフォールバックする**(再生成のリトライは行わない。系統Aで確認済みの
「モデル依存の不安定さ」を評価データセット生成側に持ち込まないため)。

| # | 検証項目 | 入力 | 合格条件 | 不合格時 |
|---|---|---|---|---|
| V1 | diff構文パース可否 | `mutated_patch` | hunkヘッダー・追加/削除/コンテキスト行として構文的に解釈できる (3.1.2で導入済みの `split_hunks` 系ロジックを再利用、後述) | フォールバック |
| V2 | 追加行以外の非改変 | `mutated_patch` と元patchの差分 | 元patchに存在した削除行・コンテキスト行がそのまま残っており、新規追加行 (`+`) 以外に変更がない | フォールバック |
| V3 | 必須トークン含有 | `mutated_patch` の追加行、ruleの `line_snippet` 相当の必須トークン (例: `eval(`) | 追加行のいずれかに必須トークンが含まれる | フォールバック |
| V4 | ランタイム整合性 | `mutated_patch` の追加行、対象ファイルの `runtime` (`browser`/`node`/`universal`、3.1.1参照) | 禁止APIリスト (例: Node向けファイルへの `window.`/`document.` 系API) に抵触しない | フォールバック |

**V1の実装方針 (未決定事項の解消)**: 元設計では「diffパースライブラリ (`unidiff` 等) を
新規導入するか、自前実装するか」を未決定事項としていたが、3.1.2で `split_hunks` /
`find_insertion_point` / `parse_hunk_new_start` / `count_new_lines_before` を既に自前実装済み
(Phase1、Issue #111) であるため、これらをV1の検証にもそのまま再利用する方針とする。
新規外部依存 (`unidiff` 等) は追加しない。理由は次の比較表の通り。

| 案 | 採用/却下 | 理由 |
|---|---|---|
| (A) Phase1の自前hunk走査ロジックを再利用 | **採用** | 3.1.2で実装済みの行番号走査ロジックと実質的に同じ処理であり、車輪の再発明を避けられる。新規依存が増えないためpyproject.tomlの依存管理・脆弱性スキャン対象も増えない |
| (B) `unidiff` 等の外部ライブラリを新規導入 | 却下 | Phase1で既に同等機能を実装済みであり、追加のメリットが薄い。新規依存はCVEスキャン対象を増やし、コンテナイメージの脆弱性管理方針とも整合しない |

#### 3.2.4 再現性の担保 (R6)

- 生成はビルド時の1回限りのオフライン処理とし、結果を `seeded_set.jsonl` として
  固定する (gold PRが更新されない限り再生成しない)。評価実行のたびにLLMを呼び出さない。
  ここで言う「固定」は生成物の内容を確定させキャッシュとして扱うことを指し、それを
  Git管理対象にするか (現状 `.gitignore` の `evaluation/data/` エントリによりコミット対象外)
  は別の論点である。
  Git管理対象にするかどうかの判断は4節「対象外」を参照。
- `--seed` は「どの (file, rule) ペアを選ぶか」(`enumerate_combo_pool` → `rnd.shuffle`) の
  決定論性にのみ使用する。snippet生成 (LLM呼び出し) 自体の再現性は、生成物を
  固定した成果物として扱うことで担保する。
- **モデル構成を変更した場合の扱い**: 3.2.6で導入する生成用モデル (`--model-id`/`--llm-base-url`)
  を変更した場合、同じ (file, rule, seed) の組でも生成結果が変わりうるため、既存の
  `seeded_set.jsonl` キャッシュはモデル変更前の生成物のままでは整合しない。

  | 案 | 採用/却下 | 理由 |
  |---|---|---|
  | (A) キャッシュキーに生成モデルIDを含めない。モデル変更時は運用者が手動で `seeded_set.jsonl` を削除・再生成する | **採用** | 生成はビルド時1回限りのオフライン処理という前提 (3.2.4冒頭) と整合する。モデル切替は頻繁に起きる操作ではなく、自動キャッシュ無効化の仕組みを持ち込むと再現性 (R6) の担保ロジック自体が複雑化する |
  | (B) `seeded_set.jsonl` の各itemにモデルIDを埋め込み、実行時に現在の設定と突合して自動再生成する | 却下 | 実装複雑度に見合うメリットが薄い。3.2.6のモデル分離はバイアス低減が目的であり、頻繁なモデル切替を前提とした運用ではない |

  採用した(A)のもとでは、生成モデルを変更した場合は運用者が明示的に再生成する必要がある旨を
  `evaluation/RUNBOOK.md` (実装時) に明記する。

#### 3.2.5 コストとレイテンシ

file_changes数 × rule数のオーダーでLLM呼び出しが発生するため、`build_seeded_set.py` の
実行時間は増加する。オフライン・オンデマンド生成であり評価実行の都度発生しないため許容するが、
新規gold item追加時の差分再生成 (既存seeded itemの再生成をスキップする仕組み) は
実装時に検討する。

#### 3.2.6 モデル構成: 生成モデルと評価モデルの分離

**背景**: Issue #112本文には明記されていないが、Seeded注入を生成するLLMと、生成物を
間接的に評価する側のLLM (レビュー対象Agent自身、および `score_evaluation.py` の
semantic-judge) が同一モデルに固定されると、そのモデル固有の「書き方の癖」と
「検出の癖」が相関し、評価にモデル依存のバイアスが混入する恐れがある。例えば、
あるモデルが注入する脆弱性コードのスタイルが、そのモデル自身がレビュアーとして
見逃しやすいスタイルと (何らかの理由で) 相関していた場合、評価結果はそのモデルにとって
不当に有利/不利になりうる。このバイアスを避けるため、生成モデルとその他のモデルを
独立して設定可能にする。

現状、本リポジトリには以下3系統のモデル設定が (今回新設する(c)を除き) 存在する。

| # | 用途 | 設定箇所 | 環境変数/引数 | 既定値 |
|---|---|---|---|---|
| (a) | レビュー対象Agent自身 (評価される側) | `src/code_review_agent/api/config.py` (Pydantic Settings, `env_prefix="CODE_REVIEW_"`) | `CODE_REVIEW_MODEL_ID` / `CODE_REVIEW_LLM_BASE_URL` | `gpt-4o` |
| (b) | `score_evaluation.py --semantic-judge` のjudgeモデル | `evaluation/tools/score_evaluation.py` の argparse | `--model-id` / `--llm-base-url` | `gpt-4o` |
| (c) (新設) | Seeded注入生成モデル (Phase2) | `evaluation/tools/build_seeded_set.py` の argparse (新設) | `--model-id` / `--llm-base-url` (CLI優先)、未指定時は `.env` の `SEEDED_GEN_MODEL_ID` / `SEEDED_GEN_LLM_BASE_URL` | 未設定時はエラー終了 (3.1.1のバリデーション方針に倣い、暗黙の既定モデルへのフォールバックはしない) |

**インターフェース案**: `build_seeded_set.py` に `score_evaluation.py` と同じ命名パターンの
`--model-id` / `--llm-base-url` を追加する。CLI引数が明示された場合はそれを優先し、
省略時のみ `.env` の `SEEDED_GEN_MODEL_ID` / `SEEDED_GEN_LLM_BASE_URL` を読む
(`load_dotenv()` は既に `build_seeded_set.py` の `main()` 冒頭で呼ばれている)。

**選択肢比較表 + 採用/却下理由**:

| 案 | 採用/却下 | 理由 |
|---|---|---|
| (A) 生成専用の環境変数/CLI引数を新設し、(a)(b)から完全に独立させる | **採用** | モデル依存バイアスの分離という目的そのものに直接応える。(a)(b)を一切変更せずに済み、既存の設定体系への影響がない |
| (B) 既存 `CODE_REVIEW_MODEL_ID` を生成モデルとしても流用する | 却下 | レビュー対象Agentのモデルを切り替えるたびにSeeded生成モデルも連動して変わってしまい、「生成モデル固定・レビュー対象モデルのみ変える」比較実験ができない。バイアス分離という目的に反する |
| (C) `score_evaluation.py` の semantic-judge 用 `--model-id` を共用する | 却下 | judgeモデルは評価スコアリング側の設定であり、生成モデルと結合すると「同じモデルが注入し、同じモデルが(間接的に)判定を補助する」経路が残る。判定は最終的にjudgeモデルのsummary類似度計算を経由するため、(A)と比べてバイアス分離の効果が弱い |

**運用上の推奨 (強制はしない)**: 生成モデル (c) とレビュー対象/judgeモデル (a)(b) には
異なるプロバイダまたは異なるモデルファミリを設定することを推奨する。強制しない理由は、
コスト・可用性の制約 (オフライン環境やAPIクォータの都合) で同一モデルしか使えない
運用も現実には存在するため。

#### 3.2.7 生成メタデータの記録

事後検証 (3.2.3) を経て確定したitemには、`seeded_set.jsonl` の各行に生成元を示す
メタデータ (例: `generation_source: "llm" | "deterministic_fallback"`) を付与する設計とする。
理由: 事後検証がどの程度の頻度でLLM生成物を不合格としフォールバックしているかを
後から追跡できないと、「LLM推論が実際にR1/R3をどれだけ改善しているか」を評価できない
(3.1.3で述べた「明らかな異常の除去止まり」というPhase1の限界に対し、Phase2がどこまで
前進したかを測る手段が必要)。この項目は5節の検証観点にも追加する。

---

## 4. 対象外

- 本ドキュメントは要件と設計方針の合意を目的とし、実装そのものは含まない。
- R5 (検出難易度の妥当性) の定量指標化は本設計のスコープ外。将来的に
  `evaluation/EVALUATION_PLAN.md` への指標追加を検討する候補として記録するに留める。
- 系統A (モデルの構造化出力信頼性、`StructuredOutputMissingError`) への対応は本ドキュメントの
  対象外。別途 `docs/granite-structured-output-failure-spec.md` の延長で扱う。
- `evaluation/data/seeded_set.jsonl` は生成物であり `.gitignore` の `evaluation/data/`
  エントリによりコミット対象外となっている
  (ディレクトリの役割分担自体は `docs/evaluation-pipeline-design.md` #2参照)。
  Phase 2導入後はLLM生成物を含むため、再現性確保の観点からコミット対象に変更するか
  どうかは実装時に別途判断するが、変更する場合は `.gitignore` 側の除外解除
  (例外パターンの追加、あるいは `evaluation/data/` からの退避) も併せて必要になる。

---

## 5. 検証観点 (実装時のテスト方針)

`tests/evaluation/tools/test_build_seeded_set.py` への追加を想定。

- **Phase 1**:
  - カタログバリデーション: `language_snippets` 欠落ルールがある場合に生成がエラー終了すること。
  - 挿入位置ヒューリスティック: 既知のhunkサンプルに対し、注入行が「文の終端パターン」の
    直後に配置され、import文ブロックの中間に挿入されないこと (回帰テストとして
    `published-docs.resolver.ts` の実データを固定サンプル化)。
  - `must_find` の行番号が新しい挿入位置に対して正しく再計算されること (R4)。
- **Phase 2**:
  - 決定論的事後検証の各チェック (diff構文・追加行のみ・必須トークン・ランタイム整合性) が
    単体で不正なLLM出力を検出できること (モックしたLLM応答で異常系を再現)。
  - 事後検証不合格時にPhase 1へフォールバックし、生成が失敗しないこと
    (seeded setがゼロ件にならないことの保証)。
  - 同一入力 (gold item, rule, seed) に対し、生成物をキャッシュ済みファイルから
    再現できること (LLM呼び出しをモックし、キャッシュヒット時にLLMが呼ばれないことを検証)。
  - 生成元メタデータ (`generation_source`) が、LLM生成物採用時は `"llm"`、
    フォールバック時は `"deterministic_fallback"` として正しく記録されること (3.2.7)。
  - Seeded生成モデル (`--model-id`/`--llm-base-url`、3.2.6) が未指定かつ
    `SEEDED_GEN_MODEL_ID` も未設定の場合にエラー終了すること (暗黙の既定モデルへ
    フォールバックしないことの確認)。
- **回帰**: 過去の見逃し2件 (hoppscotch#6171 / vuetify#22788) を新ロジックで再生成し、
  注入位置が意味のある場所になっていることを確認するゴールデンテストを追加する。

---

## 6. 今後の進め方

CONTRIBUTING.md のSpec-Driven + TDDフローに従い、以下の順で進めることを提案する。

1. 本ドキュメントの内容についてIssue化 (Phase 1 / Phase 2 を別Issueに分割することを推奨。
   Phase 1は決定論のみで完結し着手コストが低く、Phase 2はLLM呼び出し基盤の設計が別途必要なため)。
2. Phase 1をTDDで実装し、既存の `seeded_set.jsonl` を再生成して回帰確認。
3. Phase 2は事後検証ロジックを先に実装 (Red/Green容易) してから、LLM生成部を追加する。

---

## 7. Phase 2運用後に判明した問題 (Issue #131)

**実装ステータス**: Issue #131で管理。本節で示す対応方針は合意済みであり、
実装は本節の記述に従って進める。

### 7.1 事象と非開発者向け要約

Phase 2 (3.2節) が稼働を開始した後の評価データ再構築 (Issue #127でLLM呼び出しの
turn/timeoutガードを追加した後の再構築) で、18件中15件が`generation_source:
"deterministic_fallback"`となり、Phase 1のロジックにフォールバックした。
LLM推論 (Phase 2) の採用率はわずか3/18 (約17%) に留まり、本ドキュメント3.2節が
目指した「決定論だけでは満たせないR1 (到達可能性)・R3 (文脈的自然さ) の改善」が
ほとんど発揮されていない状態だった。

**注記**: Issue #127自体はLLM呼び出しがハングせず高速に成功/失敗するように
修正するものであり、この事象を生み出した原因ではない。#127以前は同じ不合格が
「ハングして進まない」という形で隠れていたに過ぎず、#127はそれを可視化した
だけである。

非開発者向けに言い換えると、次のような矛盾が起きていた。

> LLMに「`await`という単語を使った一文を追加してください、ただし既存の行は
> 一切書き換えないでください」と依頼するのは、「本の途中に、まだその章が
> 説明していない前提を要求する一文を書き足してください、ただし前後の文章は
> 一字一句変えないでください」と依頼するようなものである。`await`という単語が
> 意味を持つには、それを含む処理のまとまり (関数) が「これは非同期処理です」
> (`async`) と宣言されていなければならない。その宣言を書き換えることは
> 「既存の行を変えない」という安全装置によって禁止されている。つまり、
> 2つの依頼は原理的に両立しない場合がある。

```mermaid
flowchart TD
    A["LLMへの指示(a)\n必須トークン`await`を含めよ"] --> C{"両立不可能な場合がある"}
    B["LLMへの指示(d)\n既存行は一切変更するな"] --> C
    C --> D["LLMは(a)を優先し\n関数をasync化"]
    D --> E["V2(追加行以外の非改変)が不合格"]
    E --> F["Phase1へフォールバック\n(繰り返し発生)"]
```

### 7.2 原因分析: 構造的原因(6/7件)と書式差(1/7件)の分離

fallback対象7件を個別に再実行し、V1〜V4の真偽値と生LLM出力を計装して調査した
結果、原因は性質の異なる2種類に分かれることが分かった。これらを混同すると
「V2全体を緩めればよい」という誤った結論に至るため、明確に分離して扱う。

| # | 分類 | 該当件数 | 直接原因 | 対応の方向性 |
|---|---|---|---|---|
| A | 構造的原因 | 6/7 | `frontend_n_plus_one_api`/`b2b2c_idor_hint`の`required_tokens`が`\bawait\b`という**周囲スコープ (囲む関数のasync/sync) に依存するトークン**を要求し、対象コードが同期のアロー関数(式本体)である場合、LLMが関数をasyncのブロックボディへ書き換えてしまう | V2は変更せず、**カタログ(要求トークン・snippet)側**を自己完結する形に改訂する (7.3, 7.4) |
| B | 書式差によるfalse negative | 1/7 | 意味的には正しい注入だが、インデント幅・末尾セミコロンの差のみで`_hunk_added_indices`の完全一致比較(`line == original_hunk[oi]`, `build_seeded_set.py:611`)に失敗する | V2の比較ロジックを空白/セミコロンについてのみ限定的に緩和する (7.4) |

Aの根本原因は、`candidate_files`/`enumerate_combo_pool` (`build_seeded_set.py:806-839`)
がファイル拡張子のみでcandidateを選ぶこと (対象コードが同期関数か非同期関数かを
一切見ていない) と、mutationカタログの`required_tokens`が周囲スコープに依存する
トークンを要求すること、の組み合わせにある。V2 (`verify_only_additions_changed`)
自体は「LLM生成物の安全網」として意図通りに機能しており、むしろ**この矛盾した
要求を正しく検出して落としている**、というのが本節の評価である。

### 7.3 新しい設計原則: スニペットの自己完結性

2節 (R1-R7) には無い観点として、次の原則を新設する。

> **自己完結性の原則 (本ドキュメントでは便宜上R8と呼ぶ)**: mutation注入用の
> snippetは、挿入先の関数が同期・非同期いずれであっても、周囲のコードを
> 一切変更せずに構文的に妥当な独立した文/ブロックでなければならない。
> `required_tokens`は、周囲のスコープ宣言に依存するトークン (例: 囲む関数が
> `async`であることを要求する`await`) を含んではならない。

R1 (到達可能性)・R3 (文脈的自然さ) はLLM推論に委ねる領域として3.2節で
既に整理済みだが、「snippet自体が周囲のスコープに要求を課すかどうか」は
LLM推論の巧拙とは独立した、**カタログ設計時点で機械的に守れる制約**である。
これがR1-R7に無かったのは、5節時点ではまだフォールバック率の実測データが
無く、Phase 2稼働後に初めて可視化された問題だったためである (伏線としては
1.4節の「決定論的ロジック単体ではR1・R3を十分に満たせない」という記述が、
LLM推論側にも別の形で制約を課すことを示唆していたと言える)。

### 7.4 対応方針

#### 7.4.1 V2 (`verify_only_additions_changed`) への対応: 構造的原因には手を入れない

分類A (6/7件) に対してV2を緩めることは採用しない。理由:

- V2の「追加行のみの差分」制約は、3.2.3節が明言する通り「モデル依存の
  不安定さを評価データセット生成側に持ち込まない」ための安全網であり、
  Issue #131の受け入れ基準「V2の緩和により、意図しない構造改変まで誤って
  許容してしまわないことをテストで担保する」とも整合する。
- 分類Aの真因はV2の検証ロジックではなく、V2と両立しない要求をカタログ側が
  課していたことにある (7.2)。V2を緩めると、本来検出すべき「意図しない
  構造改変」まで通過させてしまうリスクがあり、Phase 2の設計思想そのものを
  損なう。

一方、分類B (書式差1/7件) はV2の実装上の狭い改善対象として扱う。
`_hunk_added_indices` (`build_seeded_set.py:584-619`) の完全一致比較
`line == original_hunk[oi]` を、diffマーカー (`+`/`-`/` `) を除いた本文部分に
ついて「前後空白の正規化 + 末尾セミコロンの有無を無視」した比較に限定して
緩和する。

この緩和が分類Aのケース (アロー関数の式本体 → asyncブロックボディという
構文自体の変更) を誤って通過させないことは、行の"内容"自体が変わる
(トークン列が異なる) ため空白/セミコロン正規化では吸収されない。
これを実データ (gitbutler `main.ts`相当) の回帰テストで保証する (7.8)。

#### 7.4.2 カタログ改訂: `frontend_n_plus_one_api` / `b2b2c_idor_hint`を自己完結化

**`b2b2c_idor_hint`**: IDOR (認可バイパス) の本質は「IDに基づく直接アクセスに
所有者検証がない」ことであり、`await`か`.then()`かという非同期処理の書き方は
本質と無関係である。`required_tokens`から`\bawait\b`を削除し`\.then\(`のみとし、
`language_snippets`も`await`を使わない`.then()`単独の文に書き換える。

**`frontend_n_plus_one_api`**: こちらは「逐次 (sequential) API呼び出し」という
意味論自体がN+1問題の本質であり、`.then()`をループ内に単純に並べると並行実行に
なってしまい意味が変わる。しかし「Promiseチェーンを明示的に繋ぐ」書き方であれば、
`await`なしで逐次性を保ったまま自己完結できる。

| ルール | 変更前 (スコープ依存) | 変更後 (自己完結) |
|---|---|---|
| `frontend_n_plus_one_api` | `for (const id of ids) { await api.get('/items/' + id); }` | `let chain = Promise.resolve();`<br>`for (const id of ids) { chain = chain.then(() => api.get('/items/' + id)); }` |
| `b2b2c_idor_hint` | `const resource = await fetch('/api/items/' + params.id).then((r) => r.json());` | `fetch('/api/items/' + params.id).then((r) => r.json());` |

変更後の`required_tokens`は次の通り (両ルールとも`\bawait\b`を削除):

| ルール | 変更後required_tokens |
|---|---|
| `frontend_n_plus_one_api` | `\bfor\s*\(`, `\.then\(` |
| `b2b2c_idor_hint` | `\.then\(` |

トレードオフとして、`frontend_n_plus_one_api`は`for...of`+`await`より
やや冗長になり、R3 (文脈的自然さ) がわずかに下がる可能性がある。これは
自己完結性を満たせない構成 (=構造改変を誘発しV2に落ちて結局Phase1に
フォールバックする構成) よりは優先すべきトレードオフとして許容する。

#### 7.4.3 カタログバリデーションの追加 (再発防止)

`validate_catalog()` (`build_seeded_set.py:299-434`) に、既存の
`_FORBIDDEN_GLOBAL_RE`チェック (browser global禁止、R2) と同じ位置づけで、
自己完結性 (R8) を機械的にチェックする項目を追加する。

> `required_tokens`に`\bawait\b`(または同種のスコープ依存トークン) に
> マッチするエントリがあり、かつ対応する`language_snippets`/`line_snippet`
> 自体が`async`を含まない (= 自前でasyncスコープを内包していない) 場合、
> カタログバリデーションエラーとしてビルドを失敗させる。

これにより、将来同種の非互換なルールがカタログに追加された場合、実行時の
V2フォールバック多発という間接的な症状ではなく、ビルド時の明示的なエラーとして
即座に検出できる。

### 7.5 対象外とした案とその理由: candidate選定のasyncスコープ考慮

Issue #131の対応方針の叩き台(2) (`candidate_files`選定時に対象コードが
既にasync/awaitパターンを含む箇所を優先する) は採用しない。

理由: 入力がunified diff patchのみという制約 (1.4節) の下では、diffの
断片から「挿入位置が本当にasync関数のスコープ内か」を確実に判定する情報が
原理的に不足する場合がある (該当hunkに関数シグネチャ自体が含まれない
ケースがありうる)。7.4.2のスニペット自己完結化により、この判定自体が
不要になる (どんなスコープに挿入しても構文的に妥当) ため、根本解決として
7.4.2を優先し、candidate選定の変更は対象外とする。

将来、file_changesの入力にfull file content/ASTが追加されるような設計変更が
別途行われるのであれば、そのときはcandidate選定側でのスコープ判定も
再検討の余地がある (残る限界として7.9に記録する)。

### 7.6 Issue対応方針(3)の採用可否: 逆方向を採用した理由

Issue #131の対応方針の叩き台(3)は「`b2b2c_idor_hint`の`required_tokens`から
`.then(`を外し`await`単独にする」というものだった。本設計は**この逆
(`await`を外し`.then(`のみにする)を採用する**。

理由: `await`はスコープに依存するため自己完結性 (R8) を満たせないが、
`.then()`はどんな関数 (同期/非同期問わず) にも追加できる独立した文であり、
V2のadditions-only制約と両立する。issueの提案をそのまま採用すると、
分類A (6/7件、7.2節) の根本原因である「`await`要求」をむしろ全ルールに
広げてしまい、フォールバック率を悪化させる方向に働くため採用しない。

### 7.7 計測可能性: `generation_source`比率を評価指標に昇格

現状`generation_source`はitemごとに記録されるのみで (3.2.7節)、集計指標・
受け入れ基準は`EVALUATION_PLAN.md`/`RUNBOOK.md`のいずれにも存在しない。
Issue #131の受け入れ基準「fallback率が計測可能な形で低下する」を検証可能に
するため、`evaluation/EVALUATION_PLAN.md`の「3.2 Seeded Metrics」に次の指標を
追加する。

- **LLM Adoption Rate**: `llm`件数 / 全seeded件数 (全体、および`rule_id`別内訳)

具体的な数値目標(閾値)はissue本文が明示する通り「着手時に合意」であり、
本設計では指標の定義と算出方法を定めるに留め、閾値はハードコードしない。
`evaluation/RUNBOOK.md`のSeeded set構築手順にも、ビルド後に比率を確認する
手順を追記する。

### 7.8 検証観点 (実装時のテスト方針)

`tests/evaluation/tools/test_build_seeded_set.py`への追加を想定。

- `_hunk_added_indices`の空白/セミコロン正規化比較について:
  - 意味的に等価だがインデント幅・末尾セミコロンのみ異なる行 (bitwarden
    `index.d.ts`相当) がacceptされること。
  - 構造改変 (アロー関数の式本体 → asyncブロックボディ、gitbutler `main.ts`
    相当) は引き続きrejectされること (空白正規化では吸収されないことの確認)。
- `validate_catalog`の自己完結性チェックについて:
  - `required_tokens`に`\bawait\b`を含み、かつsnippetに`async`を含まない
    ルールがカタログバリデーションエラーになること。
  - `async`を自前で内包するsnippet (将来的な例外パターン) はエラーに
    ならないこと。
- 改訂後の`frontend_n_plus_one_api`/`b2b2c_idor_hint`について:
  - 新snippetが新`required_tokens`を満たすこと (V3)。
  - 新snippetをinjectした`mutated_patch`がV2 (additions-only) を通過すること。
- 回帰: Issue #131が報告した7件の再現ケースを固定サンプル化し、新ロジックで
  分類A (6件) は引き続きfallback (V2 reject) することを確認し、分類B (1件)
  はLLM経路が採用されることを確認する。

### 7.9 残る限界

- 自己完結性 (R8) を満たせないmutationタイプが将来カタログに追加された場合
  (例: 変数のスコープ自体を書き換える必要がある脆弱性パターン)、7.4.2と
  同様の「snippet再設計による回避」が常に可能とは限らない。その場合は
  V2の検証ロジック自体の拡張 (許容する書き換えパターンをホワイトリスト化する
  等) が必要になる可能性があるが、これは本節の対象外とし、発生時に
  改めて設計を行う。
- 7.5で対象外とした「candidate選定のスコープ考慮」は、入力データ形式
  (unified diff patchのみ) が変わらない限り恒久的な対象外ではなく、
  1.4節の制約が変化した場合に再評価すべき項目として記録しておく。
