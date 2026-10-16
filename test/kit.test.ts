import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { kit, kitSchema, normalize, KitSpecError, card, row, title, arrow, scene, definePart, f, textBox, type KitReelSpec } from "../src/kit/index.ts";
import { frameAt, type Keyframe } from "../src/kit/engine.ts";
import { tokens, speechMs } from "../src/kit/text.ts";
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

  it("guesses a spoken length from the script", () => {
    expect(speechMs("あいうえおかきくけこさしすせそ")).toBe(2000);
    expect(speechMs("fourteen chars")).toBe(929);
  });
});

describe("kit", () => {
  it("times each scene to its narration and captions it", async () => {
    const reel = await kit({ kit: 1, fonts, theme, scenes: [{ say: "あいうえおかきくけこさしすせそ", parts: [title("A")] }, { ms: 1000, parts: [title("B")] }] });
    expect(reel.timing).toEqual([
      { id: "s1", start: 0, ms: 3100, say: { atMs: 400, ms: 2000, text: "あいうえおかきくけこさしすせそ", src: "" } },
      { id: "s2", start: 3100, ms: 1000 },
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

  it("says what a JSON file without kit is", async () => {
    await expect(loadCanvasEntry(join(dir, "plain.json"))).rejects.toThrow(/not a kit reel/);
  });
});
