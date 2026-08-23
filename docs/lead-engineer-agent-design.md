# Lead Engineer Agent 設計

`docs/review-agents-design.md` が並列レビュー段のアーキテクチャを定義しているのに対し、
本ドキュメントは**Lead Engineer 合成ステージ**の設計を定義します。

---

## 1. 役割と責務

Lead Engineer は、並列レビュー段が生成した `ReviewReport` を受け取り、最終的な優先修正リストを
生成する意思決定エージェントです。

### Lead Engineer がすること

- 各レビュアーの指摘（finding）を評価し、accept / reject を判定する
- 判定理由（reason）と修正しない場合の自由記述インパクト（impact）を明示する
- 指摘ごとにseverity（重大度）と品質特性（impactCategory）を分類する
- accept した指摘に3段階の最終優先度（finalPriority）を割り当てる（レビュアーの優先度と異なっても良い）
- 全指摘の評価を踏まえた総合サマリー（overallSummary）を生成する

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
[ReviewOrchestrator] ← 各スタックのレビュアー、SecurityReviewer
    ReviewReport(results, errors)
       ↓
[LeadEngineerAgent]
    LeadEngineerReport(overallSummary, decisions, reviewerErrors)
       ↓
  チャット出力（toMarkdown）  ← 現在
  GitHub PR コメント（将来）
```

---

## 3. 技術非依存設計

Lead Engineer は技術スタックに依存しない設計をとります。

- システムプロンプトに特定技術名を含めない（レビュアーが明示的に言及した場合を除く）
- 各 finding に付与された perspective（technical, security など）と reviewerId を文脈として使う
- 新しいレビュアーが追加されても Lead Engineer のコードは無改修で対応できる

---

## 4. データモデル

すべて `models/lead-engineer.ts` に Zod スキーマとして定義されている。フィールド名は
camelCase（並列レビュー段の `ReviewFinding` と同じ命名規則）。

| モデル | 役割 | 主なフィールド |
|---|---|---|
| `DecisionVerdict` | 判定の2値 | `accept` / `reject` |
| `FindingSeverity` | 最終重大度 | `critical` / `high` / `medium` / `low` |
| `FindingImpact` | 影響を受ける品質特性 | `security` / `correctness` / `performance` / `maintainability` |
| `FindingPriority` | 最終優先度 | `high` / `medium` / `low` |
| `FindingDecisionOutput` | LLM生成スキーマ（1件の判定） | `findingIndex`（1始まりの整数）, `verdict`, `reason`, `impact`, `severity`, `impactCategory`, `finalPriority` |
| `LeadEngineerOutput` | LLM生成スキーマ（全体） | `overallSummary`, `decisions: FindingDecisionOutput[]` |
| `FindingDecision` | 最終出力（1件） | 上記 `FindingDecisionOutput` の各フィールド ＋ インデックス解決で復元した `reviewerId` / `perspective` / `finding`（元の `ReviewFinding` そのもの） |
| `LeadEngineerReport` | 最終出力（全体） | `overallSummary`, `decisions: FindingDecision[]`, `reviewerErrors`（並列レビューステージのエラーを透過転送） |

`LeadEngineerReport` には以下の派生関数が付随する（`models/lead-engineer.ts`）:

- `acceptedDecisions()` / `rejectedDecisions()`: `FindingSeverity` の宣言順（critical→high→medium→low）でソートした decisions を返す。ソート順を別配列で持たず、スキーマ自身の enum 宣言順を使うため、severity の並びとソート順が構造的にずれない。
- `toMarkdown()`: チャット出力用 Markdown を生成する（§7.1参照）。
- `toEvaluationFormat(prId)`: 評価パイプラインが期待する `{id, agent_findings, lead_decisions}` 形式に変換する。このフォーマットは評価パイプライン側との外部契約であるためキーはあえて snake_case のまま。`filePath`/`line` が欠落した finding はサイレントにスキップされず `console.warn` で明示的に警告される — 設計理由は [docs/finding-location-silent-drop-spec.md](finding-location-silent-drop-spec.md) を参照。

---

## 5. finding_index 参照方式の採用理由

LLM に finding を「再現」させると、以下のリスクがある:

- フィールド値の部分的な欠落・変形（特に `filePath` や `line` の誤記）
- LLM が finding の内容を「要約」してしまい元の指摘内容が失われる

このリスクを回避するため、プロンプト内で各 finding を `Finding #N` として番号付けし、
LLM には番号（`findingIndex`）のみ返させる。Agent コードがインデックスマップから元の
finding を引くことで、データの完全性を保証する。

このインデックス解決には3つのフォールバックが組み込まれている:

- **未知のインデックス**: LLMが存在しない番号を返した場合、警告ログを出して無視する。
- **重複したインデックス**: 同じ番号に複数の判定が返った場合、最初の1件のみ採用し警告を出す。
- **判定が返らなかったfinding**: 全findingについて必ず1件の判定を出すよう指示しているが、
  LLMが一部のfindingを判定し忘れることがある。その場合、当該findingは黙って欠落させず、
  元の finding の priority/perspective から機械的に導出した既定値で **REJECT** として補完する
  （reason は「Lead Engineerから判定が得られなかった」旨を明記）。これにより
  `LeadEngineerReport.decisions` の件数は常に入力findingの総数と一致することが保証される。

---

## 6. システムプロンプト設計方針

推測禁止（新規issueの追加禁止・憶測禁止）と技術非依存（特定技術名をプロンプト本文に
含めない）を明示的に強制する。

判断の3軸を明示:

1. **Severity**: レビュアーが報告した深刻度
2. **Impact**: 修正しない場合の影響
3. **Priority**: PR の目標に対する緊急性

すべての finding に対して決定を返すよう指示する。`findingIndex` は必ずJSON数値として
返させ、文字列（`"Finding #1"` 等）での応答を明示的に禁止する（構造化出力のバリデーション
失敗を減らすため）。

---

## 7. 出力チャネル

### 7.1 現在: チャット出力

`toMarkdown(report)` が Markdown 文字列を返す。フォーマット:

```markdown
# Lead Engineer Review Report

## Summary
...

## Accepted Findings (N)

### 1. [CRITICAL] `src/App.tsx` L42
**Reviewer**: react-technical (technical)
**Finding**: ...
**Severity**: ...
**Impact category**: ...
**Priority**: ...
**Impact if not fixed**: ...
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

- **PR レビューコメント（サマリー）**: `overallSummary` + accepted findings 一覧
- **インラインコメント**: `acceptedDecisions()` の各 finding の `filePath` と `line` を
  使って差分の該当行にコメントを付ける

この拡張は `LeadEngineerReport` 自体を変更せず、別の出力フォーマッタ関数を追加するだけで対応できる。

---

## 8. 拡張ポイント

### 新しい perspective のレビュアーが追加された場合

`LeadEngineerAgent` のコードは変更不要。`ReviewReport.results` の `perspective` フィールドが
プロンプトに含まれるため、LLM は perspective を文脈として自動的に利用できる。

### 出力チャネルを追加する場合

`LeadEngineerReport` を扱う新しいフォーマッタ関数（例: `toGithubComments()`）を追加する。
既存の `toMarkdown()` は変更不要。

### Lead Engineer を複数のサブ Agent に分割する場合

`LeadEngineerReport` の契約（`overallSummary`, `decisions`, `reviewerErrors`）は変えず、
`LeadEngineerAgent.evaluate()` の内部実装のみ変更する。

---

## 8.1 structured_output が得られない場合のフェイルファスト

Agentランタイムは、強制ツール呼び出し（structured output）が一度も成功しないままターン数上限
に達した場合、例外を送出せず出力が未定義のまま結果を返すことがある。`evaluate()` はこれを
`result.structuredOutput === undefined` として明示チェックし、`StructuredOutputMissingError`
を送出する。チェックを省くと未定義値への属性アクセスで原因不明のエラーになり、デバッグが
困難になる（Python版での実例はIssue #88）。

このチェックは事後対応であり、根本的なモデルの型ミス自体を減らすものではない。システム
プロンプトに `findingIndex` は整数である旨の明示例を含めているが、モデル（特に小規模な
ローカルモデル）が指示に従わずリトライを消費し尽くす可能性は残る。

## 9. 関連ドキュメント

- 由来の記録: [docs/review-agent-workflow-spec.md](review-agent-workflow-spec.md)
- 並列レビュー段設計: [docs/review-agents-design.md](review-agents-design.md)
- finding欠落時の可視化設計: [docs/finding-location-silent-drop-spec.md](finding-location-silent-drop-spec.md)
- 要件検証基準: [evaluation/EVALUATION_PLAN.md](../evaluation/EVALUATION_PLAN.md)
- 実装プラン: [docs/plan/lead-engineer-agent.md](plan/lead-engineer-agent.md)
