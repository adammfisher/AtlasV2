import { C, MONO } from '../theme/tokens';

/* Stage 1 placeholder frame — Stage 3 swaps in the real sandboxed iframe; caption kept (PRD A19). */
export function SitePreview() {
  return (
    <div className="mt-3 rounded-xl overflow-hidden" style={{ border: `1px solid ${C.border}` }}>
      <div className="flex items-center gap-1.5 px-3 py-2" style={{ background: C.raise }}>
        <span className="w-2 h-2 rounded-full" style={{ background: C.red }} />
        <span className="w-2 h-2 rounded-full" style={{ background: C.amber }} />
        <span className="w-2 h-2 rounded-full" style={{ background: C.green }} />
        <span className="text-xs ml-2" style={{ color: C.faint, fontFamily: MONO }}>
          sandbox · csp locked · offline
        </span>
      </div>
      <div className="px-5 py-5" style={{ background: '#211f1d' }}>
        <div className="h-3 w-32 rounded" style={{ background: C.accent, opacity: 0.85 }} />
        <div className="h-2 w-64 max-w-full rounded mt-3" style={{ background: C.raise2 }} />
        <div className="h-2 w-52 max-w-full rounded mt-1.5" style={{ background: C.raise2 }} />
        <div className="flex gap-2 mt-4">
          <div
            className="h-7 w-20 rounded-lg"
            style={{ background: C.accentDim, border: `1px solid ${C.accent}` }}
          />
          <div className="h-7 w-20 rounded-lg" style={{ background: C.raise2 }} />
        </div>
      </div>
    </div>
  );
}
