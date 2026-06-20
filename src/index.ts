// kamishibai — public library surface.
// ------------------------------------------------------------------
// Slice a web page into parallel-capturable units, seek through time,
// and bake each frame into an mp4. A mechanism, not a framework.
// ------------------------------------------------------------------
export { render, encode } from "./render.ts";
export type { RenderOptions, RenderResult, EncodeFramesDirOptions, EncodeResult } from "./render.ts";

export { audio } from "./audio.ts";
export type { AudioClip, AudioManifest } from "./audio.ts";

// TTS / narration: browser-side refs + the Node-side engine (custom adapters).
export {
  sayAdapter,
  openaiAdapter,
  elevenLabsAdapter,
  googleAdapter,
  pollyAdapter,
  prepareNarration,
} from "./tts/index.ts";
export type { TTSAdapterRef, NarrationClip, NarrationInput } from "./tts/index.ts";
export { createTTSEngine } from "./tts/engine.ts";
export type { TTSAdapter, TTSEngine, TTSEngineOptions, TTSFormat } from "./tts/engine.ts";

export {
  GLOBAL_KEY,
  frameCount,
  frameTimeMs,
} from "./protocol.ts";
export type { KamishibaiMeta, KamishibaiPage } from "./protocol.ts";

export { splitFrames, chunkIndices } from "./segment.ts";
export type { Chunk } from "./segment.ts";

export { fnv1a64 } from "./fingerprint.ts";
export {
  parseFrameRanges,
  manifestMatches,
  manifestFrames,
  buildManifest,
  readManifest,
  writeManifest,
  MANIFEST_FILE,
  MANIFEST_VERSION,
} from "./incremental.ts";
export type { FrameManifest, ManifestKey } from "./incremental.ts";

// Lower-level building blocks, in case you want to assemble your own pipeline.
export { probeMeta, captureChunk } from "./renderer.ts";
export type { ChunkMarkers } from "./renderer.ts";
export { renderPool } from "./pool.ts";
export type { PoolMarkers } from "./pool.ts";
export { serveEntry } from "./serve.ts";
export type { Served } from "./serve.ts";
export {
  assertFfmpeg,
  encodeFrames,
  encodeGif,
  muxAudio,
  muxSubtitles,
  buildAudioGraph,
  volumeExpr,
  hasAudioStream,
} from "./ffmpeg.ts";

// Assembling kept frames into a video (the stage `render`/`encode` share).
export { assemble, readMuxSidecar, writeMuxSidecar } from "./assemble.ts";
export type { AssembleOptions, MuxSidecar } from "./assemble.ts";

// Subtitle parsing / serialization (also its own entry: kamishibai/subtitle).
export {
  parseSubtitles,
  loadSubtitles,
  cueAt,
  mergeCues,
  cuesToSrt,
} from "./subtitle.ts";
export type { Cue } from "./subtitle.ts";
