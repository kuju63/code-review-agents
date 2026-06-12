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

## 3. 受け入れ基準

修正前レポートとの差分で評価する。レポート6.3 の暫定基準を参照:

| 指標 | 修正前 | 受け入れ基準（暫定） |
|---|---|---|
| Title 類似度 | 平均0.254 / 完全一致0% | 類似度 ≥ 0.7（収束＝生成タイトル種類数の大幅減） |
| Label 完全一致率 | 0% | ≥ 0.9 |
| ファイルパス F1 | 0.00 | ≥ 0.8 |
| PR番号一致 | 100% | 100% 維持 |
| toolUse | 0 | **> 0**（実データ取得が実体として発生） |

**主指標は toolUse > 0 と Title/Label の改善**。File F1 は file 一覧対処の効果指標だが、
gemma-4-e4b（約4B級）のツール追従の弱さから基準未達の可能性が残る。その場合は数値を率直に報告し、
レポート6.4 の順序（設計→再計測→モデル比較）に沿って残課題として切り分ける。

---

## 4. 検証手順

```bash
# 単体テスト（案Aの新呼び出し契約）
uv run pytest tests/agents/test_pr_info_collector.py

# 全体検証
uv run pytest && uv run ruff check && uv run ruff format --check

# 20回計測 → AFTER_FIX レポート生成
python evaluation/tools/verify_pr_collector_repeated.py --runs 20
python evaluation/tools/analyze_pr_collector_repeated.py \
  --jsonl evaluation/data/pr_collector_repeated_google_gemma-4-e4b.jsonl \
  > evaluation/PR_COLLECTOR_ACCURACY_GEMMA4_E4B_AFTER_FIX.md
```
