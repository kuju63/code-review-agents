import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("App", () => {
  it("renders the Get started heading", () => {
    render(<App />);
    expect(screen.getByText("Get started")).toBeInTheDocument();
  });

  it("increments the counter on click", async () => {
    render(<App />);

    const buttons = screen.getAllByRole("button", { name: /^count is 0$/i });
    fireEvent.click(buttons[0]);
    expect(screen.getByRole("button", { name: /^count is 1$/i })).toBeInTheDocument();
  });
});
