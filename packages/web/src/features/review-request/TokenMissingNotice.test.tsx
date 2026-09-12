import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TokenMissingNotice } from "./TokenMissingNotice";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => vi.fn() };
});

describe("TokenMissingNotice (ST-01/RR-13/RR-14)", () => {
  it("shows the PAT-missing message and a link to settings", () => {
    render(<TokenMissingNotice />);

    expect(screen.getByText("GitHubアクセストークンが未設定です。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "設定画面を開く" })).toBeInTheDocument();
  });
});
