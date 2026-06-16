// kamishibai — public library surface.
// ------------------------------------------------------------------
// Slice a web page into parallel-capturable units, seek through time,
// and bake each frame into an mp4. A mechanism, not a framework.
// ------------------------------------------------------------------
export { render } from "./render.ts";
export type { RenderOptions, RenderResult } from "./render.ts";

export { audio } from "./audio.ts";
export type { AudioClip, AudioManifest } from "./audio.ts";

export {
  GLOBAL_KEY,
  frameCount,
  frameTimeMs,
} from "./protocol.ts";
export type { KamishibaiMeta, KamishibaiPage } from "./protocol.ts";

export { splitFrames, chunkIndices } from "./segment.ts";
export type { Chunk } from "./segment.ts";

// Lower-level building blocks, in case you want to assemble your own pipeline.
export { probeMeta, captureChunk } from "./renderer.ts";
export { renderPool } from "./pool.ts";
export { serveEntry } from "./serve.ts";
export type { Served } from "./serve.ts";
export {
  assertFfmpeg,
  encodeFrames,
  muxAudio,
  buildAudioGraph,
  volumeExpr,
  hasAudioStream,
} from "./ffmpeg.ts";
