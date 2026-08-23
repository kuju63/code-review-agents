# Seeded set生成: 専用Seedリポジトリ方式 実装計画

関連Issue: #224(親)、#225(Angular)、#226(React)、#227(Svelte)、#228(Vue)
設計: [docs/eval-seeded-repo-based-generation-spec.md](../eval-seeded-repo-based-generation-spec.md)

## テスト方針

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
- `run-agent-evaluation.ts`(`evaluateItem()`): `item.repository`をowner/repoに分割し
  `{owner, repo, prNumber: item.pr_number}`(`options.modelId`設定時は`modelId`も含む)を
  `sendTask()`で`/orchestrator`にPOST、`pollTask()`で完了を待ち、
  `toEvaluationFormat(report, item.id)`で`PredictionRow`に変換して返すことを検証する
  (`run-agent-evaluation.test.ts` `describe("evaluateItem")`)。`item.stack`/
  `item.file_changes`はstack別ルーティングに使わず参照もしない(データセット生成時の
  メタデータとしてのみ意味を持つ)。
  (歴史的経緯: Python版は`evaluate_seeded_item()`が個別のstack別ルーティングを持ち、
  2026-08-08、Issue #237で`evaluate_gold_item()`と統合されて`evaluate_item()`になった。
  その後TS移行で現行の`evaluateItem()`に置き換わった。詳細は
  [docs/plan/eval-seeded-orchestrator-unification-spec.md](eval-seeded-orchestrator-unification-spec.md)。)
- `test_pr_info_collector.py`: `.vue`拡張子ケースを追加。

`tests/evaluation/tools/test_build_seeded_set.py`は全面書き換えとする。

## 移行チェックリスト・作業順序

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
4. `evaluateItem()`簡略化 + `describe("evaluateItem")`のテスト追加 → コミット。完了条件:
   - 処理内容(owner/repo split → `sendTask()`で`/orchestrator`へPOST → `pollTask()`で
     完了待ち → `toEvaluationFormat(report, item.id)`で`PredictionRow`化)は変更しない。
   - `item.stack`/`item.file_changes`は`seeded_set.jsonl`のスキーマ上は残すが、
     本関数では一切参照しない(データセット生成時のメタデータとしてのみ意味を持つ)。
   - 正常系はGold形状(`stack`/`file_changes`キーなし)・Seeded形状(両キーあり)の
     どちらでも同一の呼び出しパターンで完了する。`stack`が未知の値または欠落していても
     例外を投げず正常評価される(fail-closedにしない)。
   - `describe("evaluateItem")`の必須アサーション:
     1. `sendTask()`が`{owner, repo, prNumber: item.pr_number}`
        (`options.modelId`設定時は`modelId`も含む)のペイロードで`/orchestrator`へ
        正確に1回POSTされること。
     2. `item.id`が`toEvaluationFormat()`経由で`PredictionRow.id`に正しく渡ること。
     3. Gold形状・Seeded形状の両方のitemで同じ呼び出しパターンになり正常終了すること。
     4. `stack`が未知の値または欠落していても例外を投げず正常評価されること
        (Python版`evaluate_seeded_item()`側にあったfail-closedテストの裏返しとしての
        回帰ガード)。
   (歴史的経緯: 本チェックリスト策定時点の対象はPython版`evaluate_seeded_item()`だったが、
   2026-08-08、Issue #237で`evaluate_gold_item()`と統合され`evaluate_item()`になり、
   その後TS移行で現行の`evaluateItem()`に置き換わった。詳細は
   [docs/plan/eval-seeded-orchestrator-unification-spec.md](eval-seeded-orchestrator-unification-spec.md)
   §3.1/3.2。)
5. `pr_info_collector.py`の`.vue`追加 + テスト → コミット。
6. `run_evaluation_pipeline.sh` + `seeded_item.schema.json` +
   `EVALUATION_PLAN.md` + `RUNBOOK.md` + 廃止ヘッダー2件 → コミット。
7. `seeded_mutations.json`削除、`build_seeded_set.py`の旧mutation関数完全除去 →
   コミット。
8. `uv run pytest` / `uv run ruff check` / `uv run ruff format --check`
   全通過を確認 → 最終コミット。
