import {
  Presentation,
  FileText,
  FileSpreadsheet,
  BookOpen,
  FileCode2,
  GitBranch,
  Layers,
  Braces,
  Network,
  HardDrive,
  Database,
  Box,
  MessageSquare,
  Server,
  Terminal,
  type LucideIcon,
} from 'lucide-react';
import { DEFAULT_THEME, isThemeName, type ThemeName } from './themes';

export { THEMES, THEME_NAMES, DEFAULT_THEME, isThemeName, type ThemeName } from './themes';

/* C maps Axiom's semantic names to the CSS custom properties declared in
 * themes.ts. The values are var() references, not colors: an inline
 * `style={{ background: C.panel }}` emits `background: var(--panel)` and the
 * cascade resolves it against whatever [data-theme] is on <html>. That is why
 * switching themes needs no re-render and no component ever holds a hex.
 *
 * Contract tokens are 1:1 with themes.ts. The rest are aliases kept so the ~700
 * existing call sites read the same as they always did. */
export const C = {
  bg: 'var(--bg)',
  /** sidebar, inputs and raised surfaces share one token in the contract */
  sidebar: 'var(--panel)',
  panel: 'var(--panel)',
  panelHover: 'var(--elevated)',
  raised: 'var(--elevated)',
  /** `border` is the emphasized hairline; `borderSoft` the default one */
  border: 'var(--border-strong)',
  borderSoft: 'var(--border)',
  text: 'var(--text-primary)',
  sub: 'var(--text-secondary)',
  mute: 'var(--text-faint)',
  accent: 'var(--accent)',
  accentHover: 'var(--accent-hover)',
  accentActive: 'var(--accent-active)',
  /** text/icon color on top of an accent fill — never plain white */
  accentContrast: 'var(--accent-contrast)',
  accentDim: 'var(--accent-dim)',
  navActiveBg: 'var(--nav-active-bg)',
  /** neutral hover tint; inverts with the scheme, unlike a fixed white wash */
  hoverWash: 'var(--hover-wash)',
  scrim: 'var(--scrim)',
  shadowMenu: 'var(--shadow-menu)',
  green: 'var(--status-green)',
  greenDim: 'var(--status-green-dim)',
  blue: 'var(--status-blue)',
  blueDim: 'var(--status-blue-dim)',
  purple: 'var(--status-purple)',
  purpleDim: 'var(--status-purple-dim)',
  amber: 'var(--status-amber)',
  amberDim: 'var(--status-amber-dim)',
  /** decorative only — the sandbox traffic light, not an error state */
  red: 'var(--status-red)',
} as const;

/** A translucent wash of any token, for the handful of one-off tints the fixed
 *  --*-dim tokens don't cover. Resolves against the live palette like any
 *  other var(), so `wash(C.amber, 15)` re-tints itself on a theme swap. */
export const wash = (token: string, pct: number): string =>
  `color-mix(in srgb, ${token} ${pct}%, transparent)`;

const STORAGE_KEY = 'axiom-theme';

/** Pre-token builds stored a light/dark mode under the same key. */
const LEGACY: Record<string, ThemeName> = { dark: 'ember', light: 'daylight' };

/** The persisted theme, or the default when unset/unreadable/retired. */
export function currentTheme(): ThemeName {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(STORAGE_KEY);
  } catch {
    return DEFAULT_THEME; // storage disabled (private mode)
  }
  if (!saved) return DEFAULT_THEME;
  if (isThemeName(saved)) return saved;
  return LEGACY[saved] ?? DEFAULT_THEME;
}

/** Swap the palette and persist it. Takes effect on the next frame, no reload. */
export function applyTheme(name: ThemeName): void {
  document.documentElement.dataset.theme = name;
  try {
    localStorage.setItem(STORAGE_KEY, name);
  } catch {
    /* not persisting is survivable; the swap already happened */
  }
}

export const serif = '"Tiempos Text", Georgia, "Times New Roman", serif';
export const sans = 'ui-sans-serif, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif';
export const mono = 'ui-monospace, Menlo, monospace';

/** Resolve a manifest colorToken to its color + dim pair. */
export function tokenColor(token: string): { color: string; dim: string } {
  switch (token) {
    case 'accent':
      return { color: C.accent, dim: C.accentDim };
    case 'green':
      return { color: C.green, dim: C.greenDim };
    case 'blue':
      return { color: C.blue, dim: C.blueDim };
    case 'purple':
      return { color: C.purple, dim: C.purpleDim };
    case 'amber':
      return { color: C.amber, dim: C.amberDim };
    case 'sub':
      return { color: C.sub, dim: wash(C.sub, 10) };
    case 'text':
      return { color: C.text, dim: wash(C.text, 8) };
    default:
      return { color: C.sub, dim: C.borderSoft };
  }
}

export const NAMED_ICONS: Record<string, LucideIcon> = {
  presentation: Presentation,
  'file-text': FileText,
  'file-spreadsheet': FileSpreadsheet,
  'book-open': BookOpen,
  'file-code': FileCode2,
  'git-branch': GitBranch,
  layers: Layers,
  braces: Braces,
  network: Network,
  'hard-drive': HardDrive,
  database: Database,
  box: Box,
  'message-square': MessageSquare,
  server: Server,
  terminal: Terminal,
};

export function namedIcon(name: string): LucideIcon {
  return NAMED_ICONS[name] ?? Terminal;
}
