import { useEffect, useState } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { C, sans } from '../theme/tokens';

interface Toast {
  id: number;
  message: string;
}

/** Stage 5 polish: every failed API call surfaces as a dismissible toast. */
export function Toasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const handler = (e: Event): void => {
      const message = (e as CustomEvent<string>).detail;
      const id = Date.now() + Math.random();
      setToasts((t) => [...t.slice(-2), { id, message }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 7000);
    };
    window.addEventListener('atlas-error', handler);
    return () => window.removeEventListener('atlas-error', handler);
  }, []);

  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="alert"
          className="flex items-start gap-2 rounded-xl px-4 py-2.5 text-sm shadow-2xl max-w-md"
          style={{ background: C.raised, border: `1px solid ${C.amber}`, color: C.text, fontFamily: sans }}
        >
          <AlertCircle size={15} className="mt-0.5 flex-shrink-0" style={{ color: C.amber }} />
          <span className="flex-1">{t.message}</span>
          <button onClick={() => setToasts((list) => list.filter((x) => x.id !== t.id))} style={{ color: C.mute }}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
