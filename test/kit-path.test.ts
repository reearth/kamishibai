import { describe, it, expect } from "vitest";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { kit, normalize, KitSpecError } from "../src/kit/index.ts";
import { svgVector } from "../src/kit/svg.ts";
import { nodeEnv, patchContext, registerFonts } from "../src/canvas/node.ts";
import { resolveView, type Context2D } from "../src/canvas/types.ts";
import { tempDir } from "./temp.ts";

const fonts = [{ family: "Geist", src: resolve("examples/canvas/fonts/Geist.ttf"), weight: "100 900" }];
const theme = { fonts: { sans: "Geist", mono: "Geist" }, signal: "#ff0000" };
const CHECK = "M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z";
// An outline icon as Lucide writes one: fill none, a stroke, its shapes as elements.
const OUTLINE = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/><line x1="2" y1="2" x2="22" y2="2"/><rect x="2" y="2" width="4" height="4" rx="1"/><polyline points="1 1 2 2 3 1"/></svg>`;

const problems = (spec: unknown): string[] => {
  try {
    normalize(spec as never);
    return [];
  } catch (e) {
    return e instanceof KitSpecError ? e.problems : [String(e)];
  }
};

describe("a figure's path item", () => {
  it("reads an SVG file as one path: filled, or drawn with lines as the file says", () => {
    const filled = svgVector(`<svg viewBox="0 0 24 24"><path d="${CHECK}"/></svg>`);
    expect(filled).toEqual({ d: CHECK, vx: 0, vy: 0, vw: 24, vh: 24 });
    const outline = svgVector(OUTLINE);
    expect(outline.lineWidth).toBe(2);
    expect(outline.d.split(/(?=M)/).length).toBe(5);
    expect(outline.d).toContain("M7 8a5 5 0 1 0 10 0");
    expect(outline.d).toContain("M2 2L22 2");
    expect(outline.d).toContain("M1 1L2 2L3 1");
    // A path that starts with a relative "m" (Lucide writes many) stays where the file puts it.
    const joined = svgVector(`<svg viewBox="0 0 24 24" fill="none" stroke="#000"><path d="M10 15H6"/><path d="m14.3 16.5.9-.4"/></svg>`);
    expect(joined.d).toBe("M10 15H6 M0 0m14.3 16.5.9-.4");
    expect(() => svgVector("<svg><g transform='scale(2)'><path d='M0 0L1 1'/></g></svg>", "a.svg")).toThrow(/a\.svg has a transform/);
    expect(() => svgVector("<svg viewBox='0 0 1 1'></svg>", "b.svg")).toThrow(/b\.svg has no shapes/);
    expect(() => svgVector("not svg", "c.svg")).toThrow(/c\.svg is not an SVG file/);
  });

  it("draws path data and an .svg file in the theme's colours, where pos and size put it", async () => {
    const dir = await tempDir("kamishibai-path-");
    await writeFile(join(dir, "user.svg"), OUTLINE);
    const reel = await kit({
      kit: 1, fonts, theme, captions: false,
      scenes: [{ ms: 3000, margin: 0, fill: false, parts: [{ type: "figure", width: 1920, height: 1080, items: [
        { id: "ok", path: CHECK, pos: [100, 100], size: 240, fill: "signal" },
        { id: "user", path: "user.svg", pos: ["ok.right+100", 100], size: 240, color: "signal" },
      ] } as never] }],
    });
    const env = await nodeEnv(dir);
    await registerFonts(reel, ".");
    const view = resolveView(reel.meta);
    const paint = await reel.setup(view, env);
    const c = createCanvas(view.width, view.height);
    paint(patchContext(c.getContext("2d") as unknown as Context2D), 2900);
    const red = (x0: number, y0: number, w: number, h: number) => {
      const d = c.getContext("2d").getImageData(x0, y0, w, h).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i]! > 200 && d[i + 1]! < 60 && d[i + 2]! < 60) n++;
      return n;
    };
    // The check fills its box, the outline icon is drawn beside it with lines, and nothing is red elsewhere.
    expect(red(100, 100, 240, 240)).toBeGreaterThan(3000);
    expect(red(440, 100, 240, 240)).toBeGreaterThan(2000);
    expect(red(800, 0, 1120, 1080)).toBe(0);
    expect(await reel.check(view, env)).toEqual([]);
  });

  it("names what is wrong with a path item", () => {
    const fig = (items: unknown[]) => ({ kit: 1, scenes: [{ parts: [{ type: "figure", width: 100, height: 100, items }] }] });
    expect(problems(fig([
      { path: "icons/check.png", pos: [0, 0] },
      { path: CHECK },
      { path: "a.svg", pos: [0, 0], view: 24 },
      { path: CHECK, pos: [0, 0], view: [24, 0], size: -1 },
    ]))).toEqual([
      'scenes[0].parts[0] (figure).items[0].path: expected path data ("M…") or an .svg file next to the reel',
      "scenes[0].parts[0] (figure).items[1]: a path needs pos: [x, y], its top-left corner (top-centre with align: center)",
      "scenes[0].parts[0] (figure).items[2].view: only path data takes view (an .svg file has its own viewBox)",
      "scenes[0].parts[0] (figure).items[3].size: expected how tall it is, in the figure's units",
      "scenes[0].parts[0] (figure).items[3].view: expected the path's own size, 24, or [w, h]",
    ]);
  });
});
