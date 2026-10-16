// The kit's look: colours, a type scale and spacing, for a stage whose long
// side is 1920 layout units. A reel overrides any of them with `theme`.
// ------------------------------------------------------------------

export interface Theme {
  /** the stage */
  paper: string;
  /** cards */
  card: string;
  /** a code well, a dimmed card */
  well: string;
  /** text, strongest to weakest */
  ink: string;
  ink2: string;
  ink3: string;
  /** hairlines and card edges */
  rule: string;
  /** the accent, its text colour (darker, for contrast) and its tint */
  accent: string;
  accentText: string;
  accentTint: string;
  /** text on the accent */
  onAccent: string;
  /** font families by role, as CSS lists */
  fonts: { sans: string; mono: string };
  /** weights the roles draw with */
  weights: { body: number; bold: number; black: number };
}

export const DEFAULT_THEME: Theme = {
  paper: "#fafaf7",
  card: "#ffffff",
  well: "#efeee9",
  ink: "#121212",
  ink2: "#3e3e3a",
  ink3: "#6e6e69",
  rule: "#d8d6cf",
  accent: "#d9662a",
  accentText: "#b84e14",
  accentTint: "#f6d9c6",
  onAccent: "#ffffff",
  fonts: { sans: "sans-serif", mono: "monospace" },
  weights: { body: 400, bold: 700, black: 900 },
};

/** A theme with `over` laid on the default, one level deep. */
export function mergeTheme(over: Partial<Theme> | undefined): Theme {
  if (!over) return DEFAULT_THEME;
  return {
    ...DEFAULT_THEME,
    ...over,
    fonts: { ...DEFAULT_THEME.fonts, ...over.fonts },
    weights: { ...DEFAULT_THEME.weights, ...over.weights },
  };
}

/** The type scale and spacing, in layout units of a 1920-long stage. */
export const SIZE = {
  display: 112,
  h1: 72,
  h2: 48,
  body: 36,
  small: 28,
  code: 30,
  stat: 168,
} as const;

/** The long side every layout is made at; other sizes are drawn scaled. */
export const LONG_SIDE = 1920;

/** How a text is set: which family and weight. */
export type FontRole = "sans" | "bold" | "black" | "mono";
