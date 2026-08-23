# Ollamaバックエンドが処理できないツール結果コンテンツ型の除去 テスト・検証手順 (Python版)

設計: [docs/ollama-tool-result-content-sanitizer-spec.md](../ollama-tool-result-content-sanitizer-spec.md)

## テスト方針(TDD)

1. `OllamaUnsupportedContentSanitizer`単体テスト(`tests/tools/test_tool_result_sanitizer.py`):
   - `document`キーを含む`ToolResultContent`がtextプレースホルダに置換されること
   - `document`を含まない結果は変更されないこと
   - 複数ブロック中の一部だけが`document`の場合、該当ブロックのみ置換されること
   - warningログが出ること(`caplog`で検証)
2. `base_reviewer.py`側(`tests/agents/test_base_reviewer.py`):
   - `provider_type=ProviderType.OLLAMA`のとき`Agent(...)`呼び出しに`hooks`が渡ること
   - `provider_type=ProviderType.OPENAI`のとき`hooks`が渡らない(または空)こと

## 検証手順

```bash
uv run pytest tests/tools/test_tool_result_sanitizer.py tests/agents/test_base_reviewer.py
uv run ruff check
uv run ruff format --check
```

`mode="document"`を選ぶかどうか自体がモデルの非決定的な判断に依存するため、評価パイプラインの単発再実行で「発生しなかった」ことは無罪証明にならない。単体テストでの担保を主とし、評価パイプラインでの再現待ちはしない。
