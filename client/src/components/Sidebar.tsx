import { Plus, Settings, Folder, Box, Puzzle, Sparkles, Cpu } from 'lucide-react';
import { C } from '../theme/tokens';
import type { View } from '../lib/store';
import type { Conversation } from '../lib/api';

export function Sidebar({
  view,
  setView,
  convs,
  activeConv,
  openConv,
  newChat,
  modelLabel,
  ramGB,
  userName,
}: {
  view: View;
  setView: (v: View) => void;
  convs: Conversation[];
  activeConv: string | null;
  openConv: (id: string) => void;
  newChat: () => void;
  modelLabel: string;
  ramGB: number | null;
  userName: string;
}) {
  const nav: Array<{ id: View; label: string; icon: typeof Folder }> = [
    { id: 'projects', label: 'Projects', icon: Folder },
    { id: 'artifacts', label: 'Artifacts', icon: Box },
    { id: 'plugins', label: 'Plugins', icon: Puzzle },
    { id: 'skills', label: 'Skills', icon: Sparkles },
  ];
  const initials =
    userName
      .split(/\s+/)
      .map((w) => w[0] ?? '')
      .join('')
      .slice(0, 2)
      .toUpperCase() || 'A';
  return (
    <div
      className="w-64 flex flex-col h-full flex-shrink-0"
      style={{ background: C.side, borderRight: `1px solid ${C.borderSoft}` }}
    >
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center text-sm font-semibold"
          style={{ background: `linear-gradient(135deg, ${C.accent}, #b85c3e)`, color: '#fff' }}
        >
          A
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold" style={{ color: C.text }}>
            Atlas
          </div>
          <div className="text-xs" style={{ color: C.faint }}>
            Local · on-device
          </div>
        </div>
      </div>

      <div className="px-2 space-y-0.5">
        <button
          onClick={newChat}
          className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-sm text-left"
          style={{ color: C.text }}
        >
          <Plus size={15} style={{ color: C.accent }} /> New chat
        </button>
        {nav.map((n) => {
          const active = view === n.id;
          return (
            <button
              key={n.id}
              onClick={() => setView(n.id)}
              className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-sm text-left transition-colors"
              style={{ color: active ? C.text : C.dim, background: active ? C.raise : 'transparent' }}
            >
              <n.icon size={15} style={{ color: active ? C.accent : C.faint }} />
              {n.label}
            </button>
          );
        })}
      </div>

      <div className="px-4 mt-5 mb-1 text-xs font-medium" style={{ color: C.faint }}>
        Recents
      </div>
      <div className="px-2 overflow-y-auto flex-1 space-y-0.5">
        {convs.map((c) => {
          const active = view === 'chat' && c.id === activeConv;
          return (
            <button
              key={c.id}
              onClick={() => openConv(c.id)}
              className="w-full text-left px-2.5 py-1.5 rounded-lg text-sm truncate transition-colors"
              style={{ color: active ? C.text : C.dim, background: active ? C.raise : 'transparent' }}
            >
              {c.title}
            </button>
          );
        })}
      </div>

      <div className="px-3 py-3 space-y-2" style={{ borderTop: `1px solid ${C.borderSoft}` }}>
        <div className="flex items-center gap-2 px-1.5 text-xs" style={{ color: C.dim }}>
          <Cpu size={13} style={{ color: C.green }} />
          {modelLabel}
          <span className="ml-auto" style={{ color: C.faint }}>
            {ramGB !== null ? `${ramGB} GB` : ''}
          </span>
        </div>
        <div className="flex items-center gap-2.5 px-1.5">
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium"
            style={{ background: C.raise2, color: C.text }}
          >
            {initials}
          </div>
          <div className="text-sm" style={{ color: C.text }}>
            {userName}
          </div>
          <Settings size={14} className="ml-auto cursor-pointer" style={{ color: C.faint }} />
        </div>
      </div>
    </div>
  );
}
