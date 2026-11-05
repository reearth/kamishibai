import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { folderSize, formatBytes, removeOnExit, strayFrames, strayFramesNote, TEMP_FRAMES_PREFIX } from "../src/frames-disk.ts";

describe("frames on disk", () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "kamishibai-frames-disk-test-"));
  });
  afterEach(() => rm(tmp, { recursive: true, force: true }));

  const folder = async (name: string, files: number, size: number, ageMs: number) => {
    const dir = join(tmp, name);
    await mkdir(dir);
    for (let i = 0; i < files; i++) await writeFile(join(dir, `f${String(i).padStart(6, "0")}.png`), Buffer.alloc(size));
    const t = (Date.now() - ageMs) / 1000;
    await utimes(dir, t, t);
    return dir;
  };

  it("says how much a folder of frames takes, in units a person reads", async () => {
    const dir = await folder("frames", 3, 1000, 0);
    expect(await folderSize(dir)).toEqual({ files: 3, bytes: 3000 });
    expect(await folderSize(join(tmp, "missing"))).toEqual({ files: 0, bytes: 0 });
    expect([formatBytes(512), formatBytes(2048), formatBytes(5.5 * 1024 ** 2), formatBytes(812 * 1024 ** 2), formatBytes(8.1 * 1024 ** 3)]).toEqual(["512 B", "2.0 KB", "5.5 MB", "812 MB", "8.1 GB"]);
  });

  it("finds the temporary frames a stopped render left, and only those", async () => {
    const old = await folder(`${TEMP_FRAMES_PREFIX}old`, 2, 500, 2 * 60 * 60_000);
    await folder(`${TEMP_FRAMES_PREFIX}running`, 2, 500, 60_000);
    await folder("kamishibai-canvas-x", 2, 500, 2 * 60 * 60_000);
    const stray = await strayFrames(tmp);
    expect(stray.map((s) => [s.dir, s.files, s.bytes])).toEqual([[old, 2, 1000]]);
    expect(strayFramesNote(stray)).toBe([`1 frames folder left by a render that was stopped takes 1000 B:`, `  ${old}`, "  Delete them once no other render is running."].join("\n"));
    expect(strayFramesNote([])).toBeUndefined();
  });

  it("removes a render's temporary frames when the process is stopped", async () => {
    const dir = await folder(`${TEMP_FRAMES_PREFIX}live`, 1, 10, 0);
    // Another listener, so the handler cleans up without exiting the test process.
    const other = () => {};
    process.on("SIGINT", other);
    const unwatch = removeOnExit(dir);
    try {
      process.emit("SIGINT", "SIGINT");
      expect(existsSync(dir)).toBe(false);
    } finally {
      unwatch();
      process.off("SIGINT", other);
    }
    // Stopped watching: a later signal leaves a new folder alone.
    const later = await folder(`${TEMP_FRAMES_PREFIX}later`, 1, 10, 0);
    process.on("SIGINT", other);
    process.emit("SIGINT", "SIGINT");
    process.off("SIGINT", other);
    expect(existsSync(later)).toBe(true);
  });
});
