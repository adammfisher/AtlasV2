import { useState } from 'react';
import { X, Download, FolderOpen, Package, ArrowUp, RefreshCw, FileText, Share2, ExternalLink, Maximize2, Minimize2 } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { C, wash, sans, mono, namedIcon } from '../theme/tokens';
import { api, type ProjectionRow } from '../lib/api';
import { saveFile } from '../lib/download';
import { StepRow } from './StepRow';
import { Badge } from './Badge';
import { ArtifactPreview } from './ArtifactPreview';
import type { PipelineStep } from '../lib/api';

const KIND_ICONS: Record<string, string> = {
  pptx: 'presentation',
  docx: 'file-text',
  xlsx: 'file-spreadsheet',
  pdf: 'book-open',
  md: 'file-code',
  mermaid: 'git-branch',
  svg: 'layers',
  react: 'braces',
  site: 'braces',
  product: 'box',
};

const STATE_COLORS: Record<string, { color: string; dim: string }> = {
  proposed: { color: C.sub, dim: wash(C.sub, 13) },
  endorsed: { color: C.blue, dim: C.blueDim },
  specified: { color: C.purple, dim: C.purpleDim },
  built: { color: C.green, dim: C.greenDim },
  operating: { color: C.accent, dim: C.accentDim },
};

const PROJECTION_KINDS = [
  'concept_md',
  'concept_docx',
  'brd_docx',
  'gate_pptx',
  'context_mermaid',
  'prototype_react',
];

export function ArtifactPanel({ artifactId, onClose }: { artifactId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: a } = useQuery({
    queryKey: ['artifact', artifactId],
    queryFn: () => api.artifact(artifactId),
  });
  const [ver, setVer] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyKind, setBusyKind] = useState<string | null>(null);
  const [promoteNote, setPromoteNote] = useState('');
  const [fullscreen, setFullscreen] = useState(false);

  if (!a) return null;
  const Icon = namedIcon(KIND_ICONS[a.kind] ?? 'file-text');
  const activeVer = ver ?? a.ver;
  const version = a.versions.find((v) => v.version === activeVer);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['artifact', artifactId] });

  const act = (fn: () => Promise<unknown>, busy?: string) => {
    setNotice(null);
    if (busy) setBusyKind(busy);
    void fn()
      .catch((err: unknown) => setNotice(err instanceof Error ? err.message : String(err)))
      .finally(() => {
        setBusyKind(null);
        refresh();
      });
  };

  const stateStyle = a.state ? STATE_COLORS[a.state] ?? STATE_COLORS.proposed : null;
  const projections: ProjectionRow[] = a.projections ?? [];
  const projByKind = new Map(projections.map((p) => [p.kind, p]));
  const bundleUnlocked =
    a.state === 'specified' || a.state === 'built' || a.state === 'operating';

  return (
    <div
      data-testid="artifact-panel"
      data-kind={a.kind}
      data-ver={a.ver}
      className={fullscreen ? 'flex flex-col fixed inset-0 z-50' : 'flex flex-col h-full flex-shrink-0'}
      style={
        fullscreen
          ? { background: C.panel }
          : { width: 'min(52vw, 880px)', minWidth: 480, background: C.panel, borderLeft: `1px solid ${C.borderSoft}` }
      }
    >
      <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: `1px solid ${C.borderSoft}` }}>
        <Icon size={15} style={{ color: C.accent }} />
        <span className="text-sm font-medium truncate" style={{ color: C.text, fontFamily: sans }}>
          {a.name}
        </span>
        {a.state && stateStyle && (
          <Badge color={stateStyle.color} dim={stateStyle.dim}>
            {a.state}
          </Badge>
        )}
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
        <button
          onClick={() => setFullscreen((f) => !f)}
          className="p-1 rounded-md"
          style={{ color: C.mute }}
          title={fullscreen ? 'Exit full screen' : 'Full screen'}
        >
          {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>
        <button onClick={onClose} className="p-1 rounded-md" style={{ color: C.mute }}>
          <X size={15} />
        </button>
      </div>

      <div className="px-4 py-3 overflow-y-auto flex-1 flex flex-col gap-4">
        {a.kind === 'product' ? (
          <>
            <div>
              <div className="text-xs font-medium uppercase tracking-wider mb-1.5" style={{ color: C.mute, fontFamily: sans }}>
                State timeline
              </div>
              {(a.timeline ?? []).length === 0 ? (
                <div className="text-xs" style={{ color: C.mute, fontFamily: sans }}>
                  proposed — no stamps yet
                </div>
              ) : (
                (a.timeline ?? []).map((t, i) => (
                  <div key={i} className="flex items-start gap-2 py-1 text-xs" style={{ fontFamily: sans }}>
                    <span style={{ color: STATE_COLORS[t.state]?.color ?? C.sub }}>{t.state}</span>
                    <span style={{ color: C.mute }}>
                      {t.stamped_by} · v{t.at_version}
                      {t.note ? ` · ${t.note}` : ''}
                    </span>
                  </div>
                ))
              )}
              {a.promote && (
                <div className="mt-2 flex items-center gap-2">
                  <input
                    value={promoteNote}
                    onChange={(e) => setPromoteNote(e.target.value)}
                    placeholder={a.promote.to === 'operating' ? 'note (required)' : 'note (optional)'}
                    className="flex-1 rounded-lg px-2.5 py-1.5 text-xs outline-none"
                    style={{ background: C.panel, color: C.text, border: `1px solid ${C.borderSoft}`, fontFamily: sans }}
                  />
                  <span title={a.promote.unmet.length > 0 ? `Unmet: ${a.promote.unmet.join(' · ')}` : ''}>
                    <button
                      disabled={a.promote.unmet.length > 0}
                      onClick={() =>
                        act(() => api.promoteProduct(a.id, a.promote?.to ?? '', promoteNote).then(() => setPromoteNote('')))
                      }
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
                      style={{
                        background: a.promote.unmet.length > 0 ? C.raised : C.accent,
                        color: a.promote.unmet.length > 0 ? C.mute : C.accentContrast,
                        fontFamily: sans,
                        cursor: a.promote.unmet.length > 0 ? 'not-allowed' : 'pointer',
                      }}
                    >
                      <ArrowUp size={12} /> Promote → {a.promote.to}
                    </button>
                  </span>
                </div>
              )}
              {a.promote && a.promote.unmet.length > 0 && (
                <div className="text-xs mt-1.5" style={{ color: C.amber, fontFamily: sans }}>
                  Unmet: {a.promote.unmet.join(' · ')}
                </div>
              )}
            </div>

            <div>
              <div className="text-xs font-medium uppercase tracking-wider mb-1.5" style={{ color: C.mute, fontFamily: sans }}>
                Projections
              </div>
              {PROJECTION_KINDS.map((kind) => {
                const row = projByKind.get(kind);
                const busy = busyKind === kind;
                return (
                  <div
                    key={kind}
                    className="flex items-center gap-2 rounded-lg px-2.5 py-2 mb-1"
                    style={{ background: C.panel, border: `1px solid ${C.borderSoft}` }}
                  >
                    <span className="text-xs flex-1 truncate" style={{ color: C.text, fontFamily: mono }}>
                      {kind}
                    </span>
                    <Badge
                      color={kind === 'prototype_react' ? C.amber : C.green}
                      dim={kind === 'prototype_react' ? C.amberDim : C.greenDim}
                    >
                      {kind === 'prototype_react' ? 'generated' : 'deterministic'}
                    </Badge>
                    {row && (
                      <span className="text-xs" style={{ color: C.mute, fontFamily: sans }}>
                        v{row.atVersion}
                      </span>
                    )}
                    {row?.stale && (
                      <Badge color={C.amber} dim={C.amberDim}>
                        stale
                      </Badge>
                    )}
                    <button
                      title={row ? 'Regenerate' : 'Generate'}
                      onClick={() => act(() => api.generateProjection(a.id, kind), kind)}
                      className="p-1 rounded"
                      style={{ color: busy ? C.accent : C.mute }}
                    >
                      <RefreshCw size={12} className={busy ? 'animate-spin' : ''} />
                    </button>
                    {row && row.outputRef && kind !== 'prototype_react' && (
                      <button
                        onClick={() =>
                          act(async () => {
                            const base = (row.outputRef ?? '').split('/').pop() ?? `${kind}.out`;
                            await saveFile(`/api/artifacts/${a.id}/projections/${row.id}/download`, base);
                            setNotice(`Saved ${base} to your Downloads folder.`);
                          })
                        }
                        title="Download"
                        className="p-1 rounded"
                        style={{ color: C.mute }}
                      >
                        <Download size={12} />
                      </button>
                    )}
                  </div>
                );
              })}
              <span title={bundleUnlocked ? '' : "unlocks at 'specified'"}>
                <button
                  disabled={!bundleUnlocked}
                  onClick={() => {
                    if (bundleUnlocked)
                      act(async () => {
                        const bundleName = `${a.name.replace(/\.product\.json$/, '')}-bundle-v${a.ver}.zip`;
                        await saveFile(`/api/artifacts/${a.id}/bundle`, bundleName);
                        setNotice(`Saved ${bundleName} to your Downloads folder.`);
                      });
                  }}
                  className="mt-1 w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium"
                  style={{
                    background: bundleUnlocked ? C.accent : C.raised,
                    color: bundleUnlocked ? C.accentContrast : C.mute,
                    fontFamily: sans,
                    cursor: bundleUnlocked ? 'pointer' : 'not-allowed',
                  }}
                >
                  <Package size={13} /> Export bundle{bundleUnlocked ? '' : " — unlocks at 'specified'"}
                </button>
              </span>
            </div>

            <div>
              <div className="text-xs font-medium uppercase tracking-wider mb-1.5" style={{ color: C.mute, fontFamily: sans }}>
                Definition (v{activeVer})
              </div>
              <pre
                className="rounded-lg px-3 py-2.5 overflow-auto"
                style={{ background: C.bg, color: C.sub, fontFamily: mono, fontSize: 10.5, maxHeight: 220, margin: 0, border: `1px solid ${C.borderSoft}` }}
              >
                {JSON.stringify(a.payload ?? {}, null, 2)}
              </pre>
            </div>
          </>
        ) : (
          <ArtifactPreview artifactId={a.id} version={activeVer} kind={a.kind} height={'calc(100vh - 330px)'} />
        )}

        <div>
          <div className="text-xs font-medium uppercase tracking-wider mb-1.5" style={{ color: C.mute, fontFamily: sans }}>
            Validation
          </div>
          {((version?.validation ?? []) as PipelineStep[]).map((v) => (
            <StepRow key={v.label} state={v.state} label={v.label} detail={v.detail} />
          ))}
        </div>

        {notice && (
          <div
            className="rounded-lg px-3 py-2 text-xs leading-relaxed"
            style={{ background: C.amberDim, color: C.amber, border: `1px solid ${C.amber}`, fontFamily: sans }}
          >
            {notice}
          </div>
        )}
      </div>

      <div className="px-4 py-3" style={{ borderTop: `1px solid ${C.borderSoft}` }}>
        <div className="flex gap-2">
          <button
            onClick={() =>
              act(async () => {
                const downloadName =
                  a.kind === 'react' || a.kind === 'site' ? `${a.name}-v${activeVer}.zip` : a.name;
                await saveFile(`/api/artifacts/${a.id}/versions/${activeVer}/download`, downloadName);
                setNotice(`Saved ${downloadName} to your Downloads folder.`);
              })
            }
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium"
            style={{ background: C.accent, color: C.accentContrast, fontFamily: sans }}
          >
            <Download size={14} /> Download as {a.kind === 'product' ? 'JSON' : a.kind.toUpperCase()} · v{activeVer}
          </button>
          <button
            onClick={() =>
              act(async () => {
                await api.revealArtifact(a.id, activeVer);
              })
            }
            title="Reveal the file in Finder"
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium"
            style={{ background: C.raised, color: C.text, border: `1px solid ${C.border}`, fontFamily: sans }}
          >
            <FolderOpen size={14} />
          </button>
          {['pptx', 'docx', 'xlsx'].includes(a.kind) && (
            <button
              onClick={() => {
                // open the tab synchronously (avoids popup blocking), then point
                // it at Microsoft's Office Online viewer with a signed share URL
                const win = window.open('', '_blank');
                act(async () => {
                  const { url } = await api.shareArtifact(a.id, activeVer);
                  const viewer = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`;
                  if (win) win.location.href = viewer;
                  else window.open(viewer, '_blank');
                });
              }}
              title="Open a pixel-perfect PowerPoint view (Microsoft Office Online — the file is fetched via a temporary signed link)"
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium"
              style={{ background: C.raised, color: C.text, border: `1px solid ${C.border}`, fontFamily: sans }}
            >
              <ExternalLink size={14} />
            </button>
          )}
          <button
            onClick={() =>
              act(async () => {
                const { url } = await api.shareArtifact(a.id, activeVer);
                await navigator.clipboard.writeText(url);
                setNotice('Share link copied — anyone with it can download for 7 days.');
              })
            }
            title="Share: copy a 7-day public download link"
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium"
            style={{ background: C.raised, color: C.text, border: `1px solid ${C.border}`, fontFamily: sans }}
          >
            <Share2 size={14} />
          </button>
          {activeVer !== a.ver && (
            <button
              onClick={() => act(() => api.restoreArtifact(a.id, activeVer))}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm"
              style={{ background: C.raised, color: C.sub, fontFamily: sans, border: `1px solid ${C.border}` }}
            >
              <FileText size={14} /> Restore
            </button>
          )}
        </div>
        <p className="text-xs mt-2" style={{ color: C.mute, fontFamily: sans }}>
          Edits regenerate only the affected sections — earlier versions stay byte-exact for diffing.
        </p>
      </div>
    </div>
  );
}
