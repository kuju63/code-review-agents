import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import jaTranslation from "../../public/locales/ja/translation.json";

type FetchLike = typeof fetch;

/** i18next-resources-to-backend fetches these at runtime; served from the static JSON here. */
const LOCALE_JSON: Record<string, unknown> = {
  "/locales/ja/translation.json": jaTranslation,
};

const throwUnconfigured: FetchLike = () => {
  throw new Error(
    "No API fetch handler configured for this test. Call setApiFetchHandler() before rendering.",
  );
};

let apiFetchHandler: FetchLike = throwUnconfigured;

/**
 * Tests that hit the reviews API configure their response here instead of
 * reassigning global fetch directly, so the /locales stub below keeps working.
 */
export function setApiFetchHandler(handler: FetchLike): void {
  apiFetchHandler = handler;
}

function resolveUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

vi.stubGlobal(
  "fetch",
  vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = resolveUrl(input);
    const localeJson = LOCALE_JSON[url];
    if (localeJson !== undefined) {
      return Promise.resolve(
        new Response(JSON.stringify(localeJson), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    return apiFetchHandler(input, init);
  }),
);

// Dynamic + after the fetch stub above so i18next's backend resolves against
// it instead of issuing a real network request during module evaluation.
await import("../i18next");

afterEach(() => {
  apiFetchHandler = throwUnconfigured;
});
