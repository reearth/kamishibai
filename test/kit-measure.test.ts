import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { measureText, textMeasurer } from "../src/index.ts";
import { patchContext } from "../src/canvas/node.ts";
import { resolveItems } from "../src/kit/items.ts";
import { Fonts } from "../src/kit/text.ts";
import { mergeTheme } from "../src/kit/theme.ts";
import type { Context2D } from "../src/canvas/types.ts";

const fonts = [{ family: "Geist", src: resolve("examples/canvas/fonts/Geist.ttf"), weight: "100 900" }];
const theme = { fonts: { sans: "Geist", mono: "Geist" } };

describe("measuring text for a script that writes a reel", () => {
  it("measures as the kit draws, so a number placed with it matches an edge in a figure", async () => {
    const measure = await textMeasurer({ fonts, theme });
    const re = measure("re", { size: 64 });
    expect(re).toBeGreaterThan(40);
    // Bolder is wider, a longer line is the width, and the size scales it.
    expect(measure("re", { size: 64, font: "black" })).toBeGreaterThan(re);
    expect(measure("re\nreceipt", { size: 64 })).toBe(measure("receipt", { size: 64 }));
    expect(measure("re", { size: 128 })).toBeCloseTo(re * 2, 0);
    expect(await measureText("re", { fonts, theme, size: 64 })).toBe(re);
    // The same as a figure's "syl1.right".
    const F = new Fonts(patchContext(createCanvas(1, 1).getContext("2d") as unknown as Context2D), mergeTheme(theme));
    const [, two] = resolveItems([{ id: "syl1", text: "re", pos: [100, 0], size: 64 }, { text: "CEIPT", pos: ["syl1.right", 0], size: 64 }], F);
    expect(two!.pos![0]).toBeCloseTo(100 + re);
  });
});
