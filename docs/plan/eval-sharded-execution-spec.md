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

加えて実環境検証(外部プロセス連携を伴う変更のため任意ではなく必須)。以下はPython版
`run_agent_evaluation.py`の`--shard-index`/`--shard-count`を前提とした旧手順を、現行TS実装
(`packages/evaluation/src/run-agent-evaluation.ts`)向けに置き換えたものである
——TS版はshard指定フラグを持たないため(§2.2の分割ロジックはPython版限定)、
shard分割はgold/seeded入力JSONLを事前に手動で4分割したファイルを渡すことで代替する:

> A2Aサーバーの起動方法によって`--base-url`/healthの実際の待受先が変わる点に注意すること。
> `.claude/skills/run-evaluation/scripts/start_a2a_container.sh`はコンテナ起動後
> `http://localhost:8000/health`を待ち受けるが、現行サーバー(`packages/a2a-server/src/index.ts`)
> は`:3000`で待受け`/health`もマウントしていない、既知の未解決事項である
> ([docs/a2a-api-design.md](../a2a-api-design.md) §1)。解消済みか実際に疎通確認してから
> 以下を実行すること。

1. A2Aサーバーを起動する。gold/seeded入力JSONLを4分割したファイル(shard0〜shard3)を
   事前に用意し、shardごとに`tsx packages/evaluation/src/run-agent-evaluation.ts
   --seeded <shard>.jsonl [--gold <shard>.jsonl] --pred shard{N}.jsonl
   --base-url <実際の待受先>`を4回実行する(対象件数の合計が24件になることをログで確認)。
2. `tsx packages/evaluation/src/merge-predictions.ts --gold <full>.jsonl
   --seeded <full>.jsonl --output agent_predictions.jsonl
   shard0.jsonl shard1.jsonl shard2.jsonl shard3.jsonl`で4shard分をマージし、
   exit code・summaryを確認する。
3. `tsx packages/evaluation/src/generate-evaluation-report.ts`でMarkdownレポートと
   (設定していれば)Discord通知が生成されることを確認する。
4. 生成された `agent_predictions.jsonl`・スコアが、非shard実行(単一プロセスでのフル実行)の
   結果と一致すること(または既知の非決定要素の範囲内であること)を比較確認する。
5. 非shard実行(既存コマンドそのまま)を1回実行し、出力ファイル・終了コード・コンソール出力が
   従来と変わらないことを確認する(リファクタリングの回帰確認)。
