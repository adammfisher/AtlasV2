import { X, Wrench, KeyRound, FolderKanban, ShieldCheck } from 'lucide-react';
import { C, sans, mono, namedIcon, tokenColor } from '../../theme/tokens';
import { Toggle } from '../../components/Toggle';
import { TransportBadge } from './TransportBadge';
import type { PluginEntry, Project } from '../../lib/api';

export function PluginModal({
  p,
  projects,
  onClose,
  toggleProj,
}: {
  p: PluginEntry;
  projects: Project[];
  onClose: () => void;
  toggleProj: (projectId: string, enabled: boolean) => void;
}) {
  const Icon = namedIcon(p.icon);
  const { color, dim } = tokenColor(p.colorToken);
  const configurable = p.installId !== null;
  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center p-6"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={onClose}
    >
      <div
        className="rounded-2xl w-full overflow-hidden flex flex-col"
        style={{ maxWidth: 560, maxHeight: '88%', background: C.bg, border: `1px solid ${C.border}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: `1px solid ${C.borderSoft}` }}>
          <span className="flex items-center justify-center rounded-xl" style={{ width: 42, height: 42, background: dim }}>
            <Icon size={20} style={{ color }} />
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              <span className="text-base font-medium" style={{ color: C.text, fontFamily: sans }}>
                {p.name}
              </span>
              <TransportBadge t={p.transport} />
            </span>
            <span className="block text-xs" style={{ color: C.mute, fontFamily: sans }}>
              {p.vendor} · {p.runtime}
            </span>
          </span>
          <button onClick={onClose} className="ml-auto p-1.5 rounded-lg" style={{ color: C.mute }}>
            <X size={17} />
          </button>
        </div>

        <div className="px-5 py-4 overflow-y-auto flex flex-col gap-5">
          <p className="text-sm leading-relaxed" style={{ color: C.sub, fontFamily: sans }}>
            {p.description}
          </p>

          <div>
            <div className="text-xs font-medium uppercase tracking-wider mb-2" style={{ color: C.mute, fontFamily: sans }}>
              Endpoint
            </div>
            <code
              className="block px-3 py-2 rounded-lg text-xs"
              style={{ background: C.panel, color: C.green, border: `1px solid ${C.borderSoft}`, fontFamily: mono }}
            >
              {p.endpoint}
            </code>
          </div>

          <div>
            <div className="text-xs font-medium uppercase tracking-wider mb-2" style={{ color: C.mute, fontFamily: sans }}>
              Tools ({p.tools.length})
            </div>
            <div className="flex flex-wrap gap-1.5">
              {p.tools.map((t) => (
                <span
                  key={t}
                  className="px-2 py-1 rounded-md text-xs"
                  style={{ background: C.panel, color: C.sub, border: `1px solid ${C.borderSoft}`, fontFamily: mono }}
                >
                  <Wrench size={10} className="inline mr-1" style={{ color: C.mute }} />
                  {t}
                </span>
              ))}
            </div>
          </div>

          {p.creds.length > 0 ? (
            <div>
              <div className="text-xs font-medium uppercase tracking-wider mb-2" style={{ color: C.mute, fontFamily: sans }}>
                Credentials · stored per user (customUserVars)
              </div>
              {p.creds.map((c) => (
                <div
                  key={c.key}
                  className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 mb-1.5"
                  style={{ background: C.panel, border: `1px solid ${C.borderSoft}` }}
                >
                  <KeyRound size={14} style={{ color: C.amber }} />
                  <span className="text-sm flex-1" style={{ color: C.text, fontFamily: sans }}>
                    {c.label}
                  </span>
                  <input
                    type="password"
                    defaultValue="••••••••••••"
                    disabled
                    title="Encrypted credential storage ships in Stage 4"
                    className="bg-transparent text-right text-sm outline-none w-32"
                    style={{ color: C.mute, fontFamily: sans }}
                  />
                </div>
              ))}
            </div>
          ) : null}

          <div>
            <div className="text-xs font-medium uppercase tracking-wider mb-2" style={{ color: C.mute, fontFamily: sans }}>
              Project access · hard isolation by default
            </div>
            {projects.map((pr) => (
              <div
                key={pr.id}
                className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 mb-1.5"
                style={{ background: C.panel, border: `1px solid ${C.borderSoft}` }}
              >
                <FolderKanban size={14} style={{ color: C.purple }} />
                <span className="text-sm flex-1" style={{ color: C.text, fontFamily: sans }}>
                  {pr.name}
                </span>
                <Toggle
                  on={p.enabledProjects.includes(pr.id)}
                  disabled={!configurable}
                  onClick={() => toggleProj(pr.id, !p.enabledProjects.includes(pr.id))}
                />
              </div>
            ))}
            <p className="text-xs mt-1.5 flex items-center gap-1.5" style={{ color: C.mute, fontFamily: sans }}>
              <ShieldCheck size={12} /> Tools are only injected into chats inside enabled projects. User and
              project IDs are passed to the server on every call.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 px-5 py-3.5" style={{ borderTop: `1px solid ${C.borderSoft}` }}>
          <span className="text-xs flex items-center gap-1.5" style={{ color: C.mute, fontFamily: sans }}>
            <ShieldCheck size={13} style={{ color: C.green }} /> Vetted · SSRF allowlisted · audit logged
          </span>
          <button
            onClick={onClose}
            className="ml-auto px-4 py-2 rounded-lg text-sm font-medium"
            style={{ background: C.accent, color: '#fff', fontFamily: sans }}
          >
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}
