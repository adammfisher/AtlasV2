import { Terminal, Globe } from 'lucide-react';
import { C, MONO } from '../../theme/tokens';
import { StatusBadge } from '../../components/StatusBadge';
import { Toggle } from '../../components/Toggle';
import { pluginIcon } from './icons';
import type { PluginEntry } from '../../lib/api';

export function PluginCard({
  p,
  selected,
  onSelect,
  onToggle,
  activeProject,
}: {
  p: PluginEntry;
  selected: boolean;
  onSelect: () => void;
  onToggle: () => void;
  activeProject: string;
}) {
  const planned = p.status === 'planned';
  const enabledHere = p.enabledProjects.includes(activeProject);
  const bundled = p.launch !== undefined && (p.category === 'built-in' || p.bundledRuntime === true);
  const Icon = pluginIcon(p.icon);
  return (
    <div
      onClick={onSelect}
      role="button"
      className="text-left rounded-xl p-4 transition-colors w-full cursor-pointer"
      style={{
        background: selected ? C.raise : C.bg,
        border: planned ? `1px dashed ${C.amber}` : `1px solid ${selected ? C.border : C.borderSoft}`,
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: planned ? C.amberDim : C.raise2 }}
        >
          <Icon size={17} style={{ color: planned ? C.amber : C.dim }} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate" style={{ color: C.text }}>
              {p.name}
            </span>
            <span className="ml-auto flex-shrink-0">
              <StatusBadge status={p.status} />
            </span>
          </div>
          <div className="text-xs" style={{ color: C.faint }}>
            {p.vendor}
          </div>
        </div>
      </div>
      <p className="text-xs mt-2.5 leading-relaxed" style={{ color: C.dim }}>
        {p.description}
      </p>
      <div className="flex items-center gap-2 mt-3">
        <span
          className="text-xs px-1.5 py-0.5 rounded inline-flex items-center gap-1"
          style={{ background: C.raise2, color: C.dim, fontFamily: MONO }}
        >
          {p.transport === 'stdio' ? <Terminal size={10} /> : <Globe size={10} />}
          {p.transport}
          {bundled && p.transport === 'stdio' ? ' · bundled' : ''}
        </span>
        <span className="text-xs" style={{ color: C.faint }}>
          {p.toolsPreview.length} tools
        </span>
        <span className="text-xs ml-auto" style={{ color: C.faint }}>
          {p.status === 'connected'
            ? `${p.enabledProjects.length} project${p.enabledProjects.length === 1 ? '' : 's'}`
            : ''}
        </span>
        {p.status === 'connected' && (
          <span onClick={(e) => e.stopPropagation()}>
            <Toggle on={enabledHere} onClick={onToggle} />
          </span>
        )}
      </div>
    </div>
  );
}
