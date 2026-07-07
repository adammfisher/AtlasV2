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

/* Atlas palettes — modeled on Claude.ai's warm dark/light themes. C is a
 * mutable object: applyTheme() swaps its values in place and the App root
 * re-renders, so every `C.xxx` read at render time picks up the new theme. */
const DARK = {
  bg: '#262624',
  sidebar: '#1f1e1c',
  panel: '#2f2e2b',
  panelHover: '#363430',
  raised: '#383631',
  border: '#3c3a36',
  borderSoft: 'rgba(255,255,255,0.06)',
  text: '#f0eee6',
  sub: '#b8b4a9',
  mute: '#85827a',
  accent: '#d97757',
  accentDim: 'rgba(217,119,87,0.14)',
  green: '#8fbf7f',
  greenDim: 'rgba(143,191,127,0.13)',
  blue: '#82a8c8',
  blueDim: 'rgba(130,168,200,0.13)',
  purple: '#a995c9',
  purpleDim: 'rgba(169,149,201,0.13)',
  amber: '#d4ad6a',
  amberDim: 'rgba(212,173,106,0.13)',
};

const LIGHT: typeof DARK = {
  bg: '#faf9f5',
  sidebar: '#f0eee6',
  panel: '#ffffff',
  panelHover: '#f4f2ec',
  raised: '#edeae1',
  border: '#dcd8cc',
  borderSoft: 'rgba(0,0,0,0.08)',
  text: '#262624',
  sub: '#57544b',
  mute: '#8a867b',
  accent: '#c65f3d',
  accentDim: 'rgba(198,95,61,0.12)',
  green: '#4d8a3b',
  greenDim: 'rgba(77,138,59,0.12)',
  blue: '#3f6f9c',
  blueDim: 'rgba(63,111,156,0.12)',
  purple: '#7460a0',
  purpleDim: 'rgba(116,96,160,0.12)',
  amber: '#a3782c',
  amberDim: 'rgba(163,120,44,0.13)',
};

export const C: typeof DARK = { ...DARK };

export type ThemeMode = 'dark' | 'light';

export function currentTheme(): ThemeMode {
  return (localStorage.getItem('atlas-theme') as ThemeMode) === 'light' ? 'light' : 'dark';
}

export function applyTheme(mode: ThemeMode): void {
  Object.assign(C, mode === 'light' ? LIGHT : DARK);
  localStorage.setItem('atlas-theme', mode);
  document.body.style.background = C.bg;
  document.body.style.colorScheme = mode;
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
      return { color: C.sub, dim: 'rgba(184,180,169,0.10)' };
    case 'text':
      return { color: C.text, dim: 'rgba(240,238,230,0.08)' };
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
