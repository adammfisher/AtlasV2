import { useState } from 'react';
import { X, Info, KeyRound, Folder, RefreshCw, Loader2 } from 'lucide-react';
import { C, MONO } from '../../theme/tokens';
import { StatusBadge } from '../../components/StatusBadge';
import { Toggle } from '../../components/Toggle';
import { pluginIcon } from './icons';
import { api, type PluginEntry, type Project } from '../../lib/api';

export function PluginDetail({
  p,
  projects,
  setEnabled,
  close,
}: {
  p: PluginEntry;
  projects: Project[];
  setEnabled: (projectId: string, enabled: boolean) => void;
  close: () => void;
}) {
  const planned = p.status === 'planned';
  const Icon = pluginIcon(p.icon);
  const [actionError, setActionError] = useState<string | null>(null);

  const tryAction = (fn: () => Promise<unknown>) => {
    setActionError(null);
    void fn().catch((err: unknown) => {
      setActionError(err instanceof Error ? err.message : String(err));
    });
  };

  return (
    <div
      className="w-96 flex-shrink-0 h-full overflow-y-auto px-5 py-5"
      style={{ background: C.side, borderLeft: `1px solid ${C.borderSoft}` }}
    >
      <div className="flex items-start gap-3">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center"
          style={{ background: planned ? C.amberDim : C.raise2 }}
        >
          <Icon size={19} style={{ color: planned ? C.amber : C.dim }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-base font-medium" style={{ color: C.text }}>
            {p.name}
          </div>
          <div className="text-xs" style={{ color: C.faint }}>
            {p.vendor}
          </div>
        </div>
        <X size={16} className="cursor-pointer mt-1" style={{ color: C.faint }} onClick={close} />
      </div>
      <div className="mt-3">
        <StatusBadge status={p.status} />
      </div>
      <p className="text-sm mt-3 leading-relaxed" style={{ color: C.dim }}>
        {p.description}
      </p>

      {planned && p.plannedNotice && (
        <div
          className="mt-4 rounded-xl px-3.5 py-3 text-xs leading-relaxed"
          style={{ background: C.amberDim, color: C.amber, border: `1px dashed ${C.amber}` }}
        >
          <Info size={12} className="inline mr-1.5 -mt-0.5" />
          {p.plannedNotice}
        </div>
      )}

      <div className="mt-5 text-xs font-medium" style={{ color: C.faint }}>
        CONNECTION
      </div>
      <div
        className="mt-2 rounded-lg px-3 py-2.5 text-xs break-all"
        style={{ background: C.bg, color: C.dim, fontFamily: MONO, border: `1px solid ${C.borderSoft}` }}
      >
        {p.launch ?? p.url ?? ''}
      </div>

      <div className="mt-5 text-xs font-medium" style={{ color: C.faint }}>
        TOOLS
      </div>
      <div className="mt-2 space-y-1.5">
        {p.toolsPreview.map(([name, desc]) => (
          <div
            key={name}
            className="rounded-lg px-3 py-2"
            style={{ background: C.bg, border: `1px solid ${C.borderSoft}` }}
          >
            <div className="text-xs" style={{ color: C.text, fontFamily: MONO }}>
              {name}
            </div>
            <div className="text-xs mt-0.5" style={{ color: C.faint }}>
              {desc}
            </div>
          </div>
        ))}
      </div>

      {(p.authFields?.length ?? 0) > 0 && (
        <>
          <div className="mt-5 text-xs font-medium" style={{ color: C.faint }}>
            CREDENTIALS
          </div>
          {(p.authFields ?? []).map(([label, val]) => (
            <div
              key={label}
              className="mt-2 rounded-lg px-3 py-2.5 flex items-center gap-2"
              style={{ background: C.bg, border: `1px solid ${C.borderSoft}` }}
            >
              <KeyRound size={13} style={{ color: C.faint }} />
              <div className="min-w-0">
                <div className="text-xs" style={{ color: C.faint }}>
                  {label}
                </div>
                <div className="text-xs truncate" style={{ color: C.dim, fontFamily: MONO }}>
                  {val}
                </div>
              </div>
            </div>
          ))}
          <div className="text-xs mt-1.5" style={{ color: C.faint }}>
            Stored encrypted on this machine. Never synced.
          </div>
        </>
      )}

      <div className="mt-5 text-xs font-medium" style={{ color: C.faint }}>
        ENABLED IN PROJECTS
      </div>
      <div className="mt-2 space-y-1">
        {projects.map((proj) => {
          const on = p.enabledProjects.includes(proj.id);
          return (
            <div
              key={proj.id}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg"
              style={{ background: C.bg, border: `1px solid ${C.borderSoft}` }}
            >
              <Folder size={13} style={{ color: C.faint }} />
              <span className="text-sm flex-1" style={{ color: C.text }}>
                {proj.name}
              </span>
              <Toggle
                on={on}
                disabled={p.status !== 'connected'}
                onClick={() => setEnabled(proj.id, !on)}
              />
            </div>
          );
        })}
      </div>
      <div className="text-xs mt-1.5" style={{ color: C.faint }}>
        A project’s chats only see that project’s tools.
      </div>

      {actionError && (
        <div
          className="mt-4 rounded-lg px-3 py-2.5 text-xs leading-relaxed"
          style={{ background: C.amberDim, color: C.amber, border: `1px solid ${C.amber}` }}
        >
          {actionError}
        </div>
      )}

      <div className="mt-6 flex gap-2">
        {p.status === 'connected' && (
          <>
            <button
              onClick={() =>
                tryAction(() =>
                  fetch(`/api/plugins/installs/${p.installId}/restart`, { method: 'POST' }).then(
                    async (r) => {
                      if (!r.ok) {
                        const body = (await r.json()) as { error?: string };
                        throw new Error(body.error ?? 'restart failed');
                      }
                    },
                  ),
                )
              }
              className="flex-1 text-xs py-2 rounded-lg inline-flex items-center justify-center gap-1.5"
              style={{ border: `1px solid ${C.border}`, color: C.dim }}
            >
              <RefreshCw size={12} />
              Restart
            </button>
            <button
              onClick={() =>
                tryAction(() =>
                  fetch(`/api/plugins/installs/${p.installId}`, { method: 'DELETE' }).then(
                    async (r) => {
                      if (!r.ok) {
                        const body = (await r.json()) as { error?: string };
                        throw new Error(body.error ?? 'remove failed');
                      }
                    },
                  ),
                )
              }
              className="flex-1 text-xs py-2 rounded-lg"
              style={{ border: `1px solid ${C.border}`, color: C.red }}
            >
              Remove
            </button>
          </>
        )}
        {p.status === 'available' && (
          <button
            onClick={() => tryAction(() => api.installPlugin(p.id))}
            className="flex-1 text-sm py-2 rounded-lg font-medium"
            style={{ background: C.accent, color: '#fff' }}
          >
            Install
          </button>
        )}
        {p.status === 'installing' && (
          <button
            disabled
            className="flex-1 text-sm py-2 rounded-lg inline-flex items-center justify-center gap-2"
            style={{ background: C.raise2, color: C.dim }}
          >
            <Loader2 size={13} className="animate-spin" /> Installing from bundled runtime…
          </button>
        )}
        {planned && (
          <button
            disabled
            className="flex-1 text-sm py-2 rounded-lg"
            style={{ border: `1px dashed ${C.amber}`, color: C.amber, opacity: 0.7 }}
          >
            Reserved — port 7979
          </button>
        )}
      </div>
    </div>
  );
}
