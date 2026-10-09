// Driving one Chrome through a chunk of frames.
// ------------------------------------------------------------------
// seek(ms) -> let the DOM settle -> screenshot -> advance. No real-time
// playback, so a slow frame just takes longer; it never drops.
// ------------------------------------------------------------------
import { chromium, errors, type Browser, type Page } from "playwright";
import { copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { GLOBAL_KEY, frameTimeMs, type KamishibaiMeta } from "./protocol.ts";
import { chunkIndices, type Chunk } from "./segment.ts";
import type { AudioClip } from "./audio.ts";
import type { Cue } from "./subtitle.ts";

/** What a chunk collected from the page: audio + subtitle markers. */
export interface ChunkMarkers {
  audio: AudioClip[];
  subtitles: Cue[];
}

const frameName = (i: number): string => `f${String(i).padStart(6, "0")}.png`;

/** How one frame was produced and where its time went (see `onTiming`). */
export interface FrameTiming {
  index: number;
  /** shot = settled + screenshot; copy = same as the previous frame;
   *  cached = last run's PNG kept; skipped = not selected by --only */
  kind: "shot" | "copy" | "cached" | "skipped";
  /** the seek() round trip, page work included (ms) */
  seekMs: number;
  /** the extra double-rAF settle before a screenshot (ms; 0 unless shot) */
  settleMs: number;
  /** page.screenshot, encode + write included (ms; 0 unless shot) */
  shotMs: number;
  /** copying the previous still (ms; 0 unless copy) */
  copyMs: number;
}

/** How long to wait for a page to expose window.kamishibai. */
export interface ReelWaitOptions {
  /** give up after this long with nothing in progress (ms; default 15s) */
  timeoutMs?: number;
  /** while this returns true the wait is making progress (e.g. narration is
   *  still being synthesized), so the timeout keeps resetting */
  busy?: () => boolean;
  /** extra context appended to the timeout error (e.g. TTS progress) */
  describe?: () => string | undefined;
  /** a reason the page can no longer load (e.g. a narration line failed and
   *  nothing is still in flight); once it has held for a short grace — room
   *  for a page that catches the error and mounts anyway — the wait fails with
   *  it instead of running out the idle timeout */
  failed?: () => string | undefined;
  /** receives what the page reports: each uncaught page error ("page error:
   *  …"), and, while capturing, console warnings/errors starting with
   *  "kamishibai" (e.g. a dropped subtitle cue). Called once per page, so
   *  parallel workers repeat a message; dedupe if needed. */
  onPageLog?: (msg: string) => void;
}

/**
 * Listen to a page before it loads: forward its uncaught errors (and, with
 * `forwardConsole`, its "kamishibai…" console warnings/errors) to `onPageLog`,
 * and return wait options whose failure messages name every distinct error the
 * page threw, in order (a harmless early throw must not hide the one that
 * stopped the mount). A page error never ends the wait by itself — the page may
 * still mount (a stray async throw, or narration still synthesizing) — but a
 * reel that throws before mount() then fails at the idle timeout with them.
 */
export function watchPage(page: Page, wait: ReelWaitOptions = {}, forwardConsole = false): ReelWaitOptions {
  const thrown: string[] = [];
  page.on("pageerror", (err) => {
    if (!thrown.includes(err.message)) thrown.push(err.message);
    wait.onPageLog?.(`page error: ${err.message}`);
  });
  if (forwardConsole) {
    page.on("console", (msg) => {
      const type = msg.type();
      if ((type === "warning" || type === "error") && msg.text().startsWith("kamishibai")) {
        wait.onPageLog?.(msg.text());
      }
    });
  }
  const withThrown = (msg: string | undefined): string | undefined => {
    const t = thrown.length > 0 ? `the page threw: ${thrown.join(" | ")}` : undefined;
    return msg && t ? `${msg}; ${t}` : (msg ?? t);
  };
  return {
    ...wait,
    describe: () => withThrown(wait.describe?.()),
    failed: () => {
      const f = wait.failed?.();
      return f ? withThrown(f) : undefined;
    },
  };
}

/** How long a `failed()` reason must persist before waitForReel gives up. */
const FAIL_GRACE_MS = 1000;

/**
 * Wait for the page to expose window.kamishibai. The timeout counts *idle*
 * time only: a reel that top-level-awaits prepareNarration legitimately takes
 * as long as its first synthesis, so while `busy()` reports work in flight the
 * clock restarts instead of failing a slow-but-progressing load.
 */
export async function waitForReel(page: Page, opts: ReelWaitOptions = {}): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  let idleSince = Date.now();
  let failedSince: number | undefined;
  for (;;) {
    const sliceMs = Math.max(1, Math.min(1000, timeoutMs - (Date.now() - idleSince)));
    try {
      await page.waitForFunction((key) => !!(window as any)[key], GLOBAL_KEY, { timeout: sliceMs });
      return;
    } catch (err) {
      if (!(err instanceof errors.TimeoutError)) throw err;
    }
    if (opts.busy?.()) idleSince = Date.now();
    const failure = opts.failed?.();
    if (!failure) failedSince = undefined;
    else if (failedSince === undefined) failedSince = Date.now();
    else if (Date.now() - failedSince >= FAIL_GRACE_MS) {
      throw new Error(`the page didn't expose window.${GLOBAL_KEY} — ${failure}`);
    }
    if (Date.now() - idleSince >= timeoutMs) {
      const extra = opts.describe?.();
      throw new Error(
        `the page didn't expose window.${GLOBAL_KEY} within ${timeoutMs / 1000}s` +
          (extra ? ` — ${extra}` : ` (does it call mount() / set window.${GLOBAL_KEY}?)`),
      );
    }
  }
}

/** Open the page just long enough to read its declared `meta`. */
export async function probeMeta(url: string, wait: ReelWaitOptions = {}): Promise<KamishibaiMeta> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const watched = watchPage(page, wait);
    await page.goto(url, { waitUntil: "load" });
    await waitForReel(page, watched);
    const meta = await page.evaluate(
      (key) => (window as any)[key].meta as KamishibaiMeta,
      GLOBAL_KEY,
    );
    assertMeta(meta);
    return meta;
  } finally {
    await browser.close();
  }
}

function assertMeta(meta: KamishibaiMeta): void {
  const ok =
    meta &&
    [meta.fps, meta.durationMs, meta.width, meta.height].every(
      (n) => typeof n === "number" && n > 0,
    );
  if (!ok) {
    throw new Error(
      `window.${GLOBAL_KEY}.meta is missing or invalid. ` +
        `Expected { fps, durationMs, width, height } as positive numbers, got: ${JSON.stringify(meta)}`,
    );
  }
}

export interface CaptureChunkOptions {
  url: string;
  meta: KamishibaiMeta;
  chunk: Chunk;
  framesDir: string;
  /** device scale factor — output pixels = meta size × scale (default 1) */
  scale?: number;
  /** called after each frame is written, with the frame index */
  onFrame?: (index: number) => void;
  /** called with each frame's fingerprint, when the page returns one (used to
   *  build the cross-run manifest) */
  onFingerprint?: (index: number, fp: string) => void;
  /** previous run's fingerprints (frame index -> print); a frame whose new
   *  print matches and whose PNG already exists is left untouched */
  prevFingerprints?: Map<number, string>;
  /** --only: render just these frame indices; others are left as-is on disk.
   *  When omitted, every frame is rendered. */
  shouldRender?: (index: number) => boolean;
  /** reuse an existing browser instead of launching one */
  browser?: Browser;
  /** how long to wait for the page to expose window.kamishibai */
  wait?: ReelWaitOptions;
  /** called after each frame with where its time went — for benchmarking;
   *  costs two clock reads per phase when set, nothing when not */
  onTiming?: (t: FrameTiming) => void;
  /** with `onTiming`, receives what the page itself recorded per seek (the
   *  entries a page pushes onto `window.__KAMISHIBAI_BENCH__`; kamishibai/react
   *  records its commit / settler / paint / fingerprint phases there) */
  onPageTimings?: (entries: unknown[]) => void;
}

/**
 * Render every frame in `chunk` into `framesDir` as f000000.png …, and
 * return the audio + subtitle markers the page collected while these frames
 * mounted.
 */
export async function captureChunk(opts: CaptureChunkOptions): Promise<ChunkMarkers> {
  const { url, meta, chunk, framesDir, onFrame, onFingerprint, prevFingerprints, shouldRender, onTiming } = opts;
  const now = onTiming ? () => performance.now() : () => 0;
  const browser = opts.browser ?? (await chromium.launch());
  const owns = !opts.browser;
  try {
    const page = await browser.newPage({
      // Layout is in CSS pixels (meta size); scale only multiplies the
      // captured pixels, so a 1920×1080 reel at scale 2 yields 3840×2160.
      viewport: { width: meta.width, height: meta.height },
      deviceScaleFactor: opts.scale ?? 1,
    });
    const watched = watchPage(page, opts.wait, true);
    // The page samples at meta.fps (--fps may override the page's own), so
    // tell it before any reel code runs: kamishibai/react sizes its sub-frame
    // windows on this grid.
    await page.addInitScript((fps) => {
      (window as { __KAMISHIBAI_FPS__?: number }).__KAMISHIBAI_FPS__ = fps;
    }, meta.fps);
    // Benchmarking: ask the page to record its own per-seek phases too.
    if (onTiming) {
      await page.addInitScript(() => {
        (window as { __KAMISHIBAI_BENCH__?: unknown[] }).__KAMISHIBAI_BENCH__ = [];
      });
    }
    await page.goto(url, { waitUntil: "networkidle" });
    await waitForReel(page, watched);
    // Web fonts must be ready before the first capture, or text reflows.
    await page.evaluate(() => document.fonts.ready);

    const clip = { x: 0, y: 0, width: meta.width, height: meta.height };
    let prevPath: string | undefined;
    let prevFp: string | undefined;
    for (const i of chunkIndices(chunk)) {
      const ms = frameTimeMs(i, meta.fps);
      const thisPath = join(framesDir, frameName(i));

      // --only: this frame isn't selected — leave whatever's on disk. We don't
      // even seek. Break the copy chain (prevPath + prevFp) so the next selected
      // frame can't copy across an unrendered gap: its `false` means "same as
      // my previous seek", which wasn't this frame, so it must be screenshot.
      if (shouldRender && !shouldRender(i)) {
        prevPath = undefined;
        prevFp = undefined;
        onTiming?.({ index: i, kind: "skipped", seekMs: 0, settleMs: 0, shotMs: 0, copyMs: 0 });
        onFrame?.(i);
        continue;
      }

      // Build the still for `ms`; awaits the page's seek() promise. It returns
      // `false` (identical to the previous frame), a fingerprint string, or
      // void/true (capture normally).
      const t0 = now();
      const changed = (await page.evaluate(
        ([key, t]) => Promise.resolve((window as any)[key].seek(t)),
        [GLOBAL_KEY, ms] as const,
      )) as boolean | string | undefined;

      const t1 = now();
      const fp = typeof changed === "string" ? changed : undefined;
      if (fp !== undefined) onFingerprint?.(i, fp);

      // Same as last run's frame, and that PNG is still on disk: leave it
      // untouched (checked first, so an unchanged frame is never even copied).
      const cacheHit =
        fp !== undefined && prevFingerprints?.get(i) === fp && existsSync(thisPath);
      // Else, same as the previous frame in this run: an explicit false, or a
      // print equal to the previous frame's print — copy it.
      const sameAsPrev =
        !cacheHit && !!prevPath && (changed === false || (fp !== undefined && fp === prevFp));

      let t2 = t1;
      if (cacheHit) {
        // The cached still is already correct on disk — nothing to do.
      } else if (sameAsPrev) {
        // Static span: copy the last still — no settle, no screenshot.
        await copyFile(prevPath!, thisPath);
      } else {
        // Guarantee a settled paint even if seek() resolved early.
        await page.evaluate(
          () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
        );
        t2 = now();
        await page.screenshot({ path: thisPath, clip });
      }
      if (onTiming) {
        const t3 = now();
        const kind = cacheHit ? "cached" : sameAsPrev ? "copy" : "shot";
        onTiming({
          index: i,
          kind,
          seekMs: t1 - t0,
          settleMs: kind === "shot" ? t2 - t1 : 0,
          shotMs: kind === "shot" ? t3 - t2 : 0,
          copyMs: kind === "copy" ? t3 - t1 : 0,
        });
      }
      // After a cache hit the file already exists; either way thisPath is the
      // current still for the copy chain.
      prevPath = thisPath;
      prevFp = fp;
      onFrame?.(i);
    }
    // Audio + subtitle markers the page pushed (or a raw page set) over this
    // frame range.
    const markers = (await page.evaluate((key) => {
      const k = (window as any)[key];
      return {
        audio: k && Array.isArray(k.audio) ? k.audio : [],
        subtitles: k && Array.isArray(k.subtitles) ? k.subtitles : [],
      };
    }, GLOBAL_KEY)) as ChunkMarkers;
    if (onTiming && opts.onPageTimings) {
      opts.onPageTimings(
        await page.evaluate(() => (window as { __KAMISHIBAI_BENCH__?: unknown[] }).__KAMISHIBAI_BENCH__ ?? []),
      );
    }
    await page.close();
    return markers;
  } finally {
    if (owns) await browser.close();
  }
}
