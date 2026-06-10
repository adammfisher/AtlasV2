import {
  Check,
  Loader2,
  Sparkles,
  RefreshCw,
  LayoutTemplate,
  Cpu,
  ArrowUp,
  AlertTriangle,
} from 'lucide-react';
import { C, SERIF, MONO } from '../theme/tokens';
import { Chip } from './Chip';
import { ArtifactCard } from './ArtifactCard';
import { MermaidPreview } from './MermaidPreview';
import { SitePreview } from './SitePreview';
import type { PipelineMessageData } from '../lib/api';

export function PipelineMessage({
  m,
  routerLabel,
  onOpenArtifact,
}: {
  m: PipelineMessageData;
  routerLabel: string;
  onOpenArtifact: () => void;
}) {
  return (
    <div>
      <div className="flex flex-wrap mb-2">
        {m.stage >= 1 && (
          <Chip icon={m.edit ? RefreshCw : Sparkles} tone="accent">
            {m.skillChip}
          </Chip>
        )}
        {m.stage >= 1 && m.extraChip && (
          <Chip icon={LayoutTemplate} tone="dim">
            {m.extraChip}
          </Chip>
        )}
        {m.stage >= 1 && (
          <Chip icon={Cpu} tone="dim">
            {m.modelChip}
          </Chip>
        )}
        {m.escalated && m.stage >= 1 && (
          <Chip icon={ArrowUp} tone="amber">
            Escalated to 12B — office JSON
          </Chip>
        )}
      </div>
      {m.stage === 0 && (
        <div className="flex items-center gap-2 text-sm" style={{ color: C.dim }}>
          <Loader2 size={14} className="animate-spin" style={{ color: C.accent }} />
          Routing — {routerLabel} classifying the task…
        </div>
      )}
      {m.stage >= 2 && (
        <p className="text-base leading-relaxed" style={{ color: C.text, fontFamily: SERIF }}>
          {m.text}
        </p>
      )}
      {m.stage === 1 && (
        <div className="flex items-center gap-2 text-sm" style={{ color: C.dim }}>
          <Loader2 size={14} className="animate-spin" style={{ color: C.accent }} />
          Generating constrained JSON…
        </div>
      )}
      {m.stage >= 2 && (
        <div
          className="mt-3 rounded-xl px-3.5 py-2.5"
          style={{ background: C.bg, border: `1px solid ${C.borderSoft}` }}
        >
          {m.steps.map((s, i) => (
            <div
              key={i}
              className="flex items-start gap-2 text-xs py-0.5"
              style={{ color: C.dim, fontFamily: MONO }}
            >
              <Check size={12} className="mt-0.5 flex-shrink-0" style={{ color: C.green }} />
              <span>{s}</span>
            </div>
          ))}
          {m.stage === 2 && (
            <div
              className="flex items-center gap-2 text-xs py-0.5"
              style={{ color: C.dim, fontFamily: MONO }}
            >
              <Loader2 size={12} className="animate-spin flex-shrink-0" style={{ color: C.accent }} />
              <span>validating…</span>
            </div>
          )}
        </div>
      )}
      {m.stage >= 3 && (
        <>
          <div className="flex flex-wrap mt-3">
            {m.checks.map(([label, ok]) => (
              <Chip key={label} icon={ok ? Check : AlertTriangle} tone={ok ? 'green' : 'amber'}>
                {label}
              </Chip>
            ))}
          </div>
          {m.diagram && <MermaidPreview />}
          {m.preview && <SitePreview />}
          {m.artifact && <ArtifactCard artifact={m.artifact} onOpen={onOpenArtifact} />}
        </>
      )}
    </div>
  );
}
