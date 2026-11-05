// The disk a render's frames take. A minute of 1080p frames at 30 fps is
// roughly 45 to 130 MB of PNGs, more with photographs: kept frames say how
// much, a render stopped by Ctrl+C removes its temporary ones, and the next
// render points out any that a stopped render left behind.
// ------------------------------------------------------------------
import { existsSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { readdir, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

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

/** A folder a render was using went away under it. */
export class VanishedError extends Error {
  override name = "VanishedError";
}

/**
 * `err` as it happened, unless a folder the render was using is gone: then
 * an error that says so (another process removed it), with `err` as its
 * cause. A bare ENOENT on a frame, or a stack from loading the bundle, says
 * nothing of why.
 */
export function vanishedError(err: unknown, dirs: Array<string | undefined>): unknown {
  if (err instanceof VanishedError) return err;
  const gone = dirs.filter((d): d is string => !!d && !existsSync(d));
  if (!gone.length) return err;
  const msg = err instanceof Error ? err.message : String(err);
  // In the temp dir, a cleanup of it is the likely cause; --frames-dir moves the frames out.
  const inTemp = gone.some((d) => resolve(d).startsWith(resolve(tmpdir())) || realOf(d).startsWith(realOf(tmpdir())));
  return new VanishedError(
    [
      `${gone.length === 1 ? "A folder" : "Folders"} kamishibai was using went away during the render: ${gone.join(", ")}`,
      inTemp
        ? "  Another process removed it, such as a cleanup of the temp dir. Keep that from touching kamishibai-* folders while a render runs; --frames-dir <dir> keeps the frames out of the temp dir."
        : "  Another process removed it while the render was writing to it.",
      `  (${msg})`,
    ].join("\n"),
    { cause: err },
  );
}

/** A path with its links resolved, as far as it still exists (/var → /private/var on macOS). */
function realOf(p: string): string {
  let at = resolve(p);
  const rest: string[] = [];
  while (!existsSync(at) && dirname(at) !== at) (rest.unshift(basename(at)), (at = dirname(at)));
  try {
    return join(realpathSync(at), ...rest);
  } catch {
    return resolve(p);
  }
}
