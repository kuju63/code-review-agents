# 評価パイプラインのshard分割実行 設計ドキュメント

OpenCode経由で `evaluation/tools/run_agent_evaluation.py` を実行すると、OpenCode側の実行制約
(呼び出し単位で2時間)に達し、Gold 8件+Seeded 16件=24件の評価パイプラインが完走前にタイムアウト
する問題を解消する設計を定義する。

関連Issue: #177

---

## 1. 背景と問題

`--concurrency`(既定2)、`--timeout`(既定1800秒/件、`run_agent_evaluation.py` L39-40)の
現行設計では、Gold/Seeded合わせて ceil(8/2)+ceil(16/2)=12スロット、理論上最大
12 × 1800秒 = 6時間かかりうる。時間を要するのはA2Aサーバー経由の実評価フェーズ
(`_run_evaluation` 内の `_evaluate_concurrently` によるGold→Seededの逐次実行)であり、
マージやスコアリング(`score_evaluation.py`)自体は軽量である。

OpenCodeの2時間制約は呼び出し(実行)単位でリセットされることを確認済みのため、評価フェーズを
複数回の呼び出しに分割できれば制約内に収まる。

## 2. 設計方針

### 2.1 3スクリプト構成への分割

既存の「1スクリプト=1責務、小さなヘルパー(`read_jsonl` 等)は各スクリプトに個別実装」という
流儀(`build_seeded_set.py`/`score_evaluation.py`/`run_agent_evaluation.py` がそれぞれ独立に
`read_jsonl` を持つ)を踏襲し、共有utilモジュールは新設せず3スクリプトに分割する。

```
run_agent_evaluation.py         A2A評価の実行、predictions + failed_ids sidecarの書き込みのみ
merge_predictions.py (新規)      複数shardのpredictions/failed_idsを統合
generate_evaluation_report.py (新規)  スコアリング・Markdownレポート・Discord通知
```

`run_agent_evaluation.py` から `_score`・`_build_report` とその周辺ヘルパー(`_sanitize_cell`,
`_ref_cell`, `_finding_row`, `_render_item_detail`, `_gold_heading`, `_seeded_heading`、
現行L234-516)を丸ごと `generate_evaluation_report.py` に移す。移動元・移動先ともに関数の実装は
変更しない(純粋な移動)。

非shard実行(既存の使い方)では `run_agent_evaluation.py` が evaluation 完了後に
`generate_evaluation_report.py` をsubprocessで呼び出す。これは既存の `_score` が
`score_evaluation.py` をsubprocessで叩いているのと同じパターンをそのまま踏襲するだけであり、
新しい呼び出し様式を持ち込まない。標準出力・標準エラーは継承させ、コンソール上の見え方は
変更前と同一に保つ。戻り値はsubprocessの終了コードをそのまま使う。

### 2.2 shard分割

`run_agent_evaluation.py` に `--shard-index`(0始まり)・`--shard-count` を追加する。両方指定時、
`gold_items`/`seeded_items` それぞれに対して `items[shard_index::shard_count]` によるラウンド
ロビン分割を適用する(`_select_shard` ヘルパーとして関数化)。Gold/Seededそれぞれを独立に均等分割
するため、全shard分を合算すれば元の集合に過不足なく一致し、shard間の作業量も自然に均等化される。

分割はGold/Seededの各jsonlファイル内でのレコード順序に依存する**位置ベース**の分割であるため、
全shard実行が同一の(byte-identicalな) gold/seeded 入力ファイルに対して行われることが前提となる。

`--shard-index`/`--shard-count` が指定されている場合、`run_agent_evaluation.py` は
`generate_evaluation_report.py` へのsubprocess呼び出しを行わない。専用の「スキップ」フラグは
設けない。shard指定自体が「このshardは部分結果であり、レポート生成は後段(マージ後)で行う」ことを
一意に示すため、フラグを分けると「shard実行なのに指定を忘れる」という運用ミスの余地を生むだけで
ある。

### 2.3 サーバーshutdownの制御

`main()` は `finally` で常に `_shutdown_server(args.server_pid_file)` を呼ぶ(現行L577-580)。
shard実行中にこれが動作すると、shard 0完了時点でA2AサーバーがSIGTERMされ、shard 1のヘルスチェック
(L606-613)が失敗して即エラーになる。
→ `--shard-count` が指定されている場合、`_shutdown_server` の呼び出しを自動的にスキップする
(2.2と同じ理由で専用フラグは設けない)。サーバーは全shard完了後、
`.claude/skills/run-evaluation/SKILL.md` Step 5の既存フォールバック停止で最後に1回だけ止める
運用とする。

### 2.4 failed_ids sidecarと「既知の失敗」「未回収」の区別

`_evaluate_concurrently` は失敗アイテムを `predictions` から単純に除外するのみで、現行の
非shard実行は「一部失敗でもscoreは部分結果として継続、exit code 1」という契約になっている
(L637-643, L677)。この契約自体は変更しない(1件のflaky失敗で全体をブロックしない価値は保つ)。

shard実行が新たに持ち込むリスクは、**OpenCodeの2時間制約そのものによってshardプロセスが実行途中で
killされ、predictionsファイルが一切書き出されないまま終わる**ケースである。この場合、そのshardが
担当していたidは「失敗として記録された」のではなく「存在の痕跡を残さず消える」。これを個別アイテム
の既知の失敗と同列に「warnして続行」してしまうと、このIssueの引き金である環境要因(実行時間制約に
よる強制終了)がサイレントに評価結果を欠損させうる。

そのため:

- `run_agent_evaluation.py` は predictions書き込み直後、常に `failed_ids` を
  sidecarファイル(`{output}.failed_ids.json`、`_failed_ids_path` ヘルパーで命名規則を統一)として
  書き出す(shard/非shard問わず。既存動作への影響はない)。
- `merge_predictions.py` は「期待id集合(Gold+Seeded全体) − (統合predictionsのid ∪ 全shardの
  failed_idsの和集合)」を**未回収**と定義し、**デフォルトでfatal**(exit 2)として扱う。
  `--allow-missing` を明示指定した場合のみwarnに降格して続行する(opt-out)。
- id重複(複数shardファイルに同一idが存在)は常にfatal。shard-count設定ミスやファイルの混在を
  示すため、opt-outの対象にしない。
- predictions中のidがGold+Seededの期待id集合に一つも含まれない場合も常にfatal(`--allow-missing`
  でも緩和しない)。これは「shardが遅延評価をkillされた」とは別種の異常(誤った`--gold`/`--seeded`
  の組み合わせを渡した等のデータ不整合)であり、`--allow-missing`が想定する「部分結果の許容」とは
  性質が異なるため、常に検出する。
- shardのfailed_ids sidecarファイル自体が存在しない場合も、そのshard担当id全体を「未回収」として
  扱う(特別扱いで緩和しない)。

## 3. 対象外(今回やらないこと)

- `--concurrency` を上げることによる時間短縮(出力破損の再現条件が未特定のため別Issue化を検討中)
- shard実行そのものの自動オーケストレーション(N回の呼び出し・マージ・レポート生成を1コマンドで
  束ねるスクリプト)。OpenCodeの2時間制約は呼び出し単位でリセットされることが確認済みのため、
  呼び出しの分割自体は運用側(SKILL.md/RUNBOOK.mdの手順)に委ねる
- 既存の非shard実行の外部挙動・出力ファイル形式の変更(スクリプト分割は内部リファクタリングであり、
  非shard実行時のCLI・出力・終了コードは不変)

## 4. テスト

`tests/evaluation/tools/test_run_agent_evaluation.py`:
- `_select_shard`: 境界値(shard-count=1、最終shardの余り件数)、全shard分を合算すると
  Gold/Seededそれぞれの原集合と重複・欠落なく一致することの回帰
- `_validate_shard_args`: 片方だけ指定/範囲外indexでエラーになることの確認
- shard指定時に `generate_evaluation_report.py` へのsubprocess呼び出しが発生しないこと、
  非shard時は発生することの確認(monkeypatchで検知)
- shard指定時・非shard時それぞれでの `_shutdown_server` 呼び出し有無の確認
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

## 5. 検証手順

```bash
uv run pytest
uv run ruff check
uv run ruff format --check
```

加えて実環境検証(外部プロセス連携を伴う変更のため任意ではなく必須):

1. A2Aサーバーをローカル起動し、`--shard-count 4` で4回に分けて `run_agent_evaluation.py` を実行
   (各回が実際にサーバーを停止しないこと、レポート生成subprocessが呼ばれないこと、対象件数が
   合計24件になることをログで確認)
2. `merge_predictions.py` で4shard分をマージし、exit code・summaryを確認
3. `generate_evaluation_report.py` でMarkdownレポートと(設定していれば)Discord通知が生成される
   ことを確認
4. 生成された `agent_predictions.jsonl`・スコアが、非shard実行(`--concurrency 2` フル実行)の
   結果と一致すること(または既知の非決定要素の範囲内であること)を比較確認
5. 非shard実行(既存コマンドそのまま)を1回実行し、出力ファイル・終了コード・コンソール出力が
   従来と変わらないことを確認(リファクタリングの回帰確認)
