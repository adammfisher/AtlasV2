import { useState } from 'react';
import { ChevronDown, CheckCircle2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { C, sans, serif, mono, namedIcon, tokenColor } from '../../theme/tokens';
import { api, type Skill } from '../../lib/api';
import { Badge } from '../../components/Badge';

export function SkillsView({ skills }: { skills: Skill[] }) {
  const [openId, setOpenId] = useState<string | null>('pptx');
  const queryClient = useQueryClient();

  const toggle = (s: Skill) => {
    queryClient.setQueryData<Skill[]>(['skills'], (old) =>
      old?.map((entry) => (entry.id === s.id ? { ...entry, enabled: !s.enabled } : entry)),
    );
    void api
      .toggleSkill(s.id, !s.enabled)
      .finally(() => void queryClient.invalidateQueries({ queryKey: ['skills'] }));
  };

  return (
    <div className="flex-1 flex flex-col h-full min-w-0">
      <div className="px-7 pt-6 pb-4">
        <h1 style={{ fontFamily: serif, fontSize: 26, color: C.text }}>Skills</h1>
        <p className="text-sm mt-1 max-w-2xl" style={{ color: C.sub, fontFamily: sans }}>
          Playbooks the model loads on demand. Metadata stays in context (~100 tokens each); full
          instructions load only when the router matches a task. The model emits structured JSON —
          deterministic helpers do the rest.
        </p>
      </div>
      <div className="px-7 pb-8 overflow-y-auto flex flex-col gap-2">
        {skills.map((s) => {
          const Icon = namedIcon(s.icon);
          const { color, dim } = tokenColor(s.colorToken);
          const open = openId === s.id;
          return (
            <div
              key={s.id}
              className="rounded-xl transition-colors"
              style={{
                background: C.panel,
                border: `1px solid ${open ? C.border : C.borderSoft}`,
                opacity: s.enabled ? 1 : 0.55,
              }}
            >
              <button
                onClick={() => setOpenId(open ? null : s.id)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left"
              >
                <span
                  className="flex items-center justify-center rounded-lg flex-shrink-0"
                  style={{ width: 34, height: 34, background: dim }}
                >
                  <Icon size={17} style={{ color }} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-medium" style={{ color: C.text, fontFamily: sans }}>
                      {s.name}
                    </span>
                    <span className="text-xs" style={{ color: C.mute, fontFamily: mono }}>
                      {s.ext}
                    </span>
                  </span>
                  <span className="block text-xs truncate" style={{ color: C.mute, fontFamily: sans }}>
                    Triggers: {s.triggers}
                  </span>
                </span>
                <span className="text-xs hidden md:block" style={{ color: C.mute, fontFamily: sans }}>
                  {s.metaTokens} / {s.fullTokens.toLocaleString()} tokens
                </span>
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(s);
                  }}
                  title={s.enabled ? 'Click to disable' : 'Click to enable'}
                  className="cursor-pointer"
                >
                  <Badge
                    color={s.enabled ? C.green : C.mute}
                    dim={s.enabled ? C.greenDim : 'rgba(133,130,122,0.13)'}
                  >
                    {s.enabled ? 'Enabled' : 'Disabled'}
                  </Badge>
                </span>
                <ChevronDown
                  size={15}
                  style={{ color: C.mute, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}
                />
              </button>
              {open ? (
                <div
                  className="px-4 pb-4 grid grid-cols-1 md:grid-cols-3 gap-4"
                  style={{ borderTop: `1px solid ${C.borderSoft}`, paddingTop: 14 }}
                >
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wider mb-1.5" style={{ color: C.mute, fontFamily: sans }}>
                      Pattern
                    </div>
                    <p className="text-xs leading-relaxed" style={{ color: C.sub, fontFamily: sans }}>
                      {s.note}
                    </p>
                  </div>
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wider mb-1.5" style={{ color: C.mute, fontFamily: sans }}>
                      Helper
                    </div>
                    <code
                      className="block px-2.5 py-1.5 rounded-md text-xs mb-2"
                      style={{ background: C.bg, color: C.green, border: `1px solid ${C.borderSoft}`, fontFamily: mono }}
                    >
                      {s.helper}
                    </code>
                    <div className="text-xs" style={{ color: C.mute, fontFamily: sans }}>
                      Tier: <span style={{ color: C.sub }}>{s.tier}</span>
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wider mb-1.5" style={{ color: C.mute, fontFamily: sans }}>
                      Validation gates
                    </div>
                    {s.validators.map((v) => (
                      <div key={v} className="flex items-center gap-1.5 py-0.5">
                        <CheckCircle2 size={12} style={{ color: C.green }} />
                        <span className="text-xs" style={{ color: C.sub, fontFamily: sans }}>
                          {v}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
