# Lead Engineer Agent 実装プラン

## Context

ワークフロー仕様（`docs/review-agent-workflow-spec.md`）の最終ステージである Lead Engineer Agent が未実装。現状は `ReviewOrchestrator` が並列レビュー結果を `ReviewReport` として返すところで止まり、ユーザーに届く最終判断が存在しない。

Lead Engineer は「上がってきた指摘を評価・取捨選択して優先リストを作る意思決定者」であり、自らコードを読んで新たな問題を見つける役割ではない。この性質から、技術特定のツール（GitHub MCP）は不要で、React 以外の技術スタックにも自然に対応できる。

機能設計の詳細は [docs/lead-engineer-agent-design.md](../docs/lead-engineer-agent-design.md) を参照。

---

## 対象ファイル

**新規作成**:

```text
docs/lead-engineer-agent-design.md   <- Agent 機能設計書（保守メンテナンス用）
plan/lead-engineer-agent.md          <- この実装プランのプロジェクト内コピー
src/code_review_agent/
  models/lead_engineer.py
  agents/lead_engineer.py
tests/
  models/test_lead_engineer.py
  agents/test_lead_engineer.py
```

**変更**:

- `src/code_review_agent/models/__init__.py`
- `src/code_review_agent/agents/__init__.py`
- `evaluation/EVALUATION_PLAN.md`

---

## 実装フロー（プロジェクト標準 TDD フロー準拠）

**基本サイクル**: 小さい単位ごとに RED（テスト作成）→ GREEN（実装）→ Refactor を繰り返す。各サイクルで部分的に動く状態を維持する。全体のリファクタ・Quality gate は最後にまとめて実施する。

```text
Spec 更新（設計書 + EVALUATION_PLAN 更新）→ Commit: Spec baseline
  ↓
[Cycle 1] モデル基本型
[Cycle 2] LeadEngineerReport（accepted/rejected/to_markdown/to_evaluation_format）
[Cycle 3] LeadEngineerAgent._build_prompt_and_index()
[Cycle 4] LeadEngineerAgent._resolve_decisions()
[Cycle 5] LeadEngineerAgent.evaluate()（統合）
[Cycle 6] __init__.py エクスポート追加
  ↓
全体リファクタ → lint/format → テスト再実行 → Quality gate
  ↓
Commit: Quality gate passed → PR
```

---

### Cycle 1: モデル基本型（`DecisionVerdict`, `FindingDecisionOutput`, `LeadEngineerOutput`, `FindingDecision`）

**RED**: `tests/models/test_lead_engineer.py` に以下のテストを追加:

- `DecisionVerdict.ACCEPT` / `REJECT` の値が `"accept"` / `"reject"` であること
- `FindingDecisionOutput` が `finding_index`, `verdict`, `reason`, `impact`, `final_priority` を持つこと
- `FindingDecision` が `reviewer_id`, `perspective`, `finding`, `verdict`, `reason`, `impact`, `final_priority` を持ち、元の `ReviewFinding` を保持すること

**GREEN**: `models/lead_engineer.py` に上記モデルを実装。

**Refactor**: docstring を Google style に整える。`uv run pytest tests/models/test_lead_engineer.py` でグリーンを確認。

---

### Cycle 2: `LeadEngineerReport`

**RED**: `tests/models/test_lead_engineer.py` に追加:

- `accepted()` が CRITICAL→HIGH→MEDIUM→LOW 順であること
- `rejected()` が同順であること
- `to_markdown()` に accepted findings のファイル名・コメントが含まれること
- `to_markdown()` で rejected が `<details>` ブロックに収まること
- `to_markdown()` で `reviewer_errors` があれば末尾に出力されること
- `to_evaluation_format()` が `id` / `agent_findings` / `lead_decisions` キーを持つこと
- `to_evaluation_format()` の `agent_findings` が accepted のみであること

**GREEN**: `LeadEngineerReport` を実装。ソートは `list(ReviewPriority)` の定義順を使う。

**Refactor**: ソートロジックの共通化を検討。

---

### Cycle 3: `LeadEngineerAgent._build_prompt_and_index()`

**RED**: `tests/agents/test_lead_engineer.py` に追加:

- findings が `Finding #N` 形式で番号付きになること
- 返却されるインデックスマップが `{1: (reviewer_id, perspective, finding), ...}` であること
- 複数レビュアーの findings が連番で番号付きになること
- findings なしの report でも空マップと適切なプロンプトが返ること

**GREEN**: `agents/lead_engineer.py` に `_build_prompt_and_index()` を実装。

**Refactor**: プロンプト生成の冗長性を確認。

---

### Cycle 4: `LeadEngineerAgent._resolve_decisions()`

**RED**: `tests/agents/test_lead_engineer.py` に追加:

- 有効な `finding_index` が元の finding に正しく解決されること
- 不正インデックス（範囲外）がスキップされること（例外不要）
- 複数レビュアーの findings が混在しても正しく解決されること

**GREEN**: `_resolve_decisions()` を実装。不正インデックスはスキップ。

---

### Cycle 5: `LeadEngineerAgent.evaluate()`（統合）

**RED**: 以下をテストに追加:

- `system_prompt` に `"Do NOT introduce"` と `"speculate"` が含まれること
- `tools=[]` が `Agent` に渡されること
- `structured_output` に `LeadEngineerOutput` スキーマが渡されること
- 戻り値が `LeadEngineerReport` であること
- `report.errors` が `reviewer_errors` に転送されること

**GREEN**: `evaluate()` を実装。`tools=[]` と `system_prompt` を明示。

---

### Cycle 6: `__init__.py` エクスポート追加

`models/__init__.py` と `agents/__init__.py` に新シンボルを追加。

---

### 全体リファクタ → lint/format → Quality gate

```bash
uv run pytest
uv run pytest --cov=code_review_agent.agents.lead_engineer \
              --cov=code_review_agent.models.lead_engineer \
              --cov-report=term-missing
uv run ruff check --fix src/ tests/
uv run ruff format src/ tests/
uv run pyright src/
```

---

## アーキテクチャ上の重要な選択

| 判断 | 理由 |
|---|---|
| `ReviewAgent` を継承しない | 並列レビュアーは `review(context)` を持つ。Lead Engineer は `evaluate(report)` という別契約を持つ別レイヤーの概念 |
| finding_index 参照方式 | LLM が finding を「再現」すると内容破損リスクがある。番号で参照させ Agent コードで引く方式が堅牢 |
| `tools=[]` の明示 | GitHub MCP 不使用を宣言的に表す |
| モデルを `lead_engineer.py` に分離 | `review.py` と独立して Lead Engineer ステージの契約を進化させられる |
| `to_markdown()` をモデルに置く | 将来の GitHub PR コメント出力時も `LeadEngineerReport` を起点にしてフォーマッタを追加できる |
