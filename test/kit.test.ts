import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { kit, kitBrief, kitSchema, morph, normalize, KitSpecError, card, row, title, arrow, scene, definePart, defineKata, f, textBox, type KitReelSpec } from "../src/kit/index.ts";
import { camAt, frameAt, layersAt, type Keyframe } from "../src/kit/engine.ts";
import { aim } from "../src/kit/reel.ts";
import { tokens, speechMs, sentences } from "../src/kit/text.ts";
import { loadCanvasEntry, nodeEnv, patchContext, registerFonts } from "../src/canvas/node.ts";
import { resolveView, type Context2D } from "../src/canvas/types.ts";
import { checkEntry } from "../src/kit-check.ts";
import { layoutScene, partBox, stageFrame } from "../src/kit/stage.ts";
import { loadYoga } from "../src/kit/layout.ts";
import { Fonts } from "../src/kit/text.ts";
import { mergeTheme, SIZE } from "../src/kit/theme.ts";
import { itemPaint } from "../src/kit/items.ts";
import { check } from "../src/kit/check.ts";
import type { Ctx } from "../src/kit/parts.ts";
import type { Bounds, Drawable } from "../src/kit/model.ts";
import type { PartSpec, SceneSpec } from "../src/kit/spec.ts";

const GEIST = resolve("examples/canvas/fonts/Geist.ttf");
const fonts = [{ family: "Geist", src: GEIST, weight: "100 900" }];
const theme = { fonts: { sans: "Geist", mono: "Geist" } };

const problems = (spec: unknown): string[] => {
  try {
    normalize(spec as KitReelSpec);
    return [];
  } catch (e) {
    if (e instanceof KitSpecError) return e.problems;
    throw e;
  }
};

describe("normalize", () => {
  it("expands a shape and gives every part an id, keeping the shape's", () => {
    const [cover, s2] = normalize({
      kit: 1,
      scenes: [
        { kata: "flow", title: "Steps", steps: ["a", "b"], at: 1 },
        { say: "two", parts: [{ type: "title", text: "T" }, { type: "card", body: "x" }, { type: "card", body: "y" }] },
      ],
    });
    expect(cover!.id).toBe("s1");
    expect(cover!.parts.map((p) => p.id)).toEqual(["title", "flow"]);
    const flow = cover!.parts[1] as { parts: { id: string; state?: string }[] };
    expect(flow.parts.map((p) => p.id)).toEqual(["flow.0", "flow.a1", "flow.1"]);
    expect(flow.parts[2]!.state).toBe("active");
    expect(s2!.parts.map((p) => p.id)).toEqual(["title", "card", "card.2"]);
  });

  it("says to quote text that YAML read as a map", () => {
    // say: ["Note: it moves"] unquoted in YAML
    const ps = problems({ kit: 1, scenes: [{ say: [{ Note: "it moves" }], parts: [{ type: "title", text: "T" }] }] });
    expect(ps).toEqual([expect.stringMatching(/^scenes\[0\]\.say: expected a string or a list of strings, got array .* \(YAML reads "a: b" as a map: put the text in quotes\)$/)]);
  });

  it("names every problem with its place, and suggests what a typo meant", () => {
    const ps = problems({
      kit: 1,
      scenes: [
        { kata: "flow", steps: ["a"] },
        { parts: [{ type: "crad", body: "x" }, { type: "card", bdoy: "x" }, { type: "stat", value: "3" }] },
        { kata: "nope" },
        { say: "nothing to show" },
      ],
    });
    expect(ps).toContain('scenes[0] (kata flow): "title" is required (the heading)');
    expect(ps.some((p) => p.includes('no part "crad" (did you mean "card"?)'))).toBe(true);
    expect(ps.some((p) => p.includes('unknown field "bdoy" (did you mean "body"?)'))).toBe(true);
    expect(ps.some((p) => p.includes('scenes[1].parts[2] (stat).value: expected a number, got string "3"'))).toBe(true);
    expect(ps.some((p) => p.startsWith('scenes[2].kata: no shape "nope"'))).toBe(true);
    expect(ps).toContain("scenes[3]: a scene needs kata or parts");
  });

  it("refuses a reel written for newer layout rules, and ids used twice", () => {
    expect(problems({ kit: 9, scenes: [{ parts: [] }] })[0]).toMatch(/newer than this kamishibai/);
    expect(problems({ kit: 1, scenes: [{ parts: [{ type: "text", id: "a", text: "x" }, { type: "text", id: "a", text: "y" }] }] })).toEqual([
      'scenes[0].parts[1]: the id "a" is used twice in this scene',
    ]);
  });
});

describe("text", () => {
  it("breaks Japanese between phrases, keeping kinsoku characters on their neighbour", () => {
    // Word boundaries come from the runtime's ICU, so only what the kit adds is pinned.
    const ts = tokens("期限切れの判定が、逆です");
    expect(ts.join("")).toBe("期限切れの判定が、逆です");
    expect(ts).toContain("判定が、");
    expect(ts.some((t) => t.startsWith("、") || /^[のがです]/.test(t))).toBe(false);
  });

  it("keeps a number with its counter, and words joined by a no-break space", () => {
    const ts = tokens("店名が4文字と同じ");
    expect(ts.join("")).toBe("店名が4文字と同じ");
    expect(ts.some((t) => t.startsWith("4文字"))).toBe(true);
    expect(tokens("≈\u00a010 ms")).toEqual(["≈\u00a010", " ", "ms"]);
    expect(tokens("a\u00a0b c")).toEqual(["a\u00a0b", " ", "c"]);
  });

  it("splits narration into sentences, but not at a decimal point", () => {
    expect(sentences("期限です。直します！ 終わり")).toEqual(["期限です。", "直します！", "終わり"]);
    expect(sentences('It costs 3.5 dollars. Then it stops! "Yes." Done')).toEqual(["It costs 3.5 dollars.", "Then it stops!", '"Yes."', "Done"]);
  });

  it("guesses a spoken length from the script", () => {
    expect(speechMs("あいうえおかきくけこさしすせそ")).toBe(2000);
    expect(speechMs("fourteen chars")).toBe(929);
  });
});

describe("kit", () => {
  it("times each scene to its narration and captions it", async () => {
    const reel = await kit({ kit: 1, fonts, theme, scenes: [{ say: "あいうえおかきくけこさしすせそ", parts: [title("A")] }, { ms: 1000, parts: [title("B")] }] });
    expect(reel.timing).toEqual([
      { id: "s1", start: 0, ms: 3100, say: [{ atMs: 400, ms: 2000, text: "あいうえおかきくけこさしすせそ", src: "" }] },
      { id: "s2", start: 3100, ms: 1000, say: [] },
    ]);
    expect(reel.meta).toMatchObject({ durationMs: 4100, width: 1920, height: 1080, aspect: { min: 9 / 16, max: 16 / 9 } });
    expect(reel.subtitles).toEqual([{ start: 400, end: 2400, text: "あいうえおかきくけこさしすせそ" }]);
    expect(reel.audio).toEqual([]);
  });

  it("moves a part kept under the same id, and repeats a settled scene's frames", async () => {
    const reel = await kit({
      kit: 1,
      fonts,
      theme,
      scenes: [
        { ms: 3000, parts: [row([card({ id: "a", body: "left" }), card({ id: "b", body: "right" })])] },
        { ms: 3000, parts: [row([card({ id: "b", body: "right" })])] },
      ],
    });
    await registerFonts(reel, ".");
    const env = await nodeEnv(".");
    const view = resolveView(reel.meta);
    const paint = await reel.setup(view, env);
    const g = patchContext(createCanvas(view.width, view.height).getContext("2d") as unknown as Context2D);
    const fp = (ms: number) => paint(g, ms);
    expect(typeof fp(2500)).toBe("string");
    expect(fp(2500)).toBe(fp(2900));
    expect(fp(3100)).not.toBe(fp(3200));
  });

  it("interpolates a moved drawable between keyframes", () => {
    const d = (x: number) => ({ t: "rect" as const, id: "a", owner: "a", x, y: 0, w: 10, h: 10, r: 0, o: 1 });
    const ks: Keyframe[] = [
      { id: "1", start: 0, ms: 1000, ds: [d(0)] },
      { id: "2", start: 1000, ms: 1000, ds: [d(100)] },
    ];
    const x = (t: number) => (frameAt(ks, t)[0] as { x: number }).x;
    expect(x(1000)).toBe(0);
    expect(x(1375)).toBeCloseTo(50, 0);
    expect(x(1750)).toBe(100);
  });

  it("says a scene sentence by sentence, and brings a cued part in with its sentence", async () => {
    const reel = await kit({
      kit: 1,
      fonts,
      theme,
      scenes: [{ say: "あいうえおかきくけこ。さしすせそたちつてと。", parts: [title("A"), { type: "text", id: "late", text: "B", cue: 1 }] }],
    });
    const [one, two] = reel.timing[0]!.say;
    expect(one).toMatchObject({ atMs: 400, ms: 1467, text: "あいうえおかきくけこ。" });
    expect(two).toMatchObject({ atMs: 400 + 1467 + 250, text: "さしすせそたちつてと。" });
    expect(reel.subtitles).toHaveLength(2);
    const env = await nodeEnv(".");
    const view = resolveView(reel.meta);
    const paint = await reel.setup(view, env);
    const g = patchContext(createCanvas(view.width, view.height).getContext("2d") as unknown as Context2D);
    // Before its sentence the frame is the title alone; after it, the cued text has come in.
    expect(paint(g, 1500)).toBe(paint(g, 2000));
    expect(paint(g, 2000)).not.toBe(paint(g, 3500));
  });

  it("burns captions into the picture with captions: burn, instead of a track", async () => {
    const reel = await kit({ kit: 1, fonts, theme, captions: "burn", scenes: [{ say: ["One sentence here.", "And another one."], parts: [title("A")] }] });
    expect(reel.subtitles).toBeUndefined();
    const env = await nodeEnv(".");
    const view = resolveView(reel.meta);
    const paint = await reel.setup(view, env);
    const g = patchContext(createCanvas(view.width, view.height).getContext("2d") as unknown as Context2D);
    const [one, two] = reel.timing[0]!.say;
    // Two frames under different sentences differ by their caption.
    expect(paint(g, one!.atMs + one!.ms - 10)).not.toBe(paint(g, two!.atMs + 10));
    expect(problems({ kit: 1, captions: "yes", scenes: [{ kata: "cover", title: "x" }] })).toEqual(['reel.captions: expected true, false or "burn", got "yes"']);
  });

  it("refuses a cue past the scene's sentences", () => {
    expect(problems({ kit: 1, scenes: [{ say: "one. two.", parts: [{ type: "text", text: "x", cue: 2 }] }] })[0]).toMatch(/cue: 2 is not a sentence of this scene's say \(it has 2/);
  });

  it("draws a figure from data, moving an item kept under its id", async () => {
    const box = (x: number, fill: string) => ({ id: "box", rect: [x, 10, 100, 60], fill, r: 8 });
    const reel = await kit({
      kit: 1,
      fonts,
      theme,
      scenes: [
        { ms: 2000, parts: [{ type: "figure", width: 400, height: 100, items: [box(0, "accent"), { text: "a", pos: [200, 30], align: "center" }] }] },
        { ms: 2000, parts: [{ type: "figure", width: 400, height: 100, items: [box(300, "ink3")] }] },
      ],
    });
    expect(await reel.check(resolveView(reel.meta), await nodeEnv("."))).toEqual([]);
    expect(problems({ kit: 1, scenes: [{ parts: [{ type: "figure", width: 1, height: 1, items: [{ rect: [0, 0] }, { circle: [0, 0, 1], line: [[0, 0], [1, 1]] }] }] }] })).toEqual([
      "scenes[0].parts[0] (figure).items[0].rect: expected [x, y, w, h]",
      "scenes[0].parts[0] (figure).items[1]: give one of rect, circle, line, text (got circle and line)",
    ]);
    expect(problems({ kit: 1, scenes: [{ parts: [{ type: "figure", width: 1, height: 1, items: [{ line: [[0, 0], [1, 1]], width: 4 }] }] }] })).toEqual([
      expect.stringMatching(/^scenes\[0\]\.parts\[0\] \(figure\)\.items\[0\]: unknown field "width"; an item takes .*lineWidth/),
    ]);
  });

  it("keeps a shape's fields apart from the scene's", () => {
    expect(() => defineKata<{ title: string; focus: string }>("spot", { doc: "", fields: { title: f.str(), focus: f.str() }, parts: (o) => [title(o.title)] })).toThrow(
      'defineKata("spot"): "focus" is a scene field',
    );
  });

  it("takes a part defined with definePart", async () => {
    definePart<{ id: string; label: string }>("badge", {
      doc: "a test badge",
      fields: { label: f.str("its text", true) },
      box: (s, ctx) => ({ style: { pad: 12 }, kids: [textBox(`${s.id}.t`, s.label, ctx)] }),
    });
    const reel = await kit({ kit: 1, fonts, theme, scenes: [scene("hi", [{ type: "badge", label: "new" }])] });
    const env = await nodeEnv(".");
    expect(await reel.check(resolveView(reel.meta), env)).toEqual([]);
    expect(problems({ kit: 1, scenes: [{ parts: [{ type: "badge" }] }] })).toEqual(['scenes[0].parts[0] (badge): "label" is required (its text)']);
  });
});

describe("transitions and the camera", () => {
  const rect = (id: string, x: number, more: object = {}) => ({ t: "rect" as const, id, owner: id, x, y: 0, w: 10, h: 10, r: 0, o: 1, ...more });
  const paper = rect("stage", 0, { w: 100, h: 100, enter: "none" as const });
  const two = (transition?: Keyframe["transition"]): Keyframe[] => [
    { id: "1", start: 0, ms: 1000, ds: [paper, rect("a", 0)] },
    { id: "2", start: 1000, ms: 1000, ds: [paper, rect("a", 50)], transition },
  ];

  it("moves what stays by default, and lays the scene before beside, under or behind the new one otherwise", () => {
    expect(layersAt(two(), 1350, 100)).toHaveLength(1);
    const cut = layersAt(two("cut"), 1001, 100);
    expect(cut).toHaveLength(1);
    // A cut shows the new scene whole at once, with nothing moving.
    expect((cut[0]!.ds[1] as { x: number }).x).toBe(50);
    const [old, now] = layersAt(two("push"), 1350, 100);
    expect(old!.dx).toBeLessThan(0);
    expect(now!.dx).toBeCloseTo(old!.dx! + 100);
    const wipe = layersAt(two("wipe"), 1350, 100);
    expect(wipe[1]!.clipW).toBeGreaterThan(0);
    expect(wipe[1]!.clipW).toBeLessThan(100);
    // A fade: the old scene goes out over the paper before the new parts come in.
    const fade = layersAt(two("fade"), 1200, 100);
    expect(fade).toHaveLength(2);
    expect(fade[0]!.ds.map((d) => d.id)).toEqual(["stage"]);
    expect(layersAt(two("fade"), 1800, 100)).toHaveLength(1);
  });

  it("brings a part in from a side, wiped on, or out of a blur", () => {
    const ks = (enter: string): Keyframe[] => [{ id: "1", start: 0, ms: 2000, ds: [rect("a", 0, { enter })] }];
    const at = (enter: string, t: number) => frameAt(ks(enter), t)[0]!;
    expect(at("from-left", 300).dx).toBeLessThan(0);
    expect(at("from-left", 1500).dx).toBeCloseTo(0);
    expect(at("from-bottom", 300).dy).toBeGreaterThan(0);
    expect(at("wipe", 400).reveal).toBeGreaterThan(0);
    expect(at("wipe", 400).reveal).toBeLessThan(1);
    expect(at("blur", 300).blur).toBeGreaterThan(0);
    expect(at("blur", 1500).blur).toBeCloseTo(0);
  });

  it("moves the camera from shot to shot, carrying it over a morph", () => {
    const home = { x: 50, y: 50, s: 1 };
    const close = { x: 20, y: 20, s: 2 };
    const ks: Keyframe[] = [
      { id: "1", start: 0, ms: 3000, ds: [paper], shots: [{ at: 0, cam: home }, { at: 1000, cam: close }] },
      { id: "2", start: 3000, ms: 3000, ds: [paper], shots: [{ at: 0, cam: home }] },
    ];
    expect(camAt(ks, 0, 500)).toEqual(home);
    expect(camAt(ks, 0, 2500)).toEqual(close);
    expect(camAt(ks, 0, 1450)!.s).toBeCloseTo(1.5, 1);
    // The next scene starts where the camera was and goes back home.
    expect(camAt(ks, 1, 0)).toEqual(close);
    expect(camAt(ks, 1, 2000)).toEqual(home);
  });

  it("frames a part as close as fits, never cutting it off, and keeps the stage filling the view", () => {
    const stage = { W: 1000, H: 1000 };
    const fr = { top: 0, right: 0, bottom: 0, left: 0 };
    const mid = { x: 500, y: 500 };
    expect(aim({ x: 450, y: 450, w: 100, h: 100 }, undefined, stage, fr, mid).s).toBe(2.5);
    expect(aim({ x: 100, y: 450, w: 800, h: 100 }, undefined, stage, fr, mid).s).toBeCloseTo(850 / 800);
    expect(aim({ x: 100, y: 450, w: 800, h: 100 }, 3, stage, fr, mid).s).toBeCloseTo(850 / 800);
    expect(aim({ x: 450, y: 450, w: 100, h: 100 }, 1.5, stage, fr, mid).s).toBe(1.5);
    // A part in the corner: the camera stops where the stage's edge meets the view's.
    expect(aim({ x: 0, y: 0, w: 100, h: 100 }, 2, stage, fr, mid)).toEqual({ x: 250, y: 250, s: 2 });
  });

  it("moves in on an item inside a figure, by the figure's id and the item's", async () => {
    const fig = { type: "figure", id: "map", width: 1600, height: 400, items: [{ id: "a", rect: [0, 0, 300, 300], fill: "#00f" }, { id: "b", rect: [1300, 100, 300, 300], fill: "#f00" }] };
    expect(problems({ kit: 1, scenes: [{ parts: [fig], focus: "map.c" }] })).toEqual(['scenes[0].focus: no part "map.c" in this scene (did you mean "map.a"?)']);
    const reel = await kit({ kit: 1, fonts, theme, captions: false, scenes: [{ say: "One. Two.", parts: [fig], focus: { on: "map.b", cue: 1 } }] });
    const view = resolveView(reel.meta);
    const paint = await reel.setup(view, await nodeEnv("."));
    const c = createCanvas(view.width, view.height);
    const g = patchContext(c.getContext("2d") as unknown as Context2D);
    const middle = (ms: number) => (paint(g, ms), [...c.getContext("2d").getImageData(view.width / 2, view.height / 2, 1, 1).data].slice(0, 3));
    // Before its sentence the middle of the frame is paper; once the camera is in, it is item b.
    expect(middle(reel.timing[0]!.say[1]!.atMs - 200)).not.toEqual([255, 0, 0]);
    expect(middle(reel.meta.durationMs - 100)).toEqual([255, 0, 0]);
  });

  it("gives the captions' room at the foot to the parts with captionRoom: false", async () => {
    const fig = { type: "figure", width: 1600, height: 900, items: [{ rect: [0, 0, 1600, 900], fill: "#f00" }] };
    const at = async (captionRoom: boolean, y: number) => {
      const reel = await kit({ kit: 1, fonts, theme, captionRoom, scenes: [{ ms: 2000, parts: [fig] }] });
      const view = resolveView(reel.meta);
      const paint = await reel.setup(view, await nodeEnv("."));
      const c = createCanvas(view.width, view.height);
      paint(patchContext(c.getContext("2d") as unknown as Context2D), 1900);
      return [...c.getContext("2d").getImageData(view.width / 2, y, 1, 1).data].slice(0, 3);
    };
    expect(await at(true, 900)).not.toEqual([255, 0, 0]);
    expect(await at(false, 900)).toEqual([255, 0, 0]);
  });

  it("moves a figure's item within its scene, with each sentence of its steps", async () => {
    // A red bar that grows across the figure as the second sentence starts.
    const fig = { type: "figure", width: 1600, height: 400, items: [{ id: "bar", rect: [0, 150, 100, 100], fill: "#f00", then: [{ cue: 1, rect: [0, 150, 1600, 100] }] }] };
    const reel = await kit({ kit: 1, fonts, theme, captions: false, scenes: [{ say: "One. Two.", fill: false, parts: [fig] }, { ms: 1500, fill: false, parts: [{ ...fig, items: [{ id: "bar", rect: [0, 150, 1600, 100], fill: "#f00" }] }] }] });
    const view = resolveView(reel.meta);
    const paint = await reel.setup(view, await nodeEnv("."));
    const c = createCanvas(view.width, view.height);
    const g = patchContext(c.getContext("2d") as unknown as Context2D);
    const right = (ms: number) => (paint(g, ms), [...c.getContext("2d").getImageData(view.width * 0.75, view.height / 2, 1, 1).data].slice(0, 3));
    const two = reel.timing[0]!.say[1]!.atMs;
    expect(right(two - 100)).not.toEqual([255, 0, 0]);
    expect(right(two + 900)).toEqual([255, 0, 0]);
    // The next scene starts from the bar as it ended, so it stays put.
    expect(right(reel.timing[1]!.start + 50)).toEqual([255, 0, 0]);
    // A frame mid-move differs from one after it.
    expect(paint(g, two + 300)).not.toBe(paint(g, two + 900));
  });

  it("checks an item's steps", () => {
    const sc = (then: unknown) => ({ kit: 1, scenes: [{ say: "One. Two.", parts: [{ type: "figure", width: 100, height: 100, items: [{ id: "a", rect: [0, 0, 10, 10], then }] }] }] });
    expect(problems(sc([{ cue: 1, circle: [5, 5, 5] }]))).toEqual([expect.stringMatching(/then\[0\]: a rect stays a rect, so its step can't give circle$/)]);
    expect(problems(sc([{ cue: 1, rect: [1, 1, 1, 1] }, { cue: 1, fill: "red" }]))).toEqual([expect.stringMatching(/then\[1\]\.cue: steps go in order, so this must be after 1$/)]);
    expect(problems(sc([{ cue: 3, rect: [1, 1, 1, 1] }]))).toEqual([expect.stringMatching(/figure\.a moves at cue 3, which is not a sentence of this scene's say \(it has 2\)$/)]);
    expect(problems(sc([{ rect: [1, 1, 1, 1] }]))).toEqual([expect.stringMatching(/then\[0\]\.cue: expected a sentence number$/)]);
  });

  it("checks where the camera goes and how a scene comes in", () => {
    const sc = (more: object) => ({ kit: 1, scenes: [{ say: "one. two.", parts: [{ type: "text", id: "word", text: "x" }], ...more }] });
    expect(problems(sc({ focus: "wrod" }))).toEqual(['scenes[0].focus: no part "wrod" in this scene (did you mean "word"?)']);
    expect(problems(sc({ focus: { on: "word", zoom: 0.5 } }))).toEqual(["scenes[0].focus.zoom: 0.5 is under 1 (the camera only moves in)"]);
    expect(problems(sc({ focus: [{ on: "word", cue: 1 }, { on: "word" }] }))).toEqual(["scenes[0].focus[1].cue: the camera moves in sentence order, so this cue must be after 1"]);
    expect(problems(sc({ transition: "dissolve" }))[0]).toMatch(/transition: "dissolve" is not one of "morph", "cut", "fade", "push", "wipe"/);
    expect(normalize(sc({ focus: [{ on: "word", cue: 1 }], transition: "push" }) as KitReelSpec)[0]).toMatchObject({ transition: "push", focus: [{ on: "word", cue: 1 }] });
  });
});

describe("filling the stage", () => {
  // A scene laid out on a stage, with Geist measured the way a render measures it.
  const lay = async (sc: SceneSpec, W = 1920, H = 1080) => {
    const reel = await kit({ kit: 1, fonts, theme, captions: false, scenes: [sc] });
    await registerFonts(reel, ".");
    await loadYoga();
    const [s] = normalize({ kit: 1, scenes: [sc] });
    const stage = { W, H };
    const ctx: Ctx = {
      stage,
      frame: stageFrame(stage, { top: 0, right: 0, bottom: 0, left: 0 }, false),
      fonts: new Fonts(patchContext(createCanvas(1, 1).getContext("2d") as unknown as Context2D), mergeTheme(theme)),
      theme: mergeTheme(theme),
      readText: () => "",
      image: () => undefined,
      child: (p, flow) => partBox(p as PartSpec & { id: string }, { ...ctx, flow }),
    };
    const boxes = new Map<string, Bounds>();
    const ds = layoutScene(s!, ctx, boxes);
    return { ds, boxes, text: (id: string) => ds.find((d) => d.id === id) as Extract<Drawable, { t: "text" }> };
  };

  it("grows a few short parts to fill the room under the heading, and leaves a full scene be", async () => {
    const sparse = await lay({ kata: "points", title: "Why", items: ["One", "Two"] });
    expect(sparse.text("points.0").size).toBeCloseTo(SIZE.body * 1.6);
    expect(sparse.text("title").size).toBe(SIZE.h1);
    const off = await lay({ kata: "points", title: "Why", items: ["One", "Two"], fill: false });
    expect(off.text("points.0").size).toBe(SIZE.body);
    const full = await lay({ kata: "points", title: "Why", items: Array.from({ length: 9 }, (_, i) => `Item number ${i}`) });
    expect(full.text("points.0").size).toBe(SIZE.body);
  });

  it("places the parts under the heading at an edge of their room, and grows them as large as fits with fill: max", async () => {
    const parts = [{ type: "card", id: "c", body: "A short card" }];
    // the room under the heading: 96 in from each side, 96 up from the foot (no captions here)
    const left = await lay({ parts, place: "left" });
    expect(left.boxes.get("c")!.x).toBeCloseTo(96, 0);
    const right = await lay({ parts, place: "right" });
    expect(right.boxes.get("c")!.x + right.boxes.get("c")!.w).toBeCloseTo(1920 - 96, 0);
    const bottom = await lay({ parts, place: "bottom" });
    expect(bottom.boxes.get("c")!.y + bottom.boxes.get("c")!.h).toBeCloseTo(1080 - 96, 0);
    // A wide figure: true stops at 90% of the room's width, max takes all of it.
    const fig = [{ type: "figure", id: "f", width: 1200, height: 300, items: [{ rect: [0, 0, 1200, 300] }] }];
    expect((await lay({ parts: fig })).boxes.get("f")!.w).toBeCloseTo((1920 - 192) * 0.9, 0);
    expect((await lay({ parts: fig, fill: "max" })).boxes.get("f")!.w).toBeCloseTo(1920 - 192, 0);
    expect(problems({ kit: 1, scenes: [{ parts, fill: "most", place: "middle" }] })).toEqual([
      'scenes[0].place: "middle" is not one of "center", "left", "right", "top", "bottom"',
      'scenes[0].fill: expected true, false or "max", got "most"',
    ]);
  });

  it("numbers a flow's steps, and ticks the ones done", async () => {
    const { ds } = await lay({ kata: "flow", title: "Steps", steps: ["Detect", "Read", "Check"], at: 1 });
    const ids = ds.map((d) => d.id);
    expect(ids).toContain("flow.0.tick");
    expect(ids).not.toContain("flow.0.n");
    expect(ids).toEqual(expect.arrayContaining(["flow.1.n", "flow.2.n"]));
  });

  it("keeps a row across a wide stage by wrapping its cards, and stacks it on a tall one", async () => {
    const parts = [row([card({ id: "a", label: "Card", body: "Holds your balance" }), arrow(), card({ id: "b", label: "Gate", body: "Reads it over radio" }), arrow(), card({ id: "c", label: "Station server", body: "Keeps the fare tables" })])];
    const wide = await lay({ parts });
    expect(wide.boxes.get("a")!.y).toBeCloseTo(wide.boxes.get("c")!.y);
    expect(wide.boxes.get("c")!.x + wide.boxes.get("c")!.w).toBeLessThanOrEqual(1920 - 96);
    const tall = await lay({ parts }, 1080, 1920);
    expect(tall.boxes.get("c")!.y).toBeGreaterThan(tall.boxes.get("a")!.y);
  });
});

describe("check", () => {
  const widows = (...texts: string[][]) => {
    const ds = texts.map((lines, i) => ({ t: "text", id: `t${i}`, owner: `t${i}`, x: 200, y: 200 + i * 200, w: 800, h: 120, lines, font: "sans", size: 44, lh: 1.3, track: 0, color: "#111", align: "start", o: 1, need: 0 }) as Drawable);
    const ks: Keyframe[] = [{ id: "s1", start: 0, ms: 1000, ds, cues: {} }];
    return check(ks, { W: 1920, H: 1080 }, { top: 0, right: 0, bottom: 0, left: 0 }, mergeTheme(theme)).filter((i) => i.kind === "widow").map((i) => i.msg.split(" ")[0]);
  };

  it("finds characters no font has", async () => {
    const reel = await kit({ kit: 1, fonts, theme, scenes: [{ parts: [title("Done ✗ é ²"), { type: "text", text: "↻ again ✗" }] }] });
    await registerFonts(reel, ".");
    const issues = await reel.check(resolveView(reel.meta), await nodeEnv("."));
    expect(issues.filter((i) => i.kind === "glyph").map((i) => i.msg.split(", which")[0])).toEqual(['title draws "✗" (U+2717)', 'text draws "↻" (U+21BB)']);
  });

  it("finds a word or a character or two left alone on a last line", () => {
    expect(widows(["Make every", "layer."], ["期限切れの判定が逆で", "す"], ["Server:", "nextDay"], ["Make every", "layer count"], ["It costs", "10"])).toEqual(["t0", "t1"]);
  });
});

describe("schema", () => {
  it("lists every part and shape, and leaves code-only parts out", () => {
    const s = kitSchema() as { required: string[]; $defs: { part: { oneOf: { properties: { type: { const: string } } }[] }; scene: { oneOf: unknown[] } } };
    const types = s.$defs.part.oneOf.map((p) => p.properties.type.const);
    expect(types).toEqual(expect.arrayContaining(["title", "text", "row", "col", "card", "arrow", "chip", "stat", "list", "image"]));
    expect(types).not.toContain("paint");
    expect(s.required).toEqual(["kit", "scenes"]);
    expect(JSON.stringify(s)).toContain('"const":"flow"');
  });

  it("gives every field a line per part and shape, a small fraction of the schema", () => {
    const b = kitBrief();
    expect(b).toContain("  flow: title*, steps* [..], at #, note");
    expect(b).toContain("  chip: text*, state (active|done)");
    expect(b).toMatch(/^Scene: .*transition \(morph\|cut\|fade\|push\|wipe\)/m);
    expect(b).not.toMatch(/^ {2}paint:/m);
    expect(b.length).toBeLessThan(JSON.stringify(kitSchema()).length / 5);
  });
});

describe("a JSON or YAML entry", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "kamishibai-kit-"));
    await writeFile(join(dir, "code.ts"), Array.from({ length: 10 }, (_, i) => `const line${i + 1} = ${i + 1};`).join("\n"));
    const yaml = `kit: 1
fonts: [{ family: Geist, src: ${JSON.stringify(GEIST)}, weight: "100 900" }]
theme: { fonts: { sans: Geist, mono: Geist } }
scenes:
  - { kata: cover, title: Hello, say: hello there }
  # a merge key: the scene takes the anchor's fields
  - <<: &code { kata: code, title: The code }
    code: "code.ts#L3-L5"
    highlight: line4
`;
    await writeFile(join(dir, "reel.yaml"), yaml);
    await writeFile(join(dir, "wide.json"), JSON.stringify({
      kit: 1, fonts: [{ family: "Geist", src: GEIST, weight: "100 900" }], theme,
      scenes: [{ parts: [row([card({ body: "a".repeat(30), width: 900 }), arrow(), card({ body: "b".repeat(30), width: 900 })], { narrow: "keep" })] }],
    }));
    await writeFile(join(dir, "chips.json"), JSON.stringify({
      kit: 1, fonts: [{ family: "Geist", src: GEIST, weight: "100 900" }], theme,
      scenes: [{ parts: [row(["≈ 10 ms", "≈ 20 ms", "≈ 40 ms", "≈ 80 ms"].map((text) => ({ type: "chip", text })))] }],
    }));
    await writeFile(join(dir, "plain.json"), JSON.stringify({ hello: 1 }));
    // A module of parts in a package that says it has no side effects: uses must still run it.
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "parts", type: "module", sideEffects: false }));
    await writeFile(join(dir, "dot.ts"), `import { definePart } from "kamishibai/kit";
definePart("dot", { doc: "a dot", fields: {}, box: (s) => ({ style: { w: 40, h: 40 }, paint: (r) => [{ t: "circle", id: s.id, cx: r.x + 20, cy: r.y + 20, r: 20, fill: "#d9662a", o: 1 }] }) });
`);
    await writeFile(join(dir, "uses.json"), JSON.stringify({ kit: 1, uses: ["dot.ts"], fonts: [{ family: "Geist", src: GEIST }], theme, scenes: [{ parts: [{ type: "dot" }] }] }));
    await writeFile(join(dir, "missing.json"), JSON.stringify({ kit: 1, uses: ["nope.ts"], scenes: [{ parts: [] }] }));
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it("loads as a canvas reel, reading files next to it", async () => {
    const e = await loadCanvasEntry(join(dir, "reel.yaml"));
    try {
      expect(e).not.toBeNull();
      expect(e!.reel.meta.durationMs).toBeGreaterThan(5000);
      expect((await checkEntry({ entry: join(dir, "reel.yaml") })).count).toBe(0);
    } finally {
      await e?.close();
    }
  });

  it("keeps a chip's label on one line, narrowing its row instead", async () => {
    const r = await checkEntry({ entry: join(dir, "chips.json") });
    expect(r.views.flatMap((v) => v.issues)).toEqual([]);
  });

  it("is checked for every shape, and a row kept too wide is caught", async () => {
    const r = await checkEntry({ entry: join(dir, "wide.json") });
    expect(r.views.map((v) => `${v.width}x${v.height}`)).toEqual(["1920x1080", "1080x1920"]);
    expect(r.views[1]!.issues.some((i) => i.kind === "overflow")).toBe(true);
  });

  it("runs the modules uses names, with the kit the reel is made with", async () => {
    expect((await checkEntry({ entry: join(dir, "uses.json") })).count).toBe(0);
    await expect(loadCanvasEntry(join(dir, "missing.json"))).rejects.toThrow(/uses names nope.ts, which is not there/);
  });

  it("says what a JSON file without kit is", async () => {
    await expect(loadCanvasEntry(join(dir, "plain.json"))).rejects.toThrow(/not a kit reel/);
  });
});

describe("morph", () => {
  // A context that records the rects it fills, by where they are.
  const recorder = () => {
    const filled: { x: number; y: number; w: number; fill: string }[] = [];
    const g = patchContext(createCanvas(400, 200).getContext("2d") as never) as Context2D;
    const roundRect = g.roundRect.bind(g);
    let last = { x: 0, y: 0, w: 0 };
    g.roundRect = ((x: number, y: number, w: number, h: number, r: number) => ((last = { x, y, w }), roundRect(x, y, w, h, r))) as never;
    const fill = g.fill.bind(g);
    g.fill = (() => (filled.push({ ...last, fill: String(g.fillStyle) }), fill())) as never;
    return { g, filled };
  };

  it("sets a text item in the mono font when asked", () => {
    const T = mergeTheme(theme);
    const fonts = new Fonts(patchContext(createCanvas(1, 1).getContext("2d") as unknown as Context2D), T);
    const font = (it: object) => (itemPaint({ text: "nextDay", pos: [0, 0], ...it }, { id: "t", o: 1 }, { x: 0, y: 0, k: 1 }, T, fonts) as { font: string }).font;
    expect([font({}), font({ bold: true }), font({ mono: true })]).toEqual(["sans", "bold", "mono"]);
  });

  it("moves an item within its keyframe by its steps' delays", async () => {
    const env = await nodeEnv(".");
    const m = morph([{ at: 0, items: [{ id: "dot", circle: [50, 100, 20], fill: "#f00", then: [{ delay: 1000, circle: [350, 100, 20] }] }] }], { env, width: 400, height: 200 });
    const c = createCanvas(400, 200);
    const g = patchContext(c.getContext("2d") as unknown as Context2D);
    const red = (ms: number, x: number) => (g.clearRect(0, 0, 400, 200), m.draw(g, ms), c.getContext("2d").getImageData(x, 100, 1, 1).data[0] === 255);
    expect([red(900, 50), red(900, 350)]).toEqual([true, false]);
    expect([red(2000, 50), red(2000, 350)]).toEqual([false, true]);
    expect(() => morph([{ at: 0, items: [{ circle: [1, 1, 1], then: [{ cue: 1, circle: [2, 2, 1] }] }] }], { env, width: 10, height: 10 })).toThrow(/then\[0\]: unknown field "cue"/);
  });

  it("moves an item kept under its id from one keyframe to the next", async () => {
    const env = await nodeEnv(".");
    const m = morph(
      [
        { at: 0, items: [{ id: "box", rect: [0, 50, 100, 40], fill: "accent" }] },
        { at: 1000, items: [{ id: "box", rect: [300, 50, 100, 40], fill: "accent" }] },
      ],
      { env, width: 400, height: 200 },
    );
    const xAt = (ms: number) => {
      const { g, filled } = recorder();
      m.draw(g, ms);
      return filled.at(-1)!.x;
    };
    expect(xAt(900)).toBe(0);
    expect(xAt(1000 + 375)).toBeGreaterThan(100);
    expect(xAt(1000 + 375)).toBeLessThan(200);
    expect(xAt(3000)).toBe(300);
    // Nothing changes once it has settled, so the painter can say so.
    expect(m.draw(recorder().g, 3000)).toBe(m.draw(recorder().g, 4000));
  });

  it("names what is wrong with its keyframes", async () => {
    const env = await nodeEnv(".");
    const bad = () => morph([{ at: 500, items: [{ rect: [0, 0, 1, 1], cue: 1 } as never] }, { at: 500, items: [{ text: "a" }] }], { env, width: 10, height: 10 });
    expect(bad).toThrow(KitSpecError);
    try {
      bad();
    } catch (e) {
      expect((e as KitSpecError).problems).toEqual([
        expect.stringMatching(/^frames\[0\]\.items\[0\]: unknown field "cue"; an item takes .*delay/),
        "frames[1].at: 500 is not after the keyframe before (500)",
        "frames[1].items[0]: a text needs text and pos: [x, y]",
      ]);
    }
  });

  it("checks its keyframes with no frame drawn", async () => {
    const env = await nodeEnv(".");
    const m = morph(
      [{ at: 0, items: [{ id: "box", rect: [140, 10, 100, 60], fill: "card" }, { id: "t", text: "a long label", pos: [190, 20], align: "center" }, { id: "far", circle: [395, 100, 20] }] }],
      { env, width: 400, height: 200 },
    );
    expect(m.check().map((i) => `${i.kind} ${i.msg.split(":")[0]}`)).toEqual(["overflow t spills out of box", "off-stage far reaches outside the safe area (375,80 40×40)"]);
  });
});
