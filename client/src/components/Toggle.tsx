import { C } from '../theme/tokens';

export function Toggle({
  on,
  onClick,
  disabled,
}: {
  on: boolean;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="relative rounded-full transition-colors flex-shrink-0"
      style={{
        width: 36,
        height: 20,
        background: on ? C.accent : C.raised,
        opacity: disabled ? 0.45 : 1,
        border: `1px solid ${on ? C.accent : C.border}`,
      }}
    >
      <span
        className="absolute rounded-full transition-all"
        style={{ width: 14, height: 14, top: 2, left: on ? 18 : 2, background: on ? '#fff' : C.sub }}
      />
    </button>
  );
}
