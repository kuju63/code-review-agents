# ModelProviderFactory によるOllamaネイティブ対応 設計ドキュメント (Issue #214)

## 1. 背景

現在、本プロジェクトは `strands.models.openai.OpenAIModel` のみを使ってLLMを呼び出している。
ローカルOllamaを使う場合も「OpenAI互換の `/v1` エンドポイント」(`client_args={"base_url": "http://localhost:11434/v1"}`)として叩いているだけで、
Ollamaが提供するネイティブAPI(`strands.models.ollama.OllamaModel`、`strands-agents==1.45.0` に同梱済みだが `ollama` extra は
`pyproject.toml` に未追加のため現状未使用)による最適化の恩恵を受けていない。

Issue #214 はこれを問題視し、provider種別に応じて適切な `Model` インスタンスを返す `ModelProviderFactory` 的な抽象化を要求している。

`OpenAIModel` の構築ロジックは以下5箇所にほぼ同一の3分岐(`llm_base_url` 有無、`extra_params` 有無)として重複していた:

- `src/code_review_agent/agents/base_reviewer.py::LLMReviewAgent.review()`(temperature=0.1)
- `src/code_review_agent/agents/lead_engineer.py::LeadEngineerAgent.evaluate()`(temperature=0.3)
- `src/code_review_agent/agents/pr_info_collector.py::PRInfoCollector._build_model()`(temperature=0.3、`extra_params`なし)
- `evaluation/tools/score_evaluation.py::make_llm_semantic_judge()`
- `evaluation/tools/build_seeded_set.py::make_llm_mutation_generator()`

### 過去の判断との差分(伏線回収)

`docs/llm-generation-limits-spec.md`(Issue #208)は、`base_reviewer.py`と`lead_engineer.py`の同型ロジックについて
「共通ヘルパー化はしない — 両モジュールのテストがそれぞれ独立に`OpenAIModel`をpatchしているため、共通化するとpatch対象がずれる」
と明記し、意図的に重複を許容していた。

今回はこの判断を覆す。理由は、当時は「重複除去それ自体」が目的ではなかったのに対し、今回はissue #214が
「provider種別による分岐」という新しい軸を持ち込むため、3+2箇所に分岐ロジックをコピーし続けると
Ollama分岐の追加・保守コストが5倍になる。ここでは共通化を選び、既存テストのpatch対象を
`OpenAIModel`から新設のfactory関数`create_model_provider`に付け替える(§5)ことでこの制約を解消する。

## 2. 調査済み事実(再調査不要)

- `strands.models.ollama.OllamaModel.__init__(self, host: str | None, *, ollama_client_args: dict | None = None, **model_config: Unpack[OllamaConfig])`。
  `OllamaConfig`(TypedDict, total=False)は`model_id`, `temperature`, `max_tokens`, `top_p`, `stop_sequences`, `keep_alive`(既定"5m"), `options`, `additional_args`を持つ。
  `frequency_penalty`に相当するキーは存在しない。
- `host`はOpenAI互換シムのような`/v1`サフィックスを含まない、Ollamaサーバーの素のURL(例: `http://localhost:11434`)。
- `OllamaModel.structured_output()`(`strands/models/ollama.py:350-376`)は`OpenAIModel.structured_output()`と同一の抽象シグネチャ
  (`output_model`, `prompt`, `system_prompt`, `**kwargs` → `AsyncGenerator[dict[str, T | Any], None]`)を実装しており、
  内部では`format=output_model.model_json_schema()`によるOllama側JSON-schema制約デコーディングを使う。
  `build_seeded_set.py::make_llm_mutation_generator`が`Agent(...)`を経由せず`Model.structured_output()`を直接呼ぶ特殊な設計
  (tool-callingが安定しないための回避策、詳細は同関数のdocstring参照)であっても、このインターフェース互換性により
  `OllamaModel`へ差し替えてもそのまま動作する見込み(実行検証は§7参照)。
- `strands-agents`のPyPIメタデータ上、`ollama`は`openai`とは別の独立したextraであり、`ollama<1.0.0,>=0.4.8`(Python Ollamaクライアント)を要求する。
  現在の`pyproject.toml`は`"strands-agents[openai]>=1.45.0"`のみを宣言しており、`ollama`extraの追加が必要。
- 既存の最も近いidiom: `src/code_review_agent/skills/agent_skills_factory.py` — `StrEnum`(`AgentSkillType`)による判別子 +
  モジュールレベル関数(`create_agent_skills`)がif/elifで分岐する形。今回のfactoryもこのidiomを踏襲する。

## 3. 設計

### 3.1 新規モジュール `src/code_review_agent/agents/model_provider_factory.py`

```python
class ProviderType(StrEnum):
    OPENAI = "openai"
    OLLAMA = "ollama"

def create_model_provider(
    provider_type: ProviderType,
    model_id: str,
    *,
    llm_base_url: str | None = None,
    temperature: float,
    max_tokens: int | None = None,
    frequency_penalty: float | None = None,
) -> Model:
    ...
```

- **OpenAI分岐**: 既存3箇所の分岐ロジックをそのまま移設。`llm_base_url`未設定時は`temperature`を送らない、という
  既存挙動を一切変えない(回帰させない)。
- **Ollama分岐**: `OllamaModel(host, model_id=..., temperature=..., max_tokens=...)`。
  `host`は`llm_base_url`(未設定時は`http://localhost:11434`をデフォルト)。末尾が`/v1`の場合は防御的に除去する
  (旧`.env.example`の値が残っていても404にならないように)。
- `frequency_penalty`はOllama分岐では`OllamaConfig`に相当項目が無いため無視し、`logger.warning`で通知する(黙って握りつぶさない)。
- 未知の`provider_type`は`ValueError`を送出する(issue本文の疑似コード通り)。`Settings`はpydanticの型検証で
  起動時に不正値を弾くため、これは直接呼び出し元(評価CLI等)向けの防御。

### 3.2 設定の拡張

- `src/code_review_agent/api/config.py::Settings`に`provider_type: ProviderType = ProviderType.OPENAI`を追加
  (env var `CODE_REVIEW_PROVIDER_TYPE`)。
- `src/code_review_agent/agents/base_reviewer.py::ReviewerConfig`(frozen dataclass)に同名フィールドを追加。
- provider種別はリクエスト単位のオーバーライドを許可しない(`model_id`とは異なる扱い)。デプロイ時に確定する
  バックエンド選択であり、リクエストから切り替えられると接続先/認証情報が意図せず変わるリスクがあるため。
  `llm_base_url`も現状オーバーライド不可であり、これと整合させる。

### 3.3 呼び出し元の置き換え

`base_reviewer.py` / `lead_engineer.py` / `pr_info_collector.py`の3箇所の分岐を`create_model_provider(...)`呼び出しに置換。
`ReviewerConfig(...)` / `PRInfoCollector(...)`を`Settings`から構築する全箇所
(`api/agents/{angular,react,security,svelte,vue}_reviewer.py`, `api/agents/orchestrator.py`, `api/agents/pr_info_collector.py`)に
`provider_type=settings.provider_type`を配線する。

### 3.4 評価ツールの統一

`evaluation/tools/score_evaluation.py::make_llm_semantic_judge` と `evaluation/tools/build_seeded_set.py::make_llm_mutation_generator`
に`provider_type`引数を追加し、`create_model_provider`に委譲する。設定ソースは`CODE_REVIEW_*`から独立させたままにする
(既存の「評価用モデルとレビュー対象モデルのバイアス回避」という意図を壊さないため)。

- `score_evaluation.py`: `--provider-type`CLIフラグ(デフォルト`openai`、既存`--model-id`と同様env var無しのシンプルな引数)。
- `build_seeded_set.py`: `--provider-type`CLIフラグ + `SEEDED_GEN_PROVIDER_TYPE`環境変数フォールバック(`SEEDED_GEN_MODEL_ID`と同じパターン)。

## 4. 依存関係

`pyproject.toml`: `"strands-agents[openai]>=1.45.0"` → `"strands-agents[openai,ollama]>=1.45.0"`。
`uv lock && uv sync`を実行し、`uv.lock`の差分をコミットに含める(`ollama`パッケージの新規解決による意図した差分)。

## 5. テスト方針(TDD)

- 新規`tests/agents/test_model_provider_factory.py`。Red phaseは`create_model_provider`が`NotImplementedError`を
  送出するstub実装から開始する(失敗理由をロジック起因かAttributeError起因か区別するため)。
  ケース: OpenAI基本/base_url有/extra_params有の3パターン(既存挙動保持の回帰確認)、
  Ollama基本/`/v1`除去/`max_tokens`反映/`frequency_penalty`無視+warning、未知provider→`ValueError`。
- 既存`tests/agents/test_base_reviewer.py` / `test_lead_engineer.py` / `test_pr_info_collector.py`および
  `tests/evaluation/tools/test_score_evaluation.py` / `test_build_seeded_set.py`は、`OpenAIModel`を直接patchして
  厳密なkwargsをassertしている箇所を、`create_model_provider`をpatchしてその呼び出し引数をassertする形に書き換える
  (factory自体の内部実装検証は新規テストファイルに一元化する)。
- カバレッジ >=75% を維持する。

## 6. ドキュメント更新

- `docs/a2a-api-design.md` §10.4「Ollama切り替えテスト」: `CODE_REVIEW_LLM_BASE_URL=.../v1`方式の記述を
  `CODE_REVIEW_PROVIDER_TYPE=ollama` + `/v1`なしホストの記述に更新する。
- `.env.example`: `CODE_REVIEW_PROVIDER_TYPE`の説明追加、Ollamaブロックを`/v1`なしホストに修正、
  `OPENAI_API_KEY`がOllama時は不要である旨を明記、`SEEDED_GEN_PROVIDER_TYPE`の例を追加。
  LM Studio/OpenRouterブロックには`CODE_REVIEW_PROVIDER_TYPE=openai`(OpenAI互換のまま)を明示する。

## 7. 検証計画

- 必須: `uv run pytest`(カバレッジ>=75%)、`uv run ruff check`、`uv run ruff format --check`が全てパスすること。
- **必須(実環境検証)**: 本環境でOllamaデーモンが起動済み(`http://localhost:11434`で応答確認済み)であり、
  `AGENTS.setup.md`が推奨する`ornith:latest`(review用)・`gpt-oss:latest`(seed-generation用)が既にpull済みであることを確認した。
  - `CODE_REVIEW_PROVIDER_TYPE=ollama` / `CODE_REVIEW_LLM_BASE_URL=http://localhost:11434` / `CODE_REVIEW_MODEL_ID=ornith:latest`を
    設定し実際にモデル呼び出しが成功することを確認する。
  - `make_llm_mutation_generator`の`Model.structured_output()`直接呼び出しパターンが`OllamaModel`でも動作することを、
    `gpt-oss:latest`を使った実呼び出しで確認する。

## 8. 変更ファイル一覧

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
