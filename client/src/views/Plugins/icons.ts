import {
  FolderOpen,
  Brain,
  Database,
  Network,
  GitBranch,
  Layers,
  BookOpen,
  Server,
  Globe,
  Terminal,
  type LucideIcon,
} from 'lucide-react';

const MAP: Record<string, LucideIcon> = {
  'folder-open': FolderOpen,
  brain: Brain,
  database: Database,
  network: Network,
  'git-branch': GitBranch,
  layers: Layers,
  'book-open': BookOpen,
  server: Server,
  globe: Globe,
  terminal: Terminal,
};

export function pluginIcon(name: string): LucideIcon {
  return MAP[name] ?? Terminal;
}
