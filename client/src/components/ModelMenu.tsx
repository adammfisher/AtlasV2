import { Check, KeyRound, Info } from 'lucide-react';
import { C, sans } from '../theme/tokens';
import { Badge } from './Badge';
import { type ModelsRegistry } from '../lib/api';

interface MenuRow {
  id: string;
  name: string;
  detail: string;
  badge: string;
  locked?: boolean;
  selectable: boolean;
}

const PROVIDER_LABEL: Record<string, string> = { bedrock: 'Bedrock', openai: 'OpenAI', anthropic: 'Anthropic' };

function buildRows(registry: ModelsRegistry): MenuRow[] {
  return registry.bedrockModels.map((m) => {
    const provider = m.provider ?? 'bedrock';
    const available = m.available ?? registry.bedrock.connected;
    const unavailDetail =
      provider === 'bedrock' ? 'Connect Amazon Bedrock to enable' : `Set the ${provider === 'openai' ? 'OpenAI' : 'Anthropic'} API key to enable`;
    return {
      id: m.id,
      name: m.name,
      detail: available ? m.sub : unavailDetail,
      badge: PROVIDER_LABEL[provider] ?? provider,
      locked: !available && provider === 'bedrock',
      selectable: available,
    };
  });
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
            if (m.locked) {
              onConnectBedrock();
              onClose();
              return;
            }
            if (!m.selectable) return; // API model without its key — not selectable
            onSelect(m.id);
            onClose();
          }}
          className="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors"
          style={{ opacity: m.locked || !m.selectable ? 0.55 : 1 }}
          onMouseEnter={(e) => (e.currentTarget.style.background = C.hoverWash)}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <span className="flex-1 min-w-0">
            <span className="flex items-center gap-2">
              <span className="text-sm font-medium" style={{ color: C.text, fontFamily: sans }}>
                {m.name}
              </span>
              <Badge color={C.blue} dim={C.blueDim}>
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
        {registry.bedrock.connected
          ? 'Your selection runs everything — routing, chat, and document generation.'
          : 'Pick a model to connect AWS credentials (Amazon Bedrock).'}
      </div>
    </div>
  );
}
