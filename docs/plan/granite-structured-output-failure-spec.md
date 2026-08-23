# granite 構造化出力失敗: テスト・検証結果 (Python版)

設計: [docs/granite-structured-output-failure-spec.md](../granite-structured-output-failure-spec.md)

## 変更#4（可視化）のテスト

- 単体テスト（`caplog`）で、`set_failed` が存在タスクに対し WARNING で `error`（reviewer 名・
  `stop_reason` を含む）を出力すること。
- 複数行エラーが単一ログ行に正規化され、かつ保存 `error` は full のまま保持されること。
- 未知IDに対しては状態変更もログ出力もない（noop）こと。

## 変更#2（緩和）のテスト

- 単体テスト: `compose_system_prompt()` が role prompt 末尾にディレクティブを付与すること、
  および各 reviewer の**合成後**プロンプトにディレクティブが含まれること
  （`tests/agents/test_reviewers.py`）。`review()` が合成後プロンプトで `Agent` を構築すること
  （`tests/agents/test_base_reviewer.py`）。
- 評価②: 失敗件数 / Must-Find Recall / Critical Miss Rate をベースライン（4失敗）と比較。

## 検証結果（granite4.1:8b, gold 5 + seeded 10, `--concurrency 2`）

| 指標 | ベースライン `8a711e1` | 評価① #4 `4c93e0e` | 評価② #4+#2 `12a6c05` | 目標 |
|---|---|---|---|---|
| 失敗項目数 | 4 | 1 | **0** | 0 |
| `StructuredOutputException`（ログ） | （未ログ） | 1 | **0** | 0 |
| 予測できた項目 | 11/15 | 14/15 | **15/15** | 15 |
| Issue Recall | 0.233 | 0.256 | 0.302 | ≥0.70 |
| Issue Precision | 0.400 | 0.423 | 0.371 | ≥0.60 |
| Gold マッチ数 | 10 | 11 | 13 | - |
| Must-Find Recall | 0.200 | 0.200 | 0.200 | ≥0.95 |
| Critical Miss Rate | 1.000 | 1.000 | 1.000 | =0 |
| Hard Gate | FAIL | FAIL | FAIL | PASS |

### 実際の失敗文言（#4 のログが捕捉）

```text
The model failed to invoke the structured output tool even after it was forced.
```

出所は Strands `event_loop/event_loop.py:363-367`。当初推定していた `limit_turns` による
`StructuredOutputMissingError` とは別物で、#4 の可視化により推定が訂正された。

### 結論

- **#2 は構造化出力の失敗モードを解消した**: 失敗 4→1→0、`StructuredOutputException` 0件。
  「散文で `end_turn` して構造化ツールを呼ばない」挙動を直接抑制したことが効いている。
- Issue Recall は単調改善（予測できる項目が増えたため）。
- **ただし Hard Gate は依然 FAIL**: Must-Find Recall（0.2）と Critical Miss Rate（1.0）は不変。
  #2 は「失敗して欠落する」問題を直したが、granite の**検出品質そのものは改善しない**。
- 失敗は非決定的（項目固有でない）。評価②単発の 0件は統計的証明ではないが、
  「0件 + 例外0 + Recall 単調改善 + 機構的裏付け（`event_loop.py`）」が一貫して #2 の有効性を支持する。
