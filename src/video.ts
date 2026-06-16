// kamishibai/video — frame-accurate video, the kamishibai way.
// ------------------------------------------------------------------
// A raw HTML <video> can't be addressed by frame: video.currentTime is an
// approximate, async, decoder-dependent seek, so the same `ms` can yield
// different frames across runs — which breaks kamishibai's "frame i is a
// pure function of its time" invariant (parallel workers would disagree).
//
// Instead we decode the clip with WebCodecs (demuxed by mp4box) into an
// indexed set of frames, then `frameAtMs(ms)` returns the exact frame whose
// presentation time is <= ms. Deterministic, frame-accurate, and it turns a
// video back into a pure function of time — so it slots straight into seek().
//
// Runs in the page (the kamishibai server is on localhost = a secure context,
// where WebCodecs is available). The src must be fetchable by the browser
// (e.g. served via --public), NOT a filesystem path.
//
// NOTE: this decodes the whole clip into memory up front (ImageBitmaps). Great
// for short overlays; for long/large clips a streaming, keyframe-seeking
// decoder would be the next step.
import { createFile, DataStream } from "mp4box";

export interface DecodedVideo {
  width: number;
  height: number;
  durationMs: number;
  /** number of decoded frames */
  count: number;
  /** the frame whose presentation time is the latest <= ms (clamped) */
  frameAtMs(ms: number): ImageBitmap | undefined;
  /** release all decoded bitmaps */
  close(): void;
}

interface Frame {
  tsMs: number;
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

/** Fetch + demux + decode an entire clip into indexed frames. */
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
  const frames: Frame[] = [];

  const decoded = new Promise<{ width: number; height: number; durationMs: number }>(
    (resolve, reject) => {
      const pending: Promise<void>[] = [];
      let info: { width: number; height: number; durationMs: number } | undefined;

      const decoder = new VideoDecoder({
        output: (frame) => {
          const tsMs = frame.timestamp / 1000;
          pending.push(
            createImageBitmap(frame).then((bitmap) => {
              frames.push({ tsMs, bitmap });
              frame.close();
            }),
          );
        },
        error: (e) => reject(e),
      });

      file.onError = (e: string) => reject(new Error(`mp4box: ${e}`));

      file.onReady = (movie: any) => {
        const track = movie.videoTracks?.[0];
        if (!track) {
          reject(new Error("no video track found"));
          return;
        }
        info = {
          width: track.track_width,
          height: track.track_height,
          durationMs: (movie.duration / movie.timescale) * 1000,
        };
        decoder.configure({
          codec: track.codec,
          codedWidth: track.track_width,
          codedHeight: track.track_height,
          description: codecDescription(file, track.id),
        });
        file.setExtractionOptions(track.id, null, { nbSamples: Infinity });
        file.start();
      };

      file.onSamples = (_id: number, _user: unknown, samples: any[]) => {
        for (const s of samples) {
          decoder.decode(
            new EncodedVideoChunk({
              type: s.is_sync ? "key" : "delta",
              timestamp: (s.cts / s.timescale) * 1e6, // microseconds
              duration: (s.duration / s.timescale) * 1e6,
              data: s.data,
            }),
          );
        }
      };

      file.appendBuffer(buf);
      file.flush();

      decoder
        .flush()
        .then(() => Promise.all(pending))
        .then(() => {
          decoder.close();
          if (!info) throw new Error("video never became ready");
          resolve(info);
        })
        .catch(reject);
    },
  );

  const meta = await decoded;
  frames.sort((a, b) => a.tsMs - b.tsMs); // presentation order (handles B-frames)

  return {
    width: meta.width,
    height: meta.height,
    durationMs: meta.durationMs,
    count: frames.length,
    frameAtMs(ms: number) {
      if (frames.length === 0) return undefined;
      // binary search: latest frame with tsMs <= ms
      let lo = 0;
      let hi = frames.length - 1;
      let best = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (frames[mid]!.tsMs <= ms) {
          best = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      return frames[best]!.bitmap;
    },
    close() {
      for (const f of frames) f.bitmap.close();
      frames.length = 0;
    },
  };
}
