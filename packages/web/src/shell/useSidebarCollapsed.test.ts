import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useSidebarCollapsed } from "./useSidebarCollapsed";

beforeEach(() => {
  localStorage.clear();
});

describe("useSidebarCollapsed", () => {
  it("defaults to expanded", () => {
    const { result } = renderHook(() => useSidebarCollapsed());
    expect(result.current[0]).toBe(false);
  });

  it("toggles and persists across remounts (COM-05)", () => {
    const first = renderHook(() => useSidebarCollapsed());
    act(() => first.result.current[1]());
    expect(first.result.current[0]).toBe(true);
    first.unmount();

    const second = renderHook(() => useSidebarCollapsed());
    expect(second.result.current[0]).toBe(true);
  });
});
