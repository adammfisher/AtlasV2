import { useState } from 'react';
import { X, Loader2, Cloud, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { C, sans, mono } from '../theme/tokens';
import { api } from '../lib/api';

/** §8 Bedrock connect: a real ListFoundationModels round-trip — the error state shows the real AWS message. */
export function BedrockModal({ onClose }: { onClose: () => void }) {
  const [region, setRegion] = useState('us-east-1');
  const [profile, setProfile] = useState('default');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const connect = (): void => {
    setBusy(true);
    setError(null);
    api
      .connectBedrock(region, profile)
      .then((r) => {
        setSuccess(`Connected — ${r.models} Anthropic models · ${r.modelId}`);
        void queryClient.invalidateQueries({ queryKey: ['models'] });
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  };

  const field = (label: string, value: string, set: (v: string) => void): JSX.Element => (
    <label className="block mb-3">
      <span className="block text-xs font-medium mb-1" style={{ color: C.mute, fontFamily: sans }}>
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => set(e.target.value)}
        className="w-full rounded-lg px-3 py-2 text-sm outline-none"
        style={{ background: C.panel, border: `1px solid ${C.border}`, color: C.text, fontFamily: mono }}
      />
    </label>
  );

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-6"
      style={{ background: C.scrim }}
      onClick={onClose}
    >
      <div
        className="rounded-2xl w-full p-5"
        style={{ maxWidth: 440, background: C.bg, border: `1px solid ${C.border}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-1">
          <Cloud size={16} style={{ color: C.blue }} />
          <span className="text-base font-medium" style={{ color: C.text, fontFamily: sans }}>
            Connect Amazon Bedrock
          </span>
          <button onClick={onClose} className="ml-auto p-1.5 rounded-lg" style={{ color: C.mute }}>
            <X size={16} />
          </button>
        </div>
        <p className="text-xs mb-4" style={{ color: C.sub, fontFamily: sans }}>
          Credentials come from your AWS config (default provider chain). Connecting runs a real
          ListFoundationModels call — nothing is stored except region and profile name.
        </p>

        {field('Region', region, setRegion)}
        {field('AWS profile', profile, setProfile)}

        {error ? (
          <div
            className="flex items-start gap-2 rounded-lg px-3 py-2 mb-3 text-xs"
            style={{ background: C.amberDim, color: C.amber, fontFamily: sans }}
          >
            <AlertCircle size={13} className="mt-0.5 flex-shrink-0" /> {error}
          </div>
        ) : null}
        {success ? (
          <div
            className="flex items-start gap-2 rounded-lg px-3 py-2 mb-3 text-xs"
            style={{ background: C.greenDim, color: C.green, fontFamily: sans }}
          >
            <CheckCircle2 size={13} className="mt-0.5 flex-shrink-0" /> {success}
          </div>
        ) : null}

        {success ? (
          <button
            onClick={onClose}
            className="w-full py-2 rounded-lg text-sm font-medium"
            style={{ background: C.accent, color: C.accentContrast, fontFamily: sans }}
          >
            Done
          </button>
        ) : (
          <button
            disabled={busy}
            onClick={connect}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium"
            style={{ background: C.accent, color: C.accentContrast, fontFamily: sans, opacity: busy ? 0.7 : 1 }}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : null} Connect
          </button>
        )}
      </div>
    </div>
  );
}
