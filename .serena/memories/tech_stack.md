# Tech Stack

- Language: Python >=3.12 (pyproject `requires-python`), managed with `uv` (uv_build backend, `uv.lock` committed).
- Agent framework: Strands Agents (`strands-agents[openai]`, `strands-agents-tools`) — model calls go through `strands.models.openai.OpenAIModel` against an OpenAI-compatible endpoint (supports Ollama/LM Studio/OpenRouter via `CODE_REVIEW_LLM_BASE_URL`).
- Web/API: FastAPI + uvicorn[standard]; config via `pydantic-settings` (`api/config.py`); `python-dotenv` loads `.env`.
- External integration: GitHub MCP read-only endpoint (`https://api.githubcopilot.com/mcp/read-only`) via `tools/github_mcp.py`.
- Testing: PyTest + pytest-asyncio (`asyncio_mode = "strict"` — async tests need explicit `@pytest.mark.asyncio`) + pytest-cov.
- Lint/format/type-check: Ruff (no repo-level `[tool.ruff]`/`ruff.toml` override — defaults apply) and Pyright (`venvPath = "."`, `venv = ".venv"` in pyproject).
- Deployment: Docker or Podman; Chainguard base images pinned by digest, kept current by Renovate (`renovate.json`).
