// Load custom TTS adapters from module files, for the CLI's --tts-adapter.
// A module default-exports one TTSAdapter or an array of them. It is bundled
// with esbuild (so .ts works on every supported Node) into a temp file beside
// the source, so its bare imports still resolve from the project's
// node_modules, then imported and the temp file removed.
import { build } from "esbuild";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { TTSAdapter } from "./engine.ts";

function isAdapter(v: unknown): v is TTSAdapter {
  const a = v as TTSAdapter | null;
  return (
    typeof a === "object" && a !== null &&
    typeof a.provider === "string" && a.provider !== "" &&
    typeof a.synthesize === "function"
  );
}

export async function loadTTSAdapters(files: string[]): Promise<TTSAdapter[]> {
  const adapters: TTSAdapter[] = [];
  for (const file of files) {
    const src = resolve(file);
    const out = join(dirname(src), `.${basename(src)}.${randomUUID()}.kamishibai.mjs`);
    let mod: { default?: unknown };
    try {
      await build({
        entryPoints: [src],
        outfile: out,
        bundle: true,
        packages: "external",
        platform: "node",
        format: "esm",
        target: "node20",
        logLevel: "silent",
      });
      mod = (await import(pathToFileURL(out).href)) as { default?: unknown };
    } catch (err) {
      throw new Error(`--tts-adapter ${file}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      await unlink(out).catch(() => {});
    }
    const list = Array.isArray(mod.default) ? mod.default : [mod.default];
    if (list.length === 0 || !list.every(isAdapter)) {
      throw new Error(
        `--tts-adapter ${file}: the default export must be a TTSAdapter ({ provider, synthesize }) or an array of them`,
      );
    }
    adapters.push(...list);
  }
  return adapters;
}
