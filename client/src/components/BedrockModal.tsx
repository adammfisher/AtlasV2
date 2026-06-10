import { useState } from 'react';
import { Cloud, X, Loader2 } from 'lucide-react';
import { C, MONO } from '../theme/tokens';
import { api } from '../lib/api';

export function BedrockModal({ close }: { close: () => void }) {
  const [region, setRegion] = useState('us-east-1');
  const [profile, setProfile] = useState('corp-bedrock');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.bedrockConnect(region, profile);
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
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
          <div className="text-base font-medium flex items-center gap-2" style={{ color: C.text }}>
            <Cloud size={16} style={{ color: C.blue }} /> Connect Amazon Bedrock
          </div>
          <X size={16} className="cursor-pointer" style={{ color: C.faint }} onClick={close} />
        </div>
        <p className="text-xs mt-2 leading-relaxed" style={{ color: C.dim }}>
          Adds Claude as a quality upgrade. Office JSON and code tasks route to it automatically;
          chat stays on-device unless you pick it.
        </p>
        <div className="mt-4 text-xs font-medium" style={{ color: C.faint }}>
          REGION
        </div>
        <input
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          className="mt-1.5 w-full rounded-lg px-3 py-2 text-sm outline-none"
          style={{ background: C.bg, color: C.text, border: `1px solid ${C.borderSoft}`, fontFamily: MONO }}
        />
        <div className="mt-3 text-xs font-medium" style={{ color: C.faint }}>
          CREDENTIAL PROFILE
        </div>
        <input
          value={profile}
          onChange={(e) => setProfile(e.target.value)}
          className="mt-1.5 w-full rounded-lg px-3 py-2 text-sm outline-none"
          style={{ background: C.bg, color: C.text, border: `1px solid ${C.borderSoft}`, fontFamily: MONO }}
        />
        <div className="mt-2 text-xs" style={{ color: C.faint }}>
          Credentials resolve from the AWS provider chain. Nothing is stored by Atlas.
        </div>
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
            onClick={() => void connect()}
            disabled={busy}
            className="text-sm px-3.5 py-2 rounded-lg font-medium inline-flex items-center gap-2"
            style={{ background: C.accent, color: '#fff' }}
          >
            {busy && <Loader2 size={13} className="animate-spin" />}
            {busy ? 'Connecting…' : 'Connect'}
          </button>
        </div>
      </div>
    </div>
  );
}
