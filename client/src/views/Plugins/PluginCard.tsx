import { Check, Download, ShieldCheck } from 'lucide-react';
import { C, sans, namedIcon, tokenColor } from '../../theme/tokens';
import { Badge } from '../../components/Badge';
import { TransportBadge } from './TransportBadge';
import type { PluginEntry } from '../../lib/api';

export function PluginCard({
  p,
  activeProject,
  onOpen,
  onInstall,
}: {
  p: PluginEntry;
  activeProject: string;
  onOpen: (id: string) => void;
  onInstall: (id: string) => void;
}) {
  const Icon = namedIcon(p.icon);
  const { color, dim } = tokenColor(p.colorToken);
  const enabledHere = p.enabledProjects.includes(activeProject);
  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-2.5 transition-colors cursor-pointer"
      style={{ background: C.panel, border: `1px solid ${p.featured ? C.accent : C.border}` }}
      onClick={() => onOpen(p.id)}
      onMouseEnter={(e) => (e.currentTarget.style.background = C.panelHover)}
      onMouseLeave={(e) => (e.currentTarget.style.background = C.panel)}
    >
      <div className="flex items-center gap-2.5">
        <span
          className="flex items-center justify-center rounded-lg flex-shrink-0"
          style={{ width: 36, height: 36, background: dim }}
        >
          <Icon size={18} style={{ color }} />
        </span>
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <span className="text-sm font-medium truncate" style={{ color: C.text, fontFamily: sans }}>
              {p.name}
            </span>
            {p.featured ? (
              <Badge color={C.accent} dim={C.accentDim}>
                Featured
              </Badge>
            ) : null}
          </span>
          <span className="block text-xs truncate" style={{ color: C.mute, fontFamily: sans }}>
            {p.vendor}
          </span>
        </span>
      </div>
      <p className="text-xs leading-relaxed" style={{ color: C.sub, fontFamily: sans, minHeight: 44 }}>
        {p.description}
      </p>
      <div className="flex items-center gap-1.5 flex-wrap">
        <TransportBadge t={p.transport} />
        <span className="text-xs" style={{ color: C.mute, fontFamily: sans }}>
          {(p.tools ?? []).length} tools
        </span>
      </div>
      <div className="flex items-center gap-2 pt-1" style={{ borderTop: `1px solid ${C.borderSoft}` }}>
        {p.status === 'bundled' ? (
          <>
            <Badge color={C.green} dim={C.greenDim} icon={ShieldCheck}>
              Bundled
            </Badge>
            <span className="text-xs ml-auto" style={{ color: enabledHere ? C.green : C.mute, fontFamily: sans }}>
              {enabledHere ? 'Enabled' : 'Disabled'}
            </span>
          </>
        ) : p.status === 'installed' ? (
          <>
            <Badge color={C.blue} dim={C.blueDim} icon={Check}>
              Installed
            </Badge>
            <span className="text-xs ml-auto" style={{ color: C.mute, fontFamily: sans }}>
              Configure →
            </span>
          </>
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onInstall(p.id);
            }}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{
              background: p.featured ? C.accent : C.raised,
              color: p.featured ? '#fff' : C.text,
              fontFamily: sans,
              border: p.featured ? 'none' : `1px solid ${C.border}`,
            }}
          >
            <Download size={12} /> Install
          </button>
        )}
      </div>
    </div>
  );
}
