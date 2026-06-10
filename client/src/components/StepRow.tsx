import { CheckCircle2, AlertCircle, Clock } from 'lucide-react';
import { C, sans } from '../theme/tokens';

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
    <div className="flex items-start gap-2 py-1">
      {state === 'warn' ? (
        <AlertCircle size={14} style={{ color: C.amber, marginTop: 2 }} />
      ) : state === 'ok' ? (
        <CheckCircle2 size={14} style={{ color: C.green, marginTop: 2 }} />
      ) : (
        <Clock size={14} style={{ color: C.mute, marginTop: 2 }} />
      )}
      <span className="text-xs" style={{ color: C.sub, fontFamily: sans }}>
        <span style={{ color: C.text }}>{label}</span>
        {detail ? <span style={{ color: C.mute }}> — {detail}</span> : null}
      </span>
    </div>
  );
}
