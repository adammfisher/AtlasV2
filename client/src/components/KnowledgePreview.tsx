import { useQuery } from '@tanstack/react-query';
import { C, sans, mono } from '../theme/tokens';
import { StructuredOffice, type OfficePreview } from './ArtifactPreview';

const OFFICE_KINDS = ['pptx', 'docx', 'xlsx', 'pdf'];

function kindFromName(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

/** Project-knowledge equivalent of ArtifactPreview's office branch: real
 * document view (pdf native, pptx/docx/xlsx soffice-rendered) with a
 * markitdown structured-text fallback. Knowledge files are always source
 * documents, never sandboxed artifact kinds (react/site/mermaid), so this
 * only needs that one rendering path. */
export function KnowledgePreview({
  projectId,
  fileId,
  name,
  height = 420,
}: {
  projectId: string;
  fileId: string;
  name: string;
  height?: number | string;
}) {
  const kind = kindFromName(name);
  const base = `/api/projects/${projectId}/knowledge/${fileId}`;
  const office = OFFICE_KINDS.includes(kind);

  const { data: renderable } = useQuery({
    queryKey: ['knowledge-render', fileId],
    queryFn: async () => (await fetch(`${base}/render.pdf`, { method: 'HEAD' })).ok,
    enabled: office,
    staleTime: 60_000,
    retry: false,
  });
  const { data: textPreview, error: textError } = useQuery({
    queryKey: ['knowledge-preview', fileId],
    queryFn: async (): Promise<OfficePreview> => {
      const res = await fetch(`${base}/preview`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'preview unavailable');
      }
      return res.json() as Promise<OfficePreview>;
    },
    enabled: !office || renderable === false,
    staleTime: 60_000,
    retry: false,
  });

  if (office) {
    if (renderable === undefined) {
      return (
        <div className="text-xs px-3 py-4" style={{ color: C.mute, fontFamily: sans }}>
          rendering document…
        </div>
      );
    }
    if (renderable) {
      return (
        <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${C.border}` }}>
          <div className="flex items-center gap-2 px-3 py-2" style={{ background: C.raised }}>
            <span className="text-xs" style={{ color: C.mute, fontFamily: mono }}>
              {kind === 'pdf' ? 'document view' : `document view · rendered from .${kind}`}
            </span>
          </div>
          <iframe
            src={`${base}/render.pdf#toolbar=0&navpanes=0&view=FitH`}
            style={{ width: '100%', height, border: 'none', background: '#525659', display: 'block' }}
            title="document preview"
          />
        </div>
      );
    }
  }

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${C.border}` }}>
      <div className="flex items-center gap-2 px-3 py-2" style={{ background: C.raised }}>
        <span className="text-xs" style={{ color: C.mute, fontFamily: mono }}>
          {kind === 'pptx' ? 'slide preview' : kind === 'xlsx' ? 'sheet preview' : 'document preview'}
        </span>
      </div>
      {textPreview ? (
        <StructuredOffice p={textPreview} height={height} />
      ) : textError ? (
        <div className="text-xs px-3 py-4" style={{ color: C.mute, fontFamily: sans }}>
          {(textError as Error).message}
        </div>
      ) : (
        <div className="text-xs px-3 py-4" style={{ color: C.mute, fontFamily: sans }}>
          building preview…
        </div>
      )}
    </div>
  );
}
