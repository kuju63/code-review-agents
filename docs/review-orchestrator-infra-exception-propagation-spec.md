# インフラ例外の握りつぶし修正 設計ドキュメント (Issue #56)

`ReviewOrchestrator.run_async` と `PRInfoCollector.collect` が、レビュアー/収集処理の実行中に発生したインフラ層の致命的例外（strandsのモデル接続失敗、GitHub MCPクライアント初期化失敗、トランスポート層のタイムアウト等）を、ビジネス層の部分失敗として無条件に握りつぶしてしまう不具合を修正する。

---

## 1. 背景と問題

評価パイプラインRCAにて、`ReviewOrchestrator.run_async` がレビュアー実行中に発生した**あらゆる例外**（strandsの `EventLoopException` を含む）を無条件に `ReviewError`（＝「このレビュアーだけ失敗、他は続行」というビジネス層の部分失敗を表す型）に変換してしまうことが判明した。

その結果、`orchestrator._run`（API層、`src/code_review_agent/api/agents/orchestrator.py`）は `ReviewReport(results=[], errors=[...])` を「正常応答」とみなして後続の `lead_agent.evaluate` を起動してしまい、無駄なターンを消費した末にA2Aタスクが `status=working` のまま1800秒でクライアントタイムアウトする。本来はインフラ障害を検知した時点でタスクを即座に `failed` にすべきだった。

### 発生する連鎖

```
reviewer.review() → httpcore.ReadTimeout
  → strands EventLoopException
    → review_orchestrator が ReviewError に変換して握りつぶす
      → ReviewReport(results=[], errors=[ReviewError(...)])
        → orchestrator._run は正常とみなし lead_agent.evaluate を起動
          → A2Aタスクが status=working のまま長時間経過してクライアントタイムアウト
```

### issue本文との乖離（前提の是正）

issue #56 本文が引用しているコード（`asyncio.gather(..., return_exceptions=True)`, 旧 `review_orchestrator.py:83-88`）は、既に別PR（#68, commit `f66390d`, タイムアウト対応リファクタ）で `asyncio.create_task` + `asyncio.wait` 方式に置き換わっており、現在は存在しない。しかし**バグの本質（インフラ例外の無条件降格）は温存されている**。修正対象は現行コードの `review_orchestrator.py` 内の集約ループである。

### 横展開スコープの検証（名前ではなく実体で判断）

issue対応の依頼時に「lead_engineerなど他Agentへの横展開」も要望されたため、実装前に対象ファイルを実際に読んで検証した:

- **`lead_engineer.py`**: `evaluate()` は例外を無条件に上位へ伝播させる素直な実装で、`asyncio.gather`/`wait` による集約や広範な `except Exception` による握りつぶしは存在しない。`EventLoopException` は既に正しく `orchestrator.py:_run` の境界 `except Exception` まで届く。**→ 修正不要**。
- **`api/agents/*.py`**（orchestrator/pr_info_collector/lead_engineer/security_reviewer/frontend_reviewer の各A2Aハンドラ）: いずれも `except Exception as exc: await store.set_failed(...)` という意図的なタスク境界の捕捉であり、これが最終的にインフラ例外を拾う受け皿になる。**→ 修正不要**。
- **`agents/pr_info_collector.py`**（issue本文で言及なし）: issue #56 と同型の「インフラ例外を握りつぶして処理続行」パターンが**3箇所**実在する（後述）。**→ 修正対象に追加**。

つまり実体としては「lead_engineerへの横展開」は空振りで、`pr_info_collector.py` が真の横展開対象だった。評価パイプライン（`evaluation/tools/`）側への対応は今回のスコープ外とする。

---

## 2. 修正方針

### 対象とするインフラ例外

| クラス | 発生源・根拠 |
|---|---|
| `strands.types.exceptions.EventLoopException` | `strands/event_loop/event_loop.py`。モデル呼び出し中に発生したほぼ全ての未分類例外（httpcore/httpx/openai由来の接続断・タイムアウト含む）をラップする catch-all。issue本文が名指しした主対象。 |
| `strands.types.exceptions.MCPClientInitializationError` | `strands/tools/mcp/mcp_client.py`。GitHub MCPサーバへの接続確立失敗時に送出される、`EventLoopException` とは別経路（クライアント初期化フェーズ）のインフラ障害。 |
| `httpx.TransportError` | strandsのイベントループ外（`finally` でのMCPクライアント停止、`call_tool_sync` の素の呼び出し等）で発生した接続断・タイムアウトは `EventLoopException` にラップされず素の `httpx.*` 例外として伝播しうる。`ConnectError`/`ReadTimeout`/`PoolTimeout` 等の共通基底クラス。 |

`httpcore.*` 例外は個別に扱わない（httpxの公開APIを通る限りhttpx側の例外型に変換される）。`ContextWindowOverflowException`（#54の領分）、`MaxTokensReachedException`（既存の `StructuredOutputMissingError` に近いビジネス層寄り）は対象外とする。

3クラスを `src/code_review_agent/agents/exceptions.py` に `INFRA_EXCEPTIONS` タプルとして共有定義し、`review_orchestrator.py` と `pr_info_collector.py` の双方から参照する。

### `review_orchestrator.py`

集約ループで `isinstance(exc, INFRA_EXCEPTIONS)` が真の場合は `ReviewError` に降格せず `raise exc` で再送出する。ループ中で即座に送出するため、他の未処理タスクへの後始末は追加しない — 既存のタイムアウト処理（「letting timed-out threads finish in the background」）と同じ設計方針を踏襲する。

再スローされた例外は `Exception` のサブクラスなので、`api/agents/orchestrator.py:_run` の既存 `except Exception as exc: await store.set_failed(...)` がそのまま捕捉する。API層の変更は不要。

### `pr_info_collector.py`

以下3箇所の `except Exception:` は「オプショナルなデータ取得なので失敗しても握りつぶして続行する」という既存の設計意図（コード内コメントに明記、意図的なグレースフルデグレード）を持つ。この設計自体は妥当なため全否定せず、**インフラ障害だけを例外的に再送出する**形にする:

1. README要約の `project_summary` フォールバック — モデル接続失敗時に空文字へ縮退する既存挙動は、非インフラ例外（要約自体の失敗等）に対しては維持する。
2. `_read_dependency_files` — 依存ファイル一覧取得失敗時に空リストへ縮退する既存挙動を維持する。
3. `_read_readme` — README取得失敗時に `None` へ縮退する既存挙動を維持する。

いずれも `except INFRA_EXCEPTIONS: raise` を非インフラ例外用の `except Exception:` より前に追加する。

### 対象外

- `lead_engineer.py`: 同型の握りつぶしパターンなし。
- `api/agents/*.py`: 意図通りのタスク境界捕捉。
- 評価パイプライン（`evaluation/tools/`）: スコープ外（ユーザー方針）。

---

## 3. テスト

### `tests/agents/test_review_orchestrator.py`

インフラ例外を送出する専用フェイクリビュアーを追加し、`ReviewOrchestrator.run()` がその例外型をそのまま伝播すること（`report.errors` に格納されないこと）を検証する。既存の `test_error_is_isolated`（`ValueError` → `ReviewError`）は回帰確認としてそのままgreenを維持する。

### `tests/agents/test_pr_info_collector.py`

`_summarize_readme` / `_read_dependency_files` / `_read_readme` それぞれについて、`INFRA_EXCEPTIONS` に属する例外を送出するモックを注入した場合に `collect()` が例外を再送出すること、非インフラ例外の場合は従来通り握りつぶして継続することを検証する。

---

## 4. 検証手順

1. `uv run pytest tests/agents/test_review_orchestrator.py tests/agents/test_pr_info_collector.py -v`
2. `uv run pytest --cov=code_review_agent --cov-branch --cov-fail-under=75`
3. `uv run ruff check`
4. `uv run ruff format --check`
