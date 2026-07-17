import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { C, sans } from '../theme/tokens';

/** A single pipeline step. Slides + fades in so new steps appear smoothly
 * rather than popping. The keyframes are injected once (below). */
export function StepRow({
  state,
  label,
  detail,
}: {
  state: 'ok' | 'warn' | 'pending';
  label: string;
  detail?: string;
}) {
  return (
    <div className="flex items-center gap-2 py-1" style={{ animation: 'axiom-step-in 0.28s ease-out' }}>
      {state === 'warn' ? (
        <AlertCircle size={13} style={{ color: C.amber, flexShrink: 0 }} />
      ) : state === 'ok' ? (
        <CheckCircle2 size={13} style={{ color: C.green, flexShrink: 0 }} />
      ) : (
        <Loader2 size={13} className="animate-spin" style={{ color: C.accent, flexShrink: 0 }} />
      )}
      <span className="text-xs truncate" style={{ color: C.sub, fontFamily: sans }}>
        <span style={{ color: C.text }}>{label}</span>
        {detail ? <span style={{ color: C.mute }}> — {detail}</span> : null}
      </span>
    </div>
  );
}

// inject the slide-in keyframes once
if (typeof document !== 'undefined' && !document.getElementById('axiom-step-keyframes')) {
  const style = document.createElement('style');
  style.id = 'axiom-step-keyframes';
  style.textContent =
    '@keyframes axiom-step-in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}';
  document.head.appendChild(style);
}
