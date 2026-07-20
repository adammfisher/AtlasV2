import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { CSSProperties } from 'react';
import { C, wash, sans, mono, serif } from '../theme/tokens';
import { useBrand, BRAND_NAME } from '../lib/brand';
import { Badge } from './Badge';
import {
  buildReactSrcdoc,
  buildSiteSrcdoc,
  buildMermaidSrcdoc,
  buildMarkdownSrcdoc,
  buildSvgSrcdoc,
} from '../lib/sandbox';

const SANDBOX_KINDS = ['md', 'mermaid', 'svg', 'react', 'site'];

export interface OfficePreview {
  text: string;
  label: string;
  svgs?: Array<string | null>;
  slides?: Array<{ title: string; bullets: string[] }>;
  sheets?: Array<{ name: string; rows: string[][] }>;
  blocks?: Array<{ style: string; text?: string; rows?: string[][] }>;
}

/** Rich structured preview for office docs in the scale-to-zero cloud (no
 * LibreOffice): pptx → slide cards, xlsx → sheet tables, docx → styled blocks.
 * Exported for reuse by KnowledgePreview (project files aren't artifacts, but
 * need the exact same rendering for the exact same server-side extraction). */
export function StructuredOffice({ p, height }: { p: OfficePreview; height: number | string }) {
  const box: CSSProperties = {
    maxHeight: height,
    overflow: 'auto',
    padding: 14,
    background: C.bg,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  };
  // true-to-design visual preview: SVGs rendered from the pptx shapes (cloud,
  // no LibreOffice). Each 16:9 slide is isolated in an <img> data URI.
  if (p.svgs?.some(Boolean)) {
    return (
      <div style={box}>
        {p.svgs.map((svg, i) =>
          svg ? (
            <img
              key={i}
              src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`}
              alt={`slide ${i + 1}`}
              style={{ width: '100%', aspectRatio: '16 / 9', border: `1px solid ${C.border}`, borderRadius: 8, display: 'block' }}
            />
          ) : (
            <div key={i} className="text-xs px-3 py-6 text-center" style={{ color: C.mute, background: C.panel, borderRadius: 8 }}>
              slide {i + 1}
            </div>
          ),
        )}
      </div>
    );
  }
  if (p.slides?.length) {
    return (
      <div style={box}>
        {p.slides.map((s, i) => (
          <div
            key={i}
            className="rounded-lg"
            style={{ border: `1px solid ${C.border}`, background: C.panel, padding: 14, aspectRatio: '16 / 9', display: 'flex', flexDirection: 'column' }}
          >
            <div className="text-xs mb-1" style={{ color: C.mute, fontFamily: mono }}>
              slide {i + 1}
            </div>
            <div style={{ color: C.text, fontFamily: sans, fontWeight: 600, fontSize: 15, marginBottom: 8 }}>
              {s.title || '—'}
            </div>
            <ul style={{ color: C.sub, fontFamily: sans, fontSize: 12.5, lineHeight: 1.6, listStyle: 'disc', paddingLeft: 18 }}>
              {s.bullets.map((b, j) => (
                <li key={j}>{b}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    );
  }
  if (p.sheets?.length) {
    return (
      <div style={box}>
        {p.sheets.map((sh, i) => (
          <div key={i}>
            <div className="text-xs mb-1.5" style={{ color: C.accent, fontFamily: mono }}>
              {sh.name}
            </div>
            <div className="rounded-lg overflow-auto" style={{ border: `1px solid ${C.border}` }}>
              <table style={{ borderCollapse: 'collapse', fontFamily: sans, fontSize: 12 }}>
                <tbody>
                  {sh.rows.map((row, r) => (
                    <tr key={r}>
                      {row.map((cell, c) => (
                        <td
                          key={c}
                          style={{ border: `1px solid ${C.borderSoft}`, padding: '3px 8px', color: r === 0 ? C.text : C.sub, fontWeight: r === 0 ? 600 : 400, whiteSpace: 'nowrap' }}
                        >
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (p.blocks?.length) {
    return (
      <div style={{ ...box, gap: 6 }}>
        {p.blocks.map((b, i) => {
          if (b.rows) {
            return (
              <table key={i} style={{ borderCollapse: 'collapse', fontFamily: sans, fontSize: 12, margin: '6px 0' }}>
                <tbody>
                  {b.rows.map((row, r) => (
                    <tr key={r}>
                      {row.map((cell, c) => (
                        <td key={c} style={{ border: `1px solid ${C.borderSoft}`, padding: '3px 8px', color: C.sub }}>
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          }
          const heading = /Heading|Title/i.test(b.style);
          return (
            <div
              key={i}
              style={{ color: heading ? C.text : C.sub, fontFamily: heading ? serif : sans, fontSize: heading ? 16 : 13, fontWeight: heading ? 600 : 400, lineHeight: 1.55, marginTop: heading ? 8 : 0 }}
            >
              {b.text}
            </div>
          );
        })}
      </div>
    );
  }
  return (
    <pre
      className="px-3 py-3 overflow-auto whitespace-pre-wrap"
      style={{ background: C.bg, color: C.sub, fontFamily: mono, fontSize: 11, maxHeight: height, margin: 0 }}
    >
      {p.text || 'no extractable content'}
    </pre>
  );
}

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
  height: number | string;
  chips: Array<{ ok: boolean; label: string }>;
}) {
  // blob URL rather than srcdoc: srcdoc documents inherit the parent's base URL,
  // so a generated page setting location.hash would navigate the sandbox to the
  // Axiom app itself. A blob document keeps hash navigation inside the sandbox.
  const blobUrl = useMemo(
    () => URL.createObjectURL(new Blob([srcdoc], { type: 'text/html' })),
    [srcdoc],
  );
  useEffect(() => () => URL.revokeObjectURL(blobUrl), [blobUrl]);
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${C.border}` }}>
      <div className="flex items-center gap-1.5 px-3 py-2" style={{ background: C.raised }}>
        <span className="w-2 h-2 rounded-full" style={{ background: C.red }} />
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
        src={blobUrl}
        /* not a token: mirrors the background sandbox.ts paints inside the
           iframe (see its md/mermaid <style>), so the element does not flash a
           different color before the frame loads. Themed with the sandbox, if
           ever — deliberately not with the app chrome. */
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
  height?: number | string;
}) {
  const sandboxed = SANDBOX_KINDS.includes(kind);
  const brandName = BRAND_NAME[useBrand()];
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
  const office = ['pptx', 'docx', 'xlsx', 'pdf'].includes(kind);
  const { data: renderable } = useQuery({
    queryKey: ['artifact-render', artifactId, version],
    queryFn: async () => {
      const res = await fetch(`/api/artifacts/${artifactId}/versions/${version}/render.pdf`, {
        method: 'HEAD',
      });
      return res.ok;
    },
    enabled: office,
    staleTime: 60_000,
    retry: false,
  });
  const { data: textPreview, error: textError } = useQuery({
    queryKey: ['artifact-preview', artifactId, version],
    queryFn: async () => {
      const res = await fetch(`/api/artifacts/${artifactId}/versions/${version}/preview`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'preview unavailable');
      }
      return res.json() as Promise<OfficePreview>;
    },
    enabled: office && renderable === false,
    staleTime: 60_000,
    retry: false,
  });

  const [srcdoc, setSrcdoc] = useState<string | null>(null);
  // C5 "try fixing" (claude.ai parity): a failed bundle offers a one-click
  // repair request routed into the chat composer
  const [fixError, setFixError] = useState<string | null>(null);
  const [chips, setChips] = useState<Array<{ ok: boolean; label: string }>>([]);
  const [netAttempts, setNetAttempts] = useState(0);
  const [parseChip, setParseChip] = useState<{ ok: boolean; label: string } | null>(null);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const data = e.data as { type?: string; attempts?: number; ok?: boolean };
      if (data?.type === 'axiom-net-attempt') setNetAttempts(data.attempts ?? 1);
      if (data?.type === 'axiom-mermaid-parse') {
        setParseChip(data.ok ? { ok: true, label: 'Parse check' } : { ok: false, label: 'Parse failed' });
      }
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
        if (!result.ok && result.error) {
          // literal, not C.amber: this markup is the iframe's document, and the
          // parent's custom properties do not cascade across that boundary —
          // var() here would resolve to nothing. Tracks sandbox.ts's palette.
          setSrcdoc(`<pre style="color:#d4ad6a">${result.error}</pre>`);
          setFixError(result.error);
        } else {
          setFixError(null);
        }
      } else if (content.kind === 'site') {
        const result = buildSiteSrcdoc(content.files ?? {});
        if (cancelled) return;
        setSrcdoc(result.srcdoc);
        setChips([{ ok: result.ok, label: result.ok ? 'Composed offline' : 'Compose failed' }]);
      } else if (content.kind === 'mermaid') {
        setSrcdoc(await buildMermaidSrcdoc(content.source ?? '', brandName));
      } else if (content.kind === 'md') {
        setSrcdoc(await buildMarkdownSrcdoc(content.source ?? ''));
      } else if (content.kind === 'svg') {
        setSrcdoc(buildSvgSrcdoc(content.source ?? ''));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [content, brandName]);

  if (sandboxed) {
    if (!srcdoc)
      return (
        <div className="text-xs px-3 py-4" style={{ color: C.mute, fontFamily: sans }}>
          building preview…
        </div>
      );
    const allChips = [
      ...chips,
      ...(kind === 'mermaid' && parseChip ? [parseChip] : []),
      ...(kind === 'react' || kind === 'site'
        ? [
            netAttempts === 0
              ? { ok: true, label: 'No external requests' }
              : { ok: false, label: `${netAttempts} network attempts blocked` },
          ]
        : []),
    ];
    return (
      <div>
        <SandboxFrame srcdoc={srcdoc} height={height} chips={allChips} />
        {fixError ? (
          <button
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent('axiom-fix-artifact', { detail: `Fix this build error in the artifact: ${fixError}` }),
              )
            }
            className="mt-2 px-3 py-1.5 rounded-lg text-xs font-medium"
            style={{ background: wash(C.amber, 15), color: C.amber, border: `1px solid ${wash(C.amber, 40)}` }}
          >
            Try fixing
          </button>
        ) : null}
      </div>
    );
  }

  if (kind === 'product') return null; // product renders its own sections in the panel

  // office + pdf: real document view (pdf native; pptx/docx/xlsx soffice-rendered
  // to PDF server-side). Falls back to the markitdown text preview when the
  // render endpoint is unavailable (no soffice / no file).
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
          src={`/api/artifacts/${artifactId}/versions/${version}/render.pdf#toolbar=0&navpanes=0&view=FitH`}
          /* not a token: this is the PDF viewer's own backdrop gray, and the
             iframe must match the chrome the browser paints inside it — a
             themed value here would seam against the viewer, not blend in */
          style={{ width: '100%', height, border: 'none', background: '#525659', display: 'block' }}
          title="document preview"
        />
      </div>
    );
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
