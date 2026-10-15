import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { capture } from "../src/render.ts";
import { loadCanvasEntry, patchContext, registerFonts } from "../src/canvas/node.ts";
import { parseAspect, parseInsets, resolveView, splitFontWeight, viewKey, type CanvasReel } from "../src/canvas/types.ts";
import { readManifest } from "../src/incremental.ts";
import { exportHtml } from "../src/canvas/export.ts";
import { optionsFromQuery } from "../src/canvas/browser.ts";

const GEIST = resolve("examples/canvas/fonts/Geist.ttf");
const BROWSER = resolve("src/canvas/browser.ts");

describe("resolveView", () => {
  const meta = { fps: 30, durationMs: 1000, width: 1920, height: 1080, aspect: { min: 9 / 16, max: 16 / 9 } };

  it("defaults to meta's size, for a video, with no insets", () => {
    expect(resolveView(meta)).toEqual({ width: 1920, height: 1080, pixelRatio: 1, medium: "video", insets: { top: 0, right: 0, bottom: 0, left: 0 } });
  });

  it("keeps the long side for an aspect", () => {
    expect(resolveView(meta, { aspect: "9:16" })).toMatchObject({ width: 1080, height: 1920 });
    expect(resolveView(meta, { aspect: 1 })).toMatchObject({ width: 1920, height: 1920 });
  });

  it("rounds to even sizes", () => {
    expect(resolveView(meta, { aspect: "4:3" })).toMatchObject({ width: 1920, height: 1440 });
    expect(resolveView(meta, { size: { width: 1001, height: 999 } })).toMatchObject({ width: 1002, height: 1000 });
  });

  it("refuses a shape outside meta.aspect", () => {
    expect(() => resolveView(meta, { aspect: "21:9" })).toThrow(/meta.aspect/);
    expect(() => resolveView({ ...meta, aspect: undefined }, { aspect: "9:16" })).toThrow(/meta.aspect/);
  });

  it("keys a view by everything that changes its pixels", () => {
    const a = resolveView(meta);
    expect(viewKey(a)).not.toBe(viewKey({ ...a, insets: { ...a.insets, bottom: 300 } }));
    expect(viewKey(a)).not.toBe(viewKey({ ...a, pixelRatio: 2 }));
  });
});

describe("parsing", () => {
  it("reads aspects and insets", () => {
    expect(parseAspect("9:16")).toBeCloseTo(0.5625);
    expect(parseAspect("1.5")).toBe(1.5);
    expect(() => parseAspect("tall")).toThrow();
    expect(parseInsets("10")).toEqual({ top: 10, right: 10, bottom: 10, left: 10 });
    expect(parseInsets("1,2,3,4")).toEqual({ top: 1, right: 2, bottom: 3, left: 4 });
    expect(() => parseInsets("1,2")).toThrow();
  });

  it("splits any weight off a font, keeping the nearest hundred for Skia", () => {
    expect(splitFontWeight("650 48px Geist, sans-serif")).toEqual({ weight: 650, rounded: "700 48px Geist, sans-serif", families: ["Geist", "sans-serif"] });
    expect(splitFontWeight('italic bold 20px "Geist Mono"')).toMatchObject({ weight: 700, families: ["Geist Mono"] });
    expect(splitFontWeight("12px serif")).toMatchObject({ weight: 400 });
  });
});

describe("the Node context", () => {
  const reel = { meta: { fps: 1, durationMs: 1, width: 1, height: 1 }, fonts: [{ family: "GeistTest", src: GEIST, weight: "100 900" }], setup: () => () => {} } as CanvasReel;
  beforeAll(() => registerFonts(reel, "/"));
  const ctx = () => patchContext(createCanvas(10, 10).getContext("2d") as never);

  it("draws a variable font at any weight", () => {
    const g = ctx();
    const width = (w: number) => ((g.font = `${w} 100px GeistTest`), g.measureText("Kamishibai").width);
    const [w600, w650, w700] = [width(600), width(650), width(700)];
    expect(w650).toBeGreaterThan(w600);
    expect(w650).toBeLessThan(w700);
    expect(g.font).toBe("700 100px GeistTest");
  });

  it("places textBaseline as browsers do, on the em box scaled to the font size", () => {
    const g = ctx();
    g.font = "100px GeistTest";
    const a = g.measureText("x");
    const emA = (100 * a.fontBoundingBoxAscent) / (a.fontBoundingBoxAscent + a.fontBoundingBoxDescent);
    g.textBaseline = "middle";
    expect(g.measureText("x").alphabeticBaseline).toBeCloseTo(-(emA - (100 - emA)) / 2, 5);
    g.textBaseline = "top";
    expect(g.measureText("x").alphabeticBaseline).toBeCloseTo(-emA, 5);
  });

  it("keeps the font and baseline across save and restore", () => {
    const g = ctx();
    g.font = "300 20px GeistTest";
    g.textBaseline = "middle";
    g.save();
    g.font = "900 40px GeistTest";
    g.textBaseline = "top";
    g.restore();
    expect(g.font).toBe("300 20px GeistTest");
    expect(g.textBaseline).toBe("middle");
  });
});

describe("capture of a canvas reel", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "kamishibai-canvas-test-"));
    // Left half orange for the first second, then all grey (a fingerprint), in
    // a reel that lays out for wide and tall.
    await writeFile(
      join(dir, "reel.ts"),
      `import { canvasReel } from ${JSON.stringify(BROWSER)};
export default canvasReel({
  meta: { fps: 4, durationMs: 2000, width: 64, height: 36, aspect: { min: 9 / 16, max: 16 / 9 } },
  fonts: [{ family: "Geist", src: ${JSON.stringify(GEIST)} }],
  setup(view, env) {
    const note = env.readText("note.txt");
    return (g, ms) => {
      g.fillStyle = "#888888";
      g.fillRect(0, 0, view.width, view.height);
      if (ms < 1000) { g.fillStyle = "#ff0000"; g.fillRect(0, 0, view.width / 2, view.height); return; }
      g.font = "10px Geist";
      g.fillStyle = "#888888";
      g.fillText(note, 0, 0);
      return "grey:" + note;
    };
  },
});
`,
    );
    await writeFile(join(dir, "note.txt"), "hello");
    await writeFile(join(dir, "page.ts"), `(window as any).kamishibai = { meta: { fps: 1, durationMs: 1000, width: 8, height: 8 }, seek() {} };`);
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  const pixel = async (file: string, x: number, y: number) => {
    const img = await loadImage(await readFile(file));
    const c = createCanvas(img.width, img.height);
    c.getContext("2d").drawImage(img, 0, 0);
    return [...c.getContext("2d").getImageData(x, y, 1, 1).data.slice(0, 3)];
  };

  it("leaves a page entry alone, without running it", async () => {
    expect(await loadCanvasEntry(join(dir, "page.ts"))).toBeNull();
  });

  it("paints every frame on the CPU, with the view and the reel's files", async () => {
    const framesDir = join(dir, "frames");
    const cap = await capture({ entry: join(dir, "reel.ts"), framesDir, workers: 2 });
    expect(cap.frames).toBe(8);
    expect(cap.view).toMatchObject({ width: 64, height: 36, medium: "video" });
    expect((await readdir(framesDir)).filter((f) => f.endsWith(".png"))).toHaveLength(8);
    expect(await pixel(join(framesDir, "f000000.png"), 2, 2)).toEqual([255, 0, 0]);
    expect(await pixel(join(framesDir, "f000000.png"), 60, 2)).toEqual([136, 136, 136]);
    expect(await pixel(join(framesDir, "f000007.png"), 2, 2)).toEqual([136, 136, 136]);
    expect(cap.prints.get(7)).toBe("grey:hello");
    expect((await readManifest(framesDir))?.view).toBe(viewKey(cap.view!));
  });

  it("lays out for another shape", async () => {
    const cap = await capture({ entry: join(dir, "reel.ts"), framesDir: join(dir, "tall"), aspect: "9:16", workers: 1 });
    expect(cap.meta).toMatchObject({ width: 36, height: 64 });
    const img = await loadImage(await readFile(join(dir, "tall", "f000000.png")));
    expect([img.width, img.height]).toEqual([36, 64]);
  });

  it("refuses view options for a page", async () => {
    await expect(capture({ entry: join(dir, "page.ts"), framesDir: join(dir, "p"), aspect: "9:16" })).rejects.toThrow(/canvas reels/);
  });
});


describe("export", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "kamishibai-export-test-"));
    await writeFile(join(dir, "note.txt"), "quoted <b>text</b>");
    await writeFile(
      join(dir, "reel.ts"),
      `import { canvasReel } from ${JSON.stringify(BROWSER)};
export default canvasReel({
  meta: { fps: 2, durationMs: 1000, width: 64, height: 36, title: "Test reel" },
  fonts: [{ family: "Geist", src: ${JSON.stringify(GEIST)}, weight: "100 900" }],
  setup(view, env) {
    const note = env.readText("note.txt");
    return (g, ms) => { g.font = "10px Geist"; g.fillText(ms < 500 ? "AB" : "CD", 0, 20); void note; };
  },
});
`,
    );
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it("writes one HTML file with the files read and only the glyphs drawn", async () => {
    const out = join(dir, "reel.html");
    const r = await exportHtml({ entry: join(dir, "reel.ts"), out });
    const html = await readFile(out, "utf8");
    expect(html).toContain("<title>Test reel</title>");
    expect(html).toContain("data:font/woff2;base64,");
    // The quoted file is embedded, with "<" escaped so it can't close the script.
    expect(html).toContain("quoted \\u003cb>text\\u003c/b>");
    expect(html).not.toContain(dir);
    expect(r.parts.fonts).toBeGreaterThan(0);
    // Four glyphs of a 165 KB variable font.
    expect(r.parts.fonts).toBeLessThan(8_000);
    expect(r.frames).toBe(2);
  });

  it("plays once unless --loop says otherwise, with --gif-loop's values", async () => {
    const loopOf = async (loop?: number) => {
      const out = join(dir, `loop${loop}.html`);
      await exportHtml({ entry: join(dir, "reel.ts"), out, bare: true, loop });
      return JSON.parse(/<script type="application\/json" id="kamishibai-data">(.*?)<\/script>/s.exec(await readFile(out, "utf8"))![1]!).loop;
    };
    expect(await loopOf()).toBe(false);
    expect(await loopOf(-1)).toBe(false);
    expect(await loopOf(0)).toBe(true);
    expect(await loopOf(2)).toBe(2);
  });

  it("refuses a page", async () => {
    await writeFile(join(dir, "page.ts"), `(window as any).kamishibai = {};`);
    await expect(exportHtml({ entry: join(dir, "page.ts"), out: join(dir, "p.html") })).rejects.toThrow(/canvas reel/);
  });
});

describe("optionsFromQuery", () => {
  it("lets the URL change the file's defaults", () => {
    const d = { controls: false, loop: false as const, autoplay: false };
    expect(optionsFromQuery("", d)).toEqual(d);
    expect(optionsFromQuery("?controls=1&autoplay=1&loop=0&t=12.5&muted=1", d)).toEqual({ controls: true, autoplay: true, loop: true, startMs: 12500, muted: true });
    expect(optionsFromQuery("?loop=-1", { loop: true })).toEqual({ loop: false });
    expect(optionsFromQuery("?loop=3&t=4s")).toEqual({ loop: 3, startMs: 4000 });
  });

  it("leaves out what doesn't parse", () => {
    const warn = console.warn;
    const seen: string[] = [];
    console.warn = (m: string) => void seen.push(m);
    try {
      expect(optionsFromQuery("?loop=-2&t=soon&controls=maybe&loop=", { loop: 2 })).toEqual({ loop: 2 });
    } finally {
      console.warn = warn;
    }
    expect(seen).toEqual(["kamishibai: ignoring ?controls=maybe", "kamishibai: ignoring ?loop=-2", "kamishibai: ignoring ?t=soon"]);
  });
});
