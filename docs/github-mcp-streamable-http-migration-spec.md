# GitHub MCP `streamable_http_client` 移行 設計ドキュメント

PR #42（mcp 1.27.2 → 1.28.0）で判明した `streamablehttp_client` の `DeprecationWarning` を解消し、
`src/code_review_agent/tools/github_mcp.py` を新 API `streamable_http_client` へ移行するための設計を定義する。

---

## 1. 背景と問題

### 1.1 API の変化

| | 旧 API（非推奨）: `streamablehttp_client` | 新 API: `streamable_http_client` |
|---|---|---|
| 認証ヘッダー | `headers: dict[str, str] \| None` を直接渡せた | パラメータ廃止。**設定済みの `httpx.AsyncClient` を渡す**設計に変更 |
| ソース | `mcp/client/streamable_http.py:686-723`（内部で `streamable_http_client` をラップする deprecated shim） | `mcp/client/streamable_http.py:600-682` |

`headers` 引数がなくなったため、単純なシンボリックの差し替えでは対応できず、Issue #43 へ先送りされていた。

### 1.2 `httpx.AsyncClient` の所有権問題

新 API のソース（`streamable_http_client` 本体, L637-654）を確認した:

```python
client_provided = http_client is not None
client = http_client
if client is None:
    client = create_mcp_http_client()
...
async with contextlib.AsyncExitStack() as stack:
    # Only manage client lifecycle if we created it
    if not client_provided:
        await stack.enter_async_context(client)
    ...
```

呼び出し側が `http_client` を渡した場合（`client_provided=True`）、`streamable_http_client` は
`stack.enter_async_context(client)` を呼ばない。つまり**渡された `httpx.AsyncClient` の
open（`__aenter__`）／close（`__aexit__`/`aclose()`）を一切管理しない**。呼び出し側が明示的に
ライフサイクルを管理する契約になっている。

一方、この transport callable（`functools.partial(streamable_http_client, ...)`）は
strands `MCPClient` の内部から次のように呼ばれる（`strands/tools/mcp/mcp_client.py:772-821`
`_async_background_thread`）:

```python
async with self._transport_callable() as (read_stream, write_stream, *_):
    async with ClientSession(...) as session:
        ...
        await self._close_future  # stop() が呼ばれるまで待機
```

このコルーチンは `MCPClient.start()` が生成する**専用バックグラウンドスレッドの、専用 event loop 上**
（`mcp_client.py:851-865` `_background_task`）でのみ実行される。

### 1.3 検討した代替案とその却下理由

| 案 | 内容 | 却下理由 |
|---|---|---|
| 呼び出し元管理 | `create_github_mcp_client` の外（`base_reviewer.py` / `pr_info_collector.py` が `MCPClient` を生成・使用するメインスレッド）で `httpx.AsyncClient` を生成し、`finally` ブロックで `mcp_client.stop()` の後に `await http_client.aclose()` する | `httpx.AsyncClient` は**バックグラウンドスレッドの event loop 上でのみ**実際の接続処理に使われるが、`aclose()` を呼ぶ側は別スレッド（メインスレッド、`asyncio.run()` 等で新しい event loop を都度生成）になる。event loop を跨いだ非同期リソースの解放は、接続プール内部状態の不整合やハングのリスクを持ち込む。かつ `stop()` 後の同期コンテキストから `aclose()`（コルーチン）を呼ぶための追加の event loop 起動コードが呼び出し元 2 箇所に必要になり、実装が煩雑化する |

---

## 2. 採用する設計

`httpx.AsyncClient` の**生成・使用・close を transport callable のコルーチン内に閉じ込める**。
具体的には `streamable_http_client` をラップした独自の async context manager
`_github_mcp_transport` を用意し、`async with create_mcp_http_client(...) as http_client` の
スコープの中で `streamable_http_client` を呼び出す。

素の `httpx.AsyncClient()` ではなく `create_mcp_http_client`（deprecated な `streamablehttp_client`
が内部で使っていたのと同じファクトリ）を使うのは、素の `httpx.AsyncClient()` が既定で 5 秒タイムアウトに
なり、旧実装が持っていた `timeout=30s` / `sse_read_timeout=300s` / `follow_redirects=True` が失われて
長時間の SSE 読み取りがタイムアウトする回帰を防ぐためである（初版実装でこの回帰を作り込み、コードレビュー
で指摘されて修正した）。

`create_mcp_http_client` は `mcp.shared._httpx_utils`（先頭 `_` の private module）で定義されており、
`mcp.client.streamable_http` からも import 可能に見えるが、`__all__` で再エクスポートされていないため
pyright は `mcp.client.streamable_http` 経由の import を `reportPrivateImportUsage` として拒否する
（実際にレビュー対応中に試して確認した）。そのため定義元の private module から直接 import する。mcp の
将来リリースでこのパスが変わった場合は pyright と `test_github_mcp.py` が即座に検知する。

```python
@asynccontextmanager
async def _github_mcp_transport(url: str, token: str) -> AsyncGenerator[_MCPStreams, None]:
    async with create_mcp_http_client(headers={"Authorization": f"Bearer {token}"}) as http_client:
        async with streamable_http_client(url=url, http_client=http_client) as streams:
            yield streams


def create_github_mcp_client(token: str, url: str = GITHUB_MCP_URL) -> MCPClient:
    return MCPClient(functools.partial(_github_mcp_transport, url=url, token=token))
```

この `_github_mcp_transport` コルーチンは、`MCPClient._async_background_thread` から
`async with self._transport_callable() as (...)` として呼ばれるため、**生成 (`create_mcp_http_client(...)`)・
使用（`streamable_http_client` 内の全リクエスト）・close（`async with` を抜けるときの `__aexit__`）が
すべて同一スレッド・同一 event loop 内で完結する**。

### 2.1 この設計で解消されること

- `base_reviewer.py:220-223` / `pr_info_collector.py:196` の呼び出し元は**無変更**で済む。
  `mcp_client.stop(None, None, None)` を呼べば、バックグラウンドスレッド内で
  `_async_background_thread` の `async with` チェーンが正しい順序で unwind し、
  `streamable_http_client` の終了処理（`terminate_session` 等）→ `httpx.AsyncClient.aclose()`
  の順で自然に実行される。
- 呼び出し元に `httpx.AsyncClient` のライフサイクル管理という新しい責務を持ち込まない
  （Issue が懸念していた「呼び出し元で `aclose()` が必要になるかもしれない」という追加課題が
  発生しない）。
- event loop を跨いだリソース解放が発生しない。

---

## 3. 変更ファイル

- `src/code_review_agent/tools/github_mcp.py`: transport callable を `_github_mcp_transport` に変更。
- `tests/tools/test_github_mcp.py`: `functools.partial` の `keywords["headers"]` を直接検査していた
  既存テストを `keywords["token"]` の検査に変更し、`_github_mcp_transport` 自体を対象にした
  非同期テスト（`httpx.AsyncClient` の生成ヘッダー・`streamable_http_client` への引き渡し・
  スコープ終了時の close）を追加する。

呼び出し元（`base_reviewer.py`, `pr_info_collector.py`）に変更はない。

---

## 4. 検証手順

```bash
# 単体テスト
uv run pytest tests/tools/test_github_mcp.py -v

# 全体品質ゲート
uv run pytest && uv run ruff check && uv run ruff format --check

# 実疎通確認（.env の GITHUB_TOKEN を使用、DeprecationWarning が出ないこと・実データ取得を確認）
python evaluation/tools/verify_pr_collector_repeated.py --runs 1
```
