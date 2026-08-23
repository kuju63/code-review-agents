# 評価パイプライン Agent実行(A2A送信/ポーリング)のTypeScript移植 設計ドキュメント (Issue #306)

Issue #254(`docs/typescript-evaluation-migration-spec.md`)は評価パイプラインのうち
`score_evaluation.py` / `discover_candidate_prs.py` / `build_seeded_set.py` の3ツールのみを
移植対象とし、「評価Agent実行(A2Aサーバーへの送信・ポーリング)」を明示的にスコープ外とした
(§1.2)。本ドキュメントはそのスコープ外部分、すなわち `evaluation/tools/run_agent_evaluation.py`
のうちA2A通信とpredictions.jsonl変換の責務を `packages/evaluation` へ移植する設計を定める。

---

## 1. 背景と問題

`packages/a2a-server`(TypeScript製A2Aサーバー)に対して評価を実行する際も、評価対象PRを
Agentへ送信しポーリングし結果を `agent_predictions.jsonl` へ変換する役割は
`evaluation/tools/run_agent_evaluation.py`(Python)しか存在しない。TS版A2Aサーバーへの評価は
現状Pythonクライアントからの呼び出しに依存しており、evaluation配下がPython/TypeScript混在の
まま部分的にしか完結していない。

## 2. スコープ

### 2.1 移植対象

`run_agent_evaluation.py` のうち以下の責務のみを `packages/evaluation/src/run-agent-evaluation.ts`
へ移植する。

- `/orchestrator/tasks/send` へのPOST送信とタスクIDの取得
- `/orchestrator/tasks/{id}` のポーリング(`completed`/`failed`/タイムアウト判定)
- 完了レスポンスの `LeadEngineerReport` を `agent_predictions.jsonl` 形式へ変換
- `--concurrency` に基づく並列実行(元の実行順序を維持した出力)
- predictions.jsonl本体と `{output}.failed_ids.json` sidecarの書き込み
  (`docs/eval-sharded-execution-spec.md` §2.4の命名規則・契約を踏襲)

### 2.2 対象外

- shard実行(`--shard-index`/`--shard-count`)。Python版に残す。今回はSeeded-only評価が
  最小要件であり、shardが必要な規模の実行は当面Python版を使う。
- レポート生成・Discord通知・スコアリングsubprocess呼び出し(`generate_evaluation_report.py`)。
  predictions.jsonl + failed_ids sidecarのJSONL契約さえ満たせば、既存のPython製レポート生成を
  そのまま流用できるため変更しない。
- Gold set対応の検証。今回はSeeded-only運用を前提に実装・検証するが、`/orchestrator`呼び出しの
  リクエスト形状はGold/Seeded双方で共通(Issue #237, `docs/plan/eval-seeded-orchestrator-unification-spec.md`)
  であるため、コード上はGold項目もそのまま処理できる。

## 3. 変換ロジックの再利用

`packages/agent-core` には既にproduction用の変換ロジックが存在する。

| 用途 | 既存実装 |
|---|---|
| 完了レスポンスのパース | `LeadEngineerReportSchema`(`@code-review-agent/agent-core`) |
| predictions.jsonl形式への変換 | `toEvaluationFormat(report, prId)`(`@code-review-agent/agent-core`) |

Python版はTSサーバーのcamelCase出力をPythonのsnake_case Pydanticモデルへ通すために
`_TS_FIELD_NAMES`/`_convert_ts_field_names` という変換層を持つが、これはPython-TS境界を
またぐために必要だった層であり、TS-to-TS構成では不要になる。`LeadEngineerReportSchema.parse()`
にサーバーの生JSONをそのまま渡せる。

`toEvaluationFormat()` は `category: d.perspective` をそのまま出力するのみで、Python版の
`_to_predictions()` が追加で行っている以下の正規化は行わない。

```python
if finding.get("category") != "security":
    finding["category"] = "unknown"
```

これはAgentのperspectiveベースの分類(technical/security)がGold/Seededの評価タクソノミー
(correctness/performance/...)と一致せず、`score-evaluation.ts` の `is_match()` 相当のカテゴリ
一致判定を素通りさせてしまうためのGold/Seeded評価専用の後処理であり、production側の
`toEvaluationFormat()` に持ち込むべきではない。よって本スクリプト側で同じ正規化を追加で適用する。

## 4. A2Aワイヤプロトコル

`evaluation/tools/a2a_client.py` および `packages/a2a-server/src/modules/a2a/{request,response}.model.ts`
から確認した契約:

```
POST {baseUrl}/orchestrator/tasks/send
  Authorization: Bearer <GITHUB_TOKEN>
  body: { message: { role: "user", parts: [{ kind: "data", data: { owner, repo, prNumber, modelId? } }] } }
  -> 202 { task: { id, status, message, error } }

GET {baseUrl}/orchestrator/tasks/{id}
  Authorization: Bearer <GITHUB_TOKEN>
  -> 200 { id, status: "submitted"|"working"|"completed"|"failed", message: {...}|null, error: string|null }
```

`status === "completed"` の `message.parts` から `kind === "data"` のpartを取り、その `data` を
`LeadEngineerReportSchema.parse()` に渡す。`status === "failed"` は `task.error` を含めて例外化する。
`status === "completed"` だが `message`/`parts`/`kind === "data"` のpartが欠落している場合も
`LeadEngineerReportSchema.parse()` の失敗と同様に例外化する。この例外は `evaluateConcurrently`
のワーカーがitem単位で捕捉するため、1件のスキーマ不整合が実行全体を止めることはなく、当該idは
`failed_ids` sidecarに記録され他のitemの処理は継続する。

### 4.1 タイムアウト契約

`evaluateItem` は1アイテムにつき一度だけ `deadline = now() + (--timeout 秒 × 1000)` を計算し、
その1アイテムが発行する**すべて**のHTTP呼び出し(`sendTask`の送信1回 + `pollTask`の各ポーリング)に
同じ `deadline` を共有させる。各呼び出しは `AbortSignal.timeout(deadline - now())`
相当のsignalを個別に持つため、サーバーが応答を返さず接続がハングした場合でも
`await fetch(...)` がその1呼び出し分の残り予算を超えて無期限にブロックすることはない
(Python版 `httpx.Client` の `timeout=` 引数と同等の目的だが、Python版は送信30秒/ポーリング10秒を
個別の定数として持つのに対し、TS版は1アイテム全体の `--timeout` 予算を送信・ポーリング全体で
共有する設計とした。個別の定数を追加で持つより、CLIの`--timeout`一つで全体の上限を説明できる方が
単純だと判断したため)。`pollTask` のループ本体は各呼び出し前後で `now() >= deadline` を確認し、
超過していれば(タイムアウトしたリクエストが例外なく応答を返した場合でも)明示的にタイムアウト
エラーとして例外化する。HTTP呼び出しだけでなく、次のポーリングまでの待機(`sleep`)も
`Math.min(pollIntervalMs, deadline - now())` で残り予算にクランプする — `--poll-interval` が
`--timeout` より大きい場合でも、待機自体が全体予算を超えて1itemを居座らせることはない。

## 5. CLI

```
run-agent-evaluation --seeded <path> --pred <path> [--gold <path>]
  [--base-url http://localhost:3000] [--concurrency 2]
  [--poll-interval 3] [--timeout 1800]
```

Python版と異なり `--gold` は省略可能(デフォルト未指定 = 処理しない)とする。今回の最小要件は
Seeded-onlyであり、このスクリプト自体は新規実装でありPython版とのCLI互換義務を負わない
(その義務は`score-evaluation.ts`など§2の移植対象ツールにのみ課されている、Issue #254 §2.9)。
`--base-url` のデフォルトは `packages/a2a-server` がハードコードするport 3000に合わせる
(`packages/a2a-server/src/index.ts` の `serve({ port: 3000 })`)。

`GITHUB_TOKEN` は環境変数必須(未設定はexit 2、Python版runner.py の規約に合わせる)。

数値オプションは `main()` がcommanderのパース直後に検証し、無効な場合はログにエラーを出して
exit 2とする(ネットワーク呼び出しを一切行わずに即座に失敗させる)。

| オプション | 許容範囲 | 無効値の例 |
|---|---|---|
| `--concurrency` | 1以上の整数 | `0`, `-1`, `1.5`, `abc` |
| `--poll-interval` | 0より大きい有限数(秒) | `0`, `-1`, `abc` |
| `--timeout` | 0より大きい有限数(秒)、かつ ×1000 後もNode/AbortSignalのタイマー上限(2^31-1ms)以内 | `0`, `-1`, `abc`, `1e308`, `999999999999` |

`--poll-interval` に0を許すと、`completed`/`failed`になるまでGETを連続送信し続け、
`--concurrency`件を並列実行している間はその倍数でA2Aサーバーへの負荷が増える。CLI境界では
0を無効値として拒否する(単体テストが `pollTask`/`evaluateItem` を直接呼ぶ際に
`pollIntervalMs: 0`相当を使うのは許容する — CLIを経由しないため上記の負荷増大は起きない)。

`--concurrency` が未検証のままだと、`NaN`は `Number.isInteger(NaN)` が `false`
を返すため`parsePositiveInteger`で弾かれるが、仮に弾かずに`evaluateConcurrently`の並列度計算
(`Math.max(1, Math.min(concurrency, items.length))`)へ渡ると、`NaN`は
`Array.from({ length: NaN })` を0要素の配列にし全item未評価のまま`status 0`を返す一方、
`Infinity`は`Math.min(Infinity, items.length)`が`items.length`になるため全itemを
無制限に同時実行する — 無症状さの種類がNaNとInfinityで異なる(coderabbitレビューで指摘)。
`evaluateConcurrently` 自身にはこの検証を入れずCLI境界(`main()`)でのみ検証する —
内部関数は呼び出し元がCLIパース値ではなくテストからの直接呼び出しであることもあり、
境界でない箇所への検証追加は「起こり得ないケースへの防御」にあたるため(CLAUDE.md 実装ルール)。

### 5.1 検証コマンド

実装完了後は必ず以下を実行し、失敗した場合は完了報告前に修正する(CLAUDE.md 必須チェックリスト §5-6)。

```bash
pnpm exec vitest run packages/evaluation/src/run-agent-evaluation.test.ts
pnpm exec tsc --noEmit
pnpm exec biome check --no-errors-on-unmatched packages/evaluation/src/run-agent-evaluation.ts packages/evaluation/src/run-agent-evaluation.test.ts
```

### 5.2 出力ファイルの整合性

`writePredictionsAndSidecar` は `predictions.jsonl` を`writeJsonlAtomic`(一時ファイル→
atomic rename)で書き込んだ後、`{output}.failed_ids.json` sidecarを別の書き込みとして
書く。predictions.jsonl自体は途中終了しても壊れた内容にはならないが、2ファイル間の
アトミック性(両方同時に更新される保証)はない — 書き込み順の途中でプロセスが終了すると、
新しいpredictions.jsonlに対して前回実行時の古いsidecar(または初回実行なら存在しない
sidecar)が残る可能性がある。これはPython版 `_write_predictions_and_sidecar`
(こちらは predictions.jsonl 自体も atomic rename を使わない、単純な `open(..., "w")`)と
同じく、この実行単位では解消していない既知の制約として明記する
(`generate_evaluation_report.py` はsidecar欠落を検出し `--allow-missing-failed-ids`
なしではexit 5にするため、無音の不整合にはならない)。

## 6. 並行実行と出力順序

Python版 `_evaluate_concurrently` と同じ方針: `Promise` ベースで最大 `--concurrency` 件を
同時実行しつつ、結果配列は元の入力順を維持する(スコアやレポートの再現性のため、完了順ではなく
入力順で書き出す)。1件の失敗は他の実行を止めず、`failed_ids` に集約する。

## 7. 検証

- 単体テスト(vitest): リクエスト構築、ポーリング状態遷移(working→completed/failed/timeout)、
  デッドライン共有によるハングした接続のabort、`toEvaluationFormat`結果へのcategory正規化、
  predictions.jsonl + sidecar書き込みをモックfetchで検証。
- 統合確認: TS版A2Aサーバー(`packages/a2a-server`, port 3000)を起動し、Seeded setの1件を
  実際に処理して `agent_predictions.jsonl` が生成されることを手動確認する(自動テストの範囲外)。
- 受け入れ条件: §5.1の検証コマンド(vitest / tsc --noEmit / biome check)がすべて成功すること。
  いずれかが失敗した場合は完了報告前に修正する(CLAUDE.md 必須チェックリスト §5-6)。
