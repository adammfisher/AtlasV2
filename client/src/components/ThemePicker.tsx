import { useEffect, useRef, useState } from 'react';
import { Check, Palette } from 'lucide-react';
import { C, sans, THEMES, THEME_NAMES, type ThemeName } from '../theme/tokens';

/** Palette picker for the sidebar account row. Replaces the old light/dark
 * toggle — light is now just one palette among five. */
export function ThemePicker({
  theme,
  onPick,
}: {
  theme: ThemeName;
  onPick: (t: ThemeName) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative ml-auto" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="p-1 rounded"
        title="Theme"
        aria-haspopup="menu"
        aria-expanded={open}
        style={{ color: C.mute }}
      >
        <Palette size={15} />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Theme"
          className="absolute bottom-full mb-2 right-0 z-50 rounded-xl py-1 min-w-[172px]"
          style={{ background: C.raised, border: `1px solid ${C.border}`, boxShadow: C.shadowMenu }}
        >
          {THEME_NAMES.map((name) => {
            const active = name === theme;
            return (
              <button
                key={name}
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  onPick(name);
                  setOpen(false);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-left"
                style={{ color: active ? C.text : C.sub, fontFamily: sans }}
                onMouseEnter={(e) => (e.currentTarget.style.background = C.hoverWash)}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                {/* The one place literal palette hex is correct: a swatch has to
                    show the theme it offers, not the one currently applied, so
                    var() would render every swatch identically. */}
                <span
                  className="flex items-center justify-center flex-shrink-0"
                  style={{
                    width: 13,
                    height: 13,
                    borderRadius: 999,
                    background: THEMES[name].bg,
                    border: `1px solid ${THEMES[name].borderStrong}`,
                  }}
                >
                  <span style={{ width: 6, height: 6, borderRadius: 999, background: THEMES[name].accent }} />
                </span>
                <span className="flex-1">{THEMES[name].label}</span>
                {active && <Check size={12} style={{ color: C.accent }} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
