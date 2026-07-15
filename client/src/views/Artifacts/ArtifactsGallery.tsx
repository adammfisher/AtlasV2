/** X7 cross-chat artifacts gallery (claude.ai parity): every artifact across
 * every project, filterable by kind and project, with per-row download. */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Presentation, FileText, FileSpreadsheet, BookOpen, GitBranch, Layers, Box, Braces, FileCode } from 'lucide-react';
import { C, sans, serif, mono } from '../../theme/tokens';

interface Row {
  id: string;
  projectId: string;
  name: string;
  kind: string;
  ver: number;
  meta: string;
  created_at: number;
}

const KIND_ICON: Record<string, typeof FileText> = {
  pptx: Presentation,
  docx: FileText,
  xlsx: FileSpreadsheet,
  pdf: BookOpen,
  mermaid: GitBranch,
  svg: Layers,
  product: Box,
  react: Braces,
  site: Braces,
  md: FileCode,
};

export function ArtifactsGallery({ projects }: { projects: Array<{ id: string; name: string }> }) {
  const [kind, setKind] = useState<string>('All');
  const [project, setProject] = useState<string>('All');
  const { data } = useQuery({
    queryKey: ['artifacts-gallery'],
    queryFn: async () => (await fetch('/api/artifacts')).json() as Promise<Row[]>,
  });
  const rows = useMemo(() => {
    let out = data ?? [];
    if (kind !== 'All') out = out.filter((r) => r.kind === kind);
    if (project !== 'All') out = out.filter((r) => r.projectId === project);
    return out;
  }, [data, kind, project]);
  const kinds = useMemo(() => ['All', ...new Set((data ?? []).map((r) => r.kind))], [data]);

  return (
    <div className="flex-1 flex flex-col h-full min-w-0">
      <div className="px-7 pt-6 pb-4">
        <h1 style={{ fontFamily: serif, fontSize: 26, color: C.text }}>Artifacts</h1>
        <p className="text-sm mt-1" style={{ color: C.sub, fontFamily: sans }}>
          Everything generated across every chat and project.
        </p>
        <div className="flex gap-2 mt-3 flex-wrap">
          {kinds.map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className="px-2.5 py-1 rounded-lg text-xs"
              style={{
                background: kind === k ? C.raised : 'transparent',
                color: kind === k ? C.text : C.mute,
                border: `1px solid ${kind === k ? C.border : 'transparent'}`,
                fontFamily: sans,
              }}
            >
              {k}
            </button>
          ))}
          <select
            value={project}
            onChange={(e) => setProject(e.target.value)}
            className="ml-auto text-xs rounded-lg px-2 py-1"
            style={{ background: C.panel, color: C.sub, border: `1px solid ${C.borderSoft}`, fontFamily: sans }}
          >
            <option value="All">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="px-7 pb-8 overflow-y-auto flex flex-col gap-1.5">
        {rows.map((r) => {
          const Icon = KIND_ICON[r.kind] ?? FileText;
          return (
            <div
              key={r.id}
              className="flex items-center gap-3 rounded-xl px-4 py-2.5"
              style={{ background: C.panel, border: `1px solid ${C.borderSoft}` }}
            >
              <Icon size={16} style={{ color: C.accent, flexShrink: 0 }} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm truncate" style={{ color: C.text, fontFamily: sans }}>
                  {r.name}
                </span>
                <span className="block text-xs truncate" style={{ color: C.mute, fontFamily: sans }}>
                  {r.meta || r.kind} · v{r.ver} · {new Date(r.created_at).toLocaleDateString()}
                </span>
              </span>
              <span className="text-xs" style={{ color: C.mute, fontFamily: mono }}>
                {r.kind}
              </span>
              <a
                href={`/api/artifacts/${r.id}/versions/${r.ver}/download`}
                title={`Download ${r.name}`}
                className="p-1.5 rounded-lg"
                style={{ color: C.mute }}
              >
                <Download size={14} />
              </a>
            </div>
          );
        })}
        {rows.length === 0 ? (
          <p className="text-sm" style={{ color: C.mute, fontFamily: sans }}>
            No artifacts match this filter.
          </p>
        ) : null}
      </div>
    </div>
  );
}
