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
  /** font families by role, as CSS lists: bold and black (headings) take sans's unless given */
  fonts: { sans: string; mono: string; bold?: string; black?: string };
  /** weights the roles draw with: mono takes body's unless given */
  weights: { body: number; bold: number; black: number; mono?: number };
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

/**
 * What a reel writes as its theme: any of the theme's fields (fonts and
 * weights a key at a time), and colours of its own, named, to use as
 * `fill: brand` wherever a colour goes.
 */
export type ThemeSpec = Partial<Omit<Theme, "fonts" | "weights">> & {
  fonts?: Partial<Theme["fonts"]>;
  weights?: Partial<Theme["weights"]>;
  [colour: string]: unknown;
};

/** A theme with `over` laid on the default, one level deep. */
export function mergeTheme(over: ThemeSpec | undefined): Theme {
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
  display: 120,
  h1: 76,
  h2: 56,
  body: 44,
  small: 32,
  code: 30,
  stat: 200,
} as const;

/** The least a scene's parts are shrunk to fit their room; past it, check says what spills. */
export const MIN_FIT = 0.5;

/** The long side every layout is made at; other sizes are drawn scaled. */
export const LONG_SIDE = 1920;

/** How a text is set: which family and weight. */
export type FontRole = "sans" | "bold" | "black" | "mono";
