import { useState } from 'react';
import { X, Brain, Trash2, Plus, KeyRound, StickyNote, Share2 } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { C, sans, mono } from '../theme/tokens';
import { api } from '../lib/api';

/** Memory browser: everything Atlas remembers — viewable, editable, deletable.
 * Two scopes: this project (hard-isolated) and the user (spans all projects). */
export function MemoryModal({
  projectId,
  projectName,
  onClose,
}: {
  projectId: string;
  projectName: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<'project' | 'user'>('project');
  const scopeId = scope === 'user' ? 'user' : projectId;
  const { data } = useQuery({
    queryKey: ['memory', scopeId],
    queryFn: () => api.projectMemory(scopeId),
  });
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  const refresh = (): void => void queryClient.invalidateQueries({ queryKey: ['memory', scopeId] });

  const remove = (kind: 'kv' | 'note' | 'fact', ref: Record<string, string>): void => {
    void api.deleteProjectMemory(scopeId, kind, ref).then(refresh);
  };

  const section = (icon: JSX.Element, label: string, count: number): JSX.Element => (
    <div className="flex items-center gap-2 mt-4 mb-1.5">
      {icon}
      <span className="text-xs font-medium uppercase tracking-wider" style={{ color: C.mute, fontFamily: sans }}>
        {label} · {count}
      </span>
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-6"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={onClose}
    >
      <div
        className="rounded-2xl w-full flex flex-col"
        style={{ maxWidth: 640, maxHeight: '85%', background: C.bg, border: `1px solid ${C.border}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 px-5 py-4" style={{ borderBottom: `1px solid ${C.borderSoft}` }}>
          <Brain size={17} style={{ color: C.accent }} />
          <span className="text-base font-medium" style={{ color: C.text, fontFamily: sans }}>
            Memory — {scope === 'user' ? 'About you' : projectName}
          </span>
          <div className="ml-3 flex rounded-lg overflow-hidden" style={{ border: `1px solid ${C.border}` }}>
            {(['project', 'user'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setScope(s)}
                className="px-2.5 py-1 text-xs font-medium"
                style={{
                  background: scope === s ? C.raised : 'transparent',
                  color: scope === s ? C.text : C.mute,
                  fontFamily: sans,
                }}
              >
                {s === 'project' ? 'This project' : 'You'}
              </button>
            ))}
          </div>
          <button onClick={onClose} className="ml-auto p-1.5 rounded-lg" style={{ color: C.mute }}>
            <X size={16} />
          </button>
        </div>

        <div className="px-5 pb-4 overflow-y-auto flex-1">
          <p className="text-xs mt-3" style={{ color: C.mute, fontFamily: sans }}>
            {scope === 'user'
              ? 'Facts about you that persist across every project — preferences, role, working style. Recalled in all chats.'
              : 'Captured automatically when conversations go idle, plus anything you ask Atlas to remember. Facts are recalled in every chat in this project — and only this project.'}
          </p>

          {data?.profile ? (
            <div
              className="rounded-lg px-3 py-2.5 mt-3"
              style={{ background: C.accentDim ?? C.panel, border: `1px solid ${C.border}` }}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-xs font-medium uppercase tracking-wider" style={{ color: C.accent, fontFamily: sans }}>
                  {scope === 'user' ? 'What Atlas knows about you' : 'Project summary'}
                </span>
                <button
                  onClick={() => void api.consolidateMemory(scopeId).then(refresh)}
                  className="ml-auto text-xs"
                  style={{ color: C.mute, fontFamily: sans }}
                  title="Re-synthesize from current facts"
                >
                  Refresh
                </button>
              </div>
              <p className="text-sm" style={{ color: C.sub, fontFamily: sans }}>
                {data.profile.text}
              </p>
            </div>
          ) : (
            <button
              onClick={() => void api.consolidateMemory(scopeId).then(refresh)}
              className="mt-3 text-xs underline"
              style={{ color: C.mute, fontFamily: sans }}
            >
              Generate a summary of everything remembered
            </button>
          )}

          {section(<KeyRound size={13} style={{ color: C.accent }} />, 'Facts', data?.kv.length ?? 0)}
          {(data?.kv ?? []).map((row) => (
            <div
              key={row.key}
              className="flex items-start gap-2 rounded-lg px-3 py-2 mb-1"
              style={{ background: C.panel, border: `1px solid ${C.borderSoft}` }}
            >
              <span className="text-xs flex-shrink-0 mt-0.5" style={{ color: C.accent, fontFamily: mono }}>
                {row.key}
              </span>
              <span className="text-sm flex-1" style={{ color: C.sub, fontFamily: sans }}>
                {row.value}
              </span>
              <button onClick={() => remove('kv', { key: row.key })} style={{ color: C.mute }} title="Forget">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          <div className="flex items-center gap-1.5 mt-1.5">
            <input
              placeholder="key (e.g. user_preferences.tone)"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              className="rounded-lg px-2.5 py-1.5 text-xs outline-none w-56"
              style={{ background: C.panel, border: `1px solid ${C.border}`, color: C.text, fontFamily: mono }}
            />
            <input
              placeholder="value"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              className="rounded-lg px-2.5 py-1.5 text-xs outline-none flex-1"
              style={{ background: C.panel, border: `1px solid ${C.border}`, color: C.text, fontFamily: sans }}
            />
            <button
              disabled={!newKey || !newValue}
              onClick={() =>
                void api.upsertProjectMemory(scopeId, newKey, newValue).then(() => {
                  setNewKey('');
                  setNewValue('');
                  refresh();
                })
              }
              className="p-1.5 rounded-lg"
              style={{ background: C.raised, color: newKey && newValue ? C.text : C.mute, border: `1px solid ${C.border}` }}
            >
              <Plus size={13} />
            </button>
          </div>

          {section(<StickyNote size={13} style={{ color: C.purple }} />, 'Notes', data?.notes.length ?? 0)}
          {(data?.notes ?? []).map((n) => (
            <div
              key={n.id}
              className="flex items-start gap-2 rounded-lg px-3 py-2 mb-1"
              style={{ background: C.panel, border: `1px solid ${C.borderSoft}` }}
            >
              <span className="text-sm flex-1" style={{ color: C.sub, fontFamily: sans }}>
                {n.content}
              </span>
              <button onClick={() => remove('note', { id: n.id })} style={{ color: C.mute }} title="Forget">
                <Trash2 size={13} />
              </button>
            </div>
          ))}

          {section(<Share2 size={13} style={{ color: C.green }} />, 'Graph facts', data?.facts.length ?? 0)}
          {(data?.facts ?? []).map((f, i) => (
            <div
              key={`${f.src}-${f.rel}-${f.dst}-${i}`}
              className="flex items-center gap-2 rounded-lg px-3 py-2 mb-1"
              style={{ background: C.panel, border: `1px solid ${C.borderSoft}` }}
            >
              <span className="text-sm flex-1" style={{ color: C.sub, fontFamily: sans }}>
                {f.src} <span style={{ color: C.mute }}>—{f.rel}→</span> {f.dst}
              </span>
              <button onClick={() => remove('fact', f as unknown as Record<string, string>)} style={{ color: C.mute }} title="Forget">
                <Trash2 size={13} />
              </button>
            </div>
          ))}

          {data && data.kv.length === 0 && data.notes.length === 0 && data.facts.length === 0 ? (
            <p className="text-sm py-6 text-center" style={{ color: C.mute, fontFamily: sans }}>
              Nothing remembered yet — memories appear here as you chat in this project.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
