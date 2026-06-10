import { FileText } from 'lucide-react';
import { C, SERIF, MONO, ICONS } from '../../theme/tokens';
import type { ArtifactSummary } from '../../lib/api';
import { ArtifactDetail } from './ArtifactDetail';

export function ArtifactsView({
  artifacts,
  selected,
  setSelected,
}: {
  artifacts: ArtifactSummary[];
  selected: string | null;
  setSelected: (id: string | null) => void;
}) {
  return (
    <div className="flex h-full min-w-0">
      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-8">
          <h1 className="text-2xl" style={{ color: C.text, fontFamily: SERIF }}>
            Artifacts
          </h1>
          <p className="text-sm mt-1" style={{ color: C.dim }}>
            Everything Atlas has produced, versioned per project. Rendering is fully offline — no
            CDN, ever.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-6">
            {artifacts.map((a) => {
              const Icon = ICONS[a.kind] ?? FileText;
              const active = selected === a.id;
              return (
                <div
                  key={a.id}
                  onClick={() => setSelected(active ? null : a.id)}
                  role="button"
                  className="rounded-xl p-4 cursor-pointer transition-colors"
                  style={{
                    background: active ? C.raise : C.bg,
                    border: `1px solid ${active ? C.border : C.borderSoft}`,
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center"
                      style={{ background: C.accentDim }}
                    >
                      <Icon size={16} style={{ color: C.accent }} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm truncate" style={{ color: C.text, fontFamily: MONO }}>
                        {a.name}
                      </div>
                      <div className="text-xs" style={{ color: C.faint }}>
                        {a.project}
                      </div>
                    </div>
                    <span
                      className="text-xs px-1.5 py-0.5 rounded"
                      style={{ background: C.raise, color: C.dim }}
                    >
                      v{a.ver}
                    </span>
                  </div>
                  <div className="text-xs mt-3" style={{ color: C.faint }}>
                    {a.meta}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {selected && <ArtifactDetail id={selected} close={() => setSelected(null)} />}
    </div>
  );
}
