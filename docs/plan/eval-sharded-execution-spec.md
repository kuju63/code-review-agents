# 評価パイプラインのshard分割実行 実装計画・検証記録 (Python版)

設計: [docs/eval-sharded-execution-spec.md](../eval-sharded-execution-spec.md)

## テスト

`tests/evaluation/tools/test_run_agent_evaluation_shard.py`:
- `_select_shard`: 境界値(shard-count=1、最終shardの余り件数)、全shard分を合算すると
  Gold/Seededそれぞれの原集合と重複・欠落なく一致することの回帰
- `_validate_shard_args`: 片方だけ指定/範囲外indexでエラーになることの確認
- shard指定時に `generate_evaluation_report.py` へのsubprocess呼び出しが発生しないこと、
  非shard時は発生することの確認(monkeypatchで検知)
- failed_ids sidecarの書き込み内容(空/一部失敗)の検証

`tests/evaluation/tools/test_generate_evaluation_report.py`(`test_build_report.py` から移動):
- 既存の `_build_report`/`_score` 系テストをそのまま維持(移動元が変わるだけで意味は変わらない)
- failed_ids sidecar読み込み(存在時/欠如時のwarnフォールバック)を追加

`tests/evaluation/tools/test_merge_predictions.py`(新規):
- 正常マージ(2shard、重複・欠落なし)で元のgold+seeded順にpredictionsが書き出されること
- id重複 → fatal(exit 2)、マージファイルは書き出さない
- 未回収id(sidecarにもpredictionsにも現れない) → `--allow-missing` なしでfatal(exit 2)
- 同条件で `--allow-missing` あり → warnで継続、exit 1、マージ済みfailed_ids sidecarに反映
- 既知の失敗id(sidecarに記録済み)のみ欠落 → `--allow-missing` なしでも正常マージ、exit 1
- shard sidecarファイル自体が存在しない場合 → そのshard分のidは「未回収」として扱われ、
  デフォルトでfatalになること

## 検証手順

```bash
uv run pytest
uv run ruff check
uv run ruff format --check
```

加えて実環境検証(外部プロセス連携を伴う変更のため任意ではなく必須):

1. A2Aサーバーをローカル起動し、`--shard-count 4` で `--shard-index 0`/`1`/`2`/`3` を
   それぞれ指定して `run_agent_evaluation.py` を4回実行
   (各回が実際にサーバーを停止しないこと、レポート生成subprocessが呼ばれないこと、対象件数が
   合計24件になることをログで確認)
2. `merge_predictions.py` で4shard分をマージし、exit code・summaryを確認
3. `generate_evaluation_report.py` でMarkdownレポートと(設定していれば)Discord通知が生成される
   ことを確認
4. 生成された `agent_predictions.jsonl`・スコアが、非shard実行(`--concurrency 2` フル実行)の
   結果と一致すること(または既知の非決定要素の範囲内であること)を比較確認
5. 非shard実行(既存コマンドそのまま)を1回実行し、出力ファイル・終了コード・コンソール出力が
   従来と変わらないことを確認(リファクタリングの回帰確認)
