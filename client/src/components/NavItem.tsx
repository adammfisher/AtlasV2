import type { LucideIcon } from 'lucide-react';
import { C, sans } from '../theme/tokens';

export function NavItem({
  icon: Icon,
  label,
  active,
  onClick,
  badge,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: string;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-sm transition-colors text-left"
      style={{ color: active ? C.text : C.sub, background: active ? C.navActiveBg : 'transparent', fontFamily: sans }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = C.hoverWash;
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = 'transparent';
      }}
    >
      <Icon size={16} strokeWidth={1.8} style={{ color: active ? C.accent : C.mute }} />
      <span className="flex-1 truncate">{label}</span>
      {badge ? (
        <span className="text-xs px-1.5 rounded-full" style={{ color: C.accent, background: C.accentDim }}>
          {badge}
        </span>
      ) : null}
    </button>
  );
}
