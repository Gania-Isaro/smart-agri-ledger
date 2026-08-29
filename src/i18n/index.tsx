/**
 * Language and theme.
 *
 * Both are per-device preferences, so both live in localStorage rather than the
 * database: a field officer and an accountant sharing one tablet account should
 * still each get the app the way they set it on their own phone.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ACTIVITY_LABELS_RW, CROP_NAMES_RW, DICTS, EN, FIELD_LABELS_RW, type Lang } from './strings';

export type Theme = 'light' | 'dark' | 'system';

interface Prefs {
  lang: Lang;
  setLang: (l: Lang) => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  /** True when dark is actually being shown, whatever the setting says. */
  isDark: boolean;
  t: (key: string, vars?: Record<string, string | number>) => string;
  /** Translate an activity type label, falling back to the catalog English. */
  tActivity: (id: string, fallback: string) => string;
  /** Translate a dynamic form field label by its field key. */
  tField: (key: string, fallback: string) => string;
  /** Translate a built-in crop name; user-added crops keep their own name. */
  tCrop: (id: string | undefined, fallback: string) => string;
}

const Ctx = createContext<Prefs | null>(null);

const LANG_KEY = 'agri.lang';
const THEME_KEY = 'agri.theme';

function read<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => read(LANG_KEY, 'en', ['en', 'rw'] as const));
  const [theme, setThemeState] = useState<Theme>(() => read(THEME_KEY, 'system', ['light', 'dark', 'system'] as const));
  const [systemDark, setSystemDark] = useState(
    () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches,
  );

  /* Follow the device when the user has not chosen for themselves. */
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const isDark = theme === 'dark' || (theme === 'system' && systemDark);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    root.classList.toggle('theme-dark', isDark);
    root.lang = lang === 'rw' ? 'rw' : 'en';
    // Keep the browser chrome (address bar, form controls) in step.
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', isDark ? '#0E1512' : '#1B5E3F');
  }, [theme, isDark, lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(LANG_KEY, l);
    } catch {
      /* private mode: the choice simply will not persist */
    }
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    try {
      localStorage.setItem(THEME_KEY, t);
    } catch {
      /* as above */
    }
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      // Fall back to English rather than showing the raw key: a missing
      // translation should read awkwardly, never break the screen.
      const raw = DICTS[lang][key] ?? EN[key] ?? key;
      if (!vars) return raw;
      return raw.replace(/\{(\w+)\}/g, (m, name) => String(vars[name] ?? m));
    },
    [lang],
  );

  const tActivity = useCallback(
    (id: string, fallback: string) => (lang === 'rw' ? ACTIVITY_LABELS_RW[id] ?? fallback : fallback),
    [lang],
  );

  const tField = useCallback(
    (key: string, fallback: string) => (lang === 'rw' ? FIELD_LABELS_RW[key] ?? fallback : fallback),
    [lang],
  );

  const tCrop = useCallback(
    (id: string | undefined, fallback: string) =>
      lang === 'rw' && id ? CROP_NAMES_RW[id] ?? fallback : fallback,
    [lang],
  );

  const value = useMemo<Prefs>(
    () => ({ lang, setLang, theme, setTheme, isDark, t, tActivity, tField, tCrop }),
    [lang, setLang, theme, setTheme, isDark, t, tActivity, tField, tCrop],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePrefs(): Prefs {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('usePrefs must be used inside <PrefsProvider>');
  return ctx;
}

/** Shorthand for the common case. */
export function useT() {
  return usePrefs().t;
}

export { LANGUAGES, type Lang } from './strings';
