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
import { createOllama } from "ai-sdk-ollama";

// (a) OpenAI-compatible base_url, mirrors ProviderType.OPENAI in
// model_provider_factory.py (client_args={"base_url": llm_base_url}).
const openaiCompatModel = new OpenAIModel({
  api: "chat",
  modelId: "gpt-oss-120b",
  apiKey: "unused-for-construction-check",
  clientConfig: { baseURL: "http://localhost:11434/v1" },
});

// (b) Ollama, mirrors ProviderType.OLLAMA (native host, not the /v1 suffix).
// The host is a property of the *provider* (createOllama), not of the model
// call — ollama("model-id") only takes model-level settings as its second
// argument and does not accept a baseURL there.
const ollamaProvider = createOllama({
  baseURL: "http://localhost:11434",
});
const ollamaModel = new VercelModel({ provider: ollamaProvider("gpt-oss-120b") });

// Both construct successfully as Strands `Model` instances; the SDK type
// system accepts either directly as `Agent({ model })`.
new Agent({ model: openaiCompatModel });
new Agent({ model: ollamaModel });

console.log("model-provider-spike: both construction paths type-checked and constructed OK");
