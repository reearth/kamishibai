# kamishibai

> **Slice a web page into parallel-capturable units, seek through time, and bake each frame into an mp4. That's it.**
> A *mechanism*, not a framework. How you draw — React, plain DOM, canvas, WebGL — is up to you.

`kamishibai` turns any web page (DOM, canvas, anything) into a video by **seeking to each moment and capturing a still**, then assembling the stills with `ffmpeg`. Because every frame is a pure function of its time, capture is deterministic and **trivially parallelisable** across several headless Chrome instances.

It deliberately does *not* try to be a frame-accurate compositing engine or ship an editor. It gives you the renderer and one tiny contract; the rest is yours.

- **Free · DOM-or-anything · code/CI-first · AI-friendly · no guarantees (MIT)** — a corner of the programmatic-video space nothing else occupies.
- If you need a guaranteed, frame-accurate media engine, reach for [Remotion](https://www.remotion.dev/) instead.

---

## How it works

### The one and only contract

A capturable page exposes exactly one global:

```ts
window.kamishibai = {
  meta: { fps: 30, durationMs: 6000, width: 1920, height: 1080 },
  // Build the still state for `ms` and resolve once the DOM has settled.
  seek(ms: number): Promise<void>;
};
```

Whatever happens inside `seek` — a React re-render, `ctx.clearRect` + hand-drawing, a Konva `layer.draw()` — is entirely up to you. The renderer just calls `seek(ms)`, screenshots, advances, and repeats. It **never plays back in real time**, so a slow frame takes longer but never drops, and the output is deterministic.

### Parallel capture

A reel of N frames is cut into contiguous chunks of frame indices, and each chunk is captured by its own Chrome. Since frame *i* depends only on its time, it doesn't matter which Chrome renders which chunk:

```
frames 0–684     → Chrome #1 ┐
frames 685–1369  → Chrome #2 ├ run at once → PNG sequence → ffmpeg → mp4
frames 1370–…    → Chrome #3 ┘
```

### Skipping static spans

`seek(ms)` can return `false` to mean "identical to the previous frame". The renderer then copies the previous still instead of paying for a settle + screenshot, cheaply skipping held frames. Returning `void`/`true` captures normally, so existing pages are unaffected.

### Audio

kamishibai never generates sound. You declare files + start times (from a TTS, a music track, anything) and they're muxed at assembly time. Two ways:

**1. An explicit manifest** (CLI `--audio`, or the `audio` render option):

```ts
[
  { src: "voiceover/intro.m4a", atMs: 0 },
  { src: "bgm.mp3", atMs: 0, gain: -18 },
]
```

**2. Declared in the page** — composable. The page populates `window.kamishibai.audio` (an array of `{ src, atMs, gain? }`) and the renderer collects + muxes it automatically, no manifest needed. With React this is just an `<Audio>` component dropped into a scene (see below); with the raw API, push entries onto the array yourself.

### Video (frame-accurate)

A raw HTML `<video>` can't be addressed by frame — `video.currentTime` is an approximate, async, decoder-dependent seek, so the same `ms` can yield different frames across runs and break the parallel-determinism invariant. `kamishibai/video` instead decodes a clip with **WebCodecs** (demuxed by mp4box) into indexed frames, and `frameAtMs(ms)` returns the exact frame — deterministic and frame-accurate, turning a video back into a pure function of time.

```ts
import { loadVideo } from "kamishibai/video";

const clip = await loadVideo("/clip.mp4");  // served via --public, fetchable by the browser
window.kamishibai = {
  meta: { fps: 30, durationMs: 3000, width: 480, height: 270 },
  async seek(ms) {
    const frame = clip.frameAtMs(ms);
    ctx.clearRect(0, 0, 480, 270);
    if (frame) ctx.drawImage(frame, 0, 0);
  },
};
```

With React, `<Video src>` does this for you (see below). WebCodecs is available because kamishibai serves on localhost (a secure context). Codec support follows the Chromium build: VP9/AV1 everywhere, H.264 is platform-dependent — prefer VP9/AV1 for portable CI. The whole clip is decoded into memory up front (great for short overlays; a streaming decoder would be the next step for long clips).

---

## Install

```sh
npm install kamishibai
# or: pnpm add kamishibai
```

Requirements:

- **Node.js ≥ 20**
- **`ffmpeg`** on your `PATH` (not bundled — e.g. `brew install ffmpeg`)
- A Chromium for Playwright: `npx playwright install chromium`

---

## CLI

```sh
kamishibai render <entry|url> [options]
```

| Option | | Description |
|---|---|---|
| `--out` | `-o` | output mp4 (default: `out.mp4`) |
| `--workers` | `-w` | parallel Chrome instances (default: ~cpus-2, max 8) |
| `--scale` | `-s` | device scale factor; output px = meta size × scale (default: 1) |
| `--audio` | `-a` | audio manifest JSON: `[{ "src", "atMs", "gain"? }, …]` |
| `--public` | `-p` | static assets dir served at the root (for `staticFile`-style paths) |
| `--frames-dir` | `-f` | write PNG frames here (created if needed; kept after rendering) |
| `--crf` | | H.264 quality, lower = better (default: 18) |
| `--keep-frames` | | keep the intermediate PNG frames (in the temp dir; path is logged) |
| `--verbose` | | stream ffmpeg output |

The entry can be:

- a **URL** you already serve (`http://localhost:3000`),
- a local **`.html`** file (its directory is served as-is), or
- a local **script** (`.ts` / `.tsx` / `.js` / `.jsx`) — bundled with esbuild and served for you.

```sh
kamishibai render reel.tsx -o reel.mp4 -w 4
kamishibai render reel.tsx -s 2 -o reel@2x.mp4          # 2× resolution
kamishibai render http://localhost:3000 -o page.mp4
kamishibai render reel.tsx -a audio.json -p public -o reel.mp4
```

Resolution comes from `meta.width`/`meta.height` (your CSS is authored in those
pixels); `--scale` multiplies only the captured pixels, so a 1920×1080 reel at
`-s 2` outputs 3840×2160 with the same layout.

### `kamishibai skill`

Prints the full usage guide as markdown — meant to be piped into an AI agent's
context (or saved to a file) so it can author reels for you:

```sh
kamishibai skill > kamishibai.md
```

---

## Library

```ts
import { render } from "kamishibai";

await render({
  entry: "reel.tsx",
  out: "reel.mp4",
  workers: 4,
  audio: [{ src: "voiceover.m4a", atMs: 0 }],
  publicDir: "public",
  onLog: (msg) => console.log(msg),
});
```

Lower-level building blocks (`probeMeta`, `captureChunk`, `renderPool`, `serveEntry`, `encodeFrames`, `muxAudio`, `splitFrames`) are exported too if you want to assemble your own pipeline.

---

## React sugar (optional)

You don't need React — any page that sets `window.kamishibai` works. But if you want it, `kamishibai/react` wires a React tree to the contract with a small, deliberately-its-own vocabulary:

```tsx
import { mount, Cue, Enter, ramp, eases, useClock } from "kamishibai/react";

const Reel = () => {
  const { ms } = useClock();        // current time in milliseconds
  const x = ramp(ms, 0, 1000, 0, 400, eases.smooth);
  return (
    <Enter at={200} dur={600}>
      <div style={{ transform: `translateX(${x}px)` }}>hello</div>
    </Enter>
  );
};

mount(<Reel />, { fps: 30, durationMs: 6000, width: 1920, height: 1080 });
```

- `useClock()` — the current clock (`ms`, `durationMs`, `fps`, `epochMs`)
- `ramp(ms, fromMs, toMs, fromV, toV, ease)` — map a time window onto a value
- `eases` — `linear` / `smooth` / `inOut` / `pop`
- `<Stage>` — root surface · `<Cue at hold>` — reveal during a window (with a local clock) · `<Enter>` — fade + rise
- `<Series>` / `<Series.Scene durationMs crossfadeMs>` — lay scenes back-to-back, each with its own local clock, with optional crossfades
- `<Audio src delayMs atMs gain>` — declare narration/music; starts at the enclosing scene's start (+`delayMs`) or an explicit `atMs`, and is collected for muxing automatically
- `<Video src startMs style>` — frame-accurate video via WebCodecs (see [Video](#video-frame-accurate)); draws the clip frame for the current scene-local time onto a canvas
- `mount(node, meta)` — render and expose `window.kamishibai` for you (also free-runs in a browser for live preview)

```tsx
import { mount, Series, Audio } from "kamishibai/react";

const Movie = () => (
  <Series>
    <Series.Scene durationMs={4000}>
      <Audio src="vo/intro.m4a" delayMs={500} />
      <Intro />
    </Series.Scene>
    <Series.Scene durationMs={6000} crossfadeMs={600}>
      <Audio src="vo/body.m4a" />
      <Body />
    </Series.Scene>
  </Series>
);
```

The vocabulary (`seek` / `ms` / `Cue` / `Stage` / `ramp`) is intentionally distinct from Remotion's — kamishibai is an independent implementation, not a clone.

---

## Examples

- **`examples/basics`** — a 6s reel showcasing the `kamishibai/react` sugar: fade in/out, an eased progress meter + count-up, staggered reveals, and eased motion.

```sh
pnpm build
node dist/cli.js render examples/basics/index.tsx -o basics.mp4 -w 4
```

---

## Determinism & guarantees

kamishibai does **not** guarantee pixel-identical output across environments. It gives you the levers to make output stable, and the philosophy is to **verify in CI** rather than promise:

- **Fonts are awaited** (`document.fonts.ready`) before the first capture, so text doesn't reflow mid-reel.
- **Pin Chromium** via your Playwright version — emoji and sub-pixel rendering depend on the Chrome build.
- Keep `seek(ms)` a pure function of `ms` (no `Date.now()`, no un-seeded randomness) so any Chrome renders any frame identically.

The intended workflow: pin the environment, render in CI, and let a frame/checksum check fail loudly when something drifts.

---

## License

MIT.

## Name

**紙芝居 (kamishibai)** is a Japanese form of storytelling that advances a tale one picture at a time — precisely this tool's "show one still per moment" approach.
