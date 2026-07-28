# 指摘単位3軸評価仕様 (Issue #168)

## 1. 目的

Gold finding と Lead Engineer が採用した finding の双方に severity / impact / priority を保持し、指摘照合後の軸別一致率を評価できるようにする。

## 2. 全体データフロー

```text
pr_targets_{stack}.json
  PR単位 severity / impact / priority
        ↓ select_stack_targets.py（3軸を保持）
pr_targets.json
        ↓ build_gold_set.py（各コメントへ代理ラベルとして継承）
gold_pr_set.jsonl
  human_findings[].severity / impact / priority

ReviewReport
        ↓ LeadEngineerAgent（各findingを独立3軸で校正）
LeadEngineerReport
        ↓ to_evaluation_format()
agent_predictions.jsonl
  agent_findings[].severity / impact / priority

Gold finding ↔ Agent finding を既存条件で照合
        ↓ 照合済みペアだけを軸別比較
exact / within-one agreement
```

## 3. 軸の定義

| 軸 | 値域 | 意味 |
|---|---|---|
| severity | `critical` / `high` / `medium` / `low` | 問題そのものの深刻度 |
| impact（分類） | `security` / `correctness` / `performance` / `maintainability` | 主に影響を受ける品質特性 |
| priority | `high` / `medium` / `low` | 当該PRで対応する緊急度 |

この表の `impact` は4値の分類軸を指す。Lead Engineer出力ではこの分類を `impact_category` フィールドで保持し、評価用の `agent_findings` では `impact` キーとして直列化する。これは修正しない場合の影響を説明する自由記述フィールド `impact`（下記）とは別物である。自由記述の `impact` は評価軸ではなく、Markdownの「Impact if not fixed」にのみ現れる。

Gold schema は既存データとの互換性のため、各軸で `unknown` とフィールド欠落を許容する。Lead Engineer の構造化出力は3軸すべてを必須とし、`unknown` を許容しない。

既存Reviewerの `ReviewFinding.priority` は severity と priority を兼ねた4段階の初期評価である。この契約は変更せず、Lead Engineer が次を独立して出力する。

- `severity`: 4段階の最終severity
- `impact_category`: 4分類のimpact。`agent_findings.impact` へ直列化する
- `final_priority`: 3段階の最終priority
- `reason`: 判断根拠
- `impact`: 修正しない場合の影響を説明する既存の自由記述。`agent_findings` には出力しない

Reviewerの初期priorityが `critical` で、Lead Engineerの判定が欠落した場合、フォールバックする最終priorityは `high` とする。最終severityはReviewerの初期priorityをそのまま使用する。`impact_category` は元findingのperspectiveに基づき、securityなら`security`、それ以外は`correctness`を保守的な既定値とする。

## 4. Goldラベルの生成

`select_stack_targets.py` は選定結果から3軸を破棄せず、`repository` / `pr_number` とともに出力する。`build_gold_set.py` は対象PRの各 `human_findings` に同じ3軸を継承する。

このラベルはコメント固有の人手正解ではなく、PR全体のレビュー文脈から分類した代理ラベルである。したがって初期スコアは「個々のコメント分類の絶対精度」ではなく、「Leadの指摘分類がPR文脈分類とどの程度整合するか」を測る。将来コメント単位の正解ラベルを導入した場合は、その値で代理ラベルを置換できる。

旧形式の `pr_targets.json` が3軸を持たない場合、Gold findingには各軸を`unknown`として保存し、採点分母から除外する。

## 5. Lead Engineer出力

Lead Engineerはaccept/rejectと同時に、全findingへ独立3軸を付与する。acceptされたfindingだけが`agent_findings`へ出力され、`impact_category` の4値分類を評価形式の `impact` キーへ変換して次のフィールドを持つ。自由記述の `impact` は含めない。

```json
{
  "category": "security",
  "severity": "high",
  "impact": "security",
  "priority": "high",
  "path": "src/example.ts",
  "line": 42,
  "summary": "..."
}
```

`lead_decisions`には従来どおり全決定を保持する。Markdownはseverity / impact category / priorityと、自由記述のimpact / reasonを区別して表示する。

## 6. 照合と採点

findingの対応付けには既存条件だけを使う。新3軸は対応付け条件へ追加しない。これは、採点対象の軸で事前にペアを絞り、一致率を不当に高めることを防ぐためである。

照合済みペアについて次を集計する。

| 指標 | 計算 |
|---|---|
| severity exact agreement | severity完全一致数 / severity有効ペア数 |
| severity within-one agreement | severity段階差が1以内の数 / severity有効ペア数 |
| impact exact agreement | impact完全一致数 / impact有効ペア数 |
| priority exact agreement | priority完全一致数 / priority有効ペア数 |
| priority within-one agreement | priority段階差が1以内の数 / priority有効ペア数 |

順序尺度は低い順にseverityを `low=0, medium=1, high=2, critical=3`、priorityを `low=0, medium=1, high=2` とする。within-oneは完全一致を含む。impactは名義尺度なのでwithin-oneを定義しない。

各軸は、期待値と予測値がともに正規の値域にあるペアだけを分母へ含める。欠落、`null`、空文字、`unknown`、値域外、型不正はその軸の分母から除外する。分母が0なら一致率は`0.0`とし、分母件数も結果へ出力する。

既存の `severity_agreement` は `severity_exact_agreement` の互換エイリアスとして残す。Seeded setのhard gateとfinding照合条件は変更しない。

## 7. 受入条件

1. 選定済みPRの3軸がGoldの各findingへ保存される。
2. 旧形式のターゲットは`unknown`として処理できる。
3. Lead Engineerが全decisionへ独立3軸を必須出力する。
4. 採用findingの評価形式に3軸が保存される。
5. 5つの一致率と、軸別の有効ペア数・一致数が出力される。
6. 未知ラベルと未照合findingが一致率の分母に入らない。
7. 既存finding照合、Decision metrics、Seeded hard gateが変化しない。
8. 全テスト、lint、formatが成功し、coverageが75%以上である。

## 8. テスト方針

- target選定出力が3軸を保持する。
- Gold生成が各findingへ3軸を継承し、旧形式では`unknown`を使う。
- Lead構造化出力が3軸を必須とし、値域外を拒否する。
- Leadの欠落decisionフォールバックが3軸を生成する。
- 評価形式がpriorityをseverityへ詰め替えず、3軸を独立出力する。
- severity / priorityの完全一致、隣接一致、2段階以上の不一致を検証する。
- impactの一致・不一致を検証する。
- 欠落・unknown・不正値と分母0を検証する。
- 既存の照合戻り値とSeeded hard gateの回帰を検証する。
