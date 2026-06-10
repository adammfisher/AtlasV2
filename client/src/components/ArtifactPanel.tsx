import { useState } from 'react';
import { X, Download, Copy, Presentation } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { C, sans } from '../theme/tokens';
import { api } from '../lib/api';
import { StepRow } from './StepRow';
import { MiniSlide, SLIDES } from './MiniSlide';

export function ArtifactPanel({ artifactId, onClose }: { artifactId: string; onClose: () => void }) {
  const { data: a } = useQuery({
    queryKey: ['artifact', artifactId],
    queryFn: () => api.artifact(artifactId),
  });
  const [ver, setVer] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!a) return null;
  const activeVer = ver ?? a.ver;
  const version = a.versions.find((v) => v.version === activeVer);

  const download = () => {
    setNotice(null);
    void fetch(`/api/artifacts/${a.id}/versions/${activeVer}/download`).then(async (res) => {
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setNotice(body.error ?? `${res.status} ${res.statusText}`);
      }
    });
  };

  return (
    <div
      className="flex flex-col h-full flex-shrink-0"
      style={{ width: 380, background: '#21201e', borderLeft: `1px solid ${C.borderSoft}` }}
    >
      <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: `1px solid ${C.borderSoft}` }}>
        <Presentation size={15} style={{ color: C.accent }} />
        <span className="text-sm font-medium truncate" style={{ color: C.text, fontFamily: sans }}>
          {a.name}
        </span>
        <span className="ml-auto flex items-center gap-1">
          {a.versions
            .slice()
            .sort((x, y) => x.version - y.version)
            .map((v) => (
              <button
                key={v.version}
                onClick={() => setVer(v.version)}
                className="px-2 py-0.5 rounded-md text-xs font-medium"
                style={{
                  color: activeVer === v.version ? C.text : C.mute,
                  background: activeVer === v.version ? C.raised : 'transparent',
                  fontFamily: sans,
                }}
              >
                v{v.version}
              </button>
            ))}
        </span>
        <button onClick={onClose} className="p-1 rounded-md" style={{ color: C.mute }}>
          <X size={15} />
        </button>
      </div>
      <div className="px-4 py-3 grid grid-cols-2 gap-2.5 overflow-y-auto">
        {SLIDES.map((s, i) => (
          <MiniSlide key={i} s={s} active={activeVer === 2 && i === 4} />
        ))}
      </div>
      <div className="px-4 py-3 mt-auto" style={{ borderTop: `1px solid ${C.borderSoft}` }}>
        <div className="text-xs font-medium uppercase tracking-wider mb-1.5" style={{ color: C.mute, fontFamily: sans }}>
          Validation
        </div>
        {(version?.validation ?? []).map((v) => (
          <StepRow key={v.label} state={v.state} label={v.label} detail={v.detail} />
        ))}
        {notice && (
          <div
            className="mt-2 rounded-lg px-3 py-2 text-xs leading-relaxed"
            style={{ background: C.amberDim, color: C.amber, border: `1px solid ${C.amber}` }}
          >
            {notice}
          </div>
        )}
        <div className="flex gap-2 mt-3">
          <button
            onClick={download}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium"
            style={{ background: C.accent, color: '#fff', fontFamily: sans }}
          >
            <Download size={14} /> Download
          </button>
          <button
            onClick={() => setNotice('Copy ships with real artifact files in Stage 3.')}
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm"
            style={{ background: C.raised, color: C.sub, fontFamily: sans, border: `1px solid ${C.border}` }}
          >
            <Copy size={14} /> Copy
          </button>
        </div>
      </div>
    </div>
  );
}
