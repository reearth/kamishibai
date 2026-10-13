import { describe, it, expect } from "vitest";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTTSAdapters } from "../src/tts/load.ts";

async function moduleFile(name: string, code: string): Promise<{ dir: string; file: string }> {
  const dir = await mkdtemp(join(tmpdir(), "kamishibai-adapter-"));
  const file = join(dir, name);
  await writeFile(file, code);
  return { dir, file };
}

describe("loadTTSAdapters", () => {
  it("loads a TypeScript default export and leaves no temp file", async () => {
    const { dir, file } = await moduleFile(
      "a.ts",
      `import { join } from "node:path";
       const a: { provider: string; synthesize: () => Promise<unknown> } = {
         provider: "fake",
         synthesize: async () => ({ audio: new Uint8Array([join("a", "b").length]), format: "wav" }),
       };
       export default a;`,
    );
    const [a] = await loadTTSAdapters([file]);
    expect(a!.provider).toBe("fake");
    expect(await a!.synthesize("x", {})).toEqual({ audio: new Uint8Array([3]), format: "wav" });
    expect(await readdir(dir)).toEqual(["a.ts"]);
  });

  it("takes an array of adapters", async () => {
    const { file } = await moduleFile(
      "b.mjs",
      `const s = async () => ({ audio: new Uint8Array(), format: "mp3" });
       export default [{ provider: "x", synthesize: s }, { provider: "y", synthesize: s }];`,
    );
    expect((await loadTTSAdapters([file])).map((a) => a.provider)).toEqual(["x", "y"]);
  });

  it("names the file when the export isn't an adapter", async () => {
    const { file } = await moduleFile("c.js", `export default { provider: "z" };`);
    await expect(loadTTSAdapters([file])).rejects.toThrow(/--tts-adapter .*c\.js: the default export/);
  });
});
