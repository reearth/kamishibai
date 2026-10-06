import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTTSEngine, pcmToWav, type TTSAdapter, type TTSStats } from "../src/tts/engine.ts";

/** A fake provider that records what it was asked to speak. */
function fakeAdapter(spoken: string[], fail = false): TTSAdapter {
  return {
    provider: "fake",
    async synthesize(text) {
      spoken.push(text);
      if (fail) throw new Error("boom");
      return { audio: pcmToWav(new Uint8Array(4800), 24000), format: "wav" };
    },
  };
}

const ref = { id: "fake:1", provider: "fake" };

describe("TTS engine", () => {
  it("speaks `text` but returns `caption` as the clip text, without re-synthesizing", async () => {
    const spoken: string[] = [];
    const cacheDir = await mkdtemp(join(tmpdir(), "kamishibai-tts-"));
    const engine = createTTSEngine({ adapters: [fakeAdapter(spoken)], cacheDir });

    const a = await engine.handle({ adapter: ref, items: { k: { text: "まちあざ", caption: "町字" } } });
    expect(spoken).toEqual(["まちあざ"]);
    expect(a.k.text).toBe("町字");

    // Same spoken text, new caption → cache hit, new caption.
    const b = await engine.handle({ adapter: ref, items: { k: { text: "まちあざ", caption: "町・字" } } });
    expect(spoken).toEqual(["まちあざ"]);
    expect(b.k.text).toBe("町・字");
    expect(b.k.src).toBe(a.k.src);
  });

  it("reports progress for cache misses only", async () => {
    const spoken: string[] = [];
    const events: TTSStats[] = [];
    const cacheDir = await mkdtemp(join(tmpdir(), "kamishibai-tts-"));
    const engine = createTTSEngine({
      adapters: [fakeAdapter(spoken)],
      cacheDir,
      onProgress: (s) => events.push(s),
    });

    await engine.handle({ adapter: ref, items: { a: "one", b: "two" } });
    expect(engine.stats()).toEqual({ total: 2, done: 2, failed: 0 });
    expect(engine.busy()).toBe(false);

    const before = events.length;
    await engine.handle({ adapter: ref, items: { a: "one" } });
    expect(events.length).toBe(before); // cached — no new work reported
  });

  it("records failures with the last error", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "kamishibai-tts-"));
    const engine = createTTSEngine({ adapters: [fakeAdapter([], true)], cacheDir });
    await expect(engine.handle({ adapter: ref, items: { a: "x" } })).rejects.toThrow("boom");
    expect(engine.stats()).toMatchObject({ total: 1, done: 0, failed: 1, lastError: "boom" });
  });
});
