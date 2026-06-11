import { useState } from 'react';
import { X, Loader2, Plus } from 'lucide-react';
import { C, sans, mono } from '../../theme/tokens';
import { api } from '../../lib/api';

/** §6.2 custom add: stdio commands must resolve inside the repo/runtimes; the modal is the one-time consent. */
export function CustomServerModal({
  activeProject,
  onClose,
  onResult,
}: {
  activeProject: string;
  onClose: () => void;
  onResult: (errorMessage: string | null) => void;
}) {
  const [name, setName] = useState('');
  const [transport, setTransport] = useState<'stdio' | 'streamable-http'>('stdio');
  const [command, setCommand] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = (): void => {
    setBusy(true);
    api
      .addCustomPlugin({
        name,
        transport,
        command: transport === 'stdio' ? command : undefined,
        url: transport === 'streamable-http' ? url : undefined,
        projectId: activeProject,
      })
      .then((r) => onResult(r.lastError))
      .catch((err: unknown) => onResult(err instanceof Error ? err.message : String(err)))
      .finally(() => {
        setBusy(false);
        onClose();
      });
  };

  const field = (
    label: string,
    value: string,
    set: (v: string) => void,
    placeholder: string,
  ): JSX.Element => (
    <label className="block mb-3">
      <span className="block text-xs font-medium mb-1" style={{ color: C.mute, fontFamily: sans }}>
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => set(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg px-3 py-2 text-sm outline-none"
        style={{ background: C.panel, border: `1px solid ${C.border}`, color: C.text, fontFamily: mono }}
      />
    </label>
  );

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center p-6"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={onClose}
    >
      <div
        className="rounded-2xl w-full p-5"
        style={{ maxWidth: 480, background: C.bg, border: `1px solid ${C.border}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <span className="text-base font-medium" style={{ color: C.text, fontFamily: sans }}>
            Add custom MCP server
          </span>
          <button onClick={onClose} className="p-1.5 rounded-lg" style={{ color: C.mute }}>
            <X size={16} />
          </button>
        </div>

        {field('Name', name, setName, 'my-tools')}
        <div className="flex gap-2 mb-3">
          {(['stdio', 'streamable-http'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTransport(t)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium"
              style={{
                background: transport === t ? C.raised : 'transparent',
                color: transport === t ? C.text : C.mute,
                border: `1px solid ${transport === t ? C.border : 'transparent'}`,
                fontFamily: sans,
              }}
            >
              {t}
            </button>
          ))}
        </div>
        {transport === 'stdio'
          ? field('Command (inside the Atlas repo/runtimes)', command, setCommand, 'servers/my-server.ts')
          : field('URL (loopback or public — private ranges blocked)', url, setUrl, 'http://127.0.0.1:9000/mcp')}

        <p className="text-xs mb-4" style={{ color: C.mute, fontFamily: sans }}>
          Adding a server is your consent to run it. stdio commands must resolve inside the Atlas
          repo — arbitrary host binaries are refused.
        </p>

        <button
          disabled={busy || !name || (transport === 'stdio' ? !command : !url)}
          onClick={submit}
          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium"
          style={{ background: C.accent, color: '#fff', fontFamily: sans, opacity: busy ? 0.7 : 1 }}
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Connect
        </button>
      </div>
    </div>
  );
}
