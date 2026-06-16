# kamishibai — agent skill

How to author and render videos with **kamishibai**: a mechanism that seeks a
web page frame by frame and bakes the stills into an mp4. You write a page that
draws "the state at time `ms`"; kamishibai captures it deterministically and in
parallel. This document is the complete usage guide — follow it as-is.

## Mental model

- A video is a **pure function of time**. You implement "given `ms`, draw the
  frame," and resolve once the DOM has settled.
- kamishibai never plays in real time. It seeks to each moment, screenshots,
  advances. So a heavy frame just takes longer — it never drops — and the
  output is deterministic and parallelisable.
- You are expected to iterate in a loop: **render → look at frames → fix the
  code → render again.** There is no GUI editor; you are the editor.

## The one contract

Any capturable page exposes exactly one global:

```ts
window.kamishibai = {
  meta: { fps: 30, durationMs: 6000, width: 1920, height: 1080 },
  // Draw the still for `ms`; resolve once the DOM has settled.
  // Return false to mean "identical to the previous frame".
  seek(ms: number): Promise<boolean | void> | boolean | void;
};
```

- `meta` is the single source of truth for **resolution, fps, and length**.
- `seek(ms)` may do anything: React re-render, canvas redraw, Konva, WebGL.
- Keep `seek` a **pure function of `ms`** — no `Date.now()`, no unseeded
  `Math.random()`, no real-time animation — or parallel workers will disagree.

### Skipping static spans

If a stretch of the reel doesn't change visually, return `false` from `seek`
for those moments. The renderer then **copies the previous still** instead of
paying for a settle + screenshot — a cheap way to speed up reels with held
frames. Returning `void`/`true` captures normally.

```ts
let lastKey = -1;
seek(ms) {
  const key = sceneKeyAt(ms);     // whatever determines the visible state
  if (key === lastKey) return false;   // nothing changed → copy previous
  lastKey = key;
  draw(ms);
  return true;
}
```

## Writing a reel

### Raw (no framework)

```ts
const meta = { fps: 30, durationMs: 4000, width: 1280, height: 720 };
const box = document.createElement("div");
document.body.appendChild(box);
window.kamishibai = {
  meta,
  seek(ms) {
    const x = Math.min(1, ms / 2000) * 400; // pure function of ms
    box.style.transform = `translateX(${x}px)`;
  },
};
```

### React (optional sugar: `kamishibai/react`)

```tsx
import { mount, Cue, Enter, ramp, eases, useClock } from "kamishibai/react";

const Reel = () => {
  const { ms } = useClock();
  const x = ramp(ms, 0, 1000, 0, 400, eases.smooth); // map time → value
  return (
    <Enter at={200} dur={600}>
      <div style={{ transform: `translateX(${x}px)` }}>hello</div>
    </Enter>
  );
};

// mount() renders the tree AND exposes window.kamishibai for you.
mount(<Reel />, { fps: 30, durationMs: 6000, width: 1920, height: 1080 });
```

Sugar API:
- `useClock()` → `{ ms, durationMs, fps, epochMs }`
- `ramp` / `eases` / `bezier` — re-exported from `kamishibai/easing` (see below)
- `<Stage background style>` — root surface
- `<Cue at hold>` — render children only during a window, with a **local clock**
  that restarts at 0 at `at`
- `<Enter at dur lift ease>` — fade + rise in
- `<Series>` / `<Series.Scene durationMs crossfadeMs>` — sequence scenes
  back-to-back, each with its own local clock, with optional crossfades
- `<Audio src delayMs atMs gain>` — declare audio inside a scene; it starts at
  the scene's start (+`delayMs`) and is collected for muxing automatically
- `<Video src startMs muted gain fadeInMs fadeOutMs style>` — frame-accurate
  video via WebCodecs (see Video below); draws the clip frame for the current
  scene-local time and auto-muxes the clip's audio (pass `muted` to drop it)

```tsx
import { mount, Series, Audio } from "kamishibai/react";
const Movie = () => (
  <Series>
    <Series.Scene durationMs={4000}><Audio src="vo/a.m4a" delayMs={500} /><A /></Series.Scene>
    <Series.Scene durationMs={6000} crossfadeMs={600}><Audio src="vo/b.m4a" /><B /></Series.Scene>
  </Series>
);
mount(<Movie />, { fps: 30, durationMs: 10000, width: 1920, height: 1080 });
```

## Easing (framework-free)

`kamishibai/easing` works without React — use it from the raw API or Node too:

```ts
import { ramp, eases, bezier } from "kamishibai/easing";
ramp(ms, 0, 1000, 0, 400, eases.smooth);   // clamped time→value map
const ease = bezier(0.16, 1, 0.3, 1);        // custom cubic-bezier
```

- `bezier(x1,y1,x2,y2)` — custom easing
- `eases` — `linear` | `smooth` | `inOut` | `pop`
- `ramp(ms, fromMs, toMs, fromV, toV, ease?)` — clamped interpolation
- `spring({ stiffness, damping, mass })` — physical spring as an easing (deterministic)
- `track(ms, [{ at, value, ease? }])` — multi-stop interpolation
- `stagger(i, { each, from })` — cascade delay (ms)
- `interpolateColor(a, b, t)` — hex color tween

## Rendering (CLI)

```
kamishibai render <entry|url> [options]
```

| Option | | Description |
|---|---|---|
| `--out` | `-o` | output file; `.mp4` (default) or `.gif` by extension |
| `--workers` | `-w` | parallel Chrome instances (default ~cpus-2, max 8) |
| `--scale` | `-s` | device scale factor; output px = meta size × scale (default 1) |
| `--max-width` | | downscale the output (mp4 or gif) to at most N px wide |
| `--gif-loop` | | gif loops: `0` infinite (default), `-1` once, `n` times |
| `--audio` | `-a` | audio manifest JSON `[{ "src", "atMs", "gain"? }, …]` |
| `--public` | `-p` | static assets dir served at root (for `staticFile`-style paths) |
| `--frames-dir` | `-f` | write PNG frames here (created if needed; kept after rendering) |
| `--crf` | | H.264 quality, lower = better (default 18) |
| `--keep-frames` | | keep intermediate PNGs (temp dir; path is logged) |
| `--verbose` | | stream ffmpeg output |

The `<entry|url>` can be:
- a **URL** you already serve,
- a local **`.html`** (its directory is served as-is), or
- a local **script** `.ts/.tsx/.js/.jsx` — bundled with esbuild and served.

Examples:
```
kamishibai render reel.tsx -o reel.mp4 -w 4
kamishibai render reel.tsx -s 2 -o reel@2x.mp4          # 2× resolution
kamishibai render reel.tsx -a audio.json -p public -o reel.mp4
kamishibai render http://localhost:3000 -o page.mp4
```

## Resolution

Resolution is **not** a CLI flag of its own — it comes from `meta.width`/
`meta.height`. Your CSS layout is authored in those CSS pixels. `--scale`
multiplies only the captured pixels: a 1920×1080 reel at `-s 2` outputs
3840×2160 with the same layout (use it for crisp/retina output).

## Audio

kamishibai does not generate sound. Declare files + start times; they're muxed
at the end. `atMs` is the clip's start in milliseconds; `gain` is dB (negative =
quieter). The output is clamped to the reel length (video is the master
timeline). Two ways:

**1. A manifest** via `--audio file.json`:

```json
[
  { "src": "voiceover/intro.m4a", "atMs": 0 },
  { "src": "bgm.mp3", "atMs": 0, "gain": -18, "trimStartMs": 5000, "durationMs": 20000, "fadeOutMs": 800 }
]
```

Per-clip: `gain` (dB), `trimStartMs`/`durationMs` (use a sub-section),
`fadeInMs`/`fadeOutMs` (fade-out needs `durationMs`), and `gainKeyframes`
(`[{ atMs, gain }]`) — dB volume automation over the clip's timeline, linearly
interpolated, for ducking/swells.

**2. Declared in the page** (composable, no manifest). The renderer reads
`window.kamishibai.audio` after capture and muxes it. With React, use `<Audio>`
(above). With the raw API, push markers yourself:

```ts
window.kamishibai = {
  meta,
  audio: [],
  seek(ms) {
    // ... draw ...
    if (atIntroStart(ms)) window.kamishibai.audio.push({ src: "vo/intro.m4a", atMs: 0 });
  },
};
```

`src` must be a path ffmpeg can read (relative to the render's working dir, or
absolute). An explicit `--audio` manifest takes precedence over collected markers.

## Video (frame-accurate)

Don't use a raw `<video>` — `currentTime` seeking is approximate and
non-deterministic, which breaks parallel capture. Use `kamishibai/video`, which
decodes the clip with WebCodecs into indexed frames so each `ms` maps to an
exact frame. The `src` must be fetchable by the browser (serve it via
`--public`), not a filesystem path.

```ts
import { loadVideo } from "kamishibai/video";
const clip = await loadVideo("/clip.mp4");
// in seek(ms): const f = clip.frameAtMs(ms); if (f) ctx.drawImage(f, 0, 0);
```

With React, just use `<Video src startMs />` inside a scene; the clip's own
audio is muxed automatically (trimmed to the scene, with optional gain/fades) —
pass `muted` to drop it. WebCodecs works because kamishibai serves on localhost
(secure context). Codecs: VP9/AV1 are portable; H.264 is platform-dependent.
The clip is decoded into memory up front (best for short overlays).

## Library (programmatic)

```ts
import { render } from "kamishibai";
await render({
  entry: "reel.tsx",
  out: "reel.mp4",
  workers: 4,
  scale: 1,
  audio: [{ src: "vo.m4a", atMs: 0 }],
  publicDir: "public",
  onLog: console.log,
});
```

## Determinism checklist

- Await fonts before drawing text (the renderer awaits `document.fonts.ready`,
  but custom/remote fonts should be loaded by your page).
- Pin Chromium via your Playwright version; emoji and sub-pixel rendering are
  Chrome-build dependent.
- Never read wall-clock time or unseeded randomness inside `seek`.

## Requirements

- Node.js ≥ 20
- `ffmpeg` on PATH (not bundled)
- Chromium for Playwright: `npx playwright install chromium`
