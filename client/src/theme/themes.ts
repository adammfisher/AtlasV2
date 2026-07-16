/* Single source of truth for every color in Atlas.
 *
 * Nothing here is imported by components. `vite.config.ts` reads this file and
 * compiles it into `virtual:atlas-theme.css`, which Vite emits as a blocking
 * <link> in the document head — that is what makes the vars available on the
 * very first paint. `theme/tokens.ts` maps the same contract to var() strings
 * for the inline styles the components actually use. */

/** Palette contract. Kebab-cased keys become the CSS custom properties. */
export type Palette = {
  label: string;
  scheme?: 'light' | 'dark';
  bg: string;
  panel: string;
  elevated: string;
  border: string;
  borderStrong: string;
  textPrimary: string;
  textSecondary: string;
  textFaint: string;
  accent: string;
  accentHover: string;
  accentActive: string;
  accentContrast: string;
  navActiveBg: string;
};

export const THEMES = {
  ember: {
    label: 'Ember',
    bg: '#16130F', panel: '#201B15', elevated: '#2A2319',
    border: '#342C20', borderStrong: '#443A2A',
    // textFaint (placeholders/timestamps) is lightened across all five palettes
    // to clear AA 4.5:1 on the lightest surface it sits on (elevated for the
    // dark themes, bg for daylight). It stays the dimmest tier — below
    // textSecondary — so the primary/secondary/faint hierarchy is preserved.
    textPrimary: '#F4EDE1', textSecondary: '#A6957D', textFaint: '#938B7D',
    accent: '#E8804D', accentHover: '#F0946A', accentActive: '#D06E3C',
    accentContrast: '#2A1508', navActiveBg: '#2C2419',
  },
  glacier: {
    label: 'Glacier',
    bg: '#0C1117', panel: '#141B22', elevated: '#1C242E',
    border: '#232C37', borderStrong: '#313D4B',
    textPrimary: '#E5EDF4', textSecondary: '#8593A4', textFaint: '#838C96',
    accent: '#35D0BE', accentHover: '#4FDCCC', accentActive: '#2BB4A4',
    accentContrast: '#04211D', navActiveBg: '#1C242E',
  },
  nocturne: {
    label: 'Nocturne',
    bg: '#0F0D16', panel: '#191625', elevated: '#221E33',
    border: '#2B2740', borderStrong: '#3A3556',
    textPrimary: '#ECE9F4', textSecondary: '#978FB2', textFaint: '#8C86A0',
    // Ramp darkened from the original #8A6DFF/#9D85FF/#7355E6 so white button
    // labels clear AA (4.5:1) on every state. The original spanned too wide a
    // lightness range for any single contrast color — the light hover failed
    // white text (2.90) while the dark active failed dark text — so the accent
    // itself had to move. Same blue-purple hue, deeper; contrast stays white.
    accent: '#755DD8', accentHover: '#7A61E0', accentActive: '#6852C0',
    accentContrast: '#FFFFFF', navActiveBg: '#221E33',
  },
  terra: {
    label: 'Terra',
    bg: '#0F130E', panel: '#191E16', elevated: '#222A1D',
    border: '#2A3123', borderStrong: '#384330',
    textPrimary: '#EBEEE4', textSecondary: '#93A086', textFaint: '#899381',
    accent: '#D8A93B', accentHover: '#E6B94F', accentActive: '#BC9026',
    accentContrast: '#241A03', navActiveBg: '#222A1D',
  },
  daylight: {
    label: 'Daylight',
    scheme: 'light',
    bg: '#F6F2EB', panel: '#FFFFFF', elevated: '#FCFAF6',
    border: '#E4DDD0', borderStrong: '#D2C9B8',
    // On a light theme, secondary and faint text both have to be dark enough to
    // clear AA, which squeezes them together. To keep three legible tiers,
    // secondary is pushed well past AA (5.8:1 on bg) and faint sits just above
    // the line (4.6:1), leaving a visible step between nav labels and timestamps.
    textPrimary: '#211D16', textSecondary: '#635D54', textFaint: '#736C63',
    // Original ramp put the lighter hover (#D96513) at 3.61:1 for white text.
    // Base is darkened for margin and hover kept as the lightest state but under
    // the AA ceiling, so white passes on all three. Same burnt-orange hue.
    accent: '#B24F0B', accentHover: '#BC5811', accentActive: '#A2450A',
    accentContrast: '#FFFFFF', navActiveBg: '#EFE9DE',
  },
} satisfies Record<string, Palette>;

export type ThemeName = keyof typeof THEMES;

export const DEFAULT_THEME: ThemeName = 'ember';

export const THEME_NAMES = Object.keys(THEMES) as ThemeName[];

export function isThemeName(v: unknown): v is ThemeName {
  return typeof v === 'string' && v in THEMES;
}

/* Status hues are deliberately NOT per-palette. `colorToken` in the connector
 * and skill manifests encodes meaning — green is "connected", amber is
 * "needs attention" — and meaning must not drift when the user picks a
 * different decoration. Only the scheme (light vs dark) varies, so these stay
 * legible on their background. Values carried over from the pre-token palette.
 *
 * `red` is the sandbox traffic-light dot only — never a state — and holds one
 * value across both schemes for the same reason a real traffic light does. */
const STATUS = {
  dark: { green: '#8fbf7f', blue: '#82a8c8', purple: '#a995c9', amber: '#d4ad6a', red: '#c97c70' },
  light: { green: '#4d8a3b', blue: '#3f6f9c', purple: '#7460a0', amber: '#a3782c', red: '#c97c70' },
} as const;

/* Scrims and menu shadows stay black in both schemes (a light scrim reads as
 * fog, not depth) but a light UI needs far less of them. */
const CHROME = {
  dark: { scrim: 'rgba(0,0,0,0.55)', shadowMenu: '0 8px 30px rgba(0,0,0,0.4)' },
  light: { scrim: 'rgba(0,0,0,0.35)', shadowMenu: '0 8px 30px rgba(0,0,0,0.14)' },
} as const;

const kebab = (k: string) => k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);

function paletteBlock(name: ThemeName): string {
  const p: Palette = THEMES[name];
  const scheme = p.scheme ?? 'dark';
  const lines = [`color-scheme: ${scheme};`];

  for (const [key, value] of Object.entries(p)) {
    if (key === 'label' || key === 'scheme') continue;
    lines.push(`--${kebab(key)}: ${value};`);
  }
  for (const [hue, value] of Object.entries(STATUS[scheme])) {
    lines.push(`--status-${hue}: ${value};`);
  }
  for (const [key, value] of Object.entries(CHROME[scheme])) {
    lines.push(`--${kebab(key)}: ${value};`);
  }

  // `:root` doubles as the fallback so an unknown or legacy data-theme value
  // still renders a complete palette instead of a page with no vars at all.
  const selector = name === DEFAULT_THEME ? `:root,\n[data-theme='${name}']` : `[data-theme='${name}']`;
  return `${selector} {\n  ${lines.join('\n  ')}\n}`;
}

/** Compile the palettes to CSS. Called from vite.config.ts at build/serve. */
export function buildThemeCss(): string {
  const palettes = THEME_NAMES.map(paletteBlock).join('\n\n');

  /* Derived once, for every palette: these read var(--accent)/var(--text-primary)
   * off the same element the palette landed on, so they re-resolve for free on
   * a theme swap. --hover-wash inverts automatically — dark text on a light
   * theme yields a dark wash. */
  const derived = `:root {
  /* Rendered-markdown chrome (code wash, table rules) is deliberately a neutral
   * gray rather than a palette tint: it sits behind model output in every theme
   * and reads as chrome, not decoration. One channel triple, alpha applied per
   * use in index.css, so it stays tunable from here. */
  --md-neutral: 140 140 140;
  --accent-dim: color-mix(in srgb, var(--accent) 14%, transparent);
  --hover-wash: color-mix(in srgb, var(--text-primary) 6%, transparent);
  --status-green-dim: color-mix(in srgb, var(--status-green) 13%, transparent);
  --status-blue-dim: color-mix(in srgb, var(--status-blue) 13%, transparent);
  --status-purple-dim: color-mix(in srgb, var(--status-purple) 13%, transparent);
  --status-amber-dim: color-mix(in srgb, var(--status-amber) 13%, transparent);
}`;

  return `/* GENERATED from src/theme/themes.ts — edit that file, not this output. */\n\n${palettes}\n\n${derived}\n`;
}
