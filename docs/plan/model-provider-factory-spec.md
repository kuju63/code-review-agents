# ModelProviderFactory によるOllamaネイティブ対応 実装計画 (Issue #214)

設計: [docs/model-provider-factory-spec.md](../model-provider-factory-spec.md)

## テスト方針(TDD)

- `create_model_provider`/`createModelProvider` が未実装stubから開始し、失敗理由をロジック
  起因かAttributeError起因か区別できるようにする（Red phase）。
- ケース: OpenAI基本/base_url有/extra_params有の3パターン(既存挙動保持の回帰確認)、
  Ollama基本/`/v1`除去/`max_tokens`反映/`frequency_penalty`無視+warning、未知provider→例外。
- 既存の各呼び出し元のテストは、モデルクラスを直接patchして厳密なkwargsをassertしている
  箇所を、`create_model_provider`をpatchしてその呼び出し引数をassertする形に書き換える
  (factory自体の内部実装検証は新規テストファイルに一元化する)。
- カバレッジ >=75% を維持する。

## 検証計画

- 必須: 型チェック・lint・テストスイートが全てパスすること。
- **必須(実環境検証)**: Ollamaデーモンが起動済みであり、review用・seed-generation用の
  モデルが既にpull済みであることを確認した上で、実際にモデル呼び出しが成功することを確認する。
- 評価パイプラインのLLM呼び出し（意味的判定・seed生成）がOllamaプロバイダでも動作することを、
  実際のモデル呼び出しで確認する。

## 変更ファイル一覧（Python版・完了済み。TS移植は `packages/agent-core/src/agents/model-provider-factory.ts` として完了済み）

- `src/code_review_agent/agents/model_provider_factory.py`(新規)
- `src/code_review_agent/api/config.py`
- `src/code_review_agent/agents/base_reviewer.py`
- `src/code_review_agent/agents/lead_engineer.py`
- `src/code_review_agent/agents/pr_info_collector.py`
- `src/code_review_agent/api/agents/{angular,react,security,svelte,vue}_reviewer.py`
- `src/code_review_agent/api/agents/orchestrator.py`
- `src/code_review_agent/api/agents/pr_info_collector.py`
- `evaluation/tools/score_evaluation.py`
- `evaluation/tools/build_seeded_set.py`
- `pyproject.toml` / `uv.lock`
- `.env.example`
- `docs/a2a-api-design.md`
- `tests/agents/test_model_provider_factory.py`(新規)
- `tests/agents/test_base_reviewer.py` / `test_lead_engineer.py` / `test_pr_info_collector.py`
- `tests/evaluation/tools/test_score_evaluation.py` / `test_build_seeded_set.py`
