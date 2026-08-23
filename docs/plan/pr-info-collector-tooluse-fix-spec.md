# PR Info Collector ツール呼び出し修正 検証手順 (Python版)

設計: [docs/pr-info-collector-tooluse-fix-spec.md](../pr-info-collector-tooluse-fix-spec.md)

```bash
# 単体テスト（決定論コレクタ）
uv run pytest tests/agents/test_pr_info_collector.py

# 全体検証
uv run pytest && uv run ruff check && uv run ruff format --check

# 20回計測 → 決定論レポート生成
python evaluation/tools/verify_pr_collector_repeated.py --runs 20
python evaluation/tools/analyze_pr_collector_repeated.py \
  --jsonl evaluation/data/pr_collector_repeated_google_gemma-4-e4b.jsonl \
  > evaluation/PR_COLLECTOR_ACCURACY_GEMMA4_E4B_DETERMINISTIC.md
```
