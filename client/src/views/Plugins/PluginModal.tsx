import { useState } from 'react';
import { X, Wrench, KeyRound, FolderKanban, ShieldCheck, RotateCw, Trash2, Loader2, AlertCircle, Settings2, PlugZap, Check } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { C, sans, mono, namedIcon, tokenColor } from '../../theme/tokens';
import { Toggle } from '../../components/Toggle';
import { TransportBadge } from './TransportBadge';
import { api, type PluginEntry, type Project } from '../../lib/api';

export function PluginModal({
  p,
  projects,
  activeProject,
  onClose,
  toggleProj,
}: {
  p: PluginEntry;
  projects: Project[];
  activeProject: string;
  onClose: () => void;
  toggleProj: (projectId: string, enabled: boolean) => void;
}) {
  const Icon = namedIcon(p.icon);
  const { color, dim } = tokenColor(p.colorToken);
  const configurable = p.installId !== null;
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<'restart' | 'remove' | 'cred' | 'test' | null>(null);
  const [credValue, setCredValue] = useState('');
  const [error, setError] = useState<string | null>(p.lastError ?? null);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    tools?: Array<{ name: string; description: string }>;
    error?: string;
  } | null>(null);
  // saved value wins, then the manifest default (e.g. https://gitlab.com)
  const savedConfig = (): Record<string, string> => {
    const initial: Record<string, string> = {};
    for (const f of p.config ?? []) initial[f.key] = p.configValues?.[f.key] ?? f.default ?? '';
    return initial;
  };
  const [configDraft, setConfigDraft] = useState<Record<string, string>>(savedConfig);
  const configDirty = (p.config ?? []).some(
    (f) => configDraft[f.key] !== (p.configValues?.[f.key] ?? f.default ?? ''),
  );

  // live listTools replaces toolsPreview once connected
  const { data: liveTools } = useQuery({
    queryKey: ['plugin-tools', p.installId, activeProject],
    queryFn: () => api.pluginTools(p.installId as string, activeProject),
    enabled: Boolean(p.installId && (p.status === 'connected' || p.status === 'bundled')),
    retry: false,
  });
  const tools = liveTools?.map((t) => t.name) ?? p.tools ?? [];

  const run = (kind: 'restart' | 'remove' | 'cred', fn: () => Promise<unknown>) => {
    setBusy(kind);
    setError(null);
    fn()
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => {
        setBusy(null);
        void queryClient.invalidateQueries({ queryKey: ['plugins'] });
        void queryClient.invalidateQueries({ queryKey: ['plugin-tools'] });
      });
  };

  const runTest = () => {
    setBusy('test');
    setTestResult(null);
    api
      .testPlugin(p.installId as string, activeProject)
      .then((result) => setTestResult(result))
      .catch((err: unknown) =>
        setTestResult({ ok: false, error: err instanceof Error ? err.message : String(err) }),
      )
      .finally(() => {
        setBusy(null);
        void queryClient.invalidateQueries({ queryKey: ['plugin-tools'] });
      });
  };
  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center p-6"
      style={{ background: C.scrim }}
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
              Tools ({tools.length}){liveTools ? ' · live' : ' · preview'}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {tools.map((t) => (
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

          {p.id === 'memory' ? (
            <p className="text-xs" style={{ color: C.mute, fontFamily: sans }}>
              Semantic recall off — add an EmbeddingGemma GGUF to the models folder. Keyword (FTS5)
              recall is active.
            </p>
          ) : null}

          {error ? (
            <div
              className="flex items-start gap-2 rounded-lg px-3 py-2 text-xs"
              style={{ background: C.amberDim, color: C.amber, fontFamily: sans }}
            >
              <AlertCircle size={13} className="mt-0.5 flex-shrink-0" /> {error}
            </div>
          ) : null}

          {testResult ? (
            <div
              className="flex items-start gap-2 rounded-lg px-3 py-2 text-xs"
              style={{
                background: testResult.ok ? C.greenDim : C.amberDim,
                color: testResult.ok ? C.green : C.amber,
                fontFamily: sans,
              }}
            >
              {testResult.ok ? (
                <Check size={13} className="mt-0.5 flex-shrink-0" />
              ) : (
                <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />
              )}
              {testResult.ok
                ? `Connected — ${testResult.tools?.length ?? 0} tool${testResult.tools?.length === 1 ? '' : 's'} responded: ${
                    testResult.tools?.map((t) => t.name).join(', ') || 'none'
                  }`
                : testResult.error}
            </div>
          ) : null}

          {(p.creds ?? []).length > 0 || (p.config ?? []).length > 0 ? (
            <div>
              <div className="text-xs font-medium uppercase tracking-wider mb-2" style={{ color: C.mute, fontFamily: sans }}>
                Settings
              </div>
              {(p.config ?? []).map((f) => (
                <label
                  key={f.key}
                  className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 mb-1.5"
                  style={{ background: C.panel, border: `1px solid ${C.borderSoft}` }}
                >
                  <Settings2 size={14} style={{ color: C.blue }} />
                  <span className="text-sm flex-1" style={{ color: C.text, fontFamily: sans }}>
                    {f.label}
                  </span>
                  <input
                    value={configDraft[f.key] ?? ''}
                    placeholder={f.placeholder ?? f.default ?? ''}
                    disabled={!configurable}
                    onChange={(e) => setConfigDraft({ ...configDraft, [f.key]: e.target.value })}
                    className="bg-transparent text-right text-xs outline-none w-56"
                    style={{ color: C.text, fontFamily: mono }}
                  />
                </label>
              ))}
              {(p.creds ?? []).map((c) => (
                <label
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
                    placeholder={p.hasCredentials ? '•••••••• saved' : 'paste token'}
                    value={credValue}
                    disabled={!configurable}
                    onChange={(e) => setCredValue(e.target.value)}
                    className="bg-transparent text-right text-sm outline-none w-40"
                    style={{ color: C.text, fontFamily: sans }}
                  />
                </label>
              ))}
              <button
                disabled={!configurable || busy === 'cred' || (!credValue && !configDirty)}
                onClick={() =>
                  run('cred', async () => {
                    await api.savePluginSettings(p.installId as string, {
                      // omit the token when the field is blank so saving a host
                      // change doesn't wipe an already-stored one
                      credential: credValue || undefined,
                      config: configDraft,
                      projectId: activeProject,
                    });
                    setCredValue('');
                  })
                }
                className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium"
                style={{
                  background: C.raised,
                  color: !configurable || (!credValue && !configDirty) ? C.mute : C.text,
                  border: `1px solid ${C.border}`,
                  fontFamily: sans,
                }}
              >
                {busy === 'cred' ? <Loader2 size={12} className="animate-spin" /> : <KeyRound size={12} />}
                Save & connect
              </button>
              <p className="text-xs mt-1.5" style={{ color: C.mute, fontFamily: sans }}>
                {configurable
                  ? 'Tokens are AES-256-GCM encrypted at rest, never returned by the API, and never shown to the model.'
                  : 'Install this connector first, then add its token here.'}
              </p>
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
          {configurable ? (
            <>
              <button
                onClick={runTest}
                className="ml-auto flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium"
                style={{ background: C.raised, color: C.text, border: `1px solid ${C.border}`, fontFamily: sans }}
              >
                {busy === 'test' ? <Loader2 size={12} className="animate-spin" /> : <PlugZap size={12} />} Test
              </button>
              <button
                onClick={() => run('restart', () => api.restartPlugin(p.installId as string, activeProject))}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium"
                style={{ background: C.raised, color: C.text, border: `1px solid ${C.border}`, fontFamily: sans }}
              >
                {busy === 'restart' ? <Loader2 size={12} className="animate-spin" /> : <RotateCw size={12} />} Restart
              </button>
              {p.status !== 'bundled' ? (
                <button
                  onClick={() =>
                    run('remove', async () => {
                      await api.removePlugin(p.installId as string);
                      onClose();
                    })
                  }
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium"
                  style={{ background: 'transparent', color: C.amber, border: `1px solid ${C.amber}`, fontFamily: sans }}
                >
                  {busy === 'remove' ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Remove
                </button>
              ) : null}
            </>
          ) : null}
          <button
            onClick={onClose}
            className={configurable ? 'px-4 py-2 rounded-lg text-sm font-medium' : 'ml-auto px-4 py-2 rounded-lg text-sm font-medium'}
            style={{ background: C.accent, color: C.accentContrast, fontFamily: sans }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
