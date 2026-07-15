import { useState } from 'react';
import { Plus, MessageSquare, FolderKanban, Puzzle, Sparkles, Settings2, Trash2, Check, Search, Pencil, X, Sun, Moon, Box, Ghost, LogOut } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { C, sans } from '../theme/tokens';
import { NavItem } from './NavItem';
import { AtlasLogo } from './AtlasLogo';
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
  theme,
  onToggleTheme,
}: {
  view: View;
  setView: (v: View) => void;
  convs: Conversation[];
  activeConv: string | null;
  openConv: (id: string | null) => void;
  newChat: (projectId?: string, message?: string, attachments?: undefined, incognito?: boolean) => void;
  registry: ModelsRegistry | undefined;
  health: Health | undefined;
  userName: string;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
}) {
  const [manage, setManage] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const queryClient = useQueryClient();
  // search: instant title filter, plus server-side content search for 2+ chars
  const { data: searchHits } = useQuery({
    queryKey: ['conv-search', query],
    queryFn: () => api.searchConversations(query),
    enabled: query.trim().length >= 2,
  });
  const shown = query.trim()
    ? (() => {
        const t = query.toLowerCase();
        const local = convs.filter((c) => c.title.toLowerCase().includes(t));
        const ids = new Set(local.map((c) => c.id));
        return [...local, ...(searchHits ?? []).filter((c) => !ids.has(c.id))];
      })()
    : convs;
  // the signed-in ACCOUNT (not the display-name setting) — drives the footer
  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.me(),
    staleTime: 60_000,
  });
  const accountName = me?.username ?? userName;
  const initials = accountName.slice(0, 2).toUpperCase() || 'A';

  return (
    <div
      className="flex flex-col h-full flex-shrink-0"
      style={{ width: 264, background: C.sidebar, borderRight: `1px solid ${C.borderSoft}` }}
    >
      <div className="px-4 pt-4 pb-3 flex items-center justify-center">
        <AtlasLogo />
      </div>

      <div className="px-2.5">
        <button
          onClick={() => newChat()}
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
          <span
            role="button"
            title="Incognito chat — not saved, not remembered"
            className="ml-auto p-1 rounded-md opacity-50 hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              newChat(undefined, undefined, undefined, true);
            }}
          >
            <Ghost size={14} />
          </span>
        </button>
      </div>

      <div className="px-2.5 mt-1 flex flex-col gap-0.5">
        <NavItem icon={MessageSquare} label="Chats" active={view === 'chat'} onClick={() => setView('chat')} />
        <NavItem icon={FolderKanban} label="Projects" active={view === 'projects'} onClick={() => setView('projects')} />
        <NavItem icon={Puzzle} label="Plugins" active={view === 'plugins'} onClick={() => setView('plugins')} badge="MCP" />
        <NavItem icon={Sparkles} label="Skills" active={view === 'skills'} onClick={() => setView('skills')} />
        <NavItem icon={Box} label="Artifacts" active={view === 'artifacts'} onClick={() => setView('artifacts')} />
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
          <a href="/api/conversations/export.zip" download title="Export all conversations (markdown + manifest)" style={{ color: C.sub }}>
            Export all
          </a>
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
      <div className="px-2.5 pb-1.5">
        <div className="flex items-center gap-1.5 rounded-lg px-2 py-1" style={{ background: C.panel, border: `1px solid ${C.borderSoft}` }}>
          <Search size={12} style={{ color: C.mute }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats…"
            className="w-full bg-transparent text-xs outline-none"
            style={{ color: C.text, fontFamily: sans }}
          />
          {query && (
            <button onClick={() => setQuery('')} style={{ color: C.mute }}>
              <X size={11} />
            </button>
          )}
        </div>
      </div>
      <div className="px-2.5 flex-1 overflow-y-auto flex flex-col gap-0.5 pb-2">
        {shown.length === 0 && (
          <span className="px-2.5 py-2 text-xs" style={{ color: C.mute, fontFamily: sans }}>
            {query ? 'No matches.' : 'No conversations yet — start one with New chat.'}
          </span>
        )}
        {shown.map((c) => {
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
              className="group/conv flex-shrink-0 flex items-center gap-2 text-left px-2.5 py-1.5 rounded-lg text-sm transition-colors"
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
              <span className="truncate flex-1">{c.title}</span>
              {!manage && (
                <span
                  role="button"
                  title="Rename chat"
                  className="opacity-0 group-hover/conv:opacity-60 hover:!opacity-100 flex-shrink-0"
                  style={{ color: C.mute }}
                  onClick={(e) => {
                    e.stopPropagation();
                    const title = window.prompt('Rename chat', c.title);
                    if (title?.trim()) {
                      void api.renameConversation(c.id, title.trim()).then(() =>
                        queryClient.invalidateQueries({ queryKey: ['conversations'] }),
                      );
                    }
                  }}
                >
                  <Pencil size={11} />
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="px-3 pb-3 pt-2" style={{ borderTop: `1px solid ${C.borderSoft}` }}>
        <div className="flex items-center gap-2 px-1.5 pt-1">
          <span
            className="flex items-center justify-center rounded-full text-xs font-semibold"
            style={{ width: 26, height: 26, background: C.raised, color: C.text, fontFamily: sans }}
          >
            {initials}
          </span>
          <span className="text-sm" style={{ color: C.text, fontFamily: sans }}>
            {accountName}
          </span>
          <button
            onClick={onToggleTheme}
            className="ml-auto p-1 rounded"
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            style={{ color: C.mute }}
          >
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <button
            onClick={() => {
              void fetch('/api/auth/logout', { method: 'POST' }).finally(() => {
                localStorage.removeItem('atlas_token');
                window.location.reload();
              });
            }}
            className="p-1 rounded"
            title="Sign out"
            style={{ color: C.mute }}
          >
            <LogOut size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
