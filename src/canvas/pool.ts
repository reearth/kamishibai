// A canvas capture across worker threads: the CPU counterpart of renderPool.
// ------------------------------------------------------------------
import { Worker } from "node:worker_threads";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Chunk } from "../segment.ts";
import type { View } from "./types.ts";
import { externalPackages } from "./node.ts";
import type { MainMessage, WorkerJob, WorkerMessage } from "./worker.ts";

let fromSource: Promise<string> | undefined;

/** The worker's script: built next to this module (dist), or — when running
 *  from source — bundled from worker.ts on first use (Node 20 can't run .ts). */
function workerScript(): Promise<string> {
  const here = dirname(fileURLToPath(import.meta.url));
  const built = join(here, "canvas-worker.js");
  if (existsSync(built)) return Promise.resolve(built);
  return (fromSource ??= (async () => {
    const outfile = join(await mkdtemp(join(tmpdir(), "kamishibai-worker-")), "canvas-worker.mjs");
    await build({
      entryPoints: [join(here, "worker.ts")],
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node20",
      outfile,
      plugins: [externalPackages],
      logLevel: "silent",
    });
    return outfile;
  })());
}

export interface PaintPoolOptions {
  bundle: string;
  dir: string;
  view: View;
  fps: number;
  chunks: Chunk[];
  framesDir: string;
  prevFingerprints?: Map<number, string>;
  /** --only: the frames to paint; the rest stay on disk */
  only?: Set<number>;
  /** answers the reel's prepareNarration calls (the capture's TTS engine) */
  tts?: (body: unknown) => Promise<unknown>;
  onProgress?: (done: number, total: number) => void;
  onChunkDone?: (chunk: Chunk) => void;
  onFingerprint?: (index: number, fp: string) => void;
}

/** Paint all chunks concurrently, one worker thread each; resolves once every frame is on disk. */
export async function paintPool(opts: PaintPoolOptions): Promise<void> {
  const total = opts.chunks.reduce((n, c) => n + (c.end - c.start), 0);
  let done = 0;
  const script = await workerScript();
  await Promise.all(
    opts.chunks.map(
      (chunk) =>
        new Promise<void>((ok, ng) => {
          const job: WorkerJob = {
            bundle: opts.bundle,
            dir: opts.dir,
            view: opts.view,
            fps: opts.fps,
            chunk,
            framesDir: opts.framesDir,
            prevFingerprints: opts.prevFingerprints ? [...opts.prevFingerprints] : undefined,
            only: opts.only ? [...opts.only].filter((i) => i >= chunk.start && i < chunk.end) : undefined,
          };
          const w = new Worker(script, { workerData: job });
          let finished = false;
          w.on("message", async (m: WorkerMessage) => {
            if (m.type === "frame") opts.onProgress?.(++done, total);
            else if (m.type === "print") opts.onFingerprint?.(m.i, m.fp);
            else if (m.type === "tts") {
              const reply = (r: Omit<MainMessage, "type" | "id">) => w.postMessage({ type: "tts", id: m.id, ...r } satisfies MainMessage);
              if (!opts.tts) reply({ ok: false, error: "no TTS engine for this capture" });
              else opts.tts(m.body).then((value) => reply({ ok: true, value }), (e) => reply({ ok: false, error: String(e?.message ?? e) }));
            } else if (m.type === "done") {
              finished = true;
              opts.onChunkDone?.(chunk);
              await w.terminate();
              ok();
            } else if (m.type === "error") {
              finished = true;
              await w.terminate();
              ng(new Error(`canvas reel, frames ${chunk.start}..${chunk.end - 1}: ${m.message}`));
            }
          });
          w.on("error", (e) => ((finished = true), ng(e)));
          w.on("exit", (code) => {
            if (!finished) ng(new Error(`canvas worker for frames ${chunk.start}..${chunk.end - 1} exited (${code})`));
          });
        }),
    ),
  );
}
