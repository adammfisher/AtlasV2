import { Check, KeyRound, Info } from 'lucide-react';
import { C, sans } from '../theme/tokens';
import { Badge } from './Badge';
import { api, type ModelsRegistry } from '../lib/api';

interface MenuRow {
  id: string;
  name: string;
  detail: string;
  badge: string;
  locked?: boolean;
  selectable: boolean;
}

function buildRows(registry: ModelsRegistry): MenuRow[] {
  const rows: MenuRow[] = [
    { id: 'auto', name: 'Auto', detail: 'Routes by task — E2B classifies, 12B drafts', badge: 'Recommended', selectable: true },
  ];
  for (const m of registry.models) {
    if (m.id === 'embedding') continue;
    rows.push({
      id: m.id,
      name: m.name,
      detail: m.present
        ? `${m.sub}${m.sizeGB !== null ? ` · ${m.sizeGB.toFixed(1)} GB` : ''}`
        : `Place a ${m.id.toUpperCase()} GGUF in the models folder`,
      badge: 'On-device',
      selectable: m.selectable,
    });
  }
  const b = registry.bedrock as { connected: boolean; region?: string };
  rows.push({
    id: 'bedrock',
    name: 'Claude · Bedrock',
    detail: b.connected ? `Connected · ${b.region} · structured output` : 'Quality upgrade for office + code',
    badge: b.connected ? 'Connected' : 'Add model',
    locked: !b.connected,
    selectable: b.connected,
  });
  return rows;
}

export function ModelMenu({
  registry,
  onSelect,
  onClose,
  onConnectBedrock,
}: {
  registry: ModelsRegistry;
  onSelect: (id: string) => void;
  onClose: () => void;
  onConnectBedrock: () => void;
}) {
  return (
    <div
      className="absolute bottom-12 right-0 rounded-xl py-1.5 z-20 shadow-2xl"
      style={{ width: 300, background: C.raised, border: `1px solid ${C.border}` }}
    >
      {buildRows(registry).map((m) => (
        <button
          key={m.id}
          onClick={() => {
            if (m.id === 'bedrock' && m.locked) {
              onConnectBedrock();
              onClose();
              return;
            }
            if (m.selectable) {
              onSelect(m.id);
              onClose();
            } else if (m.detail.startsWith('Place a')) {
              void api.revealModelsFolder();
            }
          }}
          className="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors"
          style={{ opacity: m.locked || !m.selectable ? 0.55 : 1 }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <span className="flex-1 min-w-0">
            <span className="flex items-center gap-2">
              <span className="text-sm font-medium" style={{ color: C.text, fontFamily: sans }}>
                {m.name}
              </span>
              <Badge
                color={m.id === 'bedrock' ? C.blue : C.green}
                dim={m.id === 'bedrock' ? C.blueDim : C.greenDim}
              >
                {m.badge}
              </Badge>
            </span>
            <span className="block text-xs truncate" style={{ color: C.mute, fontFamily: sans }}>
              {m.detail}
            </span>
          </span>
          {m.locked ? (
            <KeyRound size={14} style={{ color: C.mute }} />
          ) : registry.selected === m.id ? (
            <Check size={15} style={{ color: C.accent }} />
          ) : null}
        </button>
      ))}
      <div
        className="px-3 pt-1.5 mt-1 text-xs flex items-center gap-1.5"
        style={{ borderTop: `1px solid ${C.borderSoft}`, color: C.mute, fontFamily: sans }}
      >
        <Info size={12} />{' '}
        {(registry.bedrock as { connected: boolean }).connected
          ? 'Bedrock connected — select it to route chat + office through Claude.'
          : 'Click the Bedrock row to connect AWS credentials. Absent local rows reveal the models folder.'}
      </div>
    </div>
  );
}
