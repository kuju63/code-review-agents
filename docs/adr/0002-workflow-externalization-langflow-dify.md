# ADR-0002: ワークフロー外部化(LangFlow/Dify)の検討

- Status: Proposed(検討継続中・採否未確定)
- Date: 2026-07-08
- Related: [ADR-0001](0001-large-diff-review-scope-policy.md), [docs/a2a-api-design.md](../a2a-api-design.md), [docs/review-agent-workflow-spec.md](../review-agent-workflow-spec.md), Issue #54

## Context

現行実装は元々LangFlowのワークフロー`Review-Agent.json`をベースに、A2A(Agent-to-Agent)
プロトコルへ移植したものである(`docs/review-agent-workflow-spec.md`)。移植時に
`/orchestrator`エンドポイントを新設し、3段フロー(PRInfoCollector → 並列レビュー →
LeadEngineer)全体を単一プロセス内で`asyncio.gather`によって実行する設計にした
(`docs/a2a-api-design.md` §3.1)。

ADR-0001で検討した大規模PR対応(トリミング/ファイル除外)は、「どこまでをPython側の
Agentの責務にするか」という設計判断でもある。ワークフロー制御(リトライ、フォールバック、
分岐)を外部オーケストレータ(LangFlow/Dify)に委ねるなら、こうしたスコープ判断を
フロー定義側の条件分岐ノードに移せる可能性がある。

現状、`/orchestrator`は「LangFlowワークフロー相当のフルフロー」をPython側に
再実装したものであり、外部化の検討は実質的に「一度LangFlowから移植したロジックを、
また部分的に外部ツールへ戻す」問いになる。名前は同じ「ワークフロー」でも、
担い手(Python内製 vs 外部ツール)という実体が変わる論点であることに注意する。

## Decision Drivers

- 系統A(ADR-0001の背景)の真因はモデル(`granite4.1:8b`)側の構造化出力収束信頼性であり、
  オーケストレーションをどこが担っても(Python内製でもLangFlow/Difyでも)、
  reviewerがLLM呼び出しである限りこの限界自体は解消しない。ワークフロー外部化が
  系統Aと関係するのは「収束失敗時のフォールバック・リトライ・人間へのエスカレーション」を
  柔軟に組み替えられる、という一点においてのみである。
- 評価パイプライン(`evaluation/tools/run_agent_evaluation.py`)は現在`/orchestrator`
  エンドポイントを直接HTTPで叩く前提で作られている。外部化した場合、評価は
  「個々のAgent(`/pr-info-collector`等)をLangFlow/Dify経由で呼び出す」形に変わり、
  再現性(同一入力で同一フロー判定が得られること)の担保方法を再設計する必要がある。
- CONTRIBUTING.md原則により、機能追加・変更は`docs/`配下でのSpec-Driven管理が
  必須。フロー定義がLangFlow/DifyのSaaS/別ホストに置かれると、この管理下から
  外れるリスクがある。

## Message-based vs 構造化出力の比較

LangFlow/Difyへ移行する場合、各AgentのA2Aレスポンスを「メッセージ(自由記述テキスト)」で
返すべきか、現状どおり「構造化データ(Pydanticスキーマ検証済みJSON)」で返すべきかが
論点になる。

| 観点 | メッセージベース(自由記述テキストを主とする) | 構造化出力(現状: Pydanticスキーマ検証済み) |
|---|---|---|
| 系統Aとの関係 | 収束先の制約(`structured_output_model`)自体を外すため、「スキーマに収束できず`StructuredOutputMissingError`」という失敗モードは原理的に消える。ただし変換責務が消えるわけではなく、後続ノード(LeadEngineer相当)側でのパース失敗に**移動するだけ**の可能性が高い(`docs/granite-structured-output-failure-spec.md` §5と同型のモグラたたきが再演しうる) | 現状の実装。収束失敗が`StructuredOutputMissingError`として起きうる(系統Aの直接原因)。ADR-0001の対策は入力側を縮小することでこの収束確率を上げるアプローチ |
| LangFlow/Difyとの親和性 | 両ツールともノード間の既定の受け渡し単位は「Message」型であり、チャットUI的な確認・デバッグがしやすい。プロンプトエンジニアリングだけでフロー変更が完結する | JSON Schemaをテキストとして流し、後続ノードでパースするカスタムコードノードが別途必要になり、フロー定義側の複雑度が増す。ただし両ツールとも「Structured Output」相当のノード/機能を持ち、構造化のまま渡すこと自体は両ツールのサポート範囲内 |
| 評価パイプラインとの整合性 | `run_agent_evaluation.py`のマッチングロジック(`evaluation/EVALUATION_PLAN.md` §3.1 Matching rule)は`file_path`/`line`/`category`等のフィールドを前提にしており、自由記述テキストからの再パース層が新たに必要になる。評価の再現性・決定性が低下するリスクがある | 現状のまま評価パイプラインと直結。追加実装不要 |
| 型安全性・契約の所在 | 検証責務がLangFlow/Dify側のプロンプト設計や追加のFunctionノードに分散する。契約は自然言語プロンプトでしか表現できず、`AgentCard.outputSchema`(`docs/a2a-api-design.md` §4)が採用した「自己完結JSON Schema」という既存の設計判断と矛盾する | 契約は`model_json_schema()`で自己完結し、`AgentCard`にそのまま埋め込める。既存の設計審査(§4冒頭の選択肢比較表、却下案B「非自己完結な`#/components`参照」)がこの理由で構造化出力を選んだ経緯と一貫する |
| 移行コスト | `ReviewOutput`/`ReviewResult`/`LeadEngineerReport`の各モデル、`base_reviewer.py`の`structured_output_model`呼び出し、評価スクリプトのパース処理を作り直す必要があり、影響範囲が大きい | 変更不要。LangFlow/Dify側では「JSON Schemaで検証済みの構造化データを返すAgent」としてそのまま利用可能(A2Aプロトコル自体がこれをサポート) |
| 人間可読性 | 高い。ノードのプレビュー画面でそのまま読める | 低いが、現状も`LeadEngineer`/`Orchestrator`のみ`A2ATextPart`でMarkdown要約を併載し補っている(`docs/a2a-api-design.md` §4.4/4.5) |

### 所見

現状の`AgentCard.outputSchema`設計は、まさに「LangFlow/DifyのようなA2Aクライアントが
検証可能であること」を選定理由として`model_json_schema()`埋め込みを採用済み
(却下案B: `#/components`はOpenAPI固有で非自己完結なため却下)。この経緯を踏まえると、
**構造化出力を維持したままLangFlow/Difyに委ねる**方が既存の設計判断と一貫し、
評価パイプラインへの影響も最小である。

メッセージベース化は、系統Aの失敗モードを「消す」のではなく後続ノードへ「移す」だけであり、
単独では真因(モデルの収束信頼性)を解決しない。人間向けの可読性が必要な箇所(最終report)は、
現状どおり`A2ATextPart`との併載(dual output)で足りる。

## Decision

現時点では以下を採用する。

1. **出力契約は構造化(Pydanticスキーマ検証済み)を維持する。** LangFlow/Dify委譲の
   可否によらず、`ReviewOutput`/`ReviewResult`/`LeadEngineerReport`の構造化契約は
   変更しない。
2. **ワークフロー外部化そのものは「検討継続」とし、本ADRでは採否を確定しない。**
   理由: `/orchestrator`を廃止しLangFlow/Difyにフロー制御を委ねる場合、評価パイプラインの
   再現性設計(現状はHTTP直叩き)をどう保つかという未解決の設計課題が残るため。
   この判断は別Issueで改めてスコープを切ってから着手する(CONTRIBUTING.md §1原則)。
3. ただし、各Agentが独立したA2Aエンドポイント(`/pr-info-collector`, `/react-reviewer`,
   `/security-reviewer`, `/lead-engineer`)としてすでに公開されている現状の設計
   (`docs/a2a-api-design.md` §1.3)は、外部化の判断がどちらに転んでも活かせる。
   「Agentを個別提供する」という方向性とは既に整合しており、追加の後戻りコストなく
   後日どちらの方向にも進める。

## Consequences

- `/orchestrator`エンドポイントは当面維持する(廃止はしない)。評価パイプラインが
  直接依存しているため、外部化の検討が具体化するまで既存の呼び出し経路を壊さない。
- 将来LangFlow/Difyへの委譲を正式決定する場合、評価パイプライン
  (`evaluation/tools/run_agent_evaluation.py`)の呼び出し先を「フロー経由」に
  切り替える追加設計が必要になる。これは本ADRの対象外とし、着手時に新Issueを立てる。
- 次に変化しうる箇所: LangFlow/Dify双方の「Structured Output」ノードの実際の信頼性
  (`granite4.1:8b`のような小型モデル利用時)を検証しないまま外部化を決めるのは早計。
  ADR-0001のトリミング/除外実装の評価結果と合わせて、次回この文書を更新する。
