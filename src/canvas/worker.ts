// One worker thread of a canvas capture: import the bundled reel, set it up
// for the view, and paint a chunk of frames. Narration requests go to the main
// thread, so every line is synthesized once, by one engine.
// ------------------------------------------------------------------
import { parentPort, workerData } from "node:worker_threads";
import { pathToFileURL } from "node:url";
import { paintChunk, setTTSHook } from "./node.ts";
import type { View } from "./types.ts";
import type { Chunk } from "../segment.ts";

export interface WorkerJob {
  bundle: string;
  dir: string;
  view: View;
  fps: number;
  chunk: Chunk;
  framesDir: string;
  prevFingerprints?: [number, string][];
  only?: number[];
}

/** worker → main */
export type WorkerMessage =
  | { type: "frame"; i: number }
  | { type: "print"; i: number; fp: string }
  | { type: "tts"; id: number; body: unknown }
  | { type: "done" }
  | { type: "error"; message: string };

/** main → worker */
export type MainMessage = { type: "tts"; id: number; ok: boolean; value?: unknown; error?: string };

const port = parentPort!;
const job = workerData as WorkerJob;
const post = (m: WorkerMessage) => port.postMessage(m);

let nextId = 0;
const waiting = new Map<number, { ok: (v: unknown) => void; ng: (e: Error) => void }>();
port.on("message", (m: MainMessage) => {
  const w = waiting.get(m.id);
  if (!w) return;
  waiting.delete(m.id);
  if (m.ok) w.ok(m.value);
  else w.ng(new Error(m.error));
});
setTTSHook(
  (body) =>
    new Promise((ok, ng) => {
      const id = nextId++;
      waiting.set(id, { ok, ng });
      post({ type: "tts", id, body });
    }),
);

try {
  const reel = (await import(pathToFileURL(job.bundle).href)).default;
  const only = job.only ? new Set(job.only) : undefined;
  await paintChunk({
    reel,
    dir: job.dir,
    view: job.view,
    fps: job.fps,
    chunk: job.chunk,
    framesDir: job.framesDir,
    prevFingerprints: job.prevFingerprints ? new Map(job.prevFingerprints) : undefined,
    shouldRender: only ? (i) => only.has(i) : undefined,
    onFrame: (i) => post({ type: "frame", i }),
    onFingerprint: (i, fp) => post({ type: "print", i, fp }),
  });
  post({ type: "done" });
} catch (err) {
  post({ type: "error", message: err instanceof Error ? (err.stack ?? err.message) : String(err) });
}
