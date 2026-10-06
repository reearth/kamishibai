import { describe, it, expect } from "vitest";
import { chmod, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
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
    expect(engine.stats()).toEqual({ total: 2, done: 2, failed: 0, cached: 0 });
    expect(engine.busy()).toBe(false);

    const before = events.length;
    await engine.handle({ adapter: ref, items: { a: "one" } });
    expect(events.length).toBe(before); // cached — no new work reported
    expect(engine.stats()).toMatchObject({ total: 2, done: 2, cached: 1 });
  });

  it("records failures with the last error", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "kamishibai-tts-"));
    const engine = createTTSEngine({ adapters: [fakeAdapter([], true)], cacheDir });
    await expect(engine.handle({ adapter: ref, items: { a: "x" } })).rejects.toThrow("boom");
    expect(engine.stats()).toMatchObject({ total: 1, done: 0, failed: 1, lastError: "boom" });
  });

  it("keeps cache keys stable (file name = hash of id, text and override)", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "kamishibai-tts-"));
    const engine = createTTSEngine({ adapters: [fakeAdapter([])], cacheDir });
    const r = await engine.handle({
      adapter: ref,
      items: { a: "hello", b: { text: "hello", opts: { rate: 150, voice: "x" } } },
    });
    // Changing these would orphan every user's baked (and paid-for) audio.
    expect(basename(r.a!.src)).toBe("5a6cf92566a58561be9f68fcd3a161ed.wav");
    expect(basename(r.b!.src)).toBe("aa4c3c218a8f7bb20a4cbf99d3f46646.wav");
  });

  it("fails a line whose audio ffprobe can't read, and never caches it", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "kamishibai-tts-"));
    let calls = 0;
    const garbage: TTSAdapter = {
      provider: "fake",
      async synthesize() {
        calls += 1;
        return { audio: new TextEncoder().encode("not audio"), format: "wav" };
      },
    };
    const engine = createTTSEngine({ adapters: [garbage], cacheDir });
    await expect(engine.handle({ adapter: ref, items: { a: "x" } })).rejects.toThrow(
      /ffprobe could not read/,
    );
    expect(engine.stats()).toMatchObject({ total: 1, failed: 1, cached: 0 });
    expect(await readdir(cacheDir)).toEqual([]); // no published clip, no temp left behind

    // A second run asks the provider again instead of failing from cache.
    const again = createTTSEngine({ adapters: [garbage], cacheDir });
    await expect(again.handle({ adapter: ref, items: { a: "x" } })).rejects.toThrow(
      /ffprobe could not read/,
    );
    expect(calls).toBe(2);
    expect(again.stats()).toMatchObject({ total: 1, failed: 1, cached: 0 });
  });

  it("deletes an unreadable clip found in the cache and counts it as failed", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "kamishibai-tts-"));
    // The cache file name for (fake:1, "hello"), see the cache-key test above.
    const poisoned = join(cacheDir, "5a6cf92566a58561be9f68fcd3a161ed.wav");
    await writeFile(poisoned, "not audio");
    const spoken: string[] = [];
    const engine = createTTSEngine({ adapters: [fakeAdapter(spoken)], cacheDir });
    await expect(engine.handle({ adapter: ref, items: { a: "hello" } })).rejects.toThrow(
      /removed from the cache/,
    );
    expect(engine.stats()).toMatchObject({ total: 1, failed: 1, cached: 0 });
    expect(existsSync(poisoned)).toBe(false);

    // The next run synthesizes the line afresh.
    const again = createTTSEngine({ adapters: [fakeAdapter(spoken)], cacheDir });
    const r = await again.handle({ adapter: ref, items: { a: "hello" } });
    expect(spoken).toEqual(["hello"]);
    expect(r.a!.src).toBe(poisoned);
    expect(r.a!.durationMs).toBe(100);
  });

  it("keeps a cached clip when ffprobe itself can't run", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "kamishibai-tts-"));
    const spoken: string[] = [];
    const r = await createTTSEngine({ adapters: [fakeAdapter(spoken)], cacheDir }).handle({
      adapter: ref,
      items: { a: "hello" },
    });
    const engine = createTTSEngine({ adapters: [fakeAdapter(spoken)], cacheDir });
    const path = process.env.PATH;
    process.env.PATH = "";
    try {
      await expect(engine.handle({ adapter: ref, items: { a: "hello" } })).rejects.toThrow(
        /ffprobe not found on PATH/,
      );
    } finally {
      process.env.PATH = path;
    }
    expect(engine.stats()).toMatchObject({ total: 1, failed: 1, cached: 0 });
    expect(engine.stats().lastError).not.toMatch(/removed from the cache/);
    expect(existsSync(r.a!.src)).toBe(true);
    expect(spoken).toEqual(["hello"]);
  });

  it("keeps a cached clip when ffprobe fails for a reason other than its content", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "kamishibai-tts-"));
    const spoken: string[] = [];
    const r = await createTTSEngine({ adapters: [fakeAdapter(spoken)], cacheDir }).handle({
      adapter: ref,
      items: { a: "hello" },
    });
    // A broken ffprobe install: it runs, but exits non-zero before reading anything.
    const bin = await mkdtemp(join(tmpdir(), "kamishibai-bin-"));
    await writeFile(join(bin, "ffprobe"), "#!/bin/sh\necho 'dyld: Library not loaded' >&2\nexit 134\n");
    await chmod(join(bin, "ffprobe"), 0o755);
    const engine = createTTSEngine({ adapters: [fakeAdapter(spoken)], cacheDir });
    const path = process.env.PATH;
    process.env.PATH = `${bin}:${path}`;
    try {
      await expect(engine.handle({ adapter: ref, items: { a: "hello" } })).rejects.toThrow(
        /ffprobe failed on narration audio .*dyld: Library not loaded/,
      );
    } finally {
      process.env.PATH = path;
    }
    expect(engine.stats().lastError).not.toMatch(/removed from the cache/);
    expect(existsSync(r.a!.src)).toBe(true);
    expect(spoken).toEqual(["hello"]);
  });

  it.skipIf(process.getuid?.() === 0)("keeps a cached clip ffprobe can't open", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "kamishibai-tts-"));
    const spoken: string[] = [];
    const r = await createTTSEngine({ adapters: [fakeAdapter(spoken)], cacheDir }).handle({
      adapter: ref,
      items: { a: "hello" },
    });
    await chmod(r.a!.src, 0o000);
    const engine = createTTSEngine({ adapters: [fakeAdapter(spoken)], cacheDir });
    try {
      await expect(engine.handle({ adapter: ref, items: { a: "hello" } })).rejects.toThrow(
        /Permission denied/,
      );
      expect(engine.stats().lastError).not.toMatch(/removed from the cache/);
      expect(existsSync(r.a!.src)).toBe(true);
    } finally {
      await chmod(r.a!.src, 0o644);
    }
  });

  it("keeps freshly synthesized audio when ffprobe can't run, and measures it next run", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "kamishibai-tts-"));
    const spoken: string[] = [];
    const engine = createTTSEngine({ adapters: [fakeAdapter(spoken)], cacheDir });
    const path = process.env.PATH;
    process.env.PATH = "";
    try {
      await expect(engine.handle({ adapter: ref, items: { a: "hello" } })).rejects.toThrow(
        /ffprobe not found on PATH.*the synthesized audio is kept at .*5a6cf92566a58561be9f68fcd3a161ed\.wav/,
      );
    } finally {
      process.env.PATH = path;
    }
    expect(engine.stats()).toMatchObject({ total: 1, done: 0, failed: 1 });
    expect(await readdir(cacheDir)).toEqual(["5a6cf92566a58561be9f68fcd3a161ed.wav"]);

    // With ffprobe back, the kept clip is measured from cache: no new synthesis.
    const again = createTTSEngine({ adapters: [fakeAdapter(spoken)], cacheDir });
    const r = await again.handle({ adapter: ref, items: { a: "hello" } });
    expect(spoken).toEqual(["hello"]);
    expect(r.a!.durationMs).toBe(100);
    expect(again.stats()).toMatchObject({ total: 0, cached: 1 });
  });

  it("names ffprobe when it is missing from PATH", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "kamishibai-tts-"));
    const engine = createTTSEngine({ adapters: [fakeAdapter([])], cacheDir });
    const path = process.env.PATH;
    process.env.PATH = "";
    try {
      await expect(engine.handle({ adapter: ref, items: { a: "x" } })).rejects.toThrow(
        /ffprobe not found on PATH/,
      );
    } finally {
      process.env.PATH = path;
    }
  });
});
