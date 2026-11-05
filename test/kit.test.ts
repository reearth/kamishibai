import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { kit, kitBrief, kitSchema, morph, normalize, KitSpecError, card, row, title, arrow, scene, definePart, defineKata, f, textBox, type KitReelSpec } from "../src/kit/index.ts";
import { camAt, enteredMs, frameAt, layersAt, settleMs, type Keyframe } from "../src/kit/engine.ts";
import { aim } from "../src/kit/reel.ts";
import { tokens, speechMs, sentences, parseMarks, lineMarks } from "../src/kit/text.ts";
import { loadCanvasEntry, nodeEnv, patchContext, registerFonts } from "../src/canvas/node.ts";
import { resolveView, type Context2D } from "../src/canvas/types.ts";
import { checkEntry } from "../src/kit-check.ts";
import { bundleOptions } from "../src/serve.ts";
import { build } from "esbuild";
import { layoutScene, partBox, stageFrame } from "../src/kit/stage.ts";
import { loadYoga } from "../src/kit/layout.ts";
import { Fonts } from "../src/kit/text.ts";
import { mergeTheme, SIZE } from "../src/kit/theme.ts";
import { itemPaint } from "../src/kit/items.ts";
import { check } from "../src/kit/check.ts";
import { parseColour } from "../src/kit/colour.ts";
import type { Ctx } from "../src/kit/parts.ts";
import { bbox, type Bounds, type Drawable } from "../src/kit/model.ts";
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

  it("takes a transition and an enter written out, the reel's under the scene's", () => {
    const [a, b, c] = normalize({
      kit: 1,
      transition: { type: "fade", ms: 200 },
      enter: { delay: 0, stagger: 80 },
      scenes: [
        { parts: [{ type: "title", text: "T" }] },
        { transition: { ms: 300 }, enter: { ms: 250 }, parts: [{ type: "row", enter: { delay: 500 }, parts: [{ type: "card", body: "x" }, { type: "card", body: "y", enter: { type: "pop", ms: 100 } }] }] },
        { transition: "cut", parts: [{ type: "text", text: "t", enter: "fade" }] },
      ],
    });
    expect([a!.transition, a!.transMs, a!.enter]).toEqual(["fade", 200, { delay: 0, stagger: 80 }]);
    expect([b!.transition, b!.transMs, b!.enter]).toEqual(["fade", 300, { delay: 0, stagger: 80, ms: 250 }]);
    // A name is the type alone: the reel's ms still holds.
    expect([c!.transition, c!.transMs]).toEqual(["cut", 200]);
    // The parts inside take the row's timing; a part's own fields go over it, and its enter is left as the verb.
    expect(Object.fromEntries(b!.enters)).toEqual({ row: { delay: 500 }, card: { delay: 500 }, "card.2": { delay: 500, ms: 100 } });
    const row = b!.parts[0] as unknown as { enter?: string; parts: Array<{ enter?: string }> };
    expect([row.enter, row.parts[0]!.enter, row.parts[1]!.enter]).toEqual([undefined, undefined, "pop"]);
    expect(c!.parts[0]!.enter).toBe("fade");
    expect(c!.enters.size).toBe(0);
  });

  it("names what is wrong in a transition or an enter written out", () => {
    expect(problems({
      kit: 1,
      transition: { type: "dissolve" },
      scenes: [{ transition: { ms: -1 }, enter: { wait: 1 }, parts: [{ type: "title", text: "T", enter: { type: "rise", ms: "fast" } }, { type: "text", text: "t", enter: 3 }] }],
    })).toEqual([
      'reel.transition.type: "dissolve" is not one of "morph", "cut", "fade", "push", "wipe"',
      "scenes[0].transition.ms: -1 is under 0",
      'scenes[0].enter: unknown field "wait"',
      'scenes[0].parts[0] (title).enter.ms: expected a number, got string "fast"',
      "scenes[0].parts[1] (text).enter: expected a string or an object, got number 3",
    ]);
  });

  it("says to quote text that YAML read as a map", () => {
    // say: ["Note: it moves"] unquoted in YAML
    const ps = problems({ kit: 1, scenes: [{ say: [{ Note: "it moves" }], parts: [{ type: "title", text: "T" }] }] });
    expect(ps).toEqual(['scenes[0].say[0]: expected a sentence, got {"Note":"it moves"} (YAML reads "a: b" as a map: put the text in quotes)']);
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

  it("sets each role in its own family and weight, or sans's and body's", () => {
    const g = createCanvas(1, 1).getContext("2d") as unknown as Context2D;
    const css = (over: object) => (["sans", "bold", "black", "mono"] as const).map((r) => new Fonts(g, mergeTheme(over)).css(r, 10));
    expect(css({ fonts: { sans: "Geist", mono: "Mono" } })).toEqual(["400 10px Geist", "700 10px Geist", "900 10px Geist", "400 10px Mono"]);
    expect(css({ fonts: { sans: "Geist", mono: "Mono", black: "Fraunces" }, weights: { mono: 700 } })).toEqual(["400 10px Geist", "700 10px Geist", "900 10px Fraunces", "700 10px Mono"]);
  });

  it("plays a scene's sounds from its start or from a sentence's, on the measured clock", async () => {
    const reel = await kit({
      kit: 1, fonts, theme, pace: { lead: 100, gap: 1000 },
      scenes: [
        { ms: 2000, parts: [title("A")] },
        { say: ["あいうえお。", "かきくけこ。"], sounds: [{ src: "click.wav" }, { src: "click.wav", at: 250, gain: -6 }, { src: "ding.wav", cue: 1, at: 50 }], parts: [title("B")] },
      ],
    });
    const [, b] = reel.timing;
    expect(reel.audio!.filter((c) => !c.label?.includes("#"))).toEqual([
      { src: "click.wav", atMs: b!.start, label: "s2 sound 0" },
      { src: "click.wav", atMs: b!.start + 250, gain: -6, label: "s2 sound 1" },
      { src: "ding.wav", atMs: b!.say[1]!.atMs + 50, label: "s2 sound 2" },
    ]);
    expect(problems({ kit: 1, scenes: [{ say: "one.", sounds: [{ at: 10 }, { src: "a.wav", cue: 3 }, "b.wav"], parts: [title("A")] }] })).toEqual([
      'scenes[0].sounds[0]: "src" is required (a sound file, relative to the reel)',
      "scenes[0].sounds[1].cue: 3 is not a sentence of this scene's say (it has 1)",
      'scenes[0].sounds[2]: expected { src, at?, cue?, gain? }, got "b.wav"',
    ]);
  });

  it("times narration by the pace and each line's pause, and speaks a line as written out", async () => {
    const reel = await kit({
      kit: 1, fonts, theme, pace: { lead: 100, gap: 1000 },
      scenes: [{ pace: { tail: 2000 }, say: ["あいうえお。", { text: "かきくけこ。", caption: "書き", pause: 50 }, "さしすせそ。"], parts: [title("A")] }],
    });
    const [a, b, c] = reel.timing[0]!.say;
    expect(a!.atMs).toBe(100);
    expect(b).toMatchObject({ atMs: 100 + a!.ms + 1000, text: "書き" });
    expect(c!.atMs).toBe(b!.atMs + b!.ms + 50);
    expect(reel.timing[0]!.ms).toBe(c!.atMs + c!.ms + 2000);
    // A pause on the last sentence is the time after it, instead of the tail.
    const last = await kit({ kit: 1, fonts, theme, scenes: [{ pace: { tail: 2000 }, say: ["あいうえお。", { text: "かきくけこ。", pause: 3000 }], parts: [title("A")] }] });
    const z = last.timing[0]!.say[1]!;
    expect(last.timing[0]!.ms).toBe(z.atMs + z.ms + 3000);
    expect(problems({ kit: 1, pace: { lead: "x" }, scenes: [{ parts: [title("A")], say: [{ text: "a", speed: 2 }] }] })).toEqual([
      "reel.pace.lead: expected a number, got string \"x\"",
      'scenes[0].say[0]: unknown field "speed"',
    ]);
  });

  it("passes the music's fades, trim and ducking through, and takes any provider's voice", async () => {
    const reel = await kit({ kit: 1, fonts, theme, music: { src: "m.mp3", fadeInMs: 800, trimStartMs: 2000, duck: { amountDb: -20 } }, scenes: [{ parts: [title("A")] }] });
    expect(reel.audio?.find((a) => a.label === "music")).toMatchObject({ fadeInMs: 800, fadeOutMs: 1500, trimStartMs: 2000, duck: { amountDb: -20 } });
    // A provider the kit doesn't know is a --tts-adapter's: no error, and lengths estimated with no host to synthesize.
    await expect(kit({ kit: 1, fonts, theme, voice: { provider: "mine", voice: "x" }, scenes: [{ say: "Hello.", parts: [title("A")] }] })).resolves.toBeTruthy();
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

describe("marks", () => {
  it("takes the runs between paired ** out of the text, and leaves a lone ** be", () => {
    expect(parseMarks("re·**ceipt**")).toEqual({ plain: "re·ceipt", marks: [[3, 8]] });
    expect(parseMarks("**HEAD**quar**TERS**")).toEqual({ plain: "HEADquarTERS", marks: [[0, 4], [8, 12]] });
    expect(parseMarks("2 ** 10")).toEqual({ plain: "2 ** 10", marks: [] });
    expect(parseMarks("a **b** c ** d")).toEqual({ plain: "a b c ** d", marks: [[2, 3]] });
    // Counted in code points, so a character outside the BMP is one.
    expect(parseMarks("𝑥 **漢字**")).toEqual({ plain: "𝑥 漢字", marks: [[2, 4]] });
  });

  it("follows the marks onto the lines the text breaks into", () => {
    const { plain, marks } = parseMarks("one **two three** four");
    expect(lineMarks(plain, marks, ["one two", "three four"])).toEqual([[[4, 7]], [[0, 5]]]);
    expect(lineMarks(plain, marks, ["one", "two three four"])).toEqual([[], [[0, 9]]]);
  });

  it("draws the marked runs in the mark's colour, and checks their contrast", async () => {
    const make = (mark?: string) => kit({ kit: 1, fonts, theme: { ...theme, accentText: "#ff0000" }, captions: false, scenes: [{ ms: 2000, fill: false, parts: [{ type: "text", role: "display", text: "ab**CD**", ...(mark ? { mark } : {}) }] }] });
    const reel = await make();
    const view = resolveView(reel.meta);
    const paint = await reel.setup(view, await nodeEnv("."));
    const c = createCanvas(view.width, view.height);
    paint(patchContext(c.getContext("2d") as unknown as Context2D), 1900);
    const data = c.getContext("2d").getImageData(0, 0, view.width, view.height).data;
    // "ab" in ink, then "CD" in red: every red pixel right of every ink one.
    let [red, ink, inkMaxX, redMinX] = [0, 0, -1, Infinity];
    for (let i = 0; i < data.length; i += 4) {
      const x = (i / 4) % view.width;
      if (data[i]! > 200 && data[i + 1]! < 60 && data[i + 2]! < 60) (red++, (redMinX = Math.min(redMinX, x)));
      if (data[i]! < 60 && data[i + 1]! < 60 && data[i + 2]! < 60) (ink++, (inkMaxX = Math.max(inkMaxX, x)));
    }
    expect(red).toBeGreaterThan(500);
    expect(ink).toBeGreaterThan(500);
    expect(redMinX).toBeGreaterThan(inkMaxX);
    const pale = await make("#f4f4f0");
    const issues = await pale.check(view, await nodeEnv("."));
    expect(issues.map((i) => i.msg)).toEqual([expect.stringMatching(/^text's marked text is 1\.\d\d:1 on #fafaf7/)]);
  });

  it("crossfades a text whose marks change, and moves one whose marks stay", () => {
    const t = (marks?: Array<Array<[number, number]>>) => ({ t: "text" as const, id: "w", owner: "w", x: 0, y: 0, w: 100, h: 50, lines: ["receipt"], font: "sans" as const, size: 40, lh: 1.2, track: 0, color: "#000000", align: "start" as const, o: 1, need: 0, ...(marks ? { marks, mark: "#ff0000" } : {}) });
    const ks = (a: ReturnType<typeof t>, b: ReturnType<typeof t>): Keyframe[] => [
      { id: "1", start: 0, ms: 1000, ds: [a] },
      { id: "2", start: 1000, ms: 1000, ds: [{ ...b, x: 50 }] },
    ];
    const ids = (k: Keyframe[]) => frameAt(k, 1300).map((d) => d.id);
    expect(ids(ks(t([[[2, 7]]]), t([[[2, 7]]])))).toEqual(["w"]);
    expect(ids(ks(t(), t([[[2, 7]]])))).toContain("w~");
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

  it("styles burned captions with captionStyle", async () => {
    const reel = await kit({ kit: 1, fonts, theme: { ...theme, signal: "#ff0000" }, captions: "burn", captionStyle: { box: "signal", color: "#000" }, scenes: [{ say: "One sentence here.", parts: [title("A")] }] });
    const view = resolveView(reel.meta);
    const paint = await reel.setup(view, await nodeEnv("."));
    const c = createCanvas(view.width, view.height);
    paint(patchContext(c.getContext("2d") as unknown as Context2D), reel.timing[0]!.say[0]!.atMs + 100);
    // Just inside the top of the box at the foot, above the text.
    expect([...c.getContext("2d").getImageData(view.width / 2, 940, 1, 1).data].slice(0, 3)).toEqual([255, 0, 0]);
  });

  it("draws a progress bar at the foot that fills as the reel plays", async () => {
    const make = (progress: KitReelSpec["progress"]) => kit({ kit: 1, fonts, theme: { ...theme, accent: "#ff0000" }, captions: false, progress, scenes: [{ ms: 2000, parts: [title("A")] }, { ms: 2000, parts: [title("B")] }] });
    const reel = await make(true);
    const view = resolveView(reel.meta);
    const paint = await reel.setup(view, await nodeEnv("."));
    const c = createCanvas(view.width, view.height);
    const g = patchContext(c.getContext("2d") as unknown as Context2D);
    const px = (t: number, x: number, y: number) => {
      paint(g, t);
      return [...c.getContext("2d").getImageData(x, y, 1, 1).data].slice(0, 3);
    };
    const foot = c.height - 1;
    // A quarter through, the first quarter of the foot is filled; past it, the paper.
    expect(px(1000, c.width * 0.2, foot)).toEqual([255, 0, 0]);
    expect(px(1000, c.width * 0.3, foot)).not.toEqual([255, 0, 0]);
    expect(px(3900, c.width * 0.9, foot)).toEqual([255, 0, 0]);
    // A frame that fills it further differs, even with the scene settled.
    expect(paint(g, 1700)).not.toBe(paint(g, 1900));
    const top = await make({ at: "top", size: 40, color: "#0000ff", track: "#00ff00" });
    const paintTop = await top.setup(view, await nodeEnv("."));
    paintTop(g, 1000);
    const at = (x: number, y: number) => [...c.getContext("2d").getImageData(x, y, 1, 1).data].slice(0, 3);
    expect(at(c.width * 0.2, 2)).toEqual([0, 0, 255]);
    expect(at(c.width * 0.8, 2)).toEqual([0, 255, 0]);
    expect(problems({ kit: 1, progress: { size: 0, at: "side" }, scenes: [{ kata: "cover", title: "x" }] })).toEqual([
      "reel.progress.size: 0 is under 1",
      'reel.progress.at: "side" is not one of "bottom", "top"',
    ]);
    expect(problems({ kit: 1, progress: "yes", scenes: [{ kata: "cover", title: "x" }] })).toEqual(['reel.progress: expected true, false or { color?, size?, at?, track? }, got "yes"']);
  });

  it("paints an overlay over every scene, keeping its room clear of the parts", async () => {
    const seen: Array<{ ms: number; W: number; durationMs: number; scenes: number }> = [];
    const overlay = (fingerprint: boolean) => ({
      room: { bottom: 540 },
      paint: (g: Context2D, ms: number, o: { W: number; H: number; durationMs: number; timing: readonly unknown[] }) => {
        seen.push({ ms, W: o.W, durationMs: o.durationMs, scenes: o.timing.length });
        g.fillStyle = "#00ff00";
        g.fillRect(0, o.H - 20, 20, 20);
        return fingerprint ? "same" : undefined;
      },
    });
    const reel = await kit({ kit: 1, fonts, theme, captions: false, overlay: overlay(true), scenes: [{ ms: 3000, fill: "max", parts: [{ type: "text", role: "display", text: "Hello" }] }] });
    const view = resolveView(reel.meta);
    const paint = await reel.setup(view, await nodeEnv("."));
    const c = createCanvas(view.width, view.height);
    const g = patchContext(c.getContext("2d") as unknown as Context2D);
    expect(paint(g, 2500)).toBe(paint(g, 2900));
    expect(seen.at(-1)).toEqual({ ms: 2900, W: 1920, durationMs: 3000, scenes: 1 });
    // Its corner, and nothing of the parts below the middle (its room).
    expect([...c.getContext("2d").getImageData(5, view.height - 5, 1, 1).data].slice(0, 3)).toEqual([0, 255, 0]);
    const lower = c.getContext("2d").getImageData(40, view.height / 2 + 4, view.width - 80, view.height / 2 - 60).data;
    const paper = [...lower.slice(0, 3)];
    let ink = 0;
    for (let i = 0; i < lower.length; i += 4) if (lower[i] !== paper[0] || lower[i + 1] !== paper[1] || lower[i + 2] !== paper[2]) ink++;
    expect(ink).toBe(0);
    expect((await reel.check(view, await nodeEnv("."))).length).toBe(0);
    // With no fingerprint, every frame is drawn.
    const bare = await kit({ kit: 1, fonts, theme, captions: false, overlay: overlay(false), scenes: [{ ms: 3000, parts: [title("A")] }] });
    expect((await bare.setup(view, await nodeEnv(".")))(g, 2900)).toBeUndefined();
    expect(problems({ kit: 1, overlay: { room: { top: -1 } }, scenes: [{ kata: "cover", title: "x" }] })).toEqual([
      'reel.overlay: "paint" is required ((g, ms, { W, H, durationMs, timing }) => fingerprint | void)',
      "reel.overlay.room.top: -1 is under 0",
    ]);
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
      expect.stringMatching(/^scenes\[0\]\.parts\[0\] \(figure\)\.items\[0\]\.width: only a text takes width \(where it wraps\); a line's or an outline's is lineWidth$/),
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
    // A fade crossfades: the new scene is there whole, under the old one going out.
    const fade = layersAt(two("fade"), 1200, 100);
    expect(fade).toHaveLength(2);
    expect(fade[0]!.ds.map((d) => [d.id, d.o])).toEqual([["stage", 1], ["a", 1]]);
    expect(fade[1]!.o).toBeGreaterThan(0);
    expect(layersAt(two("fade"), 1800, 100)).toHaveLength(1);
  });

  it("takes a transition's length", () => {
    const at = (tr: Keyframe["transition"], transMs: number, t: number) => {
      const ks = two(tr);
      ks[1]!.transMs = transMs;
      return layersAt(ks, t, 100);
    };
    expect(at("fade", 200, 1150)).toHaveLength(2);
    expect(at("fade", 200, 1250)).toHaveLength(1);
    expect(at("push", 200, 1150)).toHaveLength(2);
    expect(at("push", 200, 1250)).toHaveLength(1);
    // A morph of 300 ms has what stays where it ends up by then (750 by default).
    expect((at("morph", 300, 1300)[0]!.ds[1] as { x: number }).x).toBeCloseTo(50);
    expect((at(undefined, 750, 1300)[0]!.ds[1] as { x: number }).x).toBeLessThan(50);
    expect((at("morph", 0, 1000)[0]!.ds[1] as { x: number }).x).toBe(50);
  });

  it("brings new parts in when the scene or the part says, over the length it says", () => {
    const ks = (more: Partial<Keyframe>): Keyframe[] => [
      { id: "1", start: 0, ms: 1000, ds: [paper] },
      { id: "2", start: 1000, ms: 3000, ds: [paper, rect("b", 0), rect("c", 0)], ...more },
    ];
    const o = (k: Keyframe[], t: number, id: string) => frameAt(k, t).find((d) => d.id === id)?.o ?? 0;
    // By default new parts wait for what stays to mostly move (55% of 750 ms), and the next starts 160 later.
    expect(o(ks({}), 1300, "b")).toBe(0);
    // A delay of 0 and 200 ms each: the first is in by 200, the next 160 after it.
    const quick = ks({ enter: { delay: 0, ms: 200 } });
    expect(o(quick, 1200, "b")).toBe(1);
    expect(o(quick, 1200, "c")).toBeLessThan(1);
    expect(o(quick, 1360, "c")).toBe(1);
    expect(o(ks({ enter: { delay: 0, ms: 200, stagger: 0 } }), 1200, "c")).toBe(1);
    // A part's own delay, and its own length.
    const own = ks({ enters: { c: { delay: 900, ms: 100 } } });
    expect(o(own, 1890, "c")).toBe(0);
    expect(o(own, 2000, "c")).toBe(1);
    // In a cut a part with a delay of its own still comes in.
    const cut = ks({ transition: "cut", enters: { c: { delay: 900 } } });
    expect(o(cut, 1001, "b")).toBe(1);
    expect(o(cut, 1500, "c")).toBe(0);
  });

  it("crossfades a fade's parts in with it, but for those cued or given a delay", () => {
    const ks = (more: Partial<Keyframe>): Keyframe[] => [
      { id: "1", start: 0, ms: 1000, ds: [paper, rect("a", 0)] },
      { id: "2", start: 1000, ms: 900, ds: [paper, rect("b", 0), rect("c", 0), rect("d", 0)], transition: "fade", transMs: 200, cues: { d: 500 }, ...more },
    ];
    const o = (k: Keyframe[], t: number, id: string) => frameAt(k, t).find((d) => d.id === id)?.o ?? 0;
    expect(o(ks({}), 1001, "b")).toBe(1);
    // A cued part still comes in with its sentence, and one with a delay of its own at it.
    expect(o(ks({}), 1300, "d")).toBe(0);
    expect(o(ks({ enters: { c: { delay: 300 } } }), 1200, "c")).toBe(0);
    // Nothing comes in with the scene: it is all in at once.
    expect(enteredMs(ks({}), 1)).toBe(0);
    expect(enteredMs(ks({ enters: { c: { delay: 300, ms: 100 } } }), 1)).toBe(400);
  });

  it("waits for its longest part before its frames repeat", () => {
    const ks = (more: Partial<Keyframe>): Keyframe[] => [{ id: "1", start: 0, ms: 9000, ds: [paper, rect("b", 0)], ...more }];
    expect(settleMs(ks({ enters: { b: { ms: 4000 } } }), 0)).toBeGreaterThan(settleMs(ks({}), 0) + 2000);
    expect(settleMs(ks({ enters: { b: { delay: 3000 } } }), 0)).toBeGreaterThan(3000);
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
    // A zoom goes past the default cap, but never so far that the part is cut off.
    expect(aim({ x: 480, y: 480, w: 40, h: 40 }, 6, stage, fr, mid).s).toBe(6);
    expect(aim({ x: 450, y: 450, w: 100, h: 100 }, 20, stage, fr, mid).s).toBeCloseTo(8.5);
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

  it("grows a scene to fit its items as they end up, not only as they start", async () => {
    const reel = await kit({
      kit: 1, fonts, theme,
      scenes: [{ say: ["Small.", "It grows."], parts: [title("A building grows"), { type: "figure", id: "f", width: 600, height: 300, items: [{ id: "b", rect: [250, 200, 100, 100], fill: "accentTint", then: [{ cue: 1, rect: [0, 0, 600, 300] }] }] }] }],
    });
    await registerFonts(reel, ".");
    expect(await reel.check(resolveView(reel.meta), await nodeEnv("."))).toEqual([]);
  });

  it("checks an item's steps", () => {
    const sc = (then: unknown) => ({ kit: 1, scenes: [{ say: "One. Two.", parts: [{ type: "figure", width: 100, height: 100, items: [{ id: "a", rect: [0, 0, 10, 10], then }] }] }] });
    expect(problems(sc([{ cue: 1, circle: [5, 5, 5] }]))).toEqual([expect.stringMatching(/then\[0\]: a rect stays a rect, so its step can't give circle$/)]);
    expect(problems(sc([{ cue: 1, rect: [1, 1, 1, 1] }, { cue: 1, fill: "red" }]))).toEqual([expect.stringMatching(/then\[1\]: steps go in order, so this must come after the step before \(cue 1, delay 0\)$/)]);
    expect(problems(sc([{ cue: 3, rect: [1, 1, 1, 1] }]))).toEqual([expect.stringMatching(/figure\.a moves at cue 3, which is not a sentence of this scene's say \(it has 2\)$/)]);
    expect(problems(sc([{ rect: [1, 1, 1, 1] }]))).toEqual([expect.stringMatching(/then\[0\]: say when, with cue \(a sentence\) or delay \(ms after the scene starts\)$/)]);
    // Two moves in one sentence: the second a delay after it.
    expect(problems(sc([{ cue: 1, rect: [1, 1, 1, 1] }, { cue: 1, delay: 800, fill: "red" }]))).toEqual([]);
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
  const lay = async (sc: SceneSpec, W = 1920, H = 1080, images: Record<string, { w: number; h: number }> = {}) => {
    const reel = await kit({ kit: 1, fonts, theme, captions: false, scenes: [sc] });
    await registerFonts(reel, ".");
    await loadYoga();
    const [s] = normalize({ kit: 1, scenes: [sc] });
    const stage = { W, H };
    const ctx: Ctx = {
      stage,
      frame: stageFrame(stage, { top: 0, right: 0, bottom: 0, left: 0 }, false, s!.margin),
      fonts: new Fonts(patchContext(createCanvas(1, 1).getContext("2d") as unknown as Context2D), mergeTheme(theme)),
      theme: mergeTheme(theme),
      readText: () => "",
      image: (src) => (images[src] ? { img: {} as CanvasImageSource, ...images[src]! } : undefined),
      child: (p, flow) => partBox(p as PartSpec & { id: string }, { ...ctx, flow }),
    };
    const boxes = new Map<string, Bounds>();
    const ds = layoutScene(s!, ctx, boxes);
    return { ds, boxes, text: (id: string) => ds.find((d) => d.id === id) as Extract<Drawable, { t: "text" }> };
  };

  const room = (W = 1920, H = 1080) => {
    const fr = stageFrame({ W, H }, { top: 0, right: 0, bottom: 0, left: 0 }, false);
    return { x: fr.left, y: fr.top, w: W - fr.left - fr.right, h: H - fr.top - fr.bottom };
  };
  const within = (b: Bounds, r: Bounds) => b.x >= r.x - 1 && b.y >= r.y - 1 && b.x + b.w <= r.x + r.w + 1 && b.y + b.h <= r.y + r.h + 1;

  it("shrinks parts too tall for the room until they fit it, and never past half", async () => {
    const cards = Array.from({ length: 6 }, (_, i) => card({ label: `Step ${i + 1}`, body: "A sentence on a card" }));
    const { ds, boxes } = await lay({ fill: false, parts: [title("Many"), ...cards] });
    const r = room();
    for (const id of ["card", "card.6"]) expect(within(boxes.get(id)!, r)).toBe(true);
    expect(ds.filter((d) => d.owner.startsWith("card")).every((d) => within(bbox(d), r))).toBe(true);
    // Under the heading: the shrink leaves the title where it was.
    expect(boxes.get("card")!.y).toBeGreaterThan(boxes.get("title")!.y + boxes.get("title")!.h);
    const many = await lay({ parts: [title("Too many"), ...Array.from({ length: 30 }, () => card({ body: "x" }))] });
    const t = many.ds.find((d) => d.id === "card.body") as Extract<Drawable, { t: "text" }>;
    expect(t.size).toBeCloseTo((SIZE.h2 - 4) * 0.5);
  });

  it("keeps a flow a row on a wide stage, shrunk, when stacking would shrink it more", async () => {
    const steps = ["Look", "Listen", "Remember", "Read it", "Use it", "Say it"];
    const wide = await lay({ kata: "flow", title: "Five steps", steps, at: 2 });
    const ys = steps.map((_, i) => wide.boxes.get(`flow.${i}`)!.y);
    expect(new Set(ys.map(Math.round)).size).toBe(1);
    expect(within(wide.boxes.get("flow")!, room())).toBe(true);
    // A tall stage stacks it.
    const tall = await lay({ kata: "flow", title: "Five steps", steps, at: 2 }, 1080, 1920);
    expect(tall.boxes.get("flow.1")!.y).toBeGreaterThan(tall.boxes.get("flow.0")!.y);
  });

  it("makes a picture as large as its room allows, or no wider than its pixels with upscale: false", async () => {
    const images = { "a.png": { w: 300, h: 200 } };
    const big = await lay({ fill: false, parts: [title("A picture"), { type: "image", src: "a.png" }] }, 1920, 1080, images);
    const b = big.boxes.get("image")!;
    const r = room();
    // As tall as the room under the heading, its shape kept.
    expect(Math.abs(b.y + b.h - (r.y + r.h))).toBeLessThan(2);
    expect(b.w / b.h).toBeCloseTo(1.5);
    const small = await lay({ fill: false, parts: [title("A picture"), { type: "image", src: "a.png", upscale: false }] }, 1920, 1080, images);
    expect(small.boxes.get("image")!.w).toBeCloseTo(300);
    const capped = await lay({ fill: false, parts: [title("A picture"), { type: "image", src: "a.png", width: 600, upscale: false }] }, 1920, 1080, images);
    expect(capped.boxes.get("image")!.w).toBeCloseTo(300);
    // With a caption, the picture leaves it room.
    const cap = await lay({ fill: false, parts: [title("A picture"), { type: "image", src: "a.png", caption: "A caption" }] }, 1920, 1080, images);
    const c = cap.ds.find((d) => d.id === "image.caption")!;
    expect(within(bbox(c), r)).toBe(true);
  });

  it("sets a text smaller until its longest word fits, with shrink", async () => {
    const word = (shrink?: boolean | number) => lay({ fill: false, parts: [row([card({ body: "x", width: 900 }), { type: "text", role: "display", text: "accommodation", ...(shrink !== undefined ? { shrink } : {}) }], { narrow: "keep" })] });
    const plain = (await word()).text("text");
    expect(plain.need).toBeGreaterThan(plain.w + 1);
    const fit = (await word(true)).text("text");
    expect(fit.need).toBeLessThanOrEqual(fit.w + 1);
    expect(fit.size).toBeLessThan(SIZE.display);
    expect(fit.size).toBeGreaterThanOrEqual(SIZE.display / 2);
    // No further than it says.
    const floor = (await word(0.95)).text("text");
    expect(floor.size).toBeCloseTo(SIZE.display * 0.95);
    expect(problems({ kit: 1, scenes: [{ parts: [{ type: "text", text: "a", shrink: 0.1 }] }] })).toEqual([]);
    expect(problems({ kit: 1, scenes: [{ parts: [{ type: "text", text: "a", shrink: 0 }, { type: "text", text: "b", shrink: 1.5 }] }] })).toEqual([
      "scenes[0].parts[0] (text).shrink: expected true, false or a share above 0 and up to 1, got 0",
      "scenes[0].parts[1] (text).shrink: expected true, false or a share above 0 and up to 1, got 1.5",
    ]);
  });

  it("takes a margin from the reel, with a scene's over it edge by edge", () => {
    const [a, b, c] = normalize({ kit: 1, margin: 30, scenes: [{ parts: [title("A")] }, { margin: { left: 5 }, parts: [title("B")] }, { margin: 0, parts: [title("C")] }] });
    expect(a!.margin).toEqual({ top: 30, right: 30, bottom: 30, left: 30 });
    expect(b!.margin).toEqual({ top: 30, right: 30, bottom: 30, left: 5 });
    expect(c!.margin).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    const stage = { W: 1920, H: 1080 };
    const none = { top: 0, right: 0, bottom: 0, left: 0 };
    // Unwritten edges keep the default; captions take their band above the foot; a bar's edge is kept clear.
    expect(stageFrame(stage, none, false, { left: 5 })).toEqual({ top: 88, right: 96, bottom: 96, left: 5 });
    expect(stageFrame(stage, none, true, { bottom: 0 }).bottom).toBe(104);
    expect(stageFrame(stage, none, false, { bottom: 0 }, { bottom: 10 }).bottom).toBe(10);
    expect(stageFrame(stage, { top: 0, right: 0, bottom: 50, left: 0 }, false, { bottom: 0 }).bottom).toBe(50);
    expect(problems({ kit: 1, margin: -1, scenes: [{ margin: { side: 3 }, parts: [title("A")] }, { margin: "wide", parts: [title("B")] }] })).toEqual([
      "reel.margin: -1 is under 0",
      'scenes[0].margin: unknown field "side"',
      'scenes[1].margin: expected a number, or { top?, right?, bottom?, left? }, got "wide"',
    ]);
  });

  it("lets a picture reach the stage's edges with margin: 0, and check holds the scene to its margin", async () => {
    const images = { "a.png": { w: 1920, h: 1080 } };
    const full = await lay({ margin: 0, fill: false, parts: [{ type: "image", src: "a.png" }] }, 1920, 1080, images);
    expect(full.boxes.get("image")).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
    // Its corners are square where it meets the frame's edge, and only there.
    const square = (r: Awaited<ReturnType<typeof lay>>) => (r.ds.find((d) => d.t === "image") as Extract<Drawable, { t: "image" }>).square;
    expect(square(full)).toEqual([true, true, true, true]);
    const left = await lay({ margin: { left: 0 }, place: "left", fill: false, parts: [{ type: "image", src: "a.png", width: 600 }] }, 1920, 1080, images);
    expect(square(left)).toEqual([true, false, false, true]);
    const inside = await lay({ fill: false, parts: [{ type: "image", src: "a.png" }] }, 1920, 1080, images);
    expect(square(inside)).toBeUndefined();
    // The same through kit(): a picture at the edge is not off the stage at a scene's margin 0, nor at a reel's margin of 20.
    const env = await nodeEnv(".");
    const pic = join(tmpdir(), `kamishibai-margin-${process.pid}.png`);
    await writeFile(pic, createCanvas(1920, 1080).toBuffer("image/png"));
    try {
      const reel = await kit({ kit: 1, fonts, theme, captions: false, aspect: "16:9", scenes: [{ margin: 0, fill: false, parts: [{ type: "image", src: pic }] }] });
      expect(await reel.check(resolveView(reel.meta), env)).toEqual([]);
      const tight = await kit({ kit: 1, fonts, theme, captions: false, aspect: "16:9", margin: 20, scenes: [{ fill: false, parts: [{ type: "image", src: pic }] }] });
      expect(await tight.check(resolveView(tight.meta), env)).toEqual([]);
    } finally {
      await rm(pic, { force: true });
    }
  });

  it("makes a figure as tall as its room allows", async () => {
    const fig = { type: "figure", width: 1000, height: 1000, items: [{ rect: [0, 0, 1000, 1000], fill: "accent" }] };
    const { boxes } = await lay({ fill: false, parts: [title("A figure"), fig] });
    const r = room();
    const b = boxes.get("figure")!;
    // Before, 60% of the stage (648 here), shorter than the room under the heading.
    expect(b.h).toBeGreaterThan(1080 * 0.6 + 50);
    expect(Math.abs(b.y + b.h - (r.y + r.h))).toBeLessThan(2);
  });

  it("says when a scene ends before its parts have been seen whole", async () => {
    const reel = await kit({
      kit: 1, fonts, theme,
      scenes: [
        { ms: 2000, parts: [title("Ready")] },
        { id: "glance", ms: 900, parts: [{ type: "text", role: "display", text: "receipt" }] },
        { id: "quick", ms: 900, enter: { delay: 0, ms: 0 }, parts: [{ type: "text", role: "display", text: "schedule" }] },
        { id: "faded", ms: 900, transition: { type: "fade", ms: 200 }, parts: [{ type: "text", role: "display", text: "accommodation", shrink: true }] },
      ],
    });
    const issues = (await reel.check(resolveView(reel.meta), await nodeEnv("."))).filter((i) => i.kind === "timing");
    expect(issues.map((i) => i.scene)).toEqual(["glance"]);
    expect(issues[0]!.msg).toMatch(/^its parts are all in for only 0\.\d\d s of its 0\.90 s/);
  });

  it("says when a card's width goes unused on every shape the reel lays out for", async () => {
    const reel = (aspect: KitReelSpec["aspect"], scene: SceneSpec) => kit({ kit: 1, fonts, theme, aspect, scenes: [scene] });
    const issues = async (aspect: KitReelSpec["aspect"], scene: SceneSpec) => {
      const r = await reel(aspect, scene);
      return (await r.check(resolveView(r.meta), await nodeEnv("."))).filter((i) => i.kind === "unused");
    };
    const written: SceneSpec = { parts: [title("Cards"), card({ body: "Narrow", width: 600 })] };
    expect((await issues("9:16", written)).map((i) => i.msg)).toEqual(["card's width (600) goes unused: on a tall stage a card in a column takes the full width. Drop it, or put the card in a row"]);
    // Used on the wide shapes of the default range; used in a row; set by a shape, not the reel.
    expect(await issues(undefined, written)).toEqual([]);
    expect(await issues("9:16", { parts: [row([card({ body: "a", width: 400 }), card({ body: "b", width: 400 })], { narrow: "keep" })] })).toEqual([]);
    expect(await issues("9:16", { kata: "compare", title: "Two", left: { body: "a" }, right: { body: "b" } })).toEqual([]);
  });

  it("lays every built-in shape out at every shape of stage with nothing to fix", async () => {
    const scenes: SceneSpec[] = [
      { kata: "cover", kicker: "A short course", title: "Words for travel", sub: "Thirty words in four passes" },
      { kata: "flow", title: "Four passes", steps: ["Look and listen", "Remember the meaning", "Read it at a glance", "Use it in a sentence"], at: 1, note: "One word at a time, four passes each" },
      { kata: "flow", title: "Six steps", steps: ["Plan", "Write", "Check", "Fix", "Ship", "Watch"], at: 5 },
      { kata: "compare", title: "Two ways", left: { label: "Before", body: "Every word read aloud" }, right: { label: "After", body: "Only the new words" } },
      { kata: "stat", title: "Words learned", value: 120, unit: "words", label: "in four weeks" },
      { kata: "points", title: "What helps", items: ["Short sessions", "Hearing it twice", "Using it the same day"], at: 1 },
      { kata: "code", title: "The check", code: "const ok = words.every((w) => w.seen >= 4);\nif (!ok) review(words);", highlight: "w.seen >= 4", note: "Four passes each" },
    ];
    const reel = await kit({ kit: 1, fonts, theme, aspect: { min: "9:16", max: "16:9" }, scenes });
    await registerFonts(reel, ".");
    const env = await nodeEnv(".");
    for (const aspect of ["16:9", "4:3", "1:1", "4:5", "9:16"]) {
      const issues = await reel.check(resolveView(reel.meta, { aspect }), env);
      expect(issues.filter((i) => i.kind !== "contrast").map((i) => `${aspect} ${i.scene} ${i.kind} ${i.msg}`)).toEqual([]);
    }
  });

  it("grows a few short parts to fill the room under the heading, and leaves a full scene be", async () => {
    const sparse = await lay({ kata: "points", title: "Why", items: ["One", "Two"] });
    expect(sparse.text("points.0").size).toBeCloseTo(SIZE.body * 1.6);
    expect(sparse.text("title").size).toBe(SIZE.h1);
    const off = await lay({ kata: "points", title: "Why", items: ["One", "Two"], fill: false });
    expect(off.text("points.0").size).toBe(SIZE.body);
    const full = await lay({ kata: "points", title: "Why", items: Array.from({ length: 8 }, (_, i) => `Item number ${i}`) });
    expect(full.text("points.0").size).toBe(SIZE.body);
    // Too many for the room: shrunk to fit it, where the rows were squeezed into each other before.
    const over = await lay({ kata: "points", title: "Why", items: Array.from({ length: 9 }, (_, i) => `Item number ${i}`) });
    expect(over.text("points.0").size).toBeLessThan(SIZE.body);
    const rows = Array.from({ length: 9 }, (_, i) => over.text(`points.${i}`));
    rows.slice(1).forEach((t, i) => expect(t.y).toBeGreaterThanOrEqual(rows[i]!.y + rows[i]!.h));
    expect(within(bbox(rows[8]!), room())).toBe(true);
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
      'scenes[0].place: "middle" is not one of "center", "left", "right", "top", "bottom", "top-left", "top-right", "bottom-left", "bottom-right"',
      'scenes[0].fill: expected true, false, "max" or a number from 1, got "most"',
    ]);
  });

  it("takes a text's colour and end alignment, a stat's prefix, a numbered list, and an item's font, width, opacity and dash", async () => {
    const { ds } = await lay({
      parts: [
        { type: "text", id: "t", text: "Right", align: "end", color: "accent" },
        { type: "stat", id: "s", value: 3, prefix: "$" },
        { type: "list", id: "l", items: ["One", "Two"], numbered: true },
        { type: "figure", id: "f", width: 600, height: 200, items: [
          { id: "h", text: "A heading set in black that wraps", pos: [0, 0], font: "black", width: 300 },
          { id: "d", line: [[0, 150], [600, 150]], dash: [10, 6], opacity: 0.5 },
        ] },
      ],
    });
    const by = (id: string) => ds.find((d) => d.id === id) as Record<string, unknown>;
    expect(by("t")).toMatchObject({ align: "end", color: mergeTheme(theme).accent });
    expect((by("s.p").lines as string[])[0]).toBe("$");
    expect([(by("l.0.n").lines as string[])[0], (by("l.1.n").lines as string[])[0]]).toEqual(["1.", "2."]);
    expect(by("l.0.dot")).toBeUndefined();
    expect(by("f.h")).toMatchObject({ font: "black" });
    expect((by("f.h").lines as string[]).length).toBeGreaterThan(1);
    expect(by("f.d").o).toBe(0.5);
    expect((by("f.d").dash as number[]).length).toBe(2);
  });

  it("takes one shape, a numeric fill, and a corner", async () => {
    const tall = await kit({ kit: 1, fonts, theme, aspect: "9:16", scenes: [{ parts: [title("A")] }] });
    expect([tall.meta.width, tall.meta.height, tall.meta.aspect]).toEqual([1080, 1920, { min: 9 / 16, max: 9 / 16 }]);
    expect(problems({ kit: 1, aspect: "tall", scenes: [{ parts: [title("A")] }] })).toEqual(['reel.aspect: expected a shape such as "9:16" or a number, got "tall"']);
    const fig = [{ type: "figure", id: "f", width: 400, height: 100, items: [{ rect: [0, 0, 400, 100] }] }];
    expect((await lay({ parts: fig, fill: 2 })).boxes.get("f")!.w).toBeCloseTo(800, 0);
    const corner = await lay({ parts: [{ type: "card", id: "c", body: "In the corner" }], place: "bottom-right" });
    const c = corner.boxes.get("c")!;
    expect([c.x + c.w, c.y + c.h].map(Math.round)).toEqual([1920 - 96, 1080 - 96]);
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

  it("judges a moving text against what it sits on at each step", async () => {
    const issues = async (to: [number, number]) => {
      const fig = {
        type: "figure", id: "f", width: 1200, height: 300,
        items: [
          { id: "box", rect: [0, 100, 92, 120], r: 10, fill: "accentTint", stroke: "accent" },
          { id: "other", rect: [400, 100, 92, 120], r: 10, stroke: "rule" },
          { id: "t", text: "A", pos: [46, 132], size: 44, bold: true, align: "center", cue: 1, then: [{ cue: 1, delay: 900, pos: to }] },
        ],
      };
      const reel = await kit({ kit: 1, fonts, theme, scenes: [{ say: ["One.", "Two."], parts: [fig] }] });
      await registerFonts(reel, ".");
      return (await reel.check(resolveView(reel.meta), await nodeEnv("."))).map((i) => i.msg.split(":")[0]);
    };
    // Out of the box onto the paper: fine. Half off the box: it spills.
    expect(await issues([246, 152])).toEqual([]);
    expect(await issues([92, 152])).toEqual(["f.t spills out of f.box"]);
  });

  it("reads any CSS colour: it blends, and its contrast is judged", async () => {
    expect([parseColour("#fff"), parseColour("#ff000080"), parseColour("rgb(1, 2, 3)"), parseColour("rgba(1 2 3 / 50%)"), parseColour("tomato")]).toEqual([[255, 255, 255, 1], [255, 0, 0, 128 / 255], [1, 2, 3, 1], [1, 2, 3, 0.5], null]);
    // Pale text on a named paper: caught now that "white" is a colour the checker reads.
    const reel = await kit({ kit: 1, fonts, theme: { ...theme, paper: "white", ink: "#ddd" }, scenes: [{ parts: [{ type: "text", text: "Pale" }] }] });
    await registerFonts(reel, ".");
    expect((await reel.check(resolveView(reel.meta), await nodeEnv("."))).map((i) => i.kind)).toContain("contrast");
    // A named colour blends: halfway from red to blue is not either.
    const env = await nodeEnv(".");
    const m = morph([{ at: 0, items: [{ id: "a", rect: [0, 0, 10, 10], fill: "red" }] }, { at: 1000, items: [{ id: "a", rect: [0, 0, 10, 10], fill: "blue" }] }], { env, width: 10, height: 10 });
    const c = createCanvas(10, 10);
    m.draw(patchContext(c.getContext("2d") as unknown as Context2D), 1000 + 750 / 2);
    const [r, , bl] = c.getContext("2d").getImageData(5, 5, 1, 1).data;
    expect(r! > 20 && bl! > 20).toBe(true);
  });

  it("finds characters no font has", async () => {
    const reel = await kit({ kit: 1, fonts, theme, scenes: [{ parts: [title("Done ✗ é ²"), { type: "text", text: "↻ again ✗" }] }] });
    await registerFonts(reel, ".");
    const issues = await reel.check(resolveView(reel.meta), await nodeEnv("."));
    expect(issues.filter((i) => i.kind === "glyph").map((i) => i.msg.split(", which")[0])).toEqual(['title draws "✗" (U+2717)', 'text draws "↻" (U+21BB)']);
  });

  it("finds a word or a character or two left alone on a last line", () => {
    expect(widows(["It draws the map again for every", "layer."], ["期限切れの判定が逆で", "す"], ["Server:", "nextDay"], ["Make every", "layer count"], ["It costs", "10"], ["Count grapheme", "clusters"])).toEqual(["t0", "t1"]);
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
    expect(b).toMatch(/^Scene: .*transition \(morph\|cut\|fade\|push\|wipe\|\{\.\.\}\)/m);
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
    // A code reel built from data next to it: imported, or read with node:fs by import.meta.url.
    const KIT = JSON.stringify(resolve("src/kit/index.ts"));
    await writeFile(join(dir, "words.yaml"), "- accommodation\n- headquarters\n");
    await writeFile(join(dir, "words.ts"), `import { kit } from ${KIT};
import words from "./words.yaml";
export default await kit({ kit: 1, fonts: ${JSON.stringify(fonts)}, theme: ${JSON.stringify(theme)}, scenes: words.map((w: string) => ({ parts: [{ type: "text", text: w }] })) });
`);
    await writeFile(join(dir, "fs.ts"), `import { readFileSync } from "node:fs";
import { kit } from ${KIT};
const words = readFileSync(new URL("./words.yaml", import.meta.url), "utf8").split("\\n");
export default await kit({ kit: 1, scenes: [{ parts: [{ type: "text", text: words[0] }] }] });
`);
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

  it("bundles YAML a code reel imports, for Node and for a browser", async () => {
    const e = await loadCanvasEntry(join(dir, "words.ts"));
    try {
      expect((e!.reel as { timing: unknown[] }).timing).toHaveLength(2);
    } finally {
      await e?.close();
    }
    const { entryPoints: _, outfile: __, ...opts } = bundleOptions(join(dir, "words.ts"), "bundle.js");
    const r = await build({ ...opts, entryPoints: [join(dir, "words.ts")], write: false, outdir: dir, format: "esm" });
    expect(r.outputFiles[0]!.text).toContain("headquarters");
  });

  it("stops with the error a reel that imports node:fs threw, not as a page", async () => {
    const err = await loadCanvasEntry(join(dir, "fs.ts")).then(() => null, (e: Error) => e);
    expect(err?.message).toMatch(/fs\.ts failed as it loaded: .*ENOENT/);
    expect(err?.message).toMatch(/import\.meta\.url/);
    expect(err?.message).toMatch(/import words from "\.\/words\.yaml"/);
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

  it("closes a line with a fill into a filled shape", async () => {
    const env = await nodeEnv(".");
    const m = morph([{ at: 0, items: [{ line: [[0, 0], [100, 0], [0, 100]], fill: "#00ff00", enter: "none" }] }], { env, width: 100, height: 100 });
    const c = createCanvas(100, 100);
    m.draw(patchContext(c.getContext("2d") as unknown as Context2D), 2000);
    const px = (x: number, y: number) => [...c.getContext("2d").getImageData(x, y, 1, 1).data].slice(0, 4);
    expect(px(20, 20)).toEqual([0, 255, 0, 255]);
    expect(px(80, 80)[3]).toBe(0);
    expect(() => morph([{ at: 0, items: [{ line: [[0, 0], [1, 1]], fill: "red" }] }], { env, width: 10, height: 10 })).toThrow(/needs three points or more/);
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
