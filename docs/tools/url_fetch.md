# URL Fetch Tool

## 概要

外部 URL からドキュメントを取得し、LLM で要約して返すツール。
Reviewer Agent が OWASP や MDN などの外部参照ドキュメントをレビュー中に動的に参照できるようにする。

## 設計判断

### 要約のレイヤー

| 選択肢 | 概要 | 採用/却下 |
|---|---|---|
| A: ツール内 LLM 要約 | ツール自身が LLM を呼んで要約し、コンパクトな結果を返す | **採用** |
| B: Fetch のみ | ツールは前処理のみ、呼び出し元 Agent LLM が要約 | 却下 |

**採用理由:** 外部ドキュメントはサイズが大きい（OWASP ASVS JSON は 500KB 超）。
ツールが事前に要約することで、Reviewer Agent の入力コンテキストを節約できる。
`focus` パラメータにより呼び出し元 Agent が要約の方向性を制御できるため、
柔軟性も確保される。

### ファクトリパターン

| 選択肢 | 概要 | 採用/却下 |
|---|---|---|
| ファクトリ関数 | `create_url_fetch_tool(config)` で設定済みツールを返す | **採用** |
| グローバル @tool 関数 | モジュールレベルで定義し env var から設定を読む | 却下 |

**採用理由:** `create_github_mcp_client` と同じパターンで、依存性注入が明示的になる。
テスト時のモック差し込みが容易で、他 Agent から設定を柔軟に渡せる。

### HTTP クライアント

`httpx`（既存依存）の同期 API を使用。Reviewer Agent は同期コンテキストで
`asyncio.to_thread` から呼ばれるため、同期 httpx がそのまま使える。

### SSRF 対策

`_validate_url` と fetch フローで多層防御を実装している。

| 防御層 | 実装箇所 | 内容 |
|---|---|---|
| スキーム制限 | `_validate_url` | `http` / `https` のみ許可。`file://`, `ftp://`, `data:` は即エラー |
| userinfo ブロック | `_validate_url` | `user:pass@host` 形式の URL は拒否し認証情報の `[Source:]` 行漏洩を防止 |
| IP リテラルブロック | `_validate_url` + `_is_blocked_addr` | private / loopback / link-local / reserved / multicast を拒否（例: 127.0.0.1, 169.254.169.254, 10.x, 224.x） |
| DNS 解決チェック | `_validate_url` + `_is_blocked_addr` | DNS 名ホストは `socket.getaddrinfo` で解決し、全解決 IP に同じブロックリストを適用（TOCTOU 制限あり、コード内にコメント記載） |
| リダイレクト拒否 | `fetch_url_content` | `follow_redirects=False` かつ `300 <= status_code < 400` を全件エラー扱いにしリダイレクト先検証を回避 |
| タイムアウト | `fetch_url_content` | `timeout_seconds`（デフォルト 10 秒）で Slow SSRF を緩和 |
| レスポンスサイズ制限 | `fetch_url_content` | `max_raw_chars` で LLM 投入前にトリム |

**既知の制限:** DNS チェックとリクエストの間に TOCTOU ウィンドウが存在する（DNS rebinding の古典的ベクター）。
完全な排除には httpx カスタムトランスポートで接続先 IP を固定する必要があり、現時点では対象外。

## API

```python
from code_review_agent.tools.url_fetch import URLFetchConfig, create_url_fetch_tool

config = URLFetchConfig(model_id="gpt-4o", llm_base_url=None)
fetch_url_content = create_url_fetch_tool(config)

# Agent への登録
agent = Agent(model=model, system_prompt=..., tools=[fetch_url_content])
```

### `URLFetchConfig`

| フィールド | 型 | デフォルト | 説明 |
|---|---|---|---|
| `model_id` | `str` | `"gpt-4o"` | 要約 LLM のモデル ID |
| `llm_base_url` | `str \| None` | `None` | OpenAI 互換エンドポイント URL |
| `timeout_seconds` | `int` | `10` | HTTP タイムアウト（秒） |
| `max_raw_chars` | `int` | `50_000` | LLM 投入前のコンテンツ上限 |

### `fetch_url_content(url, focus="")`

| パラメータ | 説明 |
|---|---|
| `url` | Fetch 対象 URL（`http://` / `https://` のみ） |
| `focus` | 要約の重点指示（例: `"CSRF 緩和手法"`, `"CVE リスクレベル"`） |

返却形式:

```text
[Source: https://example.com/doc]
<LLM 要約テキスト>
```

エラー時:

```text
[url_fetch error] <エラー内容>
```

## 利用する Reviewer での有効化

`LLMReviewAgent` サブクラスで `uses_url_fetch = True` を宣言するだけ。
`ReviewerConfig` の `model_id` / `llm_base_url` が自動的に `URLFetchConfig` に伝播する。

```python
@register_reviewer
class SecurityReviewer(LLMReviewAgent):
    uses_url_fetch = True
    ...
```
