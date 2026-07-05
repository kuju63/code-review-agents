# Lead Engineer Agent 設計

`docs/review-agents-design.md` が並列レビュー段のアーキテクチャを定義しているのに対し、
本ドキュメントは**Lead Engineer 合成ステージ**の設計を定義します。

---

## 1. 役割と責務

Lead Engineer は、並列レビュー段が生成した `ReviewReport` を受け取り、最終的な優先修正リストを
生成する意思決定エージェントです。

### Lead Engineer がすること

- 各レビュアーの指摘（`ReviewFinding`）を評価し、accept / reject を判定する
- 判定理由（`reason`）と修正しない場合のインパクト（`impact`）を明示する
- accept した指摘に最終優先度（`final_priority`）を割り当てる（レビュアーの優先度と異なっても良い）
- 全指摘の評価を踏まえた総合サマリー（`overall_summary`）を生成する

### Lead Engineer がしてはならないこと

- レビュアーが報告していない新たな問題の発見
- PR の差分を直接読んでの追加指摘
- 推測・憶測に基づいた判断

この「推測禁止」制約は、レビュアーの品質問題を Lead Engineer が隠蔽するリスクを防ぐためです。
問題の発見はレビュアー、評価・集約は Lead Engineer という責務分離を保証します。

---

## 2. ワークフロー内の位置づけ

```text
[PR Info Collector]
    PRInfoResult
       ↓
[ReviewOrchestrator] ← ReactCodeReviewer, SecurityReviewer, (将来のレビュアー...)
    ReviewReport(results, errors)
       ↓
[LeadEngineerAgent]
    LeadEngineerReport(overall_summary, decisions, reviewer_errors)
       ↓
  チャット出力（to_markdown）  ← 現在
  GitHub PR コメント（将来）
```

---

## 3. 技術非依存設計

ワークフロー仕様（`docs/review-agent-workflow-spec.md`）の初版は React に特化していましたが、
Lead Engineer は技術スタックに依存しない設計をとります。

具体的には:

- システムプロンプトに React / Spring Boot などの特定技術名を含めない
- 各 finding に付与された `perspective`（technical, security など）と `reviewer_id` を文脈として使う
- 新しいレビュアーが追加されても Lead Engineer のコードは無改修で対応できる

---

## 4. データモデル

### 4.1 `DecisionVerdict`

```python
class DecisionVerdict(StrEnum):
    ACCEPT = "accept"   # 開発者が対応すべき指摘
    REJECT = "reject"   # 対応不要（偽陽性・スコープ外・価値が低い）
```

### 4.2 `FindingDecisionOutput`（LLM 生成用）

`Agent.structured_output` に渡すスキーマ。LLM は finding の番号（finding_index）のみ返し、
finding の内容はコード側でインデックスマップから引く（finding 再現によるデータ破損防止）。

```python
class FindingDecisionOutput(BaseModel):
    finding_index: int          # 1-based。プロンプト中の Finding #N と対応
    verdict: DecisionVerdict
    reason: str                 # 判断理由
    impact: str                 # 修正しない場合のインパクト
    final_priority: ReviewPriority
```

### 4.3 `LeadEngineerOutput`（LLM 生成用）

```python
class LeadEngineerOutput(BaseModel):
    overall_summary: str
    decisions: list[FindingDecisionOutput]
```

### 4.4 `FindingDecision`（最終出力）

Agent コードがインデックス解決で元の `ReviewFinding` を付与した最終オブジェクト。

```python
class FindingDecision(BaseModel):
    reviewer_id: str
    perspective: ReviewPerspective
    finding: ReviewFinding      # インデックス解決で取得した元 finding
    verdict: DecisionVerdict
    reason: str
    impact: str
    final_priority: ReviewPriority
```

### 4.5 `LeadEngineerReport`（最終出力）

```python
class LeadEngineerReport(BaseModel):
    overall_summary: str
    decisions: list[FindingDecision]
    reviewer_errors: list[ReviewError]  # 並列レビューステージのエラーを透過転送

    def accepted(self) -> list[FindingDecision]: ...
    # CRITICAL → HIGH → MEDIUM → LOW 順でソートした accept 決定リスト

    def rejected(self) -> list[FindingDecision]: ...
    # 同順でソートした reject 決定リスト

    def to_markdown(self) -> str: ...
    # チャット出力用 Markdown（accepted findings を優先度順に列挙、rejected は <details> に収納）

    def to_evaluation_format(self, pr_id: str) -> dict: ...
    # evaluation/tools/score_evaluation.py が期待するフォーマット
    # {"id": ..., "agent_findings": [accepted のみ], "lead_decisions": [全決定]}
```

---

## 5. finding_index 参照方式の採用理由

LLM に finding を「再現」させると、以下のリスクがある:

- フィールド値の部分的な欠落・変形（特に `file_path` や `line` の誤記）
- LLM が finding の内容を「要約」してしまい元の指摘内容が失われる

このリスクを回避するため、プロンプト内で各 finding を `Finding #N` として番号付けし、
LLM には番号（`finding_index`）のみ返させる。Agent コードがインデックスマップ
`{N: (reviewer_id, perspective, finding)}` から元の finding を引くことで、データの完全性を保証する。

---

## 6. システムプロンプト設計方針

推測禁止（`Do NOT introduce new issues`, `do not speculate`）と技術非依存
（特定技術名をプロンプト本文に含めない）を明示的に強制する。

判断の3軸を明示:

1. **Severity**: レビュアーが報告した深刻度
2. **Impact**: 修正しない場合の影響
3. **Priority**: PR の目標に対する緊急性

すべての finding に対して決定を返すよう指示（`Every Finding MUST receive a decision`）。

---

## 7. 出力チャネル

### 7.1 現在: チャット出力

`LeadEngineerReport.to_markdown()` が Markdown 文字列を返す。フォーマット:

```markdown
# Lead Engineer Review Report

## Summary
...

## Accepted Findings (N)

### 1. [CRITICAL] `src/App.tsx` L42
**Reviewer**: react-technical (technical)
**Finding**: ...
**Impact**: ...
**Decision rationale**: ...
**Suggested fix**: ...

## Rejected Findings (M)
<details>
<summary>Expand to see rejected findings</summary>
...
</details>

## Reviewer Errors
...
```

### 7.2 将来: GitHub PR コメント

`LeadEngineerReport` を起点に以下の形式でコメントを生成する予定:

- **PR レビューコメント（サマリー）**: `overall_summary` + accepted findings 一覧
- **インラインコメント**: `accepted()` の各 `FindingDecision.finding.file_path` と
  `finding.line` を使って差分の該当行にコメントを付ける

この拡張は `LeadEngineerReport` 自体を変更せず、別の出力フォーマッタ関数を追加するだけで対応できる。

---

## 8. 拡張ポイント

### 新しい perspective のレビュアーが追加された場合

`LeadEngineerAgent` のコードは変更不要。`ReviewReport.results` の `perspective` フィールドが
プロンプトに含まれるため、LLM は perspective を文脈として自動的に利用できる。

### 出力チャネルを追加する場合

`LeadEngineerReport` に新しいメソッド（例: `to_github_comments()`）を追加する。既存の
`to_markdown()` は変更不要。

### Lead Engineer を複数のサブ Agent に分割する場合

`LeadEngineerReport` の契約（`overall_summary`, `decisions`, `reviewer_errors`）は変えず、
`LeadEngineerAgent.evaluate()` の内部実装のみ変更する。

---

## 8.1 structured_output が得られない場合のフェイルファスト

strands は `Agent.__call__` の `limits={"turns": N}` を使い切った場合、例外を送出せず
`AgentResult(stop_reason="limit_turns", structured_output=None)` を返す（例外が起きるのは
「forced 呼び出し後もモデルがツールを一切呼ばなかった」場合のみ）。モデルがツール自体は呼ぶが
引数の型を間違え続ける場合（例: `finding_index` を `"Finding #1"` のような文字列で返す）、
バリデーションエラーのリトライで `max_agent_turns` を消費し尽くし、後者の経路（None を無例外で
返す）に到達しうる。

`LeadEngineerAgent.evaluate()` と `LLMReviewAgent.review()` はどちらも
`result.structured_output is None` を明示チェックし、`StructuredOutputMissingError`
（`agents/exceptions.py`）を送出する。チェックを省くと `output.decisions` 等への属性アクセスで
`AttributeError: 'NoneType' object has no attribute ...` という原因不明のエラーになり、
デバッグが困難になる（2026-07-04 の評価実行で実際に発生、詳細は Issue #88）。

このチェックは事後対応であり、根本的なモデルの型ミス自体を減らすものではない。システムプロンプト
（`_SYSTEM_PROMPT`）に `finding_index` は整数である旨の明示例を追加しているが、モデル
（特に小規模なローカルモデル）が指示に従わずリトライを消費し尽くす可能性は残る。

## 9. 関連ドキュメント

- 由来の記録: [docs/review-agent-workflow-spec.md](review-agent-workflow-spec.md)
- 並列レビュー段設計: [docs/review-agents-design.md](review-agents-design.md)
- 要件検証基準: [evaluation/EVALUATION_PLAN.md](../evaluation/EVALUATION_PLAN.md)
- 実装プラン: [plan/lead-engineer-agent.md](../plan/lead-engineer-agent.md)
