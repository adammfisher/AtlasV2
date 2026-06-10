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
        width: 34,
        height: 20,
        background: on ? C.accent : C.raise2,
        opacity: disabled ? 0.4 : 1,
        border: `1px solid ${on ? C.accent : C.border}`,
      }}
    >
      <span
        className="absolute top-0.5 rounded-full transition-all"
        style={{ width: 14, height: 14, left: on ? 17 : 2, background: on ? '#fff' : C.dim }}
      />
    </button>
  );
}
