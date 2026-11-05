// After the whole run: the canvas worker's bundle. Run from source, the pool
// bundles worker.ts into a kamishibai-worker-* folder and removes it when the
// process exits, but vitest ends its workers without an "exit" event.
// Only folders made during this run are removed.
// ------------------------------------------------------------------
import { readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default function setup() {
  const started = Date.now();
  return async () => {
    const tmp = tmpdir();
    for (const name of await readdir(tmp).catch(() => [])) {
      if (!name.startsWith("kamishibai-worker-")) continue;
      const dir = join(tmp, name);
      const s = await stat(dir).catch(() => null);
      if (s && s.birthtimeMs >= started - 1000) await rm(dir, { recursive: true, force: true });
    }
  };
}
