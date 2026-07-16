/** X7 cross-chat artifacts gallery (claude.ai parity): every artifact across
 * every project, filterable by kind and project, with per-row download. */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Trash2, Check, Presentation, FileText, FileSpreadsheet, BookOpen, GitBranch, Layers, Box, Braces, FileCode } from 'lucide-react';
import { C, sans, serif, mono } from '../../theme/tokens';
import { api } from '../../lib/api';

interface Row {
  id: string;
  projectId: string;
  convId: string | null;
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

export function ArtifactsGallery({
  projects,
  onOpen,
}: {
  projects: Array<{ id: string; name: string }>;
  onOpen: (convId: string | null, artifactId: string) => void;
}) {
  const [kind, setKind] = useState<string>('All');
  const [project, setProject] = useState<string>('All');
  const [busy, setBusy] = useState<string | null>(null); // artifact id being opened/deleted
  const [manage, setManage] = useState(false); // Edit mode: row click selects instead of opening
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ['artifacts-gallery'],
    queryFn: async () => (await fetch('/api/artifacts')).json() as Promise<Row[]>,
  });

  // click-through: new artifacts carry convId; older ones resolve on demand
  const open = async (r: Row): Promise<void> => {
    if (r.convId) {
      onOpen(r.convId, r.id);
      return;
    }
    setBusy(r.id);
    try {
      const { convId } = await api.artifactConversation(r.id);
      onOpen(convId, r.id);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (r: Row): Promise<void> => {
    if (!window.confirm(`Delete "${r.name}"? This can't be undone.`)) return;
    setBusy(r.id);
    try {
      await api.deleteArtifact(r.id);
      await queryClient.invalidateQueries({ queryKey: ['artifacts-gallery'] });
    } finally {
      setBusy(null);
    }
  };
  const rows = useMemo(() => {
    let out = data ?? [];
    if (kind !== 'All') out = out.filter((r) => r.kind === kind);
    if (project !== 'All') out = out.filter((r) => r.projectId === project);
    return out;
  }, [data, kind, project]);
  const kinds = useMemo(() => ['All', ...new Set((data ?? []).map((r) => r.kind))], [data]);
  // select-all spans the filtered view, not the whole gallery — you select what you can see
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  const removeSelected = async (): Promise<void> => {
    const ids = rows.filter((r) => selected.has(r.id)).map((r) => r.id);
    if (ids.length === 0) return;
    const label = `${ids.length} artifact${ids.length === 1 ? '' : 's'}`;
    if (!window.confirm(`Delete ${label}, every version and file? This can't be undone.`)) return;
    setBulkBusy(true);
    try {
      await api.deleteArtifacts(ids);
      setSelected(new Set());
      setManage(false);
    } catch {
      // request() already raised a toast; the refetch below shows what survived
    } finally {
      setBulkBusy(false);
      await queryClient.invalidateQueries({ queryKey: ['artifacts-gallery'] });
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full min-w-0">
      <div className="px-7 pt-6 pb-4">
        <div className="flex items-baseline">
          <h1 style={{ fontFamily: serif, fontSize: 26, color: C.text }}>Artifacts</h1>
          {(data ?? []).length > 0 && (
            <button
              onClick={() => {
                setManage(!manage);
                setSelected(new Set());
              }}
              className="ml-auto text-xs"
              style={{ color: manage ? C.accent : C.mute, fontFamily: sans }}
            >
              {manage ? 'Done' : 'Edit'}
            </button>
          )}
        </div>
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
        {manage && (
          <div className="flex items-center gap-3 text-xs mt-3" style={{ fontFamily: sans }}>
            <button
              onClick={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
              style={{ color: C.sub }}
            >
              {allSelected ? 'Clear all' : 'Select all'}
            </button>
            <button
              disabled={selected.size === 0 || bulkBusy}
              onClick={() => void removeSelected()}
              className="flex items-center gap-1"
              style={{ color: selected.size && !bulkBusy ? C.amber : C.mute }}
            >
              <Trash2 size={11} /> Delete{selected.size ? ` (${selected.size})` : ''}
            </button>
          </div>
        )}
      </div>
      <div className="px-7 pb-8 overflow-y-auto flex flex-col gap-1.5">
        {rows.map((r) => {
          const Icon = KIND_ICON[r.kind] ?? FileText;
          const checked = selected.has(r.id);
          return (
            <div
              key={r.id}
              role="button"
              onClick={() => {
                if (!manage) {
                  void open(r);
                  return;
                }
                setSelected((prev) => {
                  const next = new Set(prev);
                  if (next.has(r.id)) next.delete(r.id);
                  else next.add(r.id);
                  return next;
                });
              }}
              className="group flex items-center gap-3 rounded-xl px-4 py-2.5 cursor-pointer transition-colors"
              style={{
                background: C.panel,
                border: `1px solid ${C.borderSoft}`,
                opacity: busy === r.id || (bulkBusy && checked) ? 0.5 : 1,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = C.border)}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = C.borderSoft)}
              title={manage ? `Select ${r.name}` : `Open ${r.name}`}
            >
              {manage && (
                <span
                  className="flex items-center justify-center rounded flex-shrink-0"
                  style={{
                    width: 14,
                    height: 14,
                    border: `1.5px solid ${checked ? C.accent : C.border}`,
                    background: checked ? C.accent : 'transparent',
                  }}
                >
                  {checked && <Check size={10} style={{ color: C.accentContrast }} strokeWidth={3} />}
                </span>
              )}
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
              {!manage && (
                <>
                  <a
                    href={`/api/artifacts/${r.id}/versions/${r.ver}/download`}
                    title={`Download ${r.name}`}
                    onClick={(e) => e.stopPropagation()}
                    className="p-1.5 rounded-lg"
                    style={{ color: C.mute }}
                  >
                    <Download size={14} />
                  </a>
                  <button
                    title={`Delete ${r.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void remove(r);
                    }}
                    className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ color: C.mute }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = C.amber)}
                    onMouseLeave={(e) => (e.currentTarget.style.color = C.mute)}
                  >
                    <Trash2 size={14} />
                  </button>
                </>
              )}
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
