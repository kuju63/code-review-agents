# A2A API 実装プラン

## Context

`docs/a2a-api-design.md` の設計仕様に基づき、各 Agent を A2A（Agent-to-Agent）プロトコル準拠の
HTTP API として公開する。実装は TDD（RED → GREEN → REFACTOR → Commit）サイクルで進め、
各 Phase 完了後にコミットし、全 Phase 完了後に全体リファクタリングを実施する。

詳細設計: [docs/a2a-api-design.md](../docs/a2a-api-design.md)

---

## 停止条件

- 実 PR 検証（Phase 10）において Agent のタイムアウトが **1 回でも発生した場合、即座に停止する**。
- タイムアウト発生時は Agent 実装側の見直しが必要と判断し、それ以上の修正作業は行わない。
- 停止記録は `evaluation/data/a2a_verification.jsonl` に残す。

---

## 検証対象 PR

| 項目 | 値 |
|---|---|
| リポジトリ | `carbon-design-system/carbon-addons-iot-react` |
| PR 番号 | `#4096` |
| 検証 API | `pr-info-collector`、`orchestrator` |

---

## 環境変数・.env ファイル

Agent 実行には `.env` ファイルによる環境変数の読み込みを使用する。
テンプレートは `.env.example` を参照。

`Settings`（`api/config.py`）は `pydantic-settings` の `env_file=".env"` 設定により、
サーバー起動時に自動で `.env` を読み込む。

`verify_a2a_api.py` も `python-dotenv` の `load_dotenv()` を使って `.env` を読み込む。

---

## 実装フロー

```text
Phase 0  依存追加 & スペックベースライン
Phase 1  a2a/models.py（A2A プロトコルモデル）
Phase 2  a2a/task_store.py（インメモリ TaskStore + TTL）
Phase 3  a2a/utils.py（sanitize_error）
Phase 4  api/config.py（Settings with pydantic-settings）
Phase 5  api/dependencies.py（verify_github_token）
Phase 6  既存 Agent 拡張（ReviewerConfig.llm_base_url）
Phase 7  api/agents/common.py（_extract_data）
Phase 8a api/agents/pr_info_collector.py
Phase 8b api/agents/react_reviewer.py / security_reviewer.py / lead_engineer.py
Phase 8c api/agents/orchestrator.py
Phase 9  api/app.py + __init__.py main() 変更
Phase 10 evaluation/tools/verify_a2a_api.py（実 PR 検証スクリプト）
Phase 11 全体リファクタリング + Quality Gate
```

---

## アーキテクチャ上の重要な選択

| 判断 | 理由 |
|---|---|
| `api/agents/__init__.py` からルーターをエクスポート | `app.py` の依存関係を1箇所に集約し変更容易性を確保 |
| `Settings.env_file=".env"` | コンテナビルドなしに環境差分を吸収できる開発体験を維持 |
| タイムアウト即停止 | Agent タイムアウトは Agent 実装問題であり、API 層での回避不可 |
| `pytest-asyncio` の `asyncio_mode = "strict"` | 既存の同期テストに影響を与えず、非同期テストを明示的に管理 |
| `sanitize_error` による例外サニタイズ | GitHub トークンがエラーレスポンスに漏洩するリスクを排除 |
| `llm_base_url` はサーバー環境変数のみ | SSRF リスクを設計レベルで排除（§12.2 参照） |

