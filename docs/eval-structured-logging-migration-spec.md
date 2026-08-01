# 評価パイプライン: 構造化ロギングへの移行 設計ドキュメント

`evaluation/tools/` 配下の進捗・警告・エラー出力を `print()` から標準 `logging`
モジュールへ移行する。開始・終了時刻(`%(asctime)s`)とログレベル
(`%(levelname)s`)をメッセージごとに自動付与できるようにするのが目的。

---

## 1. 背景と問題

`evaluation/tools/` は現状 `print()` ベースの進捗・警告表示が主体で、`logging`は
`build_seeded_set.py`・`score_evaluation.py`・`discord_notify.py`・
`discover_candidate_prs.py` の4ファイルに部分的に存在するのみで、実際の出力の
大半は `print` のままである。時刻は記録されず、エラー/警告の区分は
`[WARN]`/`[ERROR]`/`[FATAL]` のような文字列プレフィックスを手作業で埋め込む
運用になっている。

`docs/eval-concurrent-log-attribution-fix-spec.md`(2026-07)は
`run_agent_evaluation.py` の並行実行時に、コンソールログ上の失敗項目の見た目が
実際に失敗した項目と食い違って見えるバグを `print` + `threading.Lock` の
最小修正で直した。同ドキュメントの「対象外」節では「構造化ロギング
(JSON Lines化等)への変更は行わない」と明記しているが、本ドキュメントは
その判断を明示的に覆すものである(理由: 開始・終了時刻とレベル区分を
継続的に必要とする運用上の要求が生じたため)。

---

## 2. 設計方針

### 2.1 stdout/stderrの分離を不変条件とする

**stdoutは機械可読データ専用、ログは全てstderrへ。**

`logging.StreamHandler()` のデフォルト出力先は `sys.stderr` であり、stdout用の
ハンドラを追加しない限りこの分離は自動的に成り立つ。これにより既存の2箇所の
「他プロセスが `subprocess.run(capture_output=True)` → `json.loads(stdout)` で
読む」契約を壊さずに済む:

- `score_evaluation.py` の `print(json.dumps(report, ...))` ―
  `generate_evaluation_report.py:_score()` が `json.loads(result.stdout)` で読む
- `select_stack_targets.py` の `print(json.dumps(summary, ...))`
  (`--print-summary` 時) ― 呼び出し側・テストが `json.loads(stdout)` で読む

**この2箇所のprintだけは変更しない。** 両ファイルのそれ以外の診断・警告
メッセージは全て `logging` に変換する。

### 2.2 共通ロギング設定モジュール

`evaluation/tools/eval_logging.py` を新設し、各スクリプトの `main()` 冒頭
(import時ではなく実行時)から呼ぶ:

```python
def setup_logging(level: int = logging.INFO) -> None:
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        force=True,
    )
```

`force=True` により、`discover_candidate_prs.py` の既存 `logging.basicConfig`
呼び出しをこの共通関数に統合しても二重設定にならない(そちらの個別呼び出しは
削除し `setup_logging()` に一本化する)。

### 2.3 ロックとflushの撤去

`run_agent_evaluation.py:_evaluate_concurrently` の `print_lock` と各print呼び出しの
`flush=True` は不要になり削除する。`StreamHandler.emit()` はレコード単位で
flushし、`logging` モジュール自体がハンドラ呼び出しをロックするため、
`nohup ... > file` のバックグラウンド運用でも即時反映される。

### 2.4 subprocess経由の子プロセスstderr継承

`generate_evaluation_report.py:_score()` は `score_evaluation.py` を
`subprocess.run(capture_output=True)` で起動している。`capture_output=True` は
子プロセスのstdout/stderr両方を握り潰すため、`score_evaluation.py` 側に
logging診断を追加してもコンソールには一切表示されない。これを
`stdout=subprocess.PIPE, text=True` に変更し、stderrは継承させて親の
コンソールにそのまま流す。エラー時の例外メッセージは `result.stderr` が
取得できなくなるため、`raise RuntimeError(f"score_evaluation.py failed "
f"(exit code {result.returncode}); see its stderr output above")` に変更する。

### 2.5 プレフィックスの扱い

`[ERROR]`/`[WARN]`/`[FATAL]` は `%(levelname)s` と重複するため除去する。
ただし **`[COVERAGE-WARN]` は文字列としてメッセージ内に残す**
(`.claude/skills/run-evaluation/SKILL.md`、`evaluation/EVALUATION_PLAN.md`、
`evaluation/RUNBOOK.md`、`docs/eval-seeded-set-duplicate-combo-fix-spec.md` が
運用上の目印として文字列参照しているため)。

---

## 3. 対象ファイルと対象外

### 対象(loggingへ変換)

`run_agent_evaluation.py`, `generate_evaluation_report.py`, `score_evaluation.py`
(JSON print以外), `select_stack_targets.py`(JSON print以外),
`discover_candidate_prs.py`, `build_gold_set.py`, `build_seeded_set.py`,
`merge_predictions.py`, `analyze_pr_collector_repeated.py`,
`measure_pr_info_response.py`, `verify_a2a_api.py`,
`verify_pr_collector_repeated.py`, `a2a_client.py`

### 対象外(変更しない)

- `score_evaluation.py` のJSON結果print(§2.1)
- `select_stack_targets.py` の `--print-summary` JSON結果print(§2.1)
- `discord_notify.py`(既に`logging.warning`のみで`print`なし)
- `target_criteria.py`(printなし)

---

## 4. テスト

`capsys` で `print` の文言を検証しているテストは、`caplog`
(`caplog.set_level(logging.INFO)` を明示)へ書き換える:

- `tests/evaluation/tools/test_run_agent_evaluation.py`
  (`test_failure_log_line_is_self_contained_under_concurrency`) ―
  `[r.getMessage() for r in caplog.records if r.levelno == logging.WARNING]`
  のように書き換え、「1件の失敗が1レコードとして自己完結する」という
  `eval-concurrent-log-attribution-fix-spec.md` の回帰防止意図は維持する。
- `tests/evaluation/tools/test_generate_evaluation_report.py`
- `tests/evaluation/tools/test_merge_predictions.py`
- `tests/evaluation/tools/test_build_seeded_set.py`
- `tests/evaluation/tools/test_select_stack_targets.py` ― JSON部分
  (`--print-summary`)は `capsys` のまま維持。それ以外の警告系のみ `caplog` 化。

他に `capsys` 依存があれば同様に洗い出して `caplog` 化する。

---

## 5. 検証手順

1. `uv run pytest tests/evaluation/`
2. `uv run ruff check`
3. `uv run ruff format --check`
4. `run_agent_evaluation.py` 等の小規模実行で、コンソール出力に
   `%(asctime)s %(levelname)s` 形式の時刻・レベル区分が出ること、
   `score_evaluation.py`/`select_stack_targets.py` のJSON出力を読む既存の
   連携が壊れていないことを確認する。

---

## 6. 関連ドキュメント

- `docs/eval-concurrent-log-attribution-fix-spec.md` ― 本ドキュメントが
  「対象外」節の判断を覆す旨の補足注記を追加済み。
