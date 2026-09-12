import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PullRequestCard } from "./PullRequestCard";
import type { GithubPullRequest } from "./reviewRequest.schema";

function pr(overrides: Partial<GithubPullRequest> = {}): GithubPullRequest {
  return {
    number: 482,
    title: "Fix login bug",
    state: "open",
    createdAt: "2026-08-09T10:24:00Z",
    author: "octocat",
    baseBranch: "main",
    ...overrides,
  };
}

describe("PullRequestCard", () => {
  it("renders the PR number, title, base branch, and author", () => {
    render(<PullRequestCard pullRequest={pr()} selected={false} onSelect={vi.fn()} />);

    expect(screen.getByText("#482 Fix login bug")).toBeInTheDocument();
    expect(screen.getByText(/main/)).toBeInTheDocument();
    expect(screen.getByText(/octocat/)).toBeInTheDocument();
  });

  it("exposes selection state via aria-pressed (OP-03 assistive-tech identifiability)", () => {
    const { rerender } = render(
      <PullRequestCard pullRequest={pr()} selected={false} onSelect={vi.fn()} />,
    );
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "false");

    rerender(<PullRequestCard pullRequest={pr()} selected onSelect={vi.fn()} />);
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  });

  it("calls onSelect with the PR number when clicked", () => {
    const onSelect = vi.fn();
    render(<PullRequestCard pullRequest={pr()} selected={false} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("button"));

    expect(onSelect).toHaveBeenCalledWith(482);
  });
});
