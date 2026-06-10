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

/* Atlas palette — modeled on Claude.ai's warm dark theme (reference/atlas-v2-ui.jsx) */
export const C = {
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
} as const;

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
