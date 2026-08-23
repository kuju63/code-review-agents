# `evaluation/` TypeScript移行 設計ドキュメント (Issue #254)

Epic #249（全面TypeScript化）のSub-Issue⑤として、評価パイプラインのうちPython版Strands AgentsおよびプロダクションPythonコードへ直接依存する3ツールを`packages/evaluation`へ移植する。

対象は次の3ツールである。

- `evaluation/tools/score_evaluation.py`
- `evaluation/tools/discover_candidate_prs.py`
- `evaluation/tools/build_seeded_set.py`

`gold_pr_set.jsonl`、`seeded_set.jsonl`、`agent_predictions.jsonl`のJSONL契約は変更しない。旧Python資産の削除はIssue #255の責務とし、本Issueではjudge parity確認まで新旧実装を併存させる。

## 1. スコープ

### 1.1 移植対象

| TypeScriptモジュール | 移植元 | 責務 |
|---|---|---|
| `score-evaluation.ts` | `score_evaluation.py` | Gold/Seededスコア計算、任意のLLM semantic judge、JSON report出力 |
| `discover-candidate-prs.ts` | `discover_candidate_prs.py` | 候補repository/PRの取得・フィルタ・LLM分類、stack別target生成 |
| `build-seeded-set.ts` | `build_seeded_set.py` | Seed PRのINTENTIONAL marker解決、Seeded JSONL生成 |
| `lib/github-rest.ts` | `github_api.py`とdiscoverer内`GitHubClient` | GitHub REST取得、pagination、rate-limit retry、安全なredirect処理 |
| `lib/target-criteria.ts` | `target_criteria.py` | production/test/doc変更の分類 |
| `lib/jsonl.ts` | 各ツールのJSONL処理 | JSONL read/writeとatomic write |
| `lib/logging.ts` | `eval_logging.py` | machine-readable stdoutと診断stderrの分離 |

### 1.2 対象外

- 評価Agent実行およびjudge parityの実スコアリング。別マシンで実施する。
- JSONL schema/dataの変更。
- Python資産、uv、pytest、ruff設定の削除。Issue #255で行う。
- `build_gold_set.py`等、Issue本文が指定しない評価ツールの全面移植。

ただし`generate_evaluation_report.py`は`score_evaluation.py`をsubprocess実行するため、`_score`の呼び出し先のみTypeScript CLIへ変更する。これにより移植後のscorerが実際のreport生成経路から到達可能になる。

## 2. 互換性要件

1. `score-evaluation`はstdoutへreport JSONのみを出力し、ログはstderrへ出す。
2. scorerのJSON object shape、metric名、count名、item detailを維持する。
3. matchingはpath完全一致、line差5以内、既知category同士のみcategory一致を要求する。
4. semantic judgeは任意機能であり、呼び出し失敗またはstructured output欠落時はnon-matchとしてfail closedする。
5. greedy matchingはpred findingを一度だけ消費する。
6. critical missはgreedy matching結果ではなく、全pred poolに対する構造的matchの有無から計算する。
7. duplicate findingは値ではなくobject identityでraw rowへ対応付ける。
8. `build-seeded-set`は全targetの処理成功後にのみatomic renameで出力を更新する。
9. CLI option、default、主要exit statusはPython版と同等にする。

## 3. `is_target_file`共有方法

`build_seeded_set.py`はプロダクションコードの`pr_info_collector.is_target_file`を直接importしている。Issue #254が要求する選択肢比較は次の通り。

| 選択肢 | 判定 | 理由 |
|---|---|---|
| (a) TypeScript側predicateを共有 | **採用** | `packages/agent-core/src/agents/pr-info-collector.ts`に`isTargetFile`が既に存在し、プロダクションとevaluationを単一の実装へ統一できる。Epic #249の重複排除という目的に合致する |
| (b) evaluation内に複製 | 却下 | extension/filename集合の変更時にドリフトし、Seeded builderと実際のreview対象が不一致になる |
| (c) production CLI/API経由 | 却下 | 副作用のない文字列predicateにprocess/network境界を導入し、失敗点と実行コストを増やす |

`isTargetFile`と`isDependencyFile`は`pr-info-collector.ts`から依存の軽い`agents/target-file.ts`へ抽出する。`pr-info-collector.ts`から再exportして既存consumerとの互換性を保ち、evaluationは`@code-review-agent/agent-core/agents/target-file.js`をimportする。これによりpredicate利用だけでStrands/MCPを含むcollector module全体を評価ツールへロードしない。

## 4. CLIとpackage境界

CLI parserには`commander`を採用する。Node標準`parseArgs`は依存を追加しない利点がある一方、3ツールが必要とするrequired option、repeatable option、choices、help、default、validationを各CLIで再実装する必要がある。`commander`の宣言的なoption定義によりPython `argparse`との対応をレビューしやすくする。

`packages/evaluation`は`@code-review-agent/agent-core`へ`workspace:^`で依存し、`tsconfig` project referenceを追加する。CLIはpackageの`bin`からbuild済みJavaScriptを起動する。ローカル開発ではpnpm scriptを通じて実行する。

`generate_evaluation_report.py::_score`はPython interpreterで旧scorerを起動せず、pnpm経由でTypeScript scorer CLIを起動する。stdoutのみcaptureしstderrは継承する既存契約を維持する。

## 5. LLM invocation

### 5.1 Semantic judge

`score-evaluation`はagent-coreの`createModelProvider`を再利用し、`@strands-agents/sdk`の`Agent.invoke`とZod schemaによるstructured outputを使用する。TypeScript SDKが非同期APIのみを提供するため、semantic judgeを受け取るmatching/scoring APIはPromiseを返す。

### 5.2 Candidate assessor

`discover-candidate-prs.py`はagentの評価設定から独立させるため`OpenAIModel`を直接生成している。この実体を維持し、candidate assessorを`createModelProvider`へ統合しない。

## 6. GitHub REST security

GitHub REST helperは次を維持する。

- HTTPSかつ`api.github.com`のみを認証付きrequest先として許可する。
- redirectを自動追従せず、locationを再検証してから追従する。
- tokenを許可されていないhostへ送信しない。
- paginationを上限付きで処理する。
- 403/429およびrate-limit headerに基づくbounded retryを行う。
- API errorは空配列へ暗黙変換せず、dataset生成をfail closedする。

実装スライス・検証手順は [docs/plan/typescript-evaluation-migration-spec.md](plan/typescript-evaluation-migration-spec.md) を参照。
