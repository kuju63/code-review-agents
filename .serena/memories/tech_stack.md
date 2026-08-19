# Tech Stack

- Language: TypeScript, Node >=24, managed as a pnpm workspace under `packages/` (`packages/agent-core/`, `packages/a2a-server/`, evaluation package). Local toolchain (Node/pnpm/biome) comes from the repo-root Nix flake — always run via `nix develop --command`. CI does not use Nix; it sets up Node/pnpm via `pnpm/setup@v2` (`.github/workflows/ci.yaml`).
- Agent framework: Strands Agents (`@strands-agents/sdk`) — model calls go through the OpenAI-compatible `openai` SDK / `ai-sdk-ollama` against an OpenAI-compatible endpoint.
- Web/API: Hono (`hono`, `@hono/node-server`, `@hono/zod-validator`) in `packages/a2a-server/` — not FastAPI (that was the removed Python version).
- External integration: GitHub MCP read-only endpoint (`https://api.githubcopilot.com/mcp/read-only`) via `packages/agent-core/src/tools/github-mcp.ts`.
- Testing: Vitest (`vitest.config.ts`), coverage provider v8, thresholds lines/functions/branches/statements each 75% (matches CONTRIBUTING.md's quality gate). `junit` reporter emits `./junit.xml` and `lcov` coverage emits `./coverage/lcov.info`, both consumed by Codecov in CI.
- Lint/format/type-check: Biome (`pnpm exec biome check`) and `tsc --noEmit`. No Ruff/Pyright — those were Python-era tooling.
- Deployment: Docker or Podman; the container build's `node-builder`/`node-runtime` stages use the `registry.access.redhat.com/hi/nodejs:26` hardened images directly (not via Nix). Kept current by Renovate (`renovate.json`).
