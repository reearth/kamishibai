// Frame-accurate video via WebCodecs — raw API (no React).
// ------------------------------------------------------------------
// Decodes a clip with kamishibai/video and, on each seek(ms), draws the
// exact frame whose presentation time is <= ms. The clip is served via
// --public, so the browser can fetch it. seek() is async, so the renderer
// waits for the decode/draw before screenshotting.
//
// seek() returns a fingerprint so this canvas reel works with --incremental:
// a canvas's pixels are invisible to the renderer, so a React reel's automatic
// DOM hash wouldn't see them — a raw page names what it drew instead. Here the
// frame is fully described by (shown video frame, reel frame index), both pure
// functions of ms and read without decoding.
//
//   node dist/cli.js render examples/video/index.ts \
//     --public examples/video/public -o video.mp4
import { loadVideo, type DecodedVideo } from "../../src/video.ts";

const meta = { fps: 30, durationMs: 3000, width: 480, height: 270 };

const canvas = document.createElement("canvas");
canvas.width = meta.width;
canvas.height = meta.height;
canvas.style.cssText = "position:absolute;top:0;left:0";
document.body.appendChild(canvas);
const ctx = canvas.getContext("2d")!;

let video: DecodedVideo | undefined;
const ready = loadVideo("/clip.mp4").then((v) => {
  video = v;
});

window.kamishibai = {
  meta,
  async seek(ms) {
    await ready;
    ctx.clearRect(0, 0, meta.width, meta.height);
    const bmp = await video?.frameAtMs(ms);
    if (bmp) ctx.drawImage(bmp, 0, 0, meta.width, meta.height);

    // Overlay the reel's own frame index to compare with the clip's HUD.
    const f = Math.round((ms * meta.fps) / 1000);
    ctx.fillStyle = "rgba(0,0,0,0.75)";
    ctx.fillRect(0, meta.height - 38, 150, 38);
    ctx.fillStyle = "#37ff8b";
    ctx.font = "22px monospace";
    ctx.fillText(`reel f=${f}`, 8, meta.height - 12);

    // The fingerprint: which clip frame is shown, plus the HUD's frame index.
    // Cheap (no decode) and a pure function of ms, so frames that match across
    // runs are reused under --incremental.
    return `${video?.frameIndexAtMs(ms) ?? -1}#${f}`;
  },
};
