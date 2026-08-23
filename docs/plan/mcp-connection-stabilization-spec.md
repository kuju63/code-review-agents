# MCP接続の安定化 実装計画 (Issue #115、Python版)

設計: [docs/mcp-connection-stabilization-spec.md](../mcp-connection-stabilization-spec.md)

## 変更対象ファイル(Python版・完了済み)

| ファイル | 変更の性質 |
|---|---|
| `src/code_review_agent/tools/github_mcp.py` | `create_github_mcp_client`が返す`MCPClient`の`start()`にリトライ機構を追加。3経路すべてがここを通るため、これが唯一のリトライ実装箇所となる |
| `src/code_review_agent/agents/review_orchestrator.py` | 共有クライアントの生成・初回起動・参照登録/解放を追加(起動自体のリトライは`github_mcp.py`側で一元化されるため、ここでの実装は不要) |
| `src/code_review_agent/agents/base_reviewer.py` | 共有クライアント使用時のフォールバック分岐、終了処理を`agent.cleanup()`に変更 |
| `src/code_review_agent/agents/pr_info_collector.py` | 変更なし(起動処理は経路(1)のまま`MCPClient.start()`を直接呼ぶが、リトライは`github_mcp.py`側で一元化されるため呼び出し元の変更は不要) |
| `src/code_review_agent/agents/exceptions.py` | `INFRA_EXCEPTIONS`に`ToolProviderException`を追加 |
| `src/code_review_agent/api/config.py` | `mcp_startup_retry_attempts`・`mcp_startup_retry_backoff_seconds`を追加 |
| `pyproject.toml` | `tenacity`を直接依存として追加 |
| `src/code_review_agent/models/review.py`(`ReviewContext`定義箇所) | 共有MCPクライアントを保持する拡張フィールドを追加 |

TS移植版は `packages/agent-core/src/tools/github-mcp.ts` / `agents/review-orchestrator.ts` /
`agents/base-reviewer.ts` として完了済み。詳細な決定ログは
[docs/typescript-agents-tools-migration-spec.md](../typescript-agents-tools-migration-spec.md) §2.1〜2.3・§5.3を参照。

## テスト方針

具体的なテストコードは実装(TDD)フェーズで確定するが、少なくとも次の観点をカバーする:

- 起動リトライがバックオフを伴って動作し、最大試行回数で打ち切られること(3経路それぞれ)。
- 経路(2)(3)それぞれで、リトライを尽くした後の最終失敗が`ToolProviderException`として`INFRA_EXCEPTIONS`に
  分類され、`ReviewOrchestrator.run_async()`から再送出されること。
- 並列レビュー実行時、複数レビュアー間でMCPクライアントのインスタンスが共有されること(生成回数が1回に
  なること)。
- オーケストレータ・複数レビュアーが参照カウントの利用者として正しく登録・解放され、全利用者が解放された
  時点でのみ接続が終了すること。
- 共有クライアントが渡されない場合(単体利用・MCP不使用レビュアー)は現状と同じ挙動(個別生成・個別終了)を
  維持すること(既存テストの回帰確認)。

## 検証手順

```bash
uv run pytest
uv run ruff check
uv run ruff format --check
```

実装完了後、必要に応じて評価パイプライン([evaluation/RUNBOOK.md](../../evaluation/RUNBOOK.md))を再実行し、
Issue #115の受け入れ基準(MCP接続起因の失敗が0件または大幅減)を確認する。
