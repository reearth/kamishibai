import { describe, it, expect } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { formatTiming, timingEntry } from "../src/kit-timing.ts";
import { tempDir } from "./temp.ts";

describe("kamishibai timing", () => {
  it("lays a kit reel's scenes and sentences on its clock, with no frame drawn", async () => {
    const dir = await tempDir("kamishibai-timing-");
    await writeFile(
      join(dir, "reel.yaml"),
      ["kit: 1", "pace: { lead: 100, gap: 200, tail: 300 }", "scenes:", '  - { id: count, say: ["Three.", "Two."], parts: [{ type: title, text: A }] }', "  - { id: hold, ms: 1500, parts: [{ type: title, text: B }] }", ""].join("\n"),
    );
    const r = await timingEntry({ entry: join(dir, "reel.yaml") });
    expect(r.scenes.map((s) => s.id)).toEqual(["count", "hold"]);
    const [count, hold] = r.scenes;
    expect(count!.say.map((l) => l.text)).toEqual(["Three.", "Two."]);
    expect(count!.say[0]!.atMs).toBe(100);
    expect(count!.say[1]!.atMs).toBe(100 + count!.say[0]!.ms + 200);
    expect(hold).toMatchObject({ start: count!.ms, ms: 1500, say: [] });
    expect(r.durationMs).toBe(count!.ms + 1500);
    // No voice: no sound clips.
    expect(r.audio).toEqual([]);
    const text = formatTiming(r);
    expect(text.split("\n")[0]).toBe(`2 scenes, ${(r.durationMs / 1000).toFixed(2)} s`);
    expect(text).toContain('    "Three."  (');
    expect(text).not.toContain("Sounds:");
  });

  it("says what it reads", async () => {
    const dir = await tempDir("kamishibai-timing-");
    await writeFile(join(dir, "page.ts"), `(window as any).kamishibai = { meta: { fps: 1, durationMs: 1000, width: 8, height: 8 }, seek() {} };`);
    await expect(timingEntry({ entry: join(dir, "page.ts") })).rejects.toThrow(/not a canvas reel: timing reads a kit reel/);
  });
});
