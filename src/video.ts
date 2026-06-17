// kamishibai/video — frame-accurate video, the kamishibai way.
// ------------------------------------------------------------------
// A raw HTML <video> can't be addressed by frame: video.currentTime is an
// approximate, async, decoder-dependent seek, so the same `ms` can yield
// different frames across runs — which breaks kamishibai's "frame i is a
// pure function of its time" invariant (parallel workers would disagree).
//
// Instead we demux the clip with mp4box into an index of *encoded* samples
// (compressed — a few KB each), then decode on demand: `frameAtMs(ms)` finds
// the sample whose presentation time is <= ms, decodes just that frame's GOP
// (keyframe → next keyframe) with WebCodecs, and returns the exact frame.
// Deterministic, frame-accurate, and a pure function of time — it slots
// straight into seek().
//
// Memory: we hold only the compressed samples plus one decoded GOP at a time,
// instead of every decoded frame at once (a 1080p clip is ~8 MB *per frame*
// decoded). Because kamishibai renders frames in increasing-time order within
// a worker, calls walk forward through GOPs and we decode each one roughly
// once — same total work as decoding up front, but bounded memory, so long
// clips no longer blow up the heap.
//
// Runs in the page (the kamishibai server is on localhost = a secure context,
// where WebCodecs is available). The src must be fetchable by the browser
// (e.g. served via --public), NOT a filesystem path.
import { createFile, DataStream } from "mp4box";

export interface DecodedVideo {
  width: number;
  height: number;
  durationMs: number;
  /** number of frames in the clip */
  count: number;
  /** the frame whose presentation time is the latest <= ms (clamped); decodes
   *  on demand, so it's async */
  frameAtMs(ms: number): Promise<ImageBitmap | undefined>;
  /** release the cached frames and the decoder */
  close(): void;
}

interface Sample {
  /** composition (presentation) time, ms */
  ctsMs: number;
  /** is this a sync sample (keyframe) — the start of a decodable GOP */
  isSync: boolean;
  /** the compressed chunk, fed to the decoder on demand */
  chunk: EncodedVideoChunk;
}

interface DecodedFrame {
  ctsMs: number;
  bitmap: ImageBitmap;
}

// Pull the codec-specific description (avcC/hvcC/vpcC/av1C) for VideoDecoder.
function codecDescription(file: any, trackId: number): Uint8Array | undefined {
  const trak = file.getTrackById(trackId);
  for (const entry of trak.mdia.minf.stbl.stsd.entries) {
    const box = entry.avcC ?? entry.hvcC ?? entry.vpcC ?? entry.av1C;
    if (box) {
      const stream = new DataStream(undefined, 0, (DataStream as any).BIG_ENDIAN);
      box.write(stream);
      return new Uint8Array(stream.buffer, 8); // strip the 8-byte box header
    }
  }
  return undefined;
}

/** latest index i in `arr` (already sorted ascending by `key`) with key(i) <= x */
function lastLE<T>(arr: T[], x: number, key: (v: T) => number): number {
  let lo = 0;
  let hi = arr.length - 1;
  let best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (key(arr[mid]!) <= x) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

/** Fetch + demux a clip into an index of encoded samples, decoding on demand. */
export async function loadVideo(src: string): Promise<DecodedVideo> {
  if (typeof VideoDecoder === "undefined") {
    throw new Error(
      "WebCodecs VideoDecoder is unavailable. kamishibai serves on localhost " +
        "(a secure context) where it should exist — check the Chromium build.",
    );
  }

  const buf = (await (await fetch(src)).arrayBuffer()) as ArrayBuffer & { fileStart: number };
  buf.fileStart = 0;

  const file = createFile();
  // Samples in *decode* order (mp4box hands them over in file order). We keep
  // them compressed and decode on demand in frameAtMs.
  const samples: Sample[] = [];
  let config: VideoDecoderConfig | undefined;
  let meta: { width: number; height: number; durationMs: number } | undefined;

  await new Promise<void>((resolve, reject) => {
    file.onError = (e: string) => reject(new Error(`mp4box: ${e}`));

    file.onReady = (movie: any) => {
      const track = movie.videoTracks?.[0];
      if (!track) {
        reject(new Error("no video track found"));
        return;
      }
      meta = {
        width: track.track_width,
        height: track.track_height,
        durationMs: (movie.duration / movie.timescale) * 1000,
      };
      config = {
        codec: track.codec,
        codedWidth: track.track_width,
        codedHeight: track.track_height,
        description: codecDescription(file, track.id),
      };
      file.setExtractionOptions(track.id, null, { nbSamples: Infinity });
      file.start();
    };

    file.onSamples = (_id: number, _user: unknown, chunkSamples: any[]) => {
      for (const s of chunkSamples) {
        samples.push({
          ctsMs: (s.cts / s.timescale) * 1000,
          isSync: !!s.is_sync,
          chunk: new EncodedVideoChunk({
            type: s.is_sync ? "key" : "delta",
            timestamp: (s.cts / s.timescale) * 1e6, // microseconds
            duration: (s.duration / s.timescale) * 1e6,
            data: s.data,
          }),
        });
      }
    };

    // The whole file is present, so appendBuffer + flush drives onReady and
    // every onSamples synchronously; once they return, the index is complete.
    file.appendBuffer(buf);
    file.flush();
    if (!meta || !config) {
      reject(new Error("video never became ready"));
      return;
    }
    resolve();
  });

  const cfg = config!;
  const info = meta!;

  // Presentation order (handles B-frames): indices into `samples`, sorted by
  // ctsMs, for "which frame is shown at ms".
  const byCts = samples.map((_, i) => i).sort((a, b) => samples[a]!.ctsMs - samples[b]!.ctsMs);
  // Decode-order indices of the sync samples — the GOP boundaries.
  const syncIdx: number[] = [];
  samples.forEach((s, i) => {
    if (s.isSync) syncIdx.push(i);
  });

  // [start, end) decode-order range of the GOP containing decode index `d`.
  function gopRange(d: number): [number, number] {
    if (syncIdx.length === 0) return [0, samples.length]; // no keyframes? one GOP
    const k = lastLE(syncIdx, d, (i) => i); // index into syncIdx
    const start = syncIdx[k]!;
    const end = k + 1 < syncIdx.length ? syncIdx[k + 1]! : samples.length;
    return [start, end];
  }

  // A single decoder, reused across GOPs. Its output is routed to whichever
  // decode is currently running (calls are serialised, so no overlap).
  let onOutput: ((f: VideoFrame) => void) | undefined;
  const decoder = new VideoDecoder({
    output: (frame) => onOutput?.(frame),
    error: (e) => {
      throw e;
    },
  });
  decoder.configure(cfg);

  // The one GOP we keep decoded, plus the decode-order index it starts at.
  let cachedStart = -1;
  let cachedFrames: DecodedFrame[] = [];

  function releaseCache() {
    for (const f of cachedFrames) f.bitmap.close();
    cachedFrames = [];
  }

  async function decodeGop(start: number, end: number): Promise<DecodedFrame[]> {
    const out: DecodedFrame[] = [];
    const pending: Promise<void>[] = [];
    onOutput = (frame) => {
      const ctsMs = frame.timestamp / 1000;
      pending.push(
        createImageBitmap(frame).then((bitmap) => {
          out.push({ ctsMs, bitmap });
          frame.close();
        }),
      );
    };
    for (let i = start; i < end; i++) decoder.decode(samples[i]!.chunk);
    await decoder.flush(); // emit every frame of this GOP, then ready for the next
    await Promise.all(pending);
    onOutput = undefined;
    out.sort((a, b) => a.ctsMs - b.ctsMs);
    return out;
  }

  // Serialise frameAtMs: the decoder and cache are shared, so concurrent calls
  // (e.g. two <Video>s on the same clip in one page) must not interleave.
  let lock: Promise<unknown> = Promise.resolve();

  async function resolveFrame(ms: number): Promise<ImageBitmap | undefined> {
    if (samples.length === 0) return undefined;
    // The sample shown at ms: latest by presentation time with ctsMs <= ms.
    const p = lastLE(byCts, ms, (i) => samples[i]!.ctsMs);
    const d = byCts[p]!;
    const [start, end] = gopRange(d);
    if (cachedStart !== start) {
      const next = await decodeGop(start, end);
      releaseCache();
      cachedStart = start;
      cachedFrames = next;
    }
    if (cachedFrames.length === 0) return undefined;
    const fi = lastLE(cachedFrames, ms, (f) => f.ctsMs);
    return cachedFrames[fi]!.bitmap;
  }

  return {
    width: info.width,
    height: info.height,
    durationMs: info.durationMs,
    count: samples.length,
    frameAtMs(ms: number) {
      const run = lock.then(() => resolveFrame(ms));
      lock = run.catch(() => undefined);
      return run;
    },
    close() {
      releaseCache();
      cachedStart = -1;
      if (decoder.state !== "closed") decoder.close();
    },
  };
}
