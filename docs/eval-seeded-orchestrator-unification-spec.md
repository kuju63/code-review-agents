# Seeded評価を`/orchestrator`単一呼び出しへ統合する 設計ドキュメント

関連Issue: #237（本実装）、#238（フォローアップ: 検出バグ修正）

---

## 1. 背景

`evaluation/tools/run_agent_evaluation.py`には、GoldSetとSeeded setで別々の評価経路が
あった。

- `evaluate_gold_item()`: `{base_url}/orchestrator`への単一A2A呼び出しで完結。サーバ側
  (`src/code_review_agent/api/agents/orchestrator.py::_run()`)がPRInfoCollector →
  ReviewOrchestrator(`detect_project_types`による自動stack検出) → LeadEngineerAgentを
  1バックグラウンドタスクで実行する。
- `evaluate_seeded_item()`: クライアント側が`/pr-info-collector` → `item["stack"]`を
  `_technical_reviewer_endpoint()`で解決した`/{stack}-reviewer`+`/security-reviewer`の
  並列呼び出し → `/lead-engineer`の3段階を手動オーケストレーションする。

この分岐は、Seededが「合成diff注入PR」(`build_seeded_set.py`のmutation-injection方式)
だった頃、`file_changes`をpr-info-collectorの応答に対して上書きする必要があったことに
由来する。Issue #224でSeededのデータソースが専用リポジトリ
(`kuju63/{react,vue,angular,svelte}-seeded`)上の実PRに移行し、この上書きロジックは
既に削除された。[docs/eval-seeded-repo-based-generation-spec.md](eval-seeded-repo-based-generation-spec.md)
§6には、その時点で「`evaluate_gold_item()`と構造的に近くなるが、統合はしない」という
判断が記録されていた。理由はただ一つ、EVALUATION_PLAN.md §4のRelease Gate要件
（stack別ルーティング + fail-closed要件）を満たすため、クライアント側の明示的
ルーティングを維持する必要があったからである。

## 2. 決定

`file_changes`上書き削除後、`evaluate_gold_item()`と`evaluate_seeded_item()`は
「owner/repo抽出 → `/orchestrator`へPOST → `_to_predictions`」という完全に同一の
ロジックに帰着する。ユーザーは、EVALUATION_PLAN.md §4のstack別明示ルーティング要件を
撤回し、Gold同様`detect_project_types`による自動検出のみに一本化する方針を明示的に
選択した。これにより両関数を統合する構造的な理由が生まれたため、`evaluate_item()`
という単一関数にマージする。

これは重複コードの表面的な類似ではなく、統合後は完全に同一のロジックになるための
統合であり、早すぎる抽象化には当たらない。

## 3. 実装

### 3.1 `evaluation/tools/run_agent_evaluation.py`

- 削除: `_STACK_TECHNICAL_REVIEWER_ENDPOINT`、`_technical_reviewer_endpoint()`、
  `evaluate_seeded_item()`。
- `evaluate_gold_item()`を`evaluate_item()`にリネーム。処理内容(owner/repo split →
  `/orchestrator`へPOST → `_to_predictions(lead_data, item["id"])`)は変更なし。
- `_run_evaluation()`内の2箇所の呼び出し(Gold用・Seeded用)をどちらも
  `evaluate_item(...)`に変更する。
- `item["stack"]`/`item["file_changes"]`フィールドは`seeded_set.jsonl`のスキーマ上
  残るが、このスクリプトでは完全に未使用になる(データセット生成時のメタデータとして
  のみ意味を持つ)。

### 3.2 テスト — `tests/evaluation/tools/test_run_agent_evaluation.py`

- 削除: `TestSeededItemReviewerParallelism`、`TestEvaluateSeededItemStackRouting`、
  `TestTechnicalReviewerEndpoint`(対応する実装が消えるため)。
- 新規`TestEvaluateItem`を追加(`evaluate_gold_item`は従来ゼロカバレッジだった):
  1. `_run_a2a`が`f"{base_url}/orchestrator"`と
     `{owner, repo, pr_number, model_id}`のペイロードで正確に1回呼ばれること。
  2. `item["id"]`が`_to_predictions`に正しく渡ること。
  3. Gold形状のitem(`stack`/`file_changes`キーなし)とSeeded形状のitem
     (`stack`/`file_changes`あり)の両方で同じ呼び出しパターンになり正常終了すること。
  4. `stack`が未知の値または欠落していても例外を投げず正常評価されること(削除される
     fail-closedテストの裏返しとしての回帰ガード)。

## 4. 既知の逸脱（Issue #238で解消予定）

`/orchestrator`が使う自動stack検出(`detect_project_types`、
`src/code_review_agent/agents/registry.py`)は、Angular→Svelte→Vue→React_TSの順に
manifestファイル名または拡張子で判定する。Seeded set 59件の実`file_changes`に
このロジックを適用すると、55件は`stack`ラベルと一致するが、4件で誤判定が発生する:

| 項目 | 誤判定結果 | 原因 |
|---|---|---|
| `svelte-seeded#8` | `REACT_TS` | 変更ファイルが`.svelte`を含まず、リポジトリに`svelte.config.js/.ts`も不在 |
| `svelte-seeded#9` | `REACT_TS` | 同上 |
| `vue-seeded#16` | `REACT_TS` | 変更ファイルが`.vue`を含まず、`vue.config.js/.ts`が`pr_info_collector.py`の`_DEPENDENCY_FILENAMES`に未登録のためmanifest検出が構造的に不能 |
| `vue-seeded#20` | `REACT_TS` | 同上 |

`SecurityReviewer`は4スタック全てを`project_types`に持つため、この誤判定の影響を
受けない。`SvelteReviewer.review()`(`src/code_review_agent/agents/reviewers/svelte.py`
75行目)は`project_type`引数を無視して独自に`detect_project_types`を再実行する
自己ガードを持つため、svelte#8/#9では技術レビューが完全にスキップされる(空findings)。

`score_evaluation.py`はレビュアー選択の正しさ自体を検査しないため、Release Gateの
数値はこの誤判定の有無に関わらずPASSしうる。EVALUATION_PLAN.md §4の
「Seeded items must route to the technical reviewer matching their stack label」
は文言を変更していないが、この4件については現時点で未達である。この逸脱は
EVALUATION_PLAN.md §5に期限付きの既知逸脱として明記し、Issue #238で追跡する。
Issue #238解消後、EVALUATION_PLAN.md §5の当該段落は削除する。

## 5. タイムアウト予算への影響

Seeded項目は従来、`pr-info-collector`/技術+security並列/`lead-engineer`という
3回の個別polled A2A呼び出しにそれぞれ`--timeout`(デフォルト1800秒)の予算があったが、
統合後はこの3段階全てが1つの`/orchestrator`タスク内(1800秒)に収まる必要がある。
従来余裕があった項目でもタイムアウトする可能性があるため、Seeded項目のタイムアウト
発生率が上がる場合は`--timeout`引き上げを検討する。`evaluation/RUNBOOK.md` §4a近傍に
一行の注記を追加済み。shardの計算式自体はこの変更による影響を受けない。

## 6. テスト方針

§3.2の通り。加えて、リポジトリ全体で`evaluate_seeded_item`/`_technical_reviewer_endpoint`
への参照が残っていないことをgrepで確認する。

## 7. ロールバック計画

`evaluate_item()`統合前のコミット(spec baseline)に戻せば、`evaluate_gold_item`/
`evaluate_seeded_item`の分離実装と対応するテストが復元される。ドキュメント変更
(EVALUATION_PLAN.md §5、`eval-seeded-repo-based-generation-spec.md` §6/§9、
`seeded-reviewer-stack-routing-spec.md`のsuperseded注記、本ファイル)も同一コミットに
含まれるため、単一のrevertで一貫した状態に戻る。

## 8. 関連ドキュメント

- [evaluation/EVALUATION_PLAN.md](../evaluation/EVALUATION_PLAN.md) §4(Release Gate)・§5(評価パスの前提)
- [docs/eval-seeded-repo-based-generation-spec.md](eval-seeded-repo-based-generation-spec.md) §6(判断の反転を記録)
- [docs/seeded-reviewer-stack-routing-spec.md](seeded-reviewer-stack-routing-spec.md)(§6/§8がsuperseded)
- [docs/evaluation-pipeline-design.md](evaluation-pipeline-design.md)(シーケンス図・レビュアー選択の説明を更新)
- [evaluation/RUNBOOK.md](../evaluation/RUNBOOK.md) §4a(タイムアウト予算の注記)
