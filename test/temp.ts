// A temporary folder for one test, removed when the test finishes, so a run
// of the suite leaves nothing in the OS's temp dir.
// ------------------------------------------------------------------
import { onTestFinished } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A fresh folder in the temp dir named `prefix…`, removed once the calling test is done. */
export async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
