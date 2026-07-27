# ADR-0006: 指摘単位の severity / impact / priority 評価方式

- Status: Accepted(提案・実装対象)
- Date: 2026-07-27
- Related: Issue #168, [docs/finding-axis-evaluation-spec.md](../finding-axis-evaluation-spec.md), [ADR-0005](0005-per-stack-evaluation-target-pipeline.md)

## Context

Lead Engineer は Severity / Impact / Priority を判断基準に掲げているが、実体はそうなっていない。`FindingDecisionOutput` は `impact` を自由記述、`final_priority` を4段階enumで持つのみで、severityは独立して存在しない。`to_evaluation_format` は `final_priority` を評価の `severity` 列へ詰め替えている（`models/lead_engineer.py:218`）。評価側の `score_evaluation.py` は `severity_agreement` だけを計算し、impact / priority を採点しない。

一方、選定パイプラインは PR 単位で severity / impact / priority を独立3軸として既に生成している（ADR-0005）が、これらは `select_stack_targets._to_output` で破棄され、Gold finding へ届いていない。

結果として、同じ「severity」「impact」という語が、選定側（独立3軸）と Lead 側（priority 兼用 + 自由記述）で別の実体を指し、指摘単位での軸別評価ができない。本 ADR は、この語と実体の不一致を解消し、指摘単位で3軸を採点可能にするための、コンポーネント間の責務分担とラベル供給源に関する意思決定である。

## 検討事項

1. Gold finding の3軸ラベルをどこから供給するか。
2. Agent 側で3軸を誰が確定するか（Reviewer か Lead Engineer か）。
3. 順序尺度の一致をどの厳しさで判定するか。

## 検討内容

### 検討事項1: Goldラベルの供給源

#### 案A: PR単位ラベルを各findingへ継承する

選定済みPRの severity / impact / priority を、そのPRの全 `human_findings` へ複製する。

| 観点 | 内容 |
| --- | --- |
| メリット | 既存の選定3軸を再利用でき追加コストが小さい。入口（母集団）から出口（採点）まで最短で疎通し、採点を即座に開始できる |
| デメリット | ラベルがコメント固有ではなくPR代理であり、粒度が粗い。同一PR内でコメントごとの深刻度差を表現できない |

#### 案B: LLMで各コメントを個別分類する

`build_gold_set.py` にLLM分類を追加し、inlineコメントごとに3軸を推定する。

| 観点 | 内容 |
| --- | --- |
| メリット | コメント固有の粒度で正解ラベルを付与でき、採点の妥当性が高い |
| デメリット | Gold生成のたびにAPIコストと非決定性が増える。決定的なGoldビルドという既存前提を崩す。今回の目的（入口を整え採点を疎通させる）に対し過剰 |

#### 案C: 現状維持（severityのみ、キーワード推定）

`_normalize_severity` のキーワード推定を続け、impact / priority を付与しない。

| 観点 | 内容 |
| --- | --- |
| メリット | 変更ゼロ |
| デメリット | impact / priority を永久に採点できない。Issue #168 の目的を満たさない |

### 検討事項2: Agent側で3軸を確定する主体

#### 案A: Lead Engineerが3軸を校正する

Reviewerの初期priority（severity兼用）は変えず、Lead Engineerの構造化出力に severity / impact / priority を独立追加する。

| 観点 | 内容 |
| --- | --- |
| メリット | 変更が Lead Engineer と評価経路に限定され、全Reviewerとテストを横断改修しない。集約・評価という Lead の既存責務と整合する |
| デメリット | Lead はPR差分を直接読まないため、入力はReviewerの初期評価とfinding本文に限られる。severityの独立性はReviewer初期値に依存する |

#### 案B: 各Reviewerが3軸を採点しLeadが集約する

Reviewer段で severity / impact / priority を出力し、Leadは受理・校正のみ行う。

| 観点 | 内容 |
| --- | --- |
| メリット | 各観点の専門Reviewerが最も近い文脈で採点でき、精度が高い |
| デメリット | 全Reviewerのプロンプト・モデル・多数のテストを横断改修する破壊的変更。`ReviewFinding` の契約変更が広範に波及する |

### 検討事項3: 一致判定の厳しさ

#### 案A: 完全一致と±1一致の併記

順序尺度の severity / priority について完全一致率と隣接1段階までの一致率を両方出力する。

| 観点 | 内容 |
| --- | --- |
| メリット | 1段階ズレを0点としない。代理ラベルの粒度の粗さを吸収しつつ、厳密一致も可視化できる |
| デメリット | 指標数が増え、レポートが冗長になる |

#### 案B: 完全一致のみ

既存 `severity_agreement` と同じく完全一致だけを見る。

| 観点 | 内容 |
| --- | --- |
| メリット | 指標がシンプル |
| デメリット | 隣接1段階のズレを完全な不一致として扱い、代理ラベルでは過度に低評価になりやすい |

## 検討結果

### 検討事項1 → 案A（PR単位ラベルの継承）を採用

目的は「入口を整えて採点を疎通させる」ことであり、案Aが最短で全経路を疎通させる。案Bはコメント固有の正解を得られるが、決定的Goldビルドを崩しコストと非決定性を増やすため、初期段階では過剰である。案Cは目的を満たさない。ラベルがPR代理である制約は仕様と評価計画に明記し、将来コメント単位ラベルへ置換できる構造にする。

- 許容したトレードオフ: Goldラベルの粒度がPR単位であり、同一PR内のコメント差を表現できない。

### 検討事項2 → 案A（Lead Engineerが校正）を採用

案Bは精度で優るが、全Reviewerと `ReviewFinding` 契約を横断する破壊的変更であり、段階導入の第一歩には重すぎる。案Aは変更をLeadと評価経路に限定でき、集約・評価というLeadの既存責務と一致する。LeadがPR差分を読まない制約は、Reviewer初期評価を入力とする現行設計の枠内で受け入れる。

- 許容したトレードオフ: severityの独立性がReviewer初期評価に依存し、Leadの校正余地が入力の範囲に限られる。

### 検討事項3 → 案A（完全一致と±1一致の併記）を採用

代理ラベルは粒度が粗く、1段階ズレを0点とする案Bでは過小評価になりやすい。完全一致も併記するため厳密な整合も失わない。指標増加は許容する。impactは名義尺度のため完全一致のみとする。

- 許容したトレードオフ: 出力指標とレポート行の増加。

## Decision

1. `select_stack_targets.py` は severity / impact / priority を破棄せず出力し、`build_gold_set.py` が各 `human_findings` へ代理ラベルとして継承する。旧形式で軸が無い場合は `unknown` とする。
2. Reviewer の `ReviewFinding.priority`（severity兼用・4段階）の契約は変更しない。Lead Engineer の構造化出力に severity（4段階）/ impact_category（4分類）/ final_priority（3段階）を独立追加し、`to_evaluation_format` が3軸を独立出力する。
3. `score_evaluation.py` は既存の照合条件を変えず、照合済みペアだけを軸別に採点する。severity / priority は完全一致と±1一致、impactは完全一致を出力する。分母は各軸で正規値を持つペアに限る。
4. `severity_agreement` は `severity_exact_agreement` の互換エイリアスとして残す。Seeded hard gate は変更しない。

## Consequences

- 指摘単位で severity / impact / priority を採点できるようになり、入口から出口まで疎通する。
- Goldラベルは当面PR代理であり、コメント固有の絶対精度ではなく、Lead分類のPR文脈整合を測る。将来コメント単位ラベルで置換可能。
- 変更はLeadと評価経路に限定され、全Reviewer横断改修を避ける。severityの独立性はReviewer初期評価に依存する制約が残る。
- 選定側とLead側で「severity」「impact」の語が指す実体が接近するが、Reviewerのpriority（severity兼用）は依然として別実体として残る。将来この分離を進める余地がある。
