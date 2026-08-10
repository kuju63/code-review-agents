import {
  type AfterToolCallEvent,
  DocumentBlock,
  type LocalAgent,
  TextBlock,
  ToolResultBlock,
} from "@strands-agents/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OllamaUnsupportedContentSanitizer } from "./tool-result-sanitizer.js";

function makeEvent(content: ToolResultBlock["content"]): AfterToolCallEvent {
  return {
    type: "afterToolCallEvent",
    agent: {} as LocalAgent,
    toolUse: { name: "file_read", toolUseId: "tool-1", input: {} },
    tool: undefined,
    result: new ToolResultBlock({ toolUseId: "tool-1", status: "success", content }),
    invocationState: {},
  } as unknown as AfterToolCallEvent;
}

describe("OllamaUnsupportedContentSanitizer", () => {
  let sanitizer: OllamaUnsupportedContentSanitizer;
  let addHook: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sanitizer = new OllamaUnsupportedContentSanitizer();
    addHook = vi.fn();
  });

  it("has a stable plugin name", () => {
    expect(sanitizer.name).toBe("ollama-unsupported-content-sanitizer");
  });

  it("registers a callback on AfterToolCallEvent when attached to an agent", () => {
    sanitizer.initAgent({ addHook } as unknown as LocalAgent);

    expect(addHook).toHaveBeenCalledTimes(1);
    expect(addHook.mock.calls[0]?.[0]?.name).toBe("AfterToolCallEvent");
  });

  it("leaves supported content untouched", () => {
    const original = [new TextBlock("hello")];
    const event = makeEvent(original);

    sanitizer.initAgent({ addHook } as unknown as LocalAgent);
    const callback = addHook.mock.calls[0]?.[1] as (event: AfterToolCallEvent) => void;
    callback(event);

    expect(event.result.content).toEqual(original);
  });

  it("strips a document block and replaces it with a text placeholder", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const documentBlock = new DocumentBlock({
      name: "report.pdf",
      format: "pdf",
      source: { text: "unserializable content" },
    });
    const event = makeEvent([new TextBlock("kept"), documentBlock]);

    sanitizer.initAgent({ addHook } as unknown as LocalAgent);
    const callback = addHook.mock.calls[0]?.[1] as (event: AfterToolCallEvent) => void;
    callback(event);

    expect(event.result.content).toHaveLength(2);
    expect(event.result.content[0]).toBeInstanceOf(TextBlock);
    expect((event.result.content[0] as TextBlock).text).toBe("kept");
    expect(event.result.content[1]).toBeInstanceOf(TextBlock);
    expect((event.result.content[1] as TextBlock).text).toContain("document");
    expect(warn).toHaveBeenCalledOnce();

    warn.mockRestore();
  });

  it("does not replace event.result when there is nothing to strip", () => {
    const original = new ToolResultBlock({
      toolUseId: "tool-1",
      status: "success",
      content: [new TextBlock("hello")],
    });
    const event = {
      type: "afterToolCallEvent",
      agent: {} as LocalAgent,
      toolUse: { name: "file_read", toolUseId: "tool-1", input: {} },
      tool: undefined,
      result: original,
      invocationState: {},
    } as unknown as AfterToolCallEvent;

    sanitizer.initAgent({ addHook } as unknown as LocalAgent);
    const callback = addHook.mock.calls[0]?.[1] as (event: AfterToolCallEvent) => void;
    callback(event);

    expect(event.result).toBe(original);
  });
});
