import { useState } from 'react';
import { X, Eye, Download, History, FileText, Check, AlertTriangle, Lock } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { C, MONO, ICONS } from '../../theme/tokens';
import { api } from '../../lib/api';
import { Chip } from '../../components/Chip';

export function ArtifactDetail({ id, close }: { id: string; close: () => void }) {
  const { data: a } = useQuery({ queryKey: ['artifact', id], queryFn: () => api.artifact(id) });
  const [notice, setNotice] = useState<string | null>(null);

  if (!a) return null;
  const Icon = ICONS[a.kind] ?? FileText;

  const surface = (path: string, method = 'GET') => {
    setNotice(null);
    void fetch(`/api${path}`, { method }).then(async (res) => {
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setNotice(body.error ?? `${res.status} ${res.statusText}`);
      }
    });
  };

  const current = a.versions.find((v) => v.version === a.ver);
  const validation = current?.validation ?? [];

  return (
    <div
      className="w-96 flex-shrink-0 h-full overflow-y-auto px-5 py-5"
      style={{ background: C.side, borderLeft: `1px solid ${C.borderSoft}` }}
    >
      <div className="flex items-start gap-3">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center"
          style={{ background: C.accentDim }}
        >
          <Icon size={19} style={{ color: C.accent }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium break-all" style={{ color: C.text, fontFamily: MONO }}>
            {a.name}
          </div>
          <div className="text-xs mt-0.5" style={{ color: C.faint }}>
            {a.project} · {a.meta}
          </div>
        </div>
        <X size={16} className="cursor-pointer mt-1" style={{ color: C.faint }} onClick={close} />
      </div>

      <div className="mt-4 flex gap-2">
        <button
          onClick={() => surface(`/artifacts/${a.id}/versions/${a.ver}/download`)}
          className="flex-1 text-sm py-2 rounded-lg font-medium inline-flex items-center justify-center gap-1.5"
          style={{ background: C.accent, color: '#fff' }}
        >
          <Eye size={13} /> Open preview
        </button>
        <button
          onClick={() => surface(`/artifacts/${a.id}/versions/${a.ver}/download`)}
          className="flex-1 text-sm py-2 rounded-lg inline-flex items-center justify-center gap-1.5"
          style={{ border: `1px solid ${C.border}`, color: C.dim }}
        >
          <Download size={13} /> Download
        </button>
      </div>

      {notice && (
        <div
          className="mt-3 rounded-lg px-3 py-2.5 text-xs leading-relaxed"
          style={{ background: C.amberDim, color: C.amber, border: `1px solid ${C.amber}` }}
        >
          {notice}
        </div>
      )}

      <div className="mt-5 text-xs font-medium" style={{ color: C.faint }}>
        VALIDATION
      </div>
      <div className="flex flex-wrap mt-2">
        {validation.map(([label, ok]) => (
          <Chip key={label} icon={ok ? Check : AlertTriangle} tone={ok ? 'green' : 'amber'}>
            {label}
          </Chip>
        ))}
        <Chip icon={Lock} tone="dim">
          Rendered offline
        </Chip>
      </div>

      <div className="mt-5 text-xs font-medium" style={{ color: C.faint }}>
        VERSION HISTORY
      </div>
      <div className="mt-2 space-y-1">
        {a.versions.map((v) => (
          <div
            key={v.version}
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg"
            style={{ background: C.bg, border: `1px solid ${C.borderSoft}` }}
          >
            <History size={13} style={{ color: C.faint }} />
            <span className="text-sm" style={{ color: C.text }}>
              v{v.version}
            </span>
            <span className="text-xs" style={{ color: C.faint }}>
              {v.version === a.ver
                ? 'current'
                : v.version === 1
                  ? 'initial generation'
                  : 'targeted edit'}
            </span>
            <button
              onClick={() => surface(`/artifacts/${a.id}/restore`, 'POST')}
              className="ml-auto text-xs"
              style={{ color: C.dim }}
            >
              Restore
            </button>
          </div>
        ))}
      </div>
      <div className="text-xs mt-1.5" style={{ color: C.faint }}>
        Edits regenerate only the affected sections — earlier versions stay byte-exact for diffing.
      </div>
    </div>
  );
}
