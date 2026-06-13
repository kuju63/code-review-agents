# PR Info Collector ツール呼び出し修正 設計ドキュメント

`PRInfoCollector.collect()` が GitHub MCP ツールを一度も呼ばずに PR 情報を創作（hallucination）する
不具合を解消し、実データに基づく構造化出力へ修正するための設計を定義します。

---

## 1. 背景と問題

`evaluation/PR_COLLECTOR_ACCURACY_GEMMA4_E4B.md` の20回統計分析（モデル `google/gemma-4-e4b`、
対象 `mui/material-ui#48591`）で、以下が**実測特定**された:

| 観測事実 | 値 |
|---|---|
| ステータス成功率 | 20/20 (100%) |
| PR番号一致率 | 20/20 (100%)（プロンプトに渡した値のため創作不要） |
| Title 完全一致 / ファイル F1 / Label一致 | 0% / 0.00 / 0% |
| 生成タイトルの種類 | 20試行で20種類すべて異なる |
| 幻覚ファイル総数 | 50件 |
| toolUse / toolResult ブロック | **0 / 0** |

ツールトレースで GitHub MCP ツール47個はロードされている（接続は正常）にもかかわらず、
`toolUse` が0、すなわち**ツールを一度も呼んでいない**ことが判明した。

### 根本原因

`pr_info_collector.py:121-124` の `agent.structured_output()` **単独使用**。
このメソッドはエージェントループ（ツール呼び出し→観測→再思考）を回さず、単発の LLM 呼び出しで
構造化 JSON を強制生成する。そのため `tools=[mcp_client]` を渡してもツール実行フェーズが存在せず、
モデルは「mui/material-ui の PR #48591」という**文字列だけ**を手がかりに訓練知識から創作する。

「名前（tools を渡している）」と「実体（ツールは呼ばれない）」が乖離している典型例。

---

## 2. 修正方針

### 2.1 呼び出し経路（案A: ツールループと構造化出力の分離）

| 案 | 内容 | 採用 | 理由 |
|---|---|---|---|
| 案A | `agent(prompt)` でツールループを回して実データ取得 → `agent.structured_output(PRInfoResult)` で会話文脈を構造化 | **採用** | 既存 API のみで最小変更。1回実測で Title/Label が0%→完全一致に改善し原因が裏付け済み |
| 案B | `__call__` に `structured_output_model` を直接渡す（strands 1.41 推奨パス） | 却下（将来課題） | DeprecationWarning 追随の観点では望ましいが、本修正では変更を最小化し回帰評価の切り分けを優先 |

採用する実装:

```python
agent = Agent(model=openai_model, system_prompt=SYSTEM_PROMPT, tools=[mcp_client])
# 1) ツールループを回し GitHub から実データを取得（toolUse が発生する）
agent(prompt)
# 2) 直近の会話文脈（取得済み実データ）を構造化（prompt 引数は渡さない）
result = agent.structured_output(PRInfoResult)
```

`structured_output(PRInfoResult)` は **prompt 引数なし**で呼ぶ（strands 1.41 で prompt は省略可、
省略時は会話履歴を構造化する）。MCP クライアントの `finally` での `stop()` クリーンアップは現状維持。

### 2.2 file 一覧対処（SYSTEM_PROMPT 強化）

案A単独では、レポート6.1 の実測でモデルがファイル一覧を「集計オブジェクト
（`changed_files_count: 5` 等）」として返し `file_changes` 配列が空になる**二次課題**が確認された。

| 案 | 内容 | 採用 | 理由 |
|---|---|---|---|
| プロンプト強化 | SYSTEM_PROMPT に「変更ファイル一覧と各 patch を取得するツールを呼ぶ」「`file_changes` はファイル1件=1エントリの配列で出力、件数集計に要約しない」を明示 | **採用** | 取得側の指示で配列化を促す最小変更。ツール強制 API のハード化は小型モデル互換性リスクがあるため避ける |
| ツール強制（forced tool use） | 特定ツール呼び出しを API レベルで強制 | 却下（将来課題） | strands のツール強制 API 依存が増え、エンドポイント/モデル互換性の検証コストが上がる |

### 2.3 本タスクの範囲外

- レポート6.2 の**検証ガード**（toolResult=0 や file_changes 空を「失敗扱い」にして下流に流さない）。
- レポート6.4 の**モデル選定**（設計修正後の再計測で基準未達の場合に検討する順序を守る）。

---

## 2.5 設計転換: 完全決定論化（案A を置き換え, 2026-06-13）

### 2.5.1 案A の実測で残った2課題

案A（§2.1-2.2）を 20 回再計測した結果（`..._AFTER_FIX.md`）、根本原因（ツール未呼び出し）は
解消し Title 完全一致 0%→73% / File F1 0.00→0.69 と大幅改善した。しかし**2つの課題が残った**:

1. **ファイルのハルシネーション**: run 1/8/11 は**ファイルパスが完全正解（ツールで実取得済み）**なのに、
   `structured_output`（2回目の LLM 呼び出し）が Title/Label を言い換え・創作した。データは会話文脈に
   あるのに小型モデルが忠実に転記しない＝構造化生成そのものが創作の温床。
2. **ツールループの長時間化**: 平均 16.6s→312.6s（最大 1039s）。小型モデルがループ内で暴走し、
   20 回中 9 回が LM Studio のメモリ枯渇で環境失敗した。

### 2.5.2 着眼: ファクトを LLM に生成させない

`title` / `body` / `labels` / `file_changes` は**すべて GitHub API が構造化データとして返す事実**であり、
LLM に再生成させる必然性がない。`MCPClient.call_tool_sync` でツールを**コードから決定論的に直接呼べる**
（LLM ループ不要）ことを実測で確認した。これにより**両課題が同時に消える**:

- ハルシネーション = **原理的に0**（LLM が生成しないので創作の余地がない）
- ツールループ = **消滅**（固定回数の API 呼び出しのみ。暴走しない）

### 2.5.3 採用する設計（案E: 完全決定論化）

| 案 | 内容 | 採用 | 理由 |
|---|---|---|---|
| 案A | LLM エージェント + ツールループ + structured_output | 却下（置き換え） | 忠実性・長時間化の2課題が残る（§2.5.1） |
| ハイブリッド | LLM ループ維持 + file_changes のみ決定論上書き | 却下 | Title/Label 忠実性とループ長時間化が未解決 |
| **案E** | **ツールループ廃止。`call_tool_sync` で GitHub MCP を直接叩き、ファクトを決定論マッピング。`project_summary` のみ単発 LLM 要約** | **採用** | ハルシネーション0・ループ長時間化0を両立。下流契約（`PRInfoResult` 型）は維持 |

**`collect()` の決定論データ取得（LLM 不使用）**:

| フィールド | 取得元（`pull_request_read` 等） | マッピング |
|---|---|---|
| `pr_info.title` / `body` | `method=get` の JSON | `data["title"]` / `data["body"]` |
| `pr_info.labels` | `method=get` の JSON | `_extract_label_names(data["labels"])`。GitHub MCP は labels を**文字列リスト**（`["scope: progress"]`）で返すため、文字列・dict (`{"name": ...}`) 両形に対応 |
| `pr_info.pr_number` | `method=get` / 入力 | `data["number"]` |
| `pr_info.file_changes` | `method=get_files` の JSON 配列 | `FileChange(filePath=f["filename"], patch=f["patch"])` を `is_target_file` で絞り込み。`page`/`perPage` で全件ページング |
| `dependency_files` | `get_file_contents`(path=`/`, ref=PR head sha) のルート列挙 | `is_dependency_file` で判定。**変更有無に関わらず、その時点でプロジェクトが依存するパッケージを記述する manifest 群**を下流に渡す（下流レビュアーへの依存コンテキスト）。「PR で変更された manifest のみ」ではない点に注意 |
| `repository_info` | 入力引数 | `owner` / `repo` |

**`project_summary`（唯一の LLM）**: README を `get_file_contents`（path=README.md）で取得し、
**ツールなし・単発**の `Agent(model, system_prompt=要約用)` 呼び出しで 2-4 文に要約。ツールループは
発生せず、要約は事実性要求が低く創作の害が小さい。README 取得失敗**および要約 LLM 失敗時**は空文字へ
フォールバックし、決定論的に取得済みの事実フィールドを失わない。

「構造化してレスポンスを返却すること自体をやめてもよい」というユーザー許可は、**LLM による構造化生成の
廃止**を指す。`PRInfoResult` という型（構造）自体は下流レビューエージェント（A2A API 契約）が期待するため
維持し、その**中身の埋め方**を LLM 生成 → MCP 決定論パースへ置き換える。

### 2.5.4 受け入れ基準の更新（案E）

- **ファイルパス F1 = 1.0（ハルシネーション 0）** を必達とする（決定論取得のため原理的に保証）。
- Title / Label / Body も GitHub の値と完全一致。
- 実行時間は案A（平均312s）から大幅短縮（固定 3-4 回の API 呼び出し + 任意で要約1回）。
- 20 回試行で結果が**完全収束**（ばらつきは要約文のみ）。

---

## 3. 受け入れ基準（案A 暫定 — §2.5.4 が上書き）

> **注記**: 本節は案A（§2.1-2.2）時点の暫定基準であり、採用設計（完全決定論化）の
> **正式な受け入れ基準は §2.5.4** である。決定論化により `toolUse > 0` は手段ではなく
> 不要となり（LLM ツールループ自体を廃止）、ファイルパス F1 は「≥ 0.8」ではなく
> **「= 1.0（ハルシネーション0）」が必達**へと引き上げられた。以下は設計変遷の記録として残す。

修正前レポートとの差分で評価する。レポート6.3 の暫定基準を参照:

| 指標 | 修正前 | 受け入れ基準（案A 暫定, §2.5.4 が上書き） |
|---|---|---|
| Title 類似度 | 平均0.254 / 完全一致0% | 類似度 ≥ 0.7（収束＝生成タイトル種類数の大幅減） |
| Label 完全一致率 | 0% | ≥ 0.9 |
| ファイルパス F1 | 0.00 | ≥ 0.8（→ 決定論化で = 1.0 へ） |
| PR番号一致 | 100% | 100% 維持 |
| toolUse | 0 | **> 0**（案A での主指標。決定論化では廃止） |

---

## 4. 検証手順

```bash
# 単体テスト（決定論コレクタ）
uv run pytest tests/agents/test_pr_info_collector.py

# 全体検証
uv run pytest && uv run ruff check && uv run ruff format --check

# 20回計測 → 決定論レポート生成
python evaluation/tools/verify_pr_collector_repeated.py --runs 20
python evaluation/tools/analyze_pr_collector_repeated.py \
  --jsonl evaluation/data/pr_collector_repeated_google_gemma-4-e4b.jsonl \
  > evaluation/PR_COLLECTOR_ACCURACY_GEMMA4_E4B_DETERMINISTIC.md
```
