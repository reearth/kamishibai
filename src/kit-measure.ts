// Text widths as a kit reel measures them, for a script that writes a reel
// (a generator placing figure items by hand): the reel's font files,
// registered as a render registers them, and its theme's families and
// weights. In a figure, an item's edge ("syl1.right") does this for you.
// ------------------------------------------------------------------
import { loadSkia, patchContext, registerFonts } from "./canvas/node.ts";
import type { CanvasReel, Context2D, FontSource } from "./canvas/types.ts";
import { Fonts } from "./kit/text.ts";
import { mergeTheme, SIZE, type FontRole, type ThemeSpec } from "./kit/theme.ts";

export interface TextMeasurerOptions {
  /** the reel's font files, as its `fonts` lists them */
  fonts?: FontSource[];
  /** the reel's theme: its font families and weights */
  theme?: ThemeSpec;
  /** the folder the font paths are relative to (default: the working directory) */
  dir?: string;
}

/** How wide `text` is at `size` in the font `font` plays (sans, bold, black, mono): its widest line, in the same units as the size. */
export type MeasureText = (text: string, o?: { size?: number; font?: FontRole }) => number;

/**
 * A function that measures text as a kit reel with these fonts and theme
 * draws it. The width is in the units of the size, so a figure's text of
 * `size: 64` measured at 64 is its width in the figure's units.
 */
export async function textMeasurer(o: TextMeasurerOptions = {}): Promise<MeasureText> {
  const { createCanvas } = await loadSkia();
  await registerFonts({ fonts: o.fonts } as CanvasReel, o.dir ?? process.cwd());
  const fonts = new Fonts(patchContext(createCanvas(1, 1).getContext("2d") as unknown as Context2D), mergeTheme(o.theme));
  return (text, m = {}) => Math.max(0, ...text.split("\n").map((l) => fonts.measure(l, m.font ?? "sans", m.size ?? SIZE.body)));
}

/** One text's width, as textMeasurer measures it. */
export async function measureText(text: string, o: TextMeasurerOptions & { size?: number; font?: FontRole } = {}): Promise<number> {
  return (await textMeasurer(o))(text, o);
}
