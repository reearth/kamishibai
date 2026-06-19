// Driving one Chrome through a chunk of frames.
// ------------------------------------------------------------------
// seek(ms) -> let the DOM settle -> screenshot -> advance. No real-time
// playback, so a slow frame just takes longer; it never drops.
// ------------------------------------------------------------------
import { chromium, type Browser } from "playwright";
import { copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { GLOBAL_KEY, frameTimeMs, type KamishibaiMeta } from "./protocol.ts";
import { chunkIndices, type Chunk } from "./segment.ts";
import type { AudioClip } from "./audio.ts";

const frameName = (i: number): string => `f${String(i).padStart(6, "0")}.png`;

/** Open the page just long enough to read its declared `meta`. */
export async function probeMeta(url: string): Promise<KamishibaiMeta> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "load" });
    await page.waitForFunction((key) => !!(window as any)[key], GLOBAL_KEY, {
      timeout: 15_000,
    });
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
}

/**
 * Render every frame in `chunk` into `framesDir` as f000000.png …, and
 * return any audio markers the page collected while these frames mounted.
 */
export async function captureChunk(opts: CaptureChunkOptions): Promise<AudioClip[]> {
  const { url, meta, chunk, framesDir, onFrame, onFingerprint, prevFingerprints, shouldRender } = opts;
  const browser = opts.browser ?? (await chromium.launch());
  const owns = !opts.browser;
  try {
    const page = await browser.newPage({
      // Layout is in CSS pixels (meta size); scale only multiplies the
      // captured pixels, so a 1920×1080 reel at scale 2 yields 3840×2160.
      viewport: { width: meta.width, height: meta.height },
      deviceScaleFactor: opts.scale ?? 1,
    });
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForFunction((key) => !!(window as any)[key], GLOBAL_KEY, {
      timeout: 15_000,
    });
    // Web fonts must be ready before the first capture, or text reflows.
    await page.evaluate(() => document.fonts.ready);

    const clip = { x: 0, y: 0, width: meta.width, height: meta.height };
    let prevPath: string | undefined;
    let prevFp: string | undefined;
    for (const i of chunkIndices(chunk)) {
      const ms = frameTimeMs(i, meta.fps);
      const thisPath = join(framesDir, frameName(i));

      // --only: this frame isn't selected — leave whatever's on disk. We don't
      // even seek. Break the copy chain (prevFp) so the next selected frame
      // can't copy across an unrendered gap.
      if (shouldRender && !shouldRender(i)) {
        if (existsSync(thisPath)) prevPath = thisPath;
        prevFp = undefined;
        onFrame?.(i);
        continue;
      }

      // Build the still for `ms`; awaits the page's seek() promise. It returns
      // `false` (identical to the previous frame), a fingerprint string, or
      // void/true (capture normally).
      const changed = (await page.evaluate(
        ([key, t]) => Promise.resolve((window as any)[key].seek(t)),
        [GLOBAL_KEY, ms] as const,
      )) as boolean | string | undefined;

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
        await page.screenshot({ path: thisPath, clip });
      }
      // After a cache hit the file already exists; either way thisPath is the
      // current still for the copy chain.
      prevPath = thisPath;
      prevFp = fp;
      onFrame?.(i);
    }
    // Audio markers <Audio> pushed (or a raw page set) over this frame range.
    const markers = (await page.evaluate((key) => {
      const k = (window as any)[key];
      return k && Array.isArray(k.audio) ? k.audio : [];
    }, GLOBAL_KEY)) as AudioClip[];
    await page.close();
    return markers;
  } finally {
    if (owns) await browser.close();
  }
}
