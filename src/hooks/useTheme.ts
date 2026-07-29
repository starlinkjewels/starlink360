import { useCallback, useEffect, useState } from "react";

export type Theme = "dark" | "light";

const KEY = "starlink.theme";

/**
 * Theme lives on the <html> element as `data-theme`, which is what the CSS
 * tokens key off. Kept out of React state on the DOM side so the whole tree —
 * stage, panel, sheet, menus — switches in one repaint rather than re-rendering
 * every component that happens to read a colour.
 */
export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>("dark");

  useEffect(() => {
    const saved = (() => {
      try {
        return localStorage.getItem(KEY) as Theme | null;
      } catch {
        return null;
      }
    })();
    const initial: Theme = saved === "light" || saved === "dark" ? saved : "dark";
    setThemeState(initial);
    document.documentElement.dataset.theme = initial;
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    document.documentElement.dataset.theme = t;
    try {
      localStorage.setItem(KEY, t);
    } catch {
      /* private mode — the choice just won't persist */
    }
  }, []);

  return [theme, setTheme];
}
