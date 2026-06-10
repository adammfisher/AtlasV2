import { Cpu, Cloud, Check, Lock, X } from 'lucide-react';
import { C, MONO } from '../theme/tokens';
import type { ModelsRegistry } from '../lib/api';

export function ModelMenu({
  registry,
  onSelect,
  openBedrock,
  close,
}: {
  registry: ModelsRegistry;
  onSelect: (id: string) => void;
  openBedrock: () => void;
  close: () => void;
}) {
  const Row = ({
    id,
    name,
    sub,
    sizeGB,
    present,
    badge,
    lockNote,
    selectable,
  }: {
    id: string;
    name: string;
    sub: string;
    sizeGB: number | null;
    present: boolean;
    badge?: string;
    lockNote?: boolean;
    selectable: boolean;
  }) => {
    const active = registry.selected === id && !registry.bedrock.connected;
    return (
      <div
        onClick={() => {
          if (selectable) {
            onSelect(id);
            close();
          }
        }}
        className="flex items-center gap-3 px-3 py-2 rounded-lg transition-colors"
        style={{
          background: active ? C.raise2 : 'transparent',
          cursor: selectable ? 'pointer' : 'default',
          opacity: present ? (selectable ? 1 : 0.75) : 0.55,
        }}
      >
        <Cpu size={14} style={{ color: active ? C.accent : C.faint }} />
        <div className="flex-1 min-w-0">
          <div className="text-sm flex items-center gap-2" style={{ color: C.text }}>
            {name}
            {badge && (
              <span className="text-xs px-1.5 rounded" style={{ background: C.greenDim, color: C.green }}>
                {badge}
              </span>
            )}
          </div>
          <div className="text-xs" style={{ color: C.faint }}>
            {present ? sub : `Place a ${name.replace('Gemma 4 ', '')} GGUF in the models folder`}
          </div>
        </div>
        <span className="text-xs" style={{ color: C.faint, fontFamily: MONO }}>
          {sizeGB !== null ? `${sizeGB.toFixed(1)} GB` : '—'}
        </span>
        {active && <Check size={14} style={{ color: C.accent }} />}
        {lockNote && <Lock size={12} style={{ color: C.faint }} />}
      </div>
    );
  };

  const onDevice = registry.models.filter((m) => m.id !== 'embedding');
  const resident = registry.hardware.residentFile ?? 'no model';

  return (
    <div
      className="absolute bottom-full mb-2 left-0 right-0 rounded-xl p-2 z-10 shadow-2xl"
      style={{ background: C.side, border: `1px solid ${C.border}` }}
    >
      <div className="flex items-center justify-between px-3 pt-1 pb-2">
        <span className="text-xs font-medium" style={{ color: C.faint }}>
          ON-DEVICE
        </span>
        <X size={13} className="cursor-pointer" style={{ color: C.faint }} onClick={close} />
      </div>
      {onDevice.map((m) => (
        <Row
          key={m.id}
          id={m.id}
          name={m.name}
          sub={m.sub}
          sizeGB={m.sizeGB}
          present={m.present}
          badge={m.id === 'e2b' ? 'router' : undefined}
          lockNote={m.id === 'e2b'}
          selectable={m.selectable}
        />
      ))}
      <div className="px-3 pt-3 pb-2 text-xs font-medium" style={{ color: C.faint }}>
        CLOUD UPGRADE
      </div>
      <div className="flex items-center gap-3 px-3 py-2 rounded-lg">
        <Cloud size={14} style={{ color: C.blue }} />
        <div className="flex-1">
          <div className="text-sm" style={{ color: C.text }}>
            Claude via Bedrock
          </div>
          <div className="text-xs" style={{ color: C.faint }}>
            Routes office JSON + code tasks when connected
          </div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            close();
            openBedrock();
          }}
          className="text-xs px-2.5 py-1 rounded-lg"
          style={{ border: `1px solid ${C.accent}`, color: C.accent }}
        >
          Add model
        </button>
      </div>
      <div className="px-3 py-2 mt-1 text-xs rounded-lg" style={{ background: C.bg, color: C.faint }}>
        This machine: {registry.hardware.ramGB} GB unified · {resident} resident ·{' '}
        {Math.round(registry.hardware.ctx / 1024)}k context window
      </div>
    </div>
  );
}
