import { useState } from 'react';
import { X } from 'lucide-react';
import { C, MONO } from '../theme/tokens';

export function AddServerModal({
  close,
  add,
}: {
  close: () => void;
  add: (name: string, transport: string, cmd: string) => Promise<void>;
}) {
  const [transport, setTransport] = useState('stdio');
  const [name, setName] = useState('');
  const [cmd, setCmd] = useState('');
  const [error, setError] = useState<string | null>(null);

  const install = () => {
    if (!name.trim()) return;
    setError(null);
    add(name.trim(), transport, cmd.trim())
      .then(close)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  };

  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.55)' }}
    >
      <div
        className="w-full max-w-md rounded-2xl p-5 mx-4"
        style={{ background: C.side, border: `1px solid ${C.border}` }}
      >
        <div className="flex items-center justify-between">
          <div className="text-base font-medium" style={{ color: C.text }}>
            Add custom server
          </div>
          <X size={16} className="cursor-pointer" style={{ color: C.faint }} onClick={close} />
        </div>
        <div className="mt-4 text-xs font-medium" style={{ color: C.faint }}>
          NAME
        </div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Internal tooling"
          className="mt-1.5 w-full rounded-lg px-3 py-2 text-sm outline-none"
          style={{ background: C.bg, color: C.text, border: `1px solid ${C.borderSoft}` }}
        />
        <div className="mt-4 text-xs font-medium" style={{ color: C.faint }}>
          TRANSPORT
        </div>
        <div className="mt-1.5 flex gap-1.5 flex-wrap">
          {['stdio', 'streamable-http', 'sse', 'websocket'].map((t) => (
            <button
              key={t}
              onClick={() => setTransport(t)}
              className="text-xs px-2.5 py-1.5 rounded-lg"
              style={{
                background: transport === t ? C.accentDim : C.bg,
                color: transport === t ? C.accent : C.dim,
                border: `1px solid ${transport === t ? C.accent : C.borderSoft}`,
              }}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="mt-4 text-xs font-medium" style={{ color: C.faint }}>
          {transport === 'stdio' ? 'COMMAND' : 'URL'}
        </div>
        <input
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          placeholder={
            transport === 'stdio'
              ? 'runtimes/python/bin/python -m my_server'
              : 'https://tool.internal.corp/mcp'
          }
          className="mt-1.5 w-full rounded-lg px-3 py-2 text-xs outline-none"
          style={{ background: C.bg, color: C.text, border: `1px solid ${C.borderSoft}`, fontFamily: MONO }}
        />
        {transport === 'stdio' && (
          <div className="mt-1.5 text-xs" style={{ color: C.faint }}>
            Launched from the bundled runtimes — Node and Python ship inside the Atlas folder.
            Nothing to install.
          </div>
        )}
        {error && (
          <div
            className="mt-3 rounded-lg px-3 py-2.5 text-xs leading-relaxed"
            style={{ background: C.amberDim, color: C.amber, border: `1px solid ${C.amber}` }}
          >
            {error}
          </div>
        )}
        <div className="mt-5 flex gap-2 justify-end">
          <button
            onClick={close}
            className="text-sm px-3.5 py-2 rounded-lg"
            style={{ color: C.dim, border: `1px solid ${C.border}` }}
          >
            Cancel
          </button>
          <button
            onClick={install}
            className="text-sm px-3.5 py-2 rounded-lg font-medium"
            style={{ background: C.accent, color: '#fff', opacity: name.trim() ? 1 : 0.5 }}
          >
            Install
          </button>
        </div>
      </div>
    </div>
  );
}
