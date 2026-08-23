# スタック別 Gold-set ターゲット選定仕様

React / Vue / Angular / Svelte の評価対象 PR を、リポジトリ候補の検証から PR の
3 軸分類まで一貫して生成し、スタック別 JSON として管理する。生成した JSON は
`select_stack_targets.py` が結合・抽出し、評価パイプラインの唯一の正規入力として使う。
設計判断は [ADR-0005](adr/0005-per-stack-evaluation-target-pipeline.md) を参照。

---

## 1. 全体データフロー

```text
evaluation/input/repo_candidates.json
    ↓ discover-candidate-prs
    │  repository検証 + PRフィルタ + LLM 3軸分類
    ↓
evaluation/input/pr_targets_{react,vue,angular,svelte}.json
    ↓ select_stack_targets.py
    │  severity/impact/priorityフィルタ + 層化/均衡抽出
    ↓
evaluation/data/pr_targets.json
    ↓ build_gold_set.py
evaluation/data/gold_pr_set.jsonl
```

旧経路の `pr_candidates_raw.json`、`pr_targets_b2b2c_tagged.json`、
`convert_tagged_targets.py`、手動選定チェックリストは廃止した。

## 2. リポジトリ選定条件

`evaluation/input/repo_candidates.json` の各候補を次の条件で検証する。

1. `archived` でない。
2. `stargazers_count >= 5000`。
3. 最新 release の公開日が実行日から 180 日以内。
4. release が存在しない場合は tag の commit 日を使い、少なくとも 1 件が 180 日以内。

既定値は `--min-stars` と `--release-window-days` で変更できる。候補は 37 repository
(react=15, vue=7, angular=6, svelte=9) である。AI review bot の導入有無は
リポジトリ選定条件にしない。

## 3. PR 選定条件

リポジトリ検証を通過した merged PR のうち、次の全条件を満たすものを対象とする。

1. PR の更新日時が `--since` 以降。未指定時は `now - release-window-days`。
2. `changed_files <= 20` かつ `additions + deletions <= 1000`。
3. frontend の production file に patch が存在する。
4. frontend の production file に対する、本文が空でない inline review comment が
   1 件以上存在する。

production file と inline comment の判定は TypeScript evaluation package の共通criteriaを
`discover-candidate-prs` が使い、`build_gold_set.py`も同じ判定契約を維持する。対象拡張子は
`.js`, `.jsx`, `.ts`, `.tsx`, `.vue`, `.svelte`, `.css`, `.scss`, `.html`、
特別対象は `package.json`/`angular.json`/`svelte.config.js`/`svelte.config.ts`/
`vue.config.js`/`vue.config.ts`（`pr_info_collector.py` の `_TARGET_FILENAMES` と
同期、Issue #230）である。test / docs file と backend-only 変更は除外する。

inline comment の投稿者は人間・AI review bot のいずれでもよい。review body は
LLM の分類コンテキストには含めるが、file location がないため PR の受理条件には
使わない。Gold schema の既存フィールド名は `human_findings` だが、実体には受理した
AI review bot の inline comment も含みうる。

上限は `--max-changed-files` と `--max-changed-lines` で変更できる。

## 4. severity / impact / priority の LLM 分類

受理可能な inline comment と review body を集約し、LLM が次の独立 3 軸を構造化出力する。

```python
class ReviewAssessment(BaseModel):
    severity: Literal["critical", "high", "medium", "low"]
    impact: Literal["security", "correctness", "performance", "maintainability"]
    priority: Literal["high", "medium", "low"]
    rationale: str
```

- `severity`: 問題そのものの深刻度。
- `impact`: 影響を受ける品質特性。
- `priority`: 対応の緊急度。
- `rationale`: 非空の判断根拠。出力 JSON には保存せず audit log に記録する。

モデルは `--model-id`、または `.env` の `SEEDED_GEN_MODEL_ID` から取得する。
接続先は `--llm-base-url`、または `SEEDED_GEN_LLM_BASE_URL` を使う。
各 LLM call の timeout は 120 秒。call失敗・structured output失敗時は warning を記録し、
その PR を出力しない (fail-closed)。

## 5. 出力スキーマ

各スタックについて `evaluation/input/pr_targets_{stack}.json` を生成する。

| フィールド | 値域・意味 |
|---|---|
| `repository` | `owner/repo` |
| `pr_number` | GitHub PR番号 |
| `stack` | `react` / `vue` / `angular` / `svelte` |
| `repo_type` | `ui-library` / `application` |
| `severity` | `critical` / `high` / `medium` / `low` |
| `impact` | `security` / `correctness` / `performance` / `maintainability` |
| `priority` | `high` / `medium` / `low` |

`write_stack_outputs` は既定4スタックのファイルを、対象0件でも空配列として必ず生成する。
既定外の stack が入力候補に存在する場合も、その stack のファイルを生成する。
repository ごとの処理完了時に逐次書き込むため、長時間実行が途中停止しても結果を保持する。

## 6. 再開と上限

主な CLI option は次のとおり。

| option | 既定値 | 意味 |
|---|---:|---|
| `--max-prs-per-repo` | 60 | repository ごとに評価する PR 上限 |
| `--max-targets-per-repo` | 10 | repository ごとに受理する target 上限 |
| `--min-stars` | 5000 | star 下限 |
| `--release-window-days` | 180 | release / tag と既定 `--since` の期間 |
| `--max-changed-files` | 20 | 変更ファイル上限 |
| `--max-changed-lines` | 1000 | additions + deletions 上限 |
| `--skip-repos` | 空 | 処理を省略する repository の CSV |

`--skip-repos` は resume 用であり、指定 repository の既存 target を現在の出力から読み戻して
保持する。指定していない repository の古い target は再処理結果で置き換える。skip対象の
既存 JSON が配列でない場合は上書きせず停止する。

全候補を再探索・再分類する実行例:

```bash
nix develop --command pnpm --filter @code-review-agent/evaluation run discover-candidate-prs \
  --model-id "$SEEDED_GEN_MODEL_ID" \
  --llm-base-url "$SEEDED_GEN_LLM_BASE_URL"
```

既存ターゲットの3軸分類を保持し、共通criteriaだけをGitHub APIで再検証する場合:

```bash
nix develop --command pnpm --filter @code-review-agent/evaluation run discover-candidate-prs \
  --revalidate-existing
```

`--revalidate-existing` はLLMを呼ばず、4ファイルをすべて読み込んで全件検証が成功した後に
一括で書き戻す。API失敗時は書込前に停止するため、部分的な削除は発生しない。

## 7. 評価実行対象の抽出

`select_stack_targets.py` が4ファイルを結合し、重複を `(repository, pr_number)` で除去する。

- `--min-severity`: severity 下限。
- `--impact`: impact の CSV filter。
- `--priority`: priority の CSV filter。
- `--stacks`: stack の CSV filter。
- `--balanced`: stack round-robin。
- `--shuffle --stratify-repo-type`: repo_type をほぼ50/50に層化した seed 固定抽出。

結果は `evaluation/data/pr_targets.json` に `repository / pr_number / stack / severity / impact / priority` を出力して `build_gold_set.py` へ渡す。`stack` はレビュアー選択に使う実行時属性であり、Gold-set/Seeded-set生成を通じて保持される（詳細は [Seeded評価のスタック別レビュアールーティング仕様](plan/seeded-reviewer-stack-routing-spec.md)）。Gold builderは3軸をPR単位の代理ラベルとして各 `human_findings` へ継承する。これはコメント固有の正解ではなくPR文脈との整合を測る暫定ラベルであり、詳細は [指摘単位3軸評価仕様](finding-axis-evaluation-spec.md) を参照する。抽出後の構成比不足は `[COVERAGE-WARN]` として通知するが、パイプラインを停止しない。

## 8. テスト方針

- repository の star / archived / release・tag境界。
- 変更規模の境界値 (20 files / 1000 linesを含む)。
- frontend production file / test / docs / backend-only / patchなしの判定。
- 人間・AI bot の inline comment、review-body-only、対象外file comment。
- LLM structured output、timeout、fail-closed。
- stack別振り分け、空file保証、既定外stack。
- `--skip-repos` による既存target保持。
- 新3軸filter、重複排除、stack均衡・repo_type層化抽出、coverage warning。
