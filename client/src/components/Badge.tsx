import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { sans } from '../theme/tokens';

export function Badge({
  children,
  color,
  dim,
  icon: Icon,
}: {
  children: ReactNode;
  color: string;
  dim: string;
  icon?: LucideIcon;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ color, background: dim, fontFamily: sans }}
    >
      {Icon ? <Icon size={11} /> : null}
      {children}
    </span>
  );
}
