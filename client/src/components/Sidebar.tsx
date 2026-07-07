import { useState } from 'react';
import { Plus, MessageSquare, FolderKanban, Puzzle, Sparkles, Cloud, Settings2, Trash2, Check } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { C, sans, serif } from '../theme/tokens';
import { Badge } from './Badge';
import { NavItem } from './NavItem';
import type { View } from '../lib/store';
import { api, type Conversation, type ModelsRegistry, type Health } from '../lib/api';

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
  openConv: (id: string | null) => void;
  newChat: () => void;
  registry: ModelsRegistry | undefined;
  health: Health | undefined;
  userName: string;
}) {
  const [manage, setManage] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();
  const initials =
    userName
      .split(/\s+/)
      .map((w) => w[0] ?? '')
      .join('')
      .slice(0, 2)
      .toUpperCase() || 'A';
  const bedrockConnected = registry?.bedrock.connected ?? false;
  const bedrockRegion = registry?.bedrock.region ?? 'us-east-1';

  return (
    <div
      className="flex flex-col h-full flex-shrink-0"
      style={{ width: 264, background: C.sidebar, borderRight: `1px solid ${C.borderSoft}` }}
    >
      <div className="px-4 pt-4 pb-3 flex items-center gap-2">
        <span style={{ fontFamily: serif, fontSize: 21, color: C.text, letterSpacing: '-0.01em' }}>
          Atlas
        </span>
        <Badge color={C.blue} dim={C.blueDim} icon={Cloud}>
          Bedrock
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
        className="px-4 mt-5 mb-1.5 flex items-center text-xs font-medium uppercase tracking-wider"
        style={{ color: C.mute, fontFamily: sans }}
      >
        Recents
        {convs.length > 0 && (
          <button
            onClick={() => {
              setManage(!manage);
              setSelected(new Set());
            }}
            className="ml-auto normal-case tracking-normal font-normal"
            style={{ color: manage ? C.accent : C.mute, fontFamily: sans }}
          >
            {manage ? 'Done' : 'Edit'}
          </button>
        )}
      </div>
      {manage && (
        <div className="px-4 pb-1.5 flex items-center gap-3 text-xs" style={{ fontFamily: sans }}>
          <button
            onClick={() =>
              setSelected(selected.size === convs.length ? new Set() : new Set(convs.map((c) => c.id)))
            }
            style={{ color: C.sub }}
          >
            {selected.size === convs.length ? 'Clear all' : 'Select all'}
          </button>
          <button
            disabled={selected.size === 0}
            onClick={() => {
              void api.deleteConversations([...selected]).then(() => {
                setSelected(new Set());
                setManage(false);
                void queryClient.invalidateQueries({ queryKey: ['conversations'] });
                if (activeConv && selected.has(activeConv)) openConv(null);
              });
            }}
            className="flex items-center gap-1"
            style={{ color: selected.size ? C.amber : C.mute }}
          >
            <Trash2 size={11} /> Delete{selected.size ? ` (${selected.size})` : ''}
          </button>
        </div>
      )}
      <div className="px-2.5 flex-1 overflow-y-auto flex flex-col gap-0.5 pb-2">
        {convs.length === 0 && (
          <span className="px-2.5 py-2 text-xs" style={{ color: C.mute, fontFamily: sans }}>
            No conversations yet — start one with New chat.
          </span>
        )}
        {convs.map((c) => {
          const active = view === 'chat' && c.id === activeConv;
          const checked = selected.has(c.id);
          return (
            <button
              key={c.id}
              onClick={() => {
                if (manage) {
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (next.has(c.id)) next.delete(c.id);
                    else next.add(c.id);
                    return next;
                  });
                } else {
                  openConv(c.id);
                }
              }}
              className="flex-shrink-0 flex items-center gap-2 text-left px-2.5 py-1.5 rounded-lg text-sm transition-colors"
              style={{ color: active ? C.text : C.sub, background: active ? C.panel : 'transparent', fontFamily: sans }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = active ? C.panel : 'transparent')}
            >
              {manage && (
                <span
                  className="flex items-center justify-center rounded flex-shrink-0"
                  style={{ width: 14, height: 14, border: `1.5px solid ${checked ? C.accent : C.border}`, background: checked ? C.accent : 'transparent' }}
                >
                  {checked && <Check size={10} color="#fff" strokeWidth={3} />}
                </span>
              )}
              <span className="truncate">{c.title}</span>
            </button>
          );
        })}
      </div>

      <div className="px-3 pb-3 pt-2" style={{ borderTop: `1px solid ${C.borderSoft}` }}>
        <div className="rounded-xl px-3 py-2.5" style={{ background: C.panel, border: `1px solid ${C.borderSoft}` }}>
          <div className="flex items-center gap-2 mb-2">
            <Cloud size={13} style={{ color: bedrockConnected ? C.green : C.amber }} />
            <span className="text-xs font-medium" style={{ color: C.text, fontFamily: sans }}>
              Amazon Bedrock
            </span>
            <span className="text-xs ml-auto" style={{ color: C.mute, fontFamily: sans }}>
              {bedrockConnected ? bedrockRegion : 'not connected'}
            </span>
          </div>
          {(registry?.bedrockModels ?? []).map((m) => {
            const active = bedrockConnected && registry?.selected === m.id;
            return (
              <div key={m.id} className="flex items-center gap-2 py-0.5">
                <span
                  className="text-xs flex-1 truncate"
                  style={{ color: active ? C.sub : C.mute, fontFamily: sans }}
                  title={m.sub}
                >
                  {m.name}
                </span>
                {active && <Check size={12} style={{ color: C.green }} />}
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
