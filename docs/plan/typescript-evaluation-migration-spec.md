# `evaluation/` TypeScript移行 実装計画 (Issue #254)

設計: [docs/typescript-evaluation-migration-spec.md](../typescript-evaluation-migration-spec.md)

## 実装スライス

| Slice | 内容 |
|---|---|
| S1 | 本spec、target-file leaf抽出、JSONL/logging/GitHub REST/target criteria基盤とテスト |
| S2 | `build-seeded-set.ts`とテスト |
| S3 | `score-evaluation.ts`、scorerテスト、`generate_evaluation_report.py`のCLI接続変更 |
| S4 | `discover-candidate-prs.ts`、GitHub client、テスト、利用者向けdocument更新 |

各sliceはRed（実行されたassertion failure）、Green、Refactor、CodeRabbit review、validationの順に進め、rollback可能なcommitを作る。

## 検証

本マシンでは評価パイプラインおよびLLM judge parityを実行しない。次の静的・単体検証を行う。

```bash
nix develop --command pnpm run test
nix develop --command pnpm run typecheck
nix develop --command pnpm run lint
```

Vitest coverage gateはlines/functions/branches/statementsの各75%以上とする。Python版testが保証するsemantic judge fail-closed、greedy consumption、critical full-pool semantics、axis agreement、atomic write、marker resolution、REST allowlist/redirect制限をTypeScript testへ移植する。

別マシンでは同一prediction fileを新旧judgeで再スコアリングし、Must-Find RecallがEpic #249 Step 1 baseline比-5ポイント以内かつ絶対値0.60以上であることを確認する。
