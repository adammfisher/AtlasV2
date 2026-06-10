import {
  Presentation,
  FileText,
  Table,
  GitBranch,
  Code,
  LayoutTemplate,
  PenTool,
  type LucideIcon,
} from 'lucide-react';

/* Atlas palette · modeled on Claude.ai dark — exact values from reference/atlas-ui.jsx */
export const C = {
  win: '#1b1a18',
  bg: '#262624',
  side: '#1f1e1c',
  raise: '#30302c',
  raise2: '#3a3934',
  border: '#3b3a35',
  borderSoft: '#33322d',
  text: '#ece9e2',
  dim: '#a39d92',
  faint: '#7a756c',
  accent: '#d97757',
  accentDim: 'rgba(217,119,87,0.14)',
  green: '#85a87c',
  greenDim: 'rgba(133,168,124,0.16)',
  amber: '#c9a36a',
  amberDim: 'rgba(201,163,106,0.15)',
  blue: '#8fb0d1',
  red: '#c97c70',
} as const;

export const SERIF = "ui-serif, Georgia, 'Times New Roman', serif";
export const MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";

export const ICONS: Record<string, LucideIcon> = {
  pptx: Presentation,
  docx: FileText,
  xlsx: Table,
  pdf: FileText,
  mermaid: GitBranch,
  react: Code,
  site: LayoutTemplate,
  md: PenTool,
};
