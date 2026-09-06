import { useCallback, useState } from "react";

const STORAGE_KEY = "sidebarCollapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

/** COM-05: sidebar label visibility toggle, persisted per browser. */
export function useSidebarCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed);

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // Private-mode/disabled storage: the toggle just won't persist.
      }
      return next;
    });
  }, []);

  return [collapsed, toggle];
}
