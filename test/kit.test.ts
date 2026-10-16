import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { kit, kitSchema, normalize, KitSpecError, card, row, title, arrow, scene, definePart, f, textBox, type KitReelSpec } from "../src/kit/index.ts";
import { camAt, frameAt, layersAt, type Keyframe } from "../src/kit/engine.ts";
import { aim } from "../src/kit/reel.ts";
import { tokens, speechMs, sentences } from "../src/kit/text.ts";
import { loadCanvasEntry, nodeEnv, patchContext, registerFonts } from "../src/canvas/node.ts";
import { resolveView, type Context2D } from "../src/canvas/types.ts";
import { checkEntry } from "../src/kit-check.ts";

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
        { ms: 2000, parts: [{ type: "figure", width: 400, height: 100, items: [box(0, "accent"), { text: "a", at: [200, 30], align: "center" }] }] },
        { ms: 2000, parts: [{ type: "figure", width: 400, height: 100, items: [box(300, "ink3")] }] },
      ],
    });
    expect(await reel.check(resolveView(reel.meta), await nodeEnv("."))).toEqual([]);
    expect(problems({ kit: 1, scenes: [{ parts: [{ type: "figure", width: 1, height: 1, items: [{ rect: [0, 0] }, { circle: [0, 0, 1], line: [[0, 0], [1, 1]] }] }] }] })).toEqual([
      "scenes[0].parts[0] (figure).items[0].rect: expected [x, y, w, h]",
      "scenes[0].parts[0] (figure).items[1]: give one of rect, circle, line, text (got circle and line)",
    ]);
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

  it("checks where the camera goes and how a scene comes in", () => {
    const sc = (more: object) => ({ kit: 1, scenes: [{ say: "one. two.", parts: [{ type: "text", id: "word", text: "x" }], ...more }] });
    expect(problems(sc({ focus: "wrod" }))).toEqual(['scenes[0].focus: no part "wrod" in this scene (did you mean "word"?)']);
    expect(problems(sc({ focus: { on: "word", zoom: 0.5 } }))).toEqual(["scenes[0].focus.zoom: 0.5 is under 1 (the camera only moves in)"]);
    expect(problems(sc({ focus: [{ on: "word", cue: 1 }, { on: "word" }] }))).toEqual(["scenes[0].focus[1].cue: the camera moves in sentence order, so this cue must be after 1"]);
    expect(problems(sc({ transition: "dissolve" }))[0]).toMatch(/transition: "dissolve" is not one of "morph", "cut", "fade", "push", "wipe"/);
    expect(normalize(sc({ focus: [{ on: "word", cue: 1 }], transition: "push" }) as KitReelSpec)[0]).toMatchObject({ transition: "push", focus: [{ on: "word", cue: 1 }] });
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
  - { kata: code, title: The code, code: "code.ts#L3-L5", mark: line4 }
`;
    await writeFile(join(dir, "reel.yaml"), yaml);
    await writeFile(join(dir, "wide.json"), JSON.stringify({
      kit: 1, fonts: [{ family: "Geist", src: GEIST, weight: "100 900" }], theme,
      scenes: [{ parts: [row([card({ body: "a".repeat(30), width: 900 }), arrow(), card({ body: "b".repeat(30), width: 900 })], { narrow: "keep" })] }],
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

  it("is checked for every shape, and a row kept too wide is caught", async () => {
    const r = await checkEntry({ entry: join(dir, "wide.json") });
    expect(r.views.map((v) => `${v.width}x${v.height}`)).toEqual(["1920x1080", "1080x1920"]);
    expect(r.views[1]!.issues.some((i) => i.kind === "off-stage")).toBe(true);
  });

  it("runs the modules uses names, with the kit the reel is made with", async () => {
    expect((await checkEntry({ entry: join(dir, "uses.json") })).count).toBe(0);
    await expect(loadCanvasEntry(join(dir, "missing.json"))).rejects.toThrow(/uses names nope.ts, which is not there/);
  });

  it("says what a JSON file without kit is", async () => {
    await expect(loadCanvasEntry(join(dir, "plain.json"))).rejects.toThrow(/not a kit reel/);
  });
});
