// The disk a render's frames take. A minute of 1080p frames at 30 fps is
// roughly 45 to 130 MB of PNGs, more with photographs: kept frames say how
// much, a render stopped by Ctrl+C
// removes its temporary ones, and the next render points out any that a
// stopped render left behind.
// ------------------------------------------------------------------
import { rmSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

/** The prefix of a render's temporary frames folder, in the OS's temp dir. */
export const TEMP_FRAMES_PREFIX = "kamishibai-frames-";

/** How many files a folder holds, and their bytes (one level: frames don't nest). */
export async function folderSize(dir: string): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (!e.isFile()) continue;
    const s = await stat(join(dir, e.name)).catch(() => null);
    if (s) (files++, (bytes += s.size));
  }
  return { files, bytes };
}

/** Bytes for a person: "812 MB", "8.1 GB". */
export function formatBytes(n: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) (n /= 1024), i++;
  return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

/**
 * Remove `dir` if the process is stopped (Ctrl+C, SIGTERM) or exits before
 * the render's own cleanup. Returns the function that stops watching.
 * A signal only exits here when nothing else listens for it; otherwise the
 * other listener exits, and the "exit" handler removes the folder then.
 */
export function removeOnExit(dir: string): () => void {
  const clean = () => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // nothing to do: the process is going
    }
  };
  const onSignal = (signal: NodeJS.Signals) => {
    clean();
    if (process.listenerCount(signal) === 1) process.exit(signal === "SIGINT" ? 130 : 143);
  };
  process.on("exit", clean);
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  return () => {
    process.off("exit", clean);
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  };
}

/**
 * Temporary frames folders in `tmp` that no render has touched for
 * `olderThanMs`: left by a render that was killed before it could remove
 * them. Newest first.
 */
export async function strayFrames(tmp: string, olderThanMs = 60 * 60_000, now = Date.now()): Promise<Array<{ dir: string; files: number; bytes: number; mtimeMs: number }>> {
  const out: Array<{ dir: string; files: number; bytes: number; mtimeMs: number }> = [];
  for (const e of await readdir(tmp, { withFileTypes: true }).catch(() => [])) {
    if (!e.isDirectory() || !e.name.startsWith(TEMP_FRAMES_PREFIX)) continue;
    const dir = join(tmp, e.name);
    const s = await stat(dir).catch(() => null);
    if (!s || now - s.mtimeMs < olderThanMs) continue;
    out.push({ dir, ...(await folderSize(dir)), mtimeMs: s.mtimeMs });
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/** A line on frames a stopped render left, or undefined when there are none. */
export function strayFramesNote(stray: Awaited<ReturnType<typeof strayFrames>>): string | undefined {
  if (!stray.length) return undefined;
  const bytes = stray.reduce((n, s) => n + s.bytes, 0);
  const list = stray.slice(0, 3).map((s) => `  ${s.dir}`);
  if (stray.length > 3) list.push(`  … and ${stray.length - 3} more`);
  return [
    stray.length === 1 ? `1 frames folder left by a render that was stopped takes ${formatBytes(bytes)}:` : `${stray.length} frames folders left by renders that were stopped take ${formatBytes(bytes)}:`,
    ...list,
    "  Delete them once no other render is running.",
  ].join("\n");
}
