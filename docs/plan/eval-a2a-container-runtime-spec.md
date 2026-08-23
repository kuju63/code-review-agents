# 評価パイプラインのA2Aサーバー コンテナ実行化 変更の影響範囲 (Python版)

設計: [docs/eval-a2a-container-runtime-spec.md](../eval-a2a-container-runtime-spec.md)

- `evaluation/tools/run_agent_evaluation.py`: `--server-pid-file`・`_shutdown_server()`・
  `signal` importを削除。`main()` の `finally`/`shard_validation_ok` を撤去し、
  shard引数バリデーションのエラーハンドリングのみを残す。
- `.claude/skills/run-evaluation/SKILL.md`: Step 1にpodman前提チェックを追加、
  Step 3/5をscript呼び出しに置換、Step 4から `--server-pid-file` を除去。
- `evaluation/RUNBOOK.md` §4a、`docs/eval-sharded-execution-spec.md` 2.3節:
  `--server-pid-file` を前提にした記述を新方式に合わせて更新。
