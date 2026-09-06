import { render, screen } from "@testing-library/react";
import { useTranslation } from "react-i18next";
import { describe, expect, it } from "vitest";

function TranslationProbe() {
  const { t } = useTranslation();
  return <p>{t("reviewList.title")}</p>;
}

describe("i18next", () => {
  it("resolves a translation key through the fetch-based resource backend", async () => {
    render(<TranslationProbe />);

    expect(await screen.findByText("コードレビュー一覧")).toBeInTheDocument();
  });
});
