// A kit reel written as JSON or YAML, as an entry: esbuild loads the file as
// a module that hands its data to kit(), so every command that bundles a
// script entry (render, dev, export, tts) takes it as it is.
// ------------------------------------------------------------------
import { existsSync, realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "esbuild";

export const DATA_EXT = new Set([".json", ".yaml", ".yml"]);

export const isDataEntry = (entry: string): boolean => DATA_EXT.has(extname(entry).toLowerCase());

/** kamishibai/kit: built next to this module (dist), or its source. */
export function kitModule(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const built = join(here, "kit.js");
  if (existsSync(built)) return built;
  const src = join(here, "kit", "index.ts");
  return existsSync(src) ? src : join(here, "..", "kit", "index.ts");
}

/** Parse a JSON or YAML reel file. */
export async function readKitData(path: string): Promise<unknown> {
  const text = await readFile(path, "utf8");
  if (extname(path).toLowerCase() === ".json") {
    try {
      return JSON.parse(text);
    } catch (err) {
      throw new Error(`${path}: not valid JSON: ${(err as Error).message}`);
    }
  }
  let yaml: typeof import("yaml");
  try {
    yaml = await import("yaml");
  } catch {
    throw new Error("a YAML reel is read with the yaml package: npm i -D yaml");
  }
  try {
    return yaml.parse(text);
  } catch (err) {
    throw new Error(`${path}: not valid YAML: ${(err as Error).message}`);
  }
}

/**
 * Load `entry` (a .json, .yaml or .yml kit reel) as a module whose default
 * export is the reel, after the modules its `uses` names: they define parts
 * with definePart, so they run for that, and their "kamishibai/kit" is the
 * same module the reel is made with.
 */
export function kitDataPlugin(entry: string): Plugin {
  const abs = resolve(entry);
  // esbuild hands over the path with links resolved (/var → /private/var on macOS).
  const real = (p: string) => (existsSync(p) ? realpathSync(p) : p);
  const target = real(abs);
  const uses = new Set<string>();
  return {
    name: "kamishibai-kit-data",
    setup(b) {
      b.onResolve({ filter: /^kamishibai\/kit$/ }, () => ({ path: kitModule() }));
      // Imported for what they run: a "sideEffects": false in their package.json must not drop them.
      b.onResolve({ filter: /.*/ }, (args) => (uses.has(args.path) ? { path: args.path, sideEffects: true } : undefined));
      b.onLoad({ filter: /\.(json|ya?ml)$/i }, async (args) => {
        if (args.path !== abs && real(args.path) !== target) return undefined;
        const data = await readKitData(abs);
        if (!data || typeof data !== "object" || !("kit" in data)) {
          return { errors: [{ text: `${entry} is not a kit reel: a JSON or YAML entry needs "kit": 1 and its scenes (kamishibai skill kit)` }] };
        }
        const use = (data as { uses?: unknown }).uses;
        const files = Array.isArray(use) ? use.filter((u): u is string => typeof u === "string").map((u) => resolve(dirname(abs), u)) : [];
        for (const f of files) {
          if (!existsSync(f)) return { errors: [{ text: `${entry}: uses names ${relative(dirname(abs), f)}, which is not there` }] };
          uses.add(f);
        }
        return {
          contents: `${files.map((f) => `import ${JSON.stringify(f)};\n`).join("")}import { kit } from ${JSON.stringify(kitModule())};\nexport default await kit(${JSON.stringify(data)});\n`,
          loader: "js",
          resolveDir: dirname(abs),
          watchFiles: [abs],
        };
      });
    },
  };
}
