// Driving one Chrome through a chunk of frames.
// ------------------------------------------------------------------
// seek(ms) -> let the DOM settle -> screenshot -> advance. No real-time
// playback, so a slow frame just takes longer; it never drops.
// ------------------------------------------------------------------
import { chromium, errors, type Browser, type CDPSession, type Page } from "playwright";
import { copyFile, writeFile } from "node:fs/promises";
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

/**
 * Headless Chrome paces rendering at 60 Hz, so every requestAnimationFrame
 * the capture waits on (in seek and before a screenshot) costs up to 16.7 ms.
 * Nothing here plays in real time, so lift the cap: a frame then comes as soon
 * as the previous one is drawn. It changes when frames are drawn, not what
 * they show.
 */
export const CHROME_ARGS = ["--disable-frame-rate-limit", "--disable-gpu-vsync"];

/**
 * Headless Chrome draws WebGL with SwiftShader, on the CPU. On macOS, ANGLE
 * over Metal puts it on the GPU, several times faster for a 3D scene. It also
 * moves the page's own painting to the GPU, which is slower for a page without
 * WebGL, so it's only used for a page that creates a WebGL context.
 */
export const GPU_CHROME_ARGS = process.platform === "darwin" ? ["--use-angle=metal"] : [];

/** Launch the headless Chrome a capture runs in; `gpu` for a WebGL page. */
export function launchChrome(gpu = false): Promise<Browser> {
  return chromium.launch({ args: gpu ? [...CHROME_ARGS, ...GPU_CHROME_ARGS] : CHROME_ARGS });
}

/**
 * Runs in the page just before a screenshot (passed to page.evaluate, so it
 * must not refer to anything outside itself).
 *
 * `settle`: first wait two animation frames, for a page whose seek() may
 * resolve before its last change is painted. A page that returns a print
 * (kamishibai/react) only does so once its DOM is final.
 *
 * Then make the paint independent of what this page painted before. Chrome
 * keeps some state for an element across frames: text animated in (its
 * opacity and transform changing together) stays on its own compositing layer
 * after the animation ends, and is rasterized a little differently from the
 * same text painted fresh. A frame's pixels then depend on the frames this
 * Chrome drew before it, so they change with the worker count (each worker
 * starts mid-reel). Hiding the body's contents for one forced layout drops
 * that state. It all happens within one task, so nothing on the page (a
 * ResizeObserver, a rAF) ever sees the body hidden, and the DOM, scroll
 * positions and paused CSS animations are left as they were.
 */
async function prepareShot(settle: boolean): Promise<void> {
  if (settle) await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  const body = document.body;
  if (!body) return;
  // Through the attribute, restored exactly: a print hashes it, and touching
  // body.style instead would leave an empty style="" behind.
  const was = body.getAttribute("style");
  body.setAttribute("style", `${was ?? ""};content-visibility:hidden`);
  void body.offsetHeight; // apply it: a style + layout pass with the contents skipped
  if (was === null) body.removeAttribute("style");
  else body.setAttribute("style", was);
}

/**
 * Screenshot the viewport into a PNG at `path`. Through CDP rather than
 * page.screenshot, to ask for the fast PNG encoder (`optimizeForSpeed`): the
 * pixels are the same, but compressing a busy 1080p frame takes a fraction of
 * the time (the PNG is larger, and only lives until the encode).
 */
async function screenshotPng(cdp: CDPSession, path: string, clip: { width: number; height: number; scale: number }): Promise<void> {
  const { data } = (await cdp.send("Page.captureScreenshot", {
    format: "png",
    optimizeForSpeed: true,
    // CDP sizes the image as clip × scale, ignoring the page's device scale
    // factor, so pass that as the scale.
    clip: { x: 0, y: 0, width: clip.width, height: clip.height, scale: clip.scale },
  })) as { data: string };
  await writeFile(path, Buffer.from(data, "base64"));
}

/** How one frame was produced and where its time went (see `onTiming`). */
export interface FrameTiming {
  index: number;
  /** shot = settled + screenshot; copy = same as the previous frame;
   *  cached = last run's PNG kept; skipped = not selected by --only */
  kind: "shot" | "copy" | "cached" | "skipped";
  /** the seek() round trip, page work included (ms) */
  seekMs: number;
  /** getting the page ready for a screenshot (ms; 0 unless shot): the paint
   *  state reset, after a double-rAF settle when seek() returned no print */
  settleMs: number;
  /** the screenshot, PNG encode + write included (ms; 0 unless shot) */
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
  return (await probeReel(url, wait)).meta;
}

/** What a probe learns about a reel: its meta, and whether it uses WebGL. */
export interface ReelProbe {
  meta: KamishibaiMeta;
  /** the page created a WebGL context by the time it exposed the reel */
  webgl: boolean;
}

/** Load the reel once, as `probeMeta` does, and also see whether it uses WebGL. */
export async function probeReel(url: string, wait: ReelWaitOptions = {}): Promise<ReelProbe> {
  const browser = await launchChrome();
  try {
    const page = await browser.newPage();
    await page.addInitScript(watchWebGL);
    const watched = watchPage(page, wait);
    await page.goto(url, { waitUntil: "load" });
    await waitForReel(page, watched);
    const { meta, webgl } = await page.evaluate(
      (key) => ({
        meta: (window as any)[key].meta as KamishibaiMeta,
        webgl: !!(window as { __KAMISHIBAI_WEBGL__?: boolean }).__KAMISHIBAI_WEBGL__,
      }),
      GLOBAL_KEY,
    );
    assertMeta(meta);
    return { meta, webgl };
  } finally {
    await browser.close();
  }
}

/** Runs in the page before its own scripts: flag any WebGL context it creates. */
function watchWebGL(): void {
  for (const proto of [globalThis.HTMLCanvasElement?.prototype, globalThis.OffscreenCanvas?.prototype]) {
    if (!proto) continue;
    const getContext = proto.getContext as (this: unknown, type: string, ...rest: unknown[]) => unknown;
    (proto as { getContext: unknown }).getContext = function (this: unknown, type: string, ...rest: unknown[]) {
      const ctx = getContext.call(this, type, ...rest);
      if (ctx && /^(experimental-)?webgl/.test(type)) {
        (window as { __KAMISHIBAI_WEBGL__?: boolean }).__KAMISHIBAI_WEBGL__ = true;
      }
      return ctx;
    };
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
  /** launch Chrome with WebGL on the GPU (see `probeReel`); ignored with `browser` */
  gpu?: boolean;
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
  const browser = opts.browser ?? (await launchChrome(opts.gpu));
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

    const cdp = await page.context().newCDPSession(page);
    const clip = { width: meta.width, height: meta.height, scale: opts.scale ?? 1 };
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
        await page.evaluate(prepareShot, fp === undefined);
        t2 = now();
        await screenshotPng(cdp, thisPath, clip);
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
