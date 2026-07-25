# スタック別 Gold set ターゲット再選定 設計ドキュメント

`evaluation/tools/discover_candidate_prs.py` を破壊的に改修し、React / Vue / Angular / Svelte の
各スタックごとに独立した Gold set ターゲット JSON (`pr_targets_{stack}.json`) を生成する。
severity / impact / priority を LLM 解析によって独立 3 軸で導出し、
`pr_targets.example.json` を新フォーマット (severity / impact / priority / repo_type / stack) へ更新する。

---

## 1. 背景と目的

現行パイプラインは以下の流れでターゲットを選定していた。

```
repo_candidates.json
    ↓ discover_candidate_prs.py (キーワードスコアリング + 人間コメント抽出、AIボット除外)
pr_candidates_raw.json  (中間ファイル)
    ↓ 手動キュレーション
pr_targets_b2b2c_tagged.json
    ↓ convert_tagged_targets.py
{repository, pr_number} のみの実行ターゲット
    ↓ build_gold_set.py
gold_pr_set.jsonl
```

この方式には以下の課題がある。

- 全スタックが 1 ファイルに混在しており、スタック別に Gold set を構成できない。
- 手動キュレーション工程が挟まり、再現性・自動化が困難。
- severity / impact / priority が付与されておらず、キーワードスコアリングでは 3 軸が
  同一キーワード源から導出されるため相関が強く、区別が形骸化する。

本改修では、スタック別 Gold set を自動生成し、LLM による独立 3 軸解析で
severity / impact / priority を付与する。

## 2. 要件

### 2.1 対象 PR の選定条件

1. **直近 6 ヶ月以内にリリースが行われている** UI ライブラリ、または各ライブラリ・
   メタフレームワークを使用したアプリケーションのリポジトリに属する PR。
   6 ヶ月の起点はスクリプト実行日 (`now - 180 日`)。
2. リポジトリの **スター数が 5,000 以上**。
3. PR の変更内容が **プロダクションコードを変更している** (テスト / ドキュメントのみの
   変更ではない)。
4. PR の **レビューコメントに指摘が入っている**。指摘の主体は人間・AI ボット
   (CodeRabbit, Copilot Code Review など) のいずれでもよい。AI ボットの指摘は必須ではなく、
   人間のレビューコメントのみでも条件を満たす。**レビューコメントが 1 件も無い PR は除外**。
5. 変更規模が **20 ファイル以内かつ 1,000 行以内** (`changed_files <= 20` かつ
   `additions + deletions <= 1000`)。

### 2.2 出力

- スタックごとに `evaluation/input/pr_targets_{stack}.json` を生成
  (`pr_targets_react.json`, `pr_targets_vue.json`, `pr_targets_angular.json`,
  `pr_targets_svelte.json`)。
- 各要素のフィールド:

  | フィールド | 意味 | 値域 | 導出元 |
  |---|---|---|---|
  | `repository` | `owner/repo` | 文字列 | repo_candidates.json |
  | `pr_number` | PR 番号 | 整数 | GitHub API |
  | `stack` | フレームワーク | `react` / `vue` / `angular` / `svelte` | repo_candidates.json |
  | `repo_type` | リポジトリ種別 | `ui-library` / `application` | repo_candidates.json |
  | `severity` | 不具合そのものの深刻度 | `critical` / `high` / `medium` / `low` | LLM 解析 |
  | `impact` | 影響を及ぼす品質特性 | `security` / `correctness` / `performance` / `maintainability` | LLM 解析 |
  | `priority` | 対応優先度 | `high` / `medium` / `low` | LLM 解析 |

- `pr_targets.example.json` を上記フォーマットのサンプルへ更新。

### 2.3 廃止するもの

- 中間ファイル `pr_candidates_raw.json` の生成と手動キュレーション工程。
- キーワードスコアリング (`SECURITY_KEYWORDS` / `SIDEEFFECT_KEYWORDS` /
  `DESIGN_KEYWORDS` / `score_comment` / `score_pr`)。
- AI ボット除外ロジック (`BOT_LOGINS`)。

## 3. 設計

### 3.1 severity / impact / priority の LLM 独立 3 軸解析

キーワード解析では 3 値が同一源から導出されて相関しすぎるため、LLM が PR の
レビューコメント群を解析し、3 軸を独立した観点で構造化出力する。既存規範
`score_evaluation.py::make_llm_semantic_judge` /
`build_seeded_set.py::make_llm_mutation_generator` を踏襲する。

```python
class ReviewAssessment(BaseModel):
    severity: Literal["critical", "high", "medium", "low"]
    impact: Literal["security", "correctness", "performance", "maintainability"]
    priority: Literal["high", "medium", "low"]
    rationale: str  # 非空。判断根拠 (監査用)
```

- **観点の独立性**: severity = 不具合の重さ、impact = どの品質特性に効くか、
  priority = いつ直すべきか。プロンプトで 3 軸が別概念であることを明示し、同一化を防ぐ。
- **入力**: その PR に付いたレビューコメント群 (人間 / AI ボット問わず) を集約して LLM へ渡す。
- **モデル選択**: `--model-id` / `CODE_REVIEW_MODEL_ID` (既定 `gpt-4o`)、
  `--llm-base-url` / `CODE_REVIEW_LLM_BASE_URL`。
- **失敗時**: warning ログを出し、その PR を出力から除外 (スキップ)。fail-closed。

### 3.2 リポジトリ検証

- スター数 `stargazers_count >= 5000` (全スタック一律)。
- 直近 6 ヶ月リリース: `/repos/{repo}/releases` の最新公開日が `now - 180 日` 以内。
  リリースが存在しない場合は `/repos/{repo}/tags` + 各タグの commit 日付でフォールバック。

### 3.3 PR フィルタ

- レビューコメント存在: inline review comments または review bodies が 1 件以上。
  コメント主体 (人間 / AI ボット) は問わない。
- 変更規模: `changed_files <= 20` かつ `additions + deletions <= 1000`。
- プロダクションコード変更: files API でテスト / ドキュメント以外の変更ファイルを 1 件以上含む。

### 3.4 出力振り分け

`repo_candidates.json` の `stack` に基づき、各 PR を該当スタックの
`pr_targets_{stack}.json` へ振り分けて出力する。`--output-dir` で出力先ディレクトリを指定。

## 4. repo_candidates.json の拡充

Angular / Svelte はスタック別 Gold set を構成するには候補が少ない
(現状 angular=1, svelte=2)。stars >= 5k の候補を追加する。AI ボット導入の有無は
選定条件にしない (PR 層でレビューコメントの有無のみを判定するため)。

## 5. テスト方針 (TDD)

`tests/evaluation/tools/test_discover_candidate_prs.py` を新規作成し、以下を検証する。

- レビューコメント存在判定 (人間のみ / AI ボットのみ / 両方 / なし)。
- 変更規模フィルタ (境界値: 20 ファイル / 1000 行)。
- プロダクションコード判定 (テスト / docs のみ除外)。
- リリース日フィルタ (6 ヶ月境界)。
- LLM 解析器のモック + 失敗時スキップ。
- スタック別振り分け・出力ファイル生成。

LLM は既存テストの `patch(OpenAIModel)` 流儀でモック化する。

## 6. 変更容易性・将来の変化点

- スタック追加時は `repo_candidates.json` に `stack` を追加し、出力振り分けは
  `stack` 値駆動なのでコード変更不要。
- LLM 解析の値域 (severity / impact / priority) は `ReviewAssessment` の `Literal` を
  変更すれば拡張可能。
- スター数閾値・変更規模上限・リリース期間はコマンドライン引数で調整可能とする。
