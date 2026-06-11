import { Plus, MessageSquare, FolderKanban, Puzzle, Sparkles, Lock, Cpu, Settings2 } from 'lucide-react';
import { C, sans, serif } from '../theme/tokens';
import { Badge } from './Badge';
import { NavItem } from './NavItem';
import type { View } from '../lib/store';
import type { Conversation, ModelsRegistry, Health } from '../lib/api';

const TIER_LABELS: Array<{ id: string; label: string }> = [
  { id: 'e2b', label: 'E2B router' },
  { id: '12b', label: '12B drafting' },
  { id: 'e4b', label: 'E4B' },
];

export function Sidebar({
  view,
  setView,
  convs,
  activeConv,
  openConv,
  newChat,
  registry,
  health,
  userName,
}: {
  view: View;
  setView: (v: View) => void;
  convs: Conversation[];
  activeConv: string | null;
  openConv: (id: string) => void;
  newChat: () => void;
  registry: ModelsRegistry | undefined;
  health: Health | undefined;
  userName: string;
}) {
  const initials =
    userName
      .split(/\s+/)
      .map((w) => w[0] ?? '')
      .join('')
      .slice(0, 2)
      .toUpperCase() || 'A';
  const rssGB = registry?.hardware.rssGB ?? 0;
  const ramGB = registry?.hardware.ramGB ?? 0;
  const residentTier = registry?.hardware.residentTier ?? null;
  const llamaReady = health?.llama.status === 'ready';

  return (
    <div
      className="flex flex-col h-full flex-shrink-0"
      style={{ width: 264, background: C.sidebar, borderRight: `1px solid ${C.borderSoft}` }}
    >
      <div className="px-4 pt-4 pb-3 flex items-center gap-2">
        <span style={{ fontFamily: serif, fontSize: 21, color: C.text, letterSpacing: '-0.01em' }}>
          Atlas
        </span>
        <Badge color={C.green} dim={C.greenDim} icon={Lock}>
          Local
        </Badge>
      </div>

      <div className="px-2.5">
        <button
          onClick={newChat}
          className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-colors"
          style={{ color: C.accent, fontFamily: sans }}
          onMouseEnter={(e) => (e.currentTarget.style.background = C.accentDim)}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <span
            className="flex items-center justify-center rounded-full"
            style={{ width: 22, height: 22, background: C.accent }}
          >
            <Plus size={13} color="#fff" strokeWidth={2.5} />
          </span>
          New chat
        </button>
      </div>

      <div className="px-2.5 mt-1 flex flex-col gap-0.5">
        <NavItem icon={MessageSquare} label="Chats" active={view === 'chat'} onClick={() => setView('chat')} />
        <NavItem icon={FolderKanban} label="Projects" active={view === 'projects'} onClick={() => setView('projects')} />
        <NavItem icon={Puzzle} label="Plugins" active={view === 'plugins'} onClick={() => setView('plugins')} badge="MCP" />
        <NavItem icon={Sparkles} label="Skills" active={view === 'skills'} onClick={() => setView('skills')} />
      </div>

      <div
        className="px-4 mt-5 mb-1.5 text-xs font-medium uppercase tracking-wider"
        style={{ color: C.mute, fontFamily: sans }}
      >
        Recents
      </div>
      <div className="px-2.5 flex-1 overflow-y-auto flex flex-col gap-0.5 pb-2">
        {convs.length === 0 && (
          <span className="px-2.5 py-2 text-xs" style={{ color: C.mute, fontFamily: sans }}>
            No conversations yet — start one with New chat.
          </span>
        )}
        {convs.map((c) => {
          const active = view === 'chat' && c.id === activeConv;
          return (
            <button
              key={c.id}
              onClick={() => openConv(c.id)}
              className="flex-shrink-0 text-left px-2.5 py-1.5 rounded-lg text-sm truncate transition-colors"
              style={{ color: active ? C.text : C.sub, background: active ? C.panel : 'transparent', fontFamily: sans }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = active ? C.panel : 'transparent')}
            >
              {c.title}
            </button>
          );
        })}
      </div>

      <div className="px-3 pb-3 pt-2" style={{ borderTop: `1px solid ${C.borderSoft}` }}>
        <div className="rounded-xl px-3 py-2.5" style={{ background: C.panel, border: `1px solid ${C.borderSoft}` }}>
          <div className="flex items-center gap-2 mb-2">
            <Cpu size={13} style={{ color: llamaReady ? C.green : C.amber }} />
            <span className="text-xs font-medium" style={{ color: C.text, fontFamily: sans }}>
              llama-server
            </span>
            <span className="text-xs ml-auto" style={{ color: C.mute, fontFamily: sans }}>
              {rssGB ? `${rssGB.toFixed(1)} / ${ramGB} GB` : `— / ${ramGB} GB`}
            </span>
          </div>
          {TIER_LABELS.map((tier) => {
            const model = registry?.models.find((m) => m.id === tier.id);
            const resident = llamaReady && residentTier === tier.id;
            const width = resident && ramGB > 0 ? `${Math.min(100, Math.round((rssGB / ramGB) * 100))}%` : '0%';
            const present = model?.present ?? false;
            return (
              <div key={tier.id} className="flex items-center gap-2 py-0.5">
                <span
                  className="text-xs w-20 truncate"
                  style={{ color: resident ? C.sub : C.mute, fontFamily: sans }}
                  title={present ? model?.file ?? '' : 'not in models folder'}
                >
                  {tier.label}
                </span>
                <div className="flex-1 rounded-full" style={{ height: 4, background: C.raised }}>
                  <div className="rounded-full" style={{ height: 4, width, background: resident ? C.green : C.border }} />
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-2 px-1.5 pt-2.5">
          <span
            className="flex items-center justify-center rounded-full text-xs font-semibold"
            style={{ width: 26, height: 26, background: C.raised, color: C.text, fontFamily: sans }}
          >
            {initials}
          </span>
          <span className="text-sm" style={{ color: C.text, fontFamily: sans }}>
            {userName}
          </span>
          <span className="text-xs" style={{ color: C.mute, fontFamily: sans }}>
            · Enterprise
          </span>
          <Settings2 size={15} className="ml-auto cursor-pointer" style={{ color: C.mute }} />
        </div>
      </div>
    </div>
  );
}
