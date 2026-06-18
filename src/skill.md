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
- `<Series>` / `<Series.Scene durationMs crossfadeMs exitFadeMs>` — sequence
  scenes back-to-back, each with its own local clock, with optional crossfades.
  Scenes **self-register**, so one wrapped in your own component works at any
  depth. Drive it from data with `<Series scenes={[{ durationMs, crossfadeMs,
  exitFadeMs, content }]} />`, and size the reel with `seriesDuration(scenes)`
  (see **Scenes** below)
- `<Audio src delayMs atMs gain>` — declare audio inside a scene; it starts at
  the scene's start (+`delayMs`) and is collected for muxing automatically
- `<Video src startMs muted gain fadeInMs fadeOutMs style>` — frame-accurate
  video via WebCodecs (see Video below); draws the clip frame for the current
  scene-local time and auto-muxes the clip's audio (pass `muted` to drop it)
- `<Subtitle src | cues | children>` — burn captions from an SRT/VTT file
  (`src`), inline `cues`, or direct text (`children`, timed via the enclosing
  `<Cue>`). Cue times count from the enclosing scene. Parser also at
  kamishibai/subtitle (parseSubtitles, cueAt) for the raw API.
- `<Narration clip delayMs gain fadeInMs fadeOutMs subtitle>` — play a clip
  from `prepareNarration` (synthesized up front, see Narration below); with
  `subtitle`, also burns the line's text as a caption for the clip's window

```tsx
import { mount, Series, Audio, seriesDuration } from "kamishibai/react";
// Timing as data: lay out the scenes and derive meta.durationMs from the same
// specs, so the total can't drift from what renders.
const scenes = [
  { durationMs: 4000, content: <><Audio src="vo/a.m4a" delayMs={500} /><A /></> },
  { durationMs: 6000, crossfadeMs: 600, content: <><Audio src="vo/b.m4a" /><B /></> },
];
mount(<Series scenes={scenes} />, {
  fps: 30, durationMs: seriesDuration(scenes), width: 1920, height: 1080,
});
```

The JSX form is equivalent and composes the same way — `<Series><Series.Scene
durationMs={4000}>…</Series.Scene>…</Series>`, including scenes returned from
your own wrapper components.

### Scenes (`<Series>`)

- **Sizing.** A crossfade *overlaps* the previous scene, so a reel is
  `Σ durations − Σ crossfades` long. Pass `seriesDuration(scenes)` to
  `meta.durationMs` (or `seriesLayout(scenes)` for the per-scene start times);
  both live framework-free in `kamishibai/series`. A hand-summed total that
  forgets crossfades leaves **trailing blank frames** (too long) or **cuts the
  last scene** (too short).
- **Local clocks.** Inside a scene the clock is scene-local: `useClock()` returns
  `ms`/`durationMs` measured from the scene start, and `<Audio>` / `<Narration>`
  `delayMs` is relative to the scene (use `atMs` for an absolute time). `<Cue>`
  nests the same way, resetting the local clock again.
- **Wrapping.** Scenes self-register with the enclosing `<Series>` (the same
  mechanism `<Audio>` uses), so `const MyScene = (p) => <Series.Scene
  durationMs={p.d}>…</Series.Scene>` renders correctly whether it's a direct
  child or nested in your own components. Keep scenes statically ordered —
  registration order is source order.
- **Transitions / anti-ghosting.** A crossfade composites *both* scenes at
  partial opacity, so two different layouts **ghost** (e.g. a centered title
  bleeding through the incoming slide). Set `exitFadeMs` on the outgoing scene to
  fade its *content* out just before it ends, so only the backgrounds blend.
  Other transitions (wipe/swipe) are a few lines of `ramp()` + `transform` on the
  scene content.

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
| `--fps` | | override the page's fps — re-samples the same reel at this rate |
| `--scale` | `-s` | device scale factor; output px = meta size × scale (default 1) |
| `--max-width` | | downscale the output (mp4 or gif) to at most N px wide |
| `--gif-loop` | | gif loops: `0` infinite (default), `-1` once, `n` times |

GIF frame delays are quantized to 1/100s, so pair `.gif` output with `--fps` set
to a divisor of 100 (e.g. 25 or 50) for exact timing; other rates drift in speed
(60fps gif effectively plays at 100fps).
| `--audio` | `-a` | audio manifest JSON `[{ "src", "atMs", "gain"? }, …]` — **replaces** page-declared audio (see Audio) |
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

`src` is read **from the filesystem by ffmpeg** (relative to the render's working
directory, or absolute) — unlike `<Video>` / `staticFile` paths, which the
*browser* fetches and so must be served via `--public`. Run the render from a
stable cwd: relative audio paths **and** the `.kamishibai-tts/` cache resolve
against it, so running from elsewhere silently misses the cache (and re-bills
TTS).

⚠️ **`--audio` replaces page audio, it does not merge.** Passing `--audio` to add
BGM silently drops your `<Narration>`/`<Audio>` tracks. To layer BGM *over*
narration, declare the BGM in the page as another `<Audio>` (it muxes alongside
the collected markers) — don't reach for `--audio`. There is also no built-in
looping: if a BGM track is shorter than the reel, tile it yourself (repeat the
clip at successive `atMs` with short `fadeInMs`/`fadeOutMs` seams).

## Video (frame-accurate)

Don't use a raw `<video>` — `currentTime` seeking is approximate and
non-deterministic, which breaks parallel capture. Use `kamishibai/video`, which
demuxes the clip into an index of encoded samples and decodes on demand (one GOP
at a time, so long clips don't blow up memory), mapping each `ms` to an exact
frame. The `src` must be fetchable by the browser (serve it via `--public`), not
a filesystem path.

```ts
import { loadVideo } from "kamishibai/video";
const clip = await loadVideo("/clip.mp4");
// in seek(ms): const f = await clip.frameAtMs(ms); if (f) ctx.drawImage(f, 0, 0);
```

With React, just use `<Video src startMs />` inside a scene; the clip's own
audio is muxed automatically (trimmed to the scene, with optional gain/fades) —
pass `muted` to drop it. WebCodecs works because kamishibai serves on localhost
(secure context). Codecs: VP9/AV1 are portable; H.264 is platform-dependent.
Frames decode on demand (one GOP at a time), so long clips stay memory-bounded.

## Narration (TTS)

TTS is non-deterministic and billable, so it never runs during `seek()`.
`prepareNarration` runs ONCE before `mount()` (a top-level `await`): it bakes
each line to a content-hashed file under `.kamishibai-tts/`, measures its
duration with ffprobe, and returns `{ src, durationMs, text }` per key. The
cache freezes synthesis (identical lines never re-billed) and every parallel
worker reads the same file → deterministic. Durations come back before mount,
so scenes can fit their narration. It rides the existing `<Audio>` mux path.

```tsx
import { mount, Series, Narration, seriesDuration } from "kamishibai/react";
import { sayAdapter, prepareNarration, narrationLayout } from "kamishibai/tts";

const voice = sayAdapter(); // dev default: free, offline, deterministic
const vo = await prepareNarration(voice, { intro: "Welcome.", body: "Pure functions of time." });
// narrationLayout sizes one scene per line to its measured duration (+ pad),
// with a uniform crossfade; add each scene's visuals and derive the reel length
// from the same specs, so it always ends exactly with the last line.
const scenes = narrationLayout([vo.intro, vo.body], { padMs: 500, crossfadeMs: 400 })
  .map(({ clip, ...spec }) => ({ ...spec, content: <Narration clip={clip} subtitle /> }));
mount(<Series scenes={scenes} />, {
  fps: 30, durationMs: seriesDuration(scenes), width: 1280, height: 720,
});
```

Narration-driven layout helpers (in `kamishibai/tts`, also re-exported from
`kamishibai/react`), all pure data:
- `narrationLayout(clips, { padMs, crossfadeMs, exitFadeMs })` → one
  `{ durationMs, crossfadeMs?, exitFadeMs?, clip }` per clip; map it to
  `<Series scenes>` items by adding `content`.
- `narrationTotal(clips)` → the raw voice-over length (sum of durations), handy
  for a sanity check against `seriesDuration(scenes)` (which adds pad/crossfade).
- `narrationSequence(clips, { gapMs, startMs })` → for **several clips in one
  scene**, each clip's cumulative `atMs`. Reveal element X exactly when clip Y
  starts by pairing `<Narration clip delayMs={atMs} />` with `<Cue at={atMs}>`:

```tsx
const steps = narrationSequence([vo.a, vo.b, vo.c]); // within one scene
<>{steps.map((s, i) => (
  <React.Fragment key={i}>
    <Narration clip={s.clip} delayMs={s.atMs} />
    <Cue at={s.atMs}><Bullet>{labels[i]}</Bullet></Cue>
  </React.Fragment>
))}</>
```

Dev on `say` for free (macOS only — it shells out to `say`), then swap one line
for the final render (same reel): `openaiAdapter({ model, voice })`
(`OPENAI_API_KEY`), `googleAdapter({ name })` (`GOOGLE_API_KEY`),
`pollyAdapter({ voiceId, engine })` (`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`,
`AWS_REGION`; signed with a built-in SigV4, no AWS SDK), or
`elevenLabsAdapter({ voiceId, model })` (`ELEVENLABS_API_KEY`). The
adapter sets the batch voice; a single line can override its opts with the
object form `{ text, opts }` (merged over the adapter's, e.g. `{ rate: 150 }`)
— the override folds into the cache key. Custom
provider: implement the Node `TTSAdapter` (`{ provider, synthesize }`) and pass
it via `render({ ttsAdapters })`; the reel references it by a matching
`provider`. (Browser/Node split: the reel's adapter is a serializable ref;
synthesis runs in Node, served to the page over `POST /__tts`.)

The cache key folds in the adapter id + text + per-line opts. Change one
character of a line and **only that line** re-synthesizes; change
`voice`/`model`/`instructions` and **every** line is re-billed. So the cheap
workflow is: **finalize the narration text first, then iterate on timing and
visuals** (those are free) — text and voice changes cost money.

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

## Debugging

When a frame looks wrong, **dump the frames and look.** Render with
`--frames-dir <dir>` (`-f`) and open the PNGs — it's the fastest way to pin a
glitch (a stray colour, a misplaced element, a blank tail) to an exact frame.
Frames are named `f000123.png` by index, so `index ÷ fps` is the timestamp, and
a blank run at the end almost always means `meta.durationMs` is longer than the
content (see **Scenes** — size it with `seriesDuration`). Iterate with
`--workers 1` for stable frame-to-frame comparison.

## Determinism checklist

- Await fonts before drawing text (the renderer awaits `document.fonts.ready`,
  but custom/remote fonts should be loaded by your page).
- Pin Chromium via your Playwright version; emoji and sub-pixel rendering are
  Chrome-build dependent.
- Never read wall-clock time or unseeded randomness inside `seek`.
- Make `seek` resolve only **after** the DOM reflects the target `ms` — commit
  the state, then settle, then resolve. (`kamishibai/react` does this for you;
  with the raw API, don't resolve on a frame that still shows the previous `ms`,
  or parallel workers can screenshot a stale frame.)

## Requirements

- Node.js ≥ 20
- `ffmpeg` on PATH (not bundled)
- Chromium for Playwright: `npx playwright install chromium`
