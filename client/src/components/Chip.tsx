import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { C } from '../theme/tokens';

const tones = {
  green: { bg: C.greenDim, fg: C.green },
  amber: { bg: C.amberDim, fg: C.amber },
  accent: { bg: C.accentDim, fg: C.accent },
  dim: { bg: C.raise, fg: C.dim },
} as const;

export function Chip({
  icon: Icon,
  children,
  tone,
  spin,
}: {
  icon?: LucideIcon;
  children: ReactNode;
  tone?: keyof typeof tones;
  spin?: boolean;
}) {
  const t = tones[tone ?? 'dim'];
  return (
    <span
      className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md mr-1.5 mb-1.5"
      style={{ background: t.bg, color: t.fg }}
    >
      {Icon && <Icon size={11} className={spin ? 'animate-spin' : ''} />}
      {children}
    </span>
  );
}
