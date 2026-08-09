/**
 * Issue #250 spike: confirm @strands-agents/sdk exposes the two model
 * construction paths current-Python's model_provider_factory.py relies on
 * (docs/typescript-toolchain-spec.md §5).
 *
 * This only proves the two paths *construct* successfully (types +
 * client wiring); it does not make a live model call.
 */
import { Agent } from "@strands-agents/sdk";
import { OpenAIModel } from "@strands-agents/sdk/models/openai";
import { VercelModel } from "@strands-agents/sdk/models/vercel";
import { ollama } from "ai-sdk-ollama";

// (a) OpenAI-compatible base_url, mirrors ProviderType.OPENAI in
// model_provider_factory.py (client_args={"base_url": llm_base_url}).
const openaiCompatModel = new OpenAIModel({
  api: "chat",
  modelId: "gpt-oss-120b",
  apiKey: "unused-for-construction-check",
  clientConfig: { baseURL: "http://localhost:11434/v1" },
});

// (b) Ollama, mirrors ProviderType.OLLAMA (native host, not the /v1 suffix).
const ollamaProvider = ollama("gpt-oss-120b", {
  // ai-sdk-ollama defaults to http://localhost:11434/api; passing baseURL
  // explicitly here to mirror model_provider_factory.py's `host` param.
});
const ollamaModel = new VercelModel({ provider: ollamaProvider });

// Both construct successfully as Strands `Model` instances; the SDK type
// system accepts either directly as `Agent({ model })`.
new Agent({ model: openaiCompatModel });
new Agent({ model: ollamaModel });

console.log("model-provider-spike: both construction paths type-checked and constructed OK");
