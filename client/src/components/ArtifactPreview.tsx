import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { C, sans, mono } from '../theme/tokens';
import { Badge } from './Badge';
import {
  buildReactSrcdoc,
  buildSiteSrcdoc,
  buildMermaidSrcdoc,
  buildMarkdownSrcdoc,
  buildSvgSrcdoc,
} from '../lib/sandbox';

const SANDBOX_KINDS = ['md', 'mermaid', 'svg', 'react', 'site'];

interface ContentResponse {
  kind: string;
  source?: string;
  files?: Record<string, string>;
  entry?: string;
}

function SandboxFrame({
  srcdoc,
  height,
  chips,
}: {
  srcdoc: string;
  height: number;
  chips: Array<{ ok: boolean; label: string }>;
}) {
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${C.border}` }}>
      <div className="flex items-center gap-1.5 px-3 py-2" style={{ background: C.raised }}>
        <span className="w-2 h-2 rounded-full" style={{ background: '#c97c70' }} />
        <span className="w-2 h-2 rounded-full" style={{ background: C.amber }} />
        <span className="w-2 h-2 rounded-full" style={{ background: C.green }} />
        <span className="text-xs ml-2" style={{ color: C.mute, fontFamily: mono }}>
          sandbox · csp locked · offline
        </span>
        <span className="ml-auto flex gap-1">
          {chips.map((chip) => (
            <Badge
              key={chip.label}
              color={chip.ok ? C.green : C.amber}
              dim={chip.ok ? C.greenDim : C.amberDim}
            >
              {chip.label}
            </Badge>
          ))}
        </span>
      </div>
      <iframe
        sandbox="allow-scripts"
        srcDoc={srcdoc}
        style={{ width: '100%', height, border: 'none', background: '#262624', display: 'block' }}
        title="artifact preview"
      />
    </div>
  );
}

export function ArtifactPreview({
  artifactId,
  version,
  kind,
  height = 360,
}: {
  artifactId: string;
  version: number;
  kind: string;
  height?: number;
}) {
  const sandboxed = SANDBOX_KINDS.includes(kind);
  const { data: content } = useQuery({
    queryKey: ['artifact-content', artifactId, version],
    queryFn: async (): Promise<ContentResponse> => {
      const res = await fetch(`/api/artifacts/${artifactId}/versions/${version}/content`);
      if (!res.ok) throw new Error('content unavailable');
      return res.json() as Promise<ContentResponse>;
    },
    enabled: sandboxed,
    staleTime: 60_000,
  });
  const { data: textPreview } = useQuery({
    queryKey: ['artifact-preview', artifactId, version],
    queryFn: async () => {
      const res = await fetch(`/api/artifacts/${artifactId}/versions/${version}/preview`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'preview unavailable');
      }
      return res.json() as Promise<{ text: string; label: string }>;
    },
    enabled: ['pptx', 'docx', 'xlsx', 'pdf'].includes(kind),
    staleTime: 60_000,
    retry: false,
  });

  const [srcdoc, setSrcdoc] = useState<string | null>(null);
  const [chips, setChips] = useState<Array<{ ok: boolean; label: string }>>([]);
  const [netAttempts, setNetAttempts] = useState(0);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const data = e.data as { type?: string; attempts?: number };
      if (data?.type === 'atlas-net-attempt') setNetAttempts(data.attempts ?? 1);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!content) return;
    void (async () => {
      setSrcdoc(null);
      setChips([]);
      setNetAttempts(0);
      if (content.kind === 'react') {
        const result = await buildReactSrcdoc(content.files ?? {}, String(content.entry ?? '/App.jsx'));
        if (cancelled) return;
        setSrcdoc(result.srcdoc);
        setChips([
          { ok: result.ok, label: result.ok ? `Bundle · ${result.ms}ms` : `Bundle failed` },
        ]);
        if (!result.ok && result.error) setSrcdoc(`<pre style="color:#d4ad6a">${result.error}</pre>`);
      } else if (content.kind === 'site') {
        const result = buildSiteSrcdoc(content.files ?? {});
        if (cancelled) return;
        setSrcdoc(result.srcdoc);
        setChips([{ ok: result.ok, label: result.ok ? 'Composed offline' : 'Compose failed' }]);
      } else if (content.kind === 'mermaid') {
        setSrcdoc(await buildMermaidSrcdoc(content.source ?? ''));
      } else if (content.kind === 'md') {
        setSrcdoc(await buildMarkdownSrcdoc(content.source ?? ''));
      } else if (content.kind === 'svg') {
        setSrcdoc(buildSvgSrcdoc(content.source ?? ''));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [content]);

  if (sandboxed) {
    if (!srcdoc)
      return (
        <div className="text-xs px-3 py-4" style={{ color: C.mute, fontFamily: sans }}>
          building preview…
        </div>
      );
    const allChips = [
      ...chips,
      ...(kind === 'react' || kind === 'site'
        ? [
            netAttempts === 0
              ? { ok: true, label: 'No external requests' }
              : { ok: false, label: `${netAttempts} network attempts blocked` },
          ]
        : []),
    ];
    return <SandboxFrame srcdoc={srcdoc} height={height} chips={allChips} />;
  }

  if (kind === 'product') return null; // product renders its own sections in the panel

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${C.border}` }}>
      <div className="flex items-center gap-2 px-3 py-2" style={{ background: C.raised }}>
        <span className="text-xs" style={{ color: C.mute, fontFamily: mono }}>
          {textPreview?.label ?? 'text preview'} · extraction-based
        </span>
      </div>
      <pre
        className="px-3 py-3 overflow-auto whitespace-pre-wrap"
        style={{ background: C.bg, color: C.sub, fontFamily: mono, fontSize: 11, maxHeight: height, margin: 0 }}
      >
        {textPreview?.text ?? 'extracting…'}
      </pre>
    </div>
  );
}
