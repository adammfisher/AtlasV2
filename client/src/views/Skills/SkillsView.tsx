import { useState } from 'react';
import { Check, Info, PenTool } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { C, SERIF, MONO, ICONS } from '../../theme/tokens';
import { api, type Skill } from '../../lib/api';
import { Toggle } from '../../components/Toggle';
import { Chip } from '../../components/Chip';

export function SkillsView({ skills }: { skills: Skill[] }) {
  const [open, setOpen] = useState<string | null>(null);
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
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-8">
        <h1 className="text-2xl" style={{ color: C.text, fontFamily: SERIF }}>
          Skills
        </h1>
        <p className="text-sm mt-1 leading-relaxed" style={{ color: C.dim }}>
          Playbooks that drive the on-device models through document creation. Metadata (~100
          tokens each) is always in context; the full playbook loads only when the router matches a
          task. The model emits structured JSON — deterministic helpers fill the templates.
        </p>

        <div className="mt-6 space-y-2">
          {skills.map((s) => {
            const Icon = ICONS[s.id] ?? PenTool;
            const expanded = open === s.id;
            return (
              <div
                key={s.id}
                className="rounded-xl transition-colors"
                style={{
                  background: expanded ? C.raise : C.bg,
                  border: `1px solid ${expanded ? C.border : C.borderSoft}`,
                  opacity: s.enabled ? 1 : 0.55,
                }}
              >
                <div
                  className="px-4 py-3.5 flex items-center gap-4 cursor-pointer"
                  onClick={() => setOpen(expanded ? null : s.id)}
                >
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: C.raise2 }}
                  >
                    <Icon size={16} style={{ color: C.dim }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium" style={{ color: C.text }}>
                        {s.name}
                      </span>
                      <span className="text-xs" style={{ color: C.faint, fontFamily: MONO }}>
                        {s.ext}
                      </span>
                    </div>
                    <div className="text-xs mt-0.5 truncate" style={{ color: C.faint }}>
                      {s.triggers}
                    </div>
                  </div>
                  <div className="hidden md:block text-right flex-shrink-0">
                    <div className="text-xs" style={{ color: C.dim, fontFamily: MONO }}>
                      {s.metaTokens} / {s.fullTokens} tok
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: C.faint, fontFamily: MONO }}>
                      {s.helper}
                    </div>
                  </div>
                  <span
                    className="text-xs px-2 py-1 rounded-md flex-shrink-0"
                    style={{ background: C.accentDim, color: C.accent, fontFamily: MONO }}
                  >
                    {s.tier}
                  </span>
                  <span onClick={(e) => e.stopPropagation()}>
                    <Toggle on={s.enabled} onClick={() => toggle(s)} />
                  </span>
                </div>
                {expanded && (
                  <div className="px-4 pb-4" style={{ borderTop: `1px solid ${C.borderSoft}` }}>
                    <div className="mt-3 text-xs font-medium" style={{ color: C.faint }}>
                      MODEL EMITS
                    </div>
                    <div
                      className="mt-1.5 rounded-lg px-3 py-2.5 text-xs break-all"
                      style={{
                        background: C.bg,
                        color: C.dim,
                        fontFamily: MONO,
                        border: `1px solid ${C.borderSoft}`,
                      }}
                    >
                      {s.schema}
                    </div>
                    <div className="mt-3 text-xs font-medium" style={{ color: C.faint }}>
                      VALIDATION CHAIN
                    </div>
                    <div className="flex flex-wrap mt-1.5">
                      {s.checks.map((c) => (
                        <Chip key={c} icon={Check} tone="green">
                          {c}
                        </Chip>
                      ))}
                    </div>
                    <div className="text-xs mt-1 leading-relaxed" style={{ color: C.faint }}>
                      Constrained decoding (json_schema → GBNF) guarantees syntax; the chain above
                      gates delivery. Failures trigger up to two repair retries, then tier
                      escalation.
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div
          className="mt-5 rounded-xl px-4 py-3.5 text-xs leading-relaxed flex gap-2.5"
          style={{ background: C.bg, border: `1px solid ${C.borderSoft}`, color: C.faint }}
        >
          <Info size={14} className="flex-shrink-0 mt-0.5" style={{ color: C.dim }} />
          <span>
            † Recalc and thumbnail checks run only when LibreOffice is present on this machine.
            When absent, validation degrades to OOXML schema, library round-trip, and placeholder
            checks — and the output is flagged accordingly.
          </span>
        </div>
      </div>
    </div>
  );
}
