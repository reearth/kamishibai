# kamishibai

> **Turn any web page into a video — by making every frame a pure function of its time.**
> A *mechanism*, not a framework. How you draw — React, plain DOM, canvas, WebGL — is up to you.

![A reel rendered with kamishibai](examples/basics/demo.gif)

<sub>The [`examples/basics`](examples/basics/index.tsx) reel — spring entrances, staggered bars, multi-stop tracks, color tweens. ([full mp4](examples/basics/out.mp4))</sub>

`kamishibai` turns any web page (DOM, canvas, anything) into a video by **seeking to each moment and capturing a still**, then assembling the stills with `ffmpeg`. Because every frame is a pure function of its time, capture is deterministic and **trivially parallelisable** across several headless Chrome instances.

It deliberately does *not* try to be a frame-accurate compositing engine or ship an editor. It gives you the renderer and one tiny contract; the rest is yours.

**Free · DOM-or-anything · code/CI-first · AI-friendly · no guarantees (MIT)** — a corner of the programmatic-video space nothing else occupies.

---

## Quick start

```sh
npm i kamishibai react react-dom         # react / react-dom are peer deps
npx playwright install chromium          # the headless browser that captures frames
# plus ffmpeg on your PATH (not bundled) — e.g. `brew install ffmpeg`
```

Write a `reel.tsx` — a page that draws "the state at time `ms`". With the optional React sugar that's just a component plus `mount`:

```tsx
import { mount, useClock, ramp, eases } from "kamishibai/react";

const Reel = () => {
  const { ms } = useClock();                       // current time, in milliseconds
  const x = ramp(ms, 0, 1000, 0, 400, eases.smooth); // map a time window onto a value
  return (
    <div style={{ font: "700 96px system-ui", transform: `translateX(${x}px)` }}>
      hello
    </div>
  );
};

// mount() renders the tree AND exposes window.kamishibai for the renderer.
mount(<Reel />, { fps: 30, durationMs: 3000, width: 1280, height: 720 });
```

Render it:

```sh
npx kamishibai render reel.tsx -o reel.mp4
```

Then iterate: **render → look at the frames → fix the code → render again.** There's no GUI editor — you're the editor.

**Requirements:** Node.js ≥ 20 · `ffmpeg` on `PATH` (not bundled) · a Chromium for Playwright (`npx playwright install chromium`).

---

## Agent skills

Building videos with an AI coding agent? Two installable skills teach it kamishibai — install one or both by name.

Using the [`skills`](https://github.com/vercel-labs/skills) CLI:

```sh
npx skills add reearth/kamishibai --skill kamishibai    # the API / engine
npx skills add reearth/kamishibai --skill video-craft   # the directing / editing craft
npx skills add reearth/kamishibai --all                 # both, all agents, no prompts
```

Or with [`gh skills`](https://cli.github.com/manual/gh_skill) — the GitHub CLI's built-in skill manager (`gh skill`, alias `gh skills`):

```sh
gh skills install reearth/kamishibai kamishibai    # the API / engine
gh skills install reearth/kamishibai video-craft   # the directing / editing craft

# pick the target agent and scope (default: project scope, github-copilot)
gh skills install reearth/kamishibai kamishibai --agent claude-code --scope user

gh skills search kamishibai     # find skills across GitHub
gh skills update --all          # update installed skills
```

- **`kamishibai`** — points the agent at `kamishibai skill`, which prints the full authoring guide (the contract, the React sugar, audio / TTS, the render CLI, determinism) — always matching the installed version.
- **`video-craft`** — the *taste* layer, not the API: narration as the spine, pacing & silence, audio-synced reveals, transitions, mix & ducking, and the outline → script sign-off → pilot → render loop.

Or pipe the guide straight into your agent's context yourself:

```sh
kamishibai skill > kamishibai.md
```

---

## How it works

### The one and only contract

A capturable page exposes exactly one global:

```ts
window.kamishibai = {
  meta: { fps: 30, durationMs: 6000, width: 1920, height: 1080 },
  // Build the still state for `ms` and resolve once the DOM has settled.
  // Return false to mean "identical to the previous frame" (see below).
  seek(ms: number): Promise<boolean | void> | boolean | void;
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

### Incremental builds

`seek(ms)` can also return a **fingerprint** — a stable string key for the frame's content. The renderer copies the previous still when two adjacent prints match (the static-span case, generalized), and with `--incremental` it reuses a cached PNG across runs whenever a print matches the previous run's, stored in `<frames-dir>/.kamishibai-cache.json`. So after you edit a reel, only the frames that actually changed are re-captured; the rest are kept byte-for-byte.

```sh
kamishibai render reel.tsx -f frames -o reel.mp4        # seed the cache
# …edit the reel…
kamishibai render reel.tsx -f frames -i -o reel.mp4     # re-render only what changed
```

`kamishibai/react` returns the fingerprint automatically by hashing the committed DOM — so React reels get this for free, no annotation needed. The only thing the DOM hash can't see is `<canvas>`/WebGL pixels; those contribute a cheap token via `useFingerprint(token)` (`<Video>` already does). The cache auto-invalidates when the output geometry (fps/size/scale) changes, and `--only 0-30,90,120-150` is a manual escape hatch that renders just the frames you name. Both need a persisted `--frames-dir`. Caching trusts determinism — a frame that isn't a pure function of its ms can be wrongly reused; omit `-i` for a clean full render.

---

## Writing reels — the React sugar

You don't need React — any page that sets `window.kamishibai` works. But `kamishibai/react` wires a React tree to the contract with a small, clock-driven vocabulary:

- `useClock()` — the current clock: `{ ms, durationMs, fps, epochMs }`
- `ramp` / `eases` / `bezier` / `spring` / `track` / `stagger` / `interpolateColor` — re-exported from [`kamishibai/easing`](#easing)
- `<Stage>` — root surface · `<Cue at hold>` — reveal children during a window, with a **local clock** that restarts at 0 · `<Enter>` — fade + rise in
- `<Series>` / `<Series.Scene durationMs crossfadeMs exitFadeMs>` — lay scenes back-to-back, each with its own local clock ([Scenes](#scenes) below)
- `<Audio>` · `<Bgm>` — declare sound ([Audio](#audio)) · `<Video>` — frame-accurate video ([Video](#video-frame-accurate))
- `<Subtitle>` — burn captions ([Subtitles](#subtitles)) · `<Narration>` — play a pre-synthesized line ([Narration](#narration-tts))
- `mount(node, meta)` — render and expose `window.kamishibai` (also free-runs on the wall clock in a normal browser for live preview)

### Scenes

`<Series>` plays scenes back-to-back, each with its own local clock (so `useClock()` and `<Audio delayMs>` are measured from the scene's start). A `crossfadeMs` overlaps a scene with the previous one; `exitFadeMs` fades a scene's *content* out just before it ends (so crossfading two different layouts doesn't ghost).

Scenes **self-register**, so a scene wrapped in your own component works at any depth — there's no "must be a direct child" rule:

```tsx
import { mount, Series, Audio, seriesDuration } from "kamishibai/react";

// Drive a Series from data, and derive meta.durationMs from the same specs so
// the reel can't drift from what renders (a crossfade overlaps, so it shortens
// the timeline — `seriesDuration` accounts for that).
const scenes = [
  { durationMs: 4000, content: <><Audio src="vo/intro.m4a" delayMs={500} /><Intro /></> },
  { durationMs: 6000, crossfadeMs: 600, content: <><Audio src="vo/body.m4a" /><Body /></> },
];

mount(<Series scenes={scenes} />, {
  fps: 30, durationMs: seriesDuration(scenes), width: 1920, height: 1080,
});
```

The JSX form is equivalent — `<Series><Series.Scene durationMs={4000}>…</Series.Scene></Series>` — and `seriesLayout(scenes)` gives the per-scene start times if you need them.

---

## Easing

`kamishibai/easing` is framework-free — use it from the raw API, the React sugar (which re-exports it), or Node-side code. No DOM or React dependency.

```ts
import { ramp, eases, bezier } from "kamishibai/easing";

ramp(ms, 0, 1000, 0, 400, eases.smooth); // map a time window onto a value
const ease = bezier(0.16, 1, 0.3, 1);    // custom cubic-bezier easing
```

- `bezier(x1, y1, x2, y2)` — build a custom easing (the curve math CSS timing functions use)
- `eases` — ready-made `linear` / `smooth` / `inOut` / `pop`
- `ramp(ms, fromMs, toMs, fromV, toV, ease?)` — clamped time→value interpolation
- `spring({ stiffness, damping, mass })` — a physical spring as an easing (overshoots, settles); analytical, so it's deterministic
- `track(ms, [{ at, value, ease? }])` — multi-stop interpolation (the n-point `ramp`)
- `stagger(i, { each, from })` — cascade delay (ms) for item `i`
- `interpolateColor(a, b, t)` — tween between hex colors

---

## Audio

kamishibai never generates sound. You **declare** files + start times — in the page — and they're muxed at assembly time. The page populates `window.kamishibai.audio` (an array of `{ src, atMs, gain?, … }`); the renderer collects and muxes it. With React, drop an `<Audio>` into a scene, or `<Bgm>` at the top level for looped, auto-ducked background music:

```tsx
<Audio src="vo/intro.m4a" delayMs={500} />          {/* starts 500ms into the enclosing scene */}
<Bgm src="theme.mp3" gain={-18} duck fadeOutMs={1500} />  {/* loops under everything, ducks under narration */}
```

Or as a plain array (raw API, or the programmatic `render({ audio })` option):

```ts
[
  { src: "voiceover/intro.m4a", atMs: 0 },
  // a short loop tiled to fill the reel, auto-ducked under the voiceover, fading out at the end:
  { src: "bgm.mp3", atMs: 0, gain: -18, loop: true, duck: true, fadeOutMs: 1500 },
]
```

Per clip: `gain` (dB) · `trimStartMs` / `durationMs` (use a sub-section) · `fadeInMs` / `fadeOutMs` · `loop` (tile the source to the reel length) · `duck` (auto-dip under other clips) · `gainKeyframes` (manual dB automation).

**Auto-ducking** derives the dip from the schedule — every clip's start and length are known up front, so the music dips while narration plays and rises in the gaps, deterministically (no audio analysis). `duck: true` uses defaults (−12 dB, 250 ms attack, 600 ms release); tune with `duck: { amountDb: -16, attackMs: 200, releaseMs: 500 }`, or automate by hand with `gainKeyframes`.

`src` is read **from the filesystem by ffmpeg** (cwd-relative or absolute) — unlike `<Video>` / `staticFile` paths, which the *browser* fetches and must be served via `--public`. There's no `--audio` CLI flag (audio belongs to the reel); the programmatic `render({ audio })` option still works and is **merged** with the page's markers — handy for adding audio to a URL entry you don't control.

---

## Video (frame-accurate)

A raw HTML `<video>` can't be addressed by frame — `video.currentTime` is an approximate, async, decoder-dependent seek, so the same `ms` can yield different frames across runs and break the parallel-determinism invariant. `kamishibai/video` instead demuxes a clip with **mp4box** into an index of *encoded* samples and decodes on demand with **WebCodecs**, and `await frameAtMs(ms)` returns the exact frame — deterministic and frame-accurate, turning a video back into a pure function of time.

```ts
import { loadVideo } from "kamishibai/video";

const clip = await loadVideo("/clip.mp4");  // served via --public, fetchable by the browser
window.kamishibai = {
  meta: { fps: 30, durationMs: 3000, width: 480, height: 270 },
  async seek(ms) {
    const frame = await clip.frameAtMs(ms);
    ctx.clearRect(0, 0, 480, 270);
    if (frame) ctx.drawImage(frame, 0, 0);
  },
};
```

With React, `<Video src startMs muted gain fadeInMs fadeOutMs style>` does this for you, and the clip's **own audio track is muxed automatically** — trimmed to the scene and gain/fade-able — unless you pass `muted`. WebCodecs is available because kamishibai serves on localhost (a secure context). Codec support follows the Chromium build: VP9/AV1 everywhere, H.264 is platform-dependent — prefer VP9/AV1 for portable CI. Only the compressed samples and one decoded GOP are held at a time, so long clips stay memory-bounded.

---

## Subtitles

Burn captions in three composable ways — drop `<Subtitle>` into a scene and its cue times count from that scene's start:

```tsx
import { Subtitle, Cue } from "kamishibai/react";

// 1. from an SRT/VTT file (served via --public)
<Subtitle src="/captions.vtt" bottom={60} />

// 2. from inline cues
<Subtitle cues={[{ start: 0, end: 1500, text: "hello" }, { start: 1500, end: 3000, text: "world" }]} />

// 3. direct text — timing via the enclosing <Cue>
<Cue at={500} hold={2000}><Subtitle>just this line</Subtitle></Cue>
```

The parser is also framework-free for the raw API or Node:

```ts
import { parseSubtitles, cueAt } from "kamishibai/subtitle";
const cues = parseSubtitles(srtOrVttText);
const text = cueAt(cues, ms)?.text;            // draw it yourself in seek()
```

---

## Narration (TTS)

TTS is non-deterministic (neural voices resample every call) and billable per request — the two things parallel capture can't tolerate. So kamishibai never synthesizes during `seek()`. Instead `prepareNarration` runs **once, before capture**, as a top-level `await`: it bakes each line to a **content-hashed file**, measures its duration with ffprobe, and hands back `{ src, durationMs, text }`. From then on the reel only references a path — the core contract never learns TTS exists; it rides the existing `<Audio>` mux path. The hash cache (`.kamishibai-tts/`) means identical lines are never re-synthesized or re-billed, and every parallel worker reads the same frozen file — so a non-deterministic API becomes a deterministic file reference.

Because the durations come back before `mount()`, you can size each scene to the line it's about to speak. `narrationLayout` does exactly that — one scene per line, sized to its measured duration — and `seriesDuration` then fits the reel to the voice-over:

```tsx
import { mount, Series, Narration, seriesDuration } from "kamishibai/react";
import { sayAdapter, prepareNarration, narrationLayout } from "kamishibai/tts";

const voice = sayAdapter();                    // dev default: free, offline, deterministic
const vo = await prepareNarration(voice, {
  intro: "Welcome to kamishibai.",
  body:  "Every frame is a pure function of time.",
});

const scenes = narrationLayout([vo.intro, vo.body], { padMs: 500, crossfadeMs: 400 })
  .map(({ clip, ...spec }) => ({
    ...spec,
    content: <Narration clip={clip} subtitle />,  // plays the clip AND burns the text as a caption
  }));

mount(<Series scenes={scenes} />, {
  fps: 30, durationMs: seriesDuration(scenes), width: 1280, height: 720,
});
```

Helpers (`kamishibai/tts`, also re-exported from `kamishibai/react`): `narrationLayout(clips, { padMs, crossfadeMs, exitFadeMs })` → one scene spec per clip · `narrationTotal(clips)` → total voice-over length · `narrationSequence(clips, { gapMs, startMs })` → cumulative start offsets for several lines in one scene (reveal element X when line Y starts via `<Cue at={atMs}>`), with `gapMs` as a number, array, or `(i, clip) => ms` for uneven pacing.

Adapters are deliberately dumb (`text → bytes`) — no SSML layer, no voice UI. `say` is **macOS-only** (it shells out to the `say` binary), so it's the free local dev default; on Linux/Windows/CI use a network adapter. **Run the dev loop on `say`, then swap one line for the final render** — same reel:

```ts
import { openaiAdapter, googleAdapter, pollyAdapter, elevenLabsAdapter } from "kamishibai/tts";
const voice = openaiAdapter({ model: "tts-1-hd", voice: "nova" });    // OPENAI_API_KEY
const voice = googleAdapter({ name: "en-US-Neural2-F" });             // GOOGLE_API_KEY
const voice = pollyAdapter({ voiceId: "Matthew", engine: "neural" }); // AWS_ACCESS_KEY_ID/SECRET (+AWS_REGION)
const voice = elevenLabsAdapter({ voiceId: "…" });                    // ELEVENLABS_API_KEY
```

(Polly is signed with a minimal built-in SigV4 — no AWS SDK dependency. Google returns base64 audio, decoded for you.)

The adapter sets the voice for the whole batch; a single line can override its options (merged over the adapter's) with the object form. The override folds into the cache key, so only that line re-synthesizes — and changing `voice`/`model` busts *every* line. **Finalize the narration text first, then iterate on timing/visuals** (those are free); text and voice changes cost money.

```ts
const vo = await prepareNarration(sayAdapter(), {
  intro: "Spoken with the default voice.",
  aside: { text: "…but this one, slower.", opts: { rate: 150 } },
});
```

A custom provider implements the Node `TTSAdapter` (`{ provider, synthesize }`) and registers it via `render({ ttsAdapters: [myAdapter] })`; the reel references it with an adapter whose `provider` matches. (Why the split: the reel is bundled for the browser, so its adapter is a serializable ref — `{ id, provider, opts }` — while the actual synthesis runs in Node, served to the page over `POST /__tts`.)

---

## CLI

```sh
kamishibai render <entry|url> [options]
```

| Option | | Description |
|---|---|---|
| `--out` | `-o` | output file; `.mp4` (default) or `.gif` by extension |
| `--workers` | `-w` | parallel Chrome instances (default: ~cpus-2, max 8) |
| `--fps` | | override the page's fps — re-samples the same reel at this rate |
| `--scale` | `-s` | device scale factor; output px = meta size × scale (default: 1) |
| `--max-width` | | downscale the output (mp4 or gif) to at most N px wide |
| `--public` | `-p` | static assets dir served at the root (for `staticFile`-style paths) |
| `--frames-dir` | `-f` | write PNG frames here (created if needed; kept after rendering) |
| `--incremental` | `-i` | reuse cached frames; re-render only changed ones (needs `--frames-dir`) |
| `--only` | | render only these frames, e.g. `0-30,90,120-150` (needs `--frames-dir`) |
| `--gif-loop` | | gif loops: `0` infinite (default), `-1` once, `n` times |
| `--crf` | | H.264 quality, lower = better (default: 18) |
| `--keep-frames` | | keep the intermediate PNG frames (in the temp dir; path is logged) |
| `--verbose` | | stream ffmpeg output |

The entry can be a **URL** you already serve (`http://localhost:3000`), a local **`.html`** file (its directory is served as-is), or a local **script** (`.ts` / `.tsx` / `.js` / `.jsx`) — bundled with esbuild and served for you.

```sh
kamishibai render reel.tsx -o reel.mp4 -w 4
kamishibai render reel.tsx -s 2 -o reel@2x.mp4                   # 2× resolution
kamishibai render reel.tsx -o reel.gif --fps 25 --max-width 720 # animated GIF
kamishibai render reel.tsx -p public -o reel.mp4                # serve ./public at the root
kamishibai render http://localhost:3000 -o page.mp4
```

Resolution comes from `meta.width`/`meta.height` (your CSS is authored in those pixels); `--scale` multiplies only the captured pixels, so a 1920×1080 reel at `-s 2` outputs 3840×2160 with the same layout. GIF frame delays are quantized to 1/100s, so pair `.gif` with `--fps` set to a divisor of 100 (25, 50, …) for exact timing.

---

## Library

```ts
import { render } from "kamishibai";

await render({
  entry: "reel.tsx",
  out: "reel.mp4",
  workers: 4,
  audio: [{ src: "voiceover.m4a", atMs: 0 }], // merged with any page-declared audio
  publicDir: "public",
  onLog: (msg) => console.log(msg),
});
```

Lower-level building blocks (`probeMeta`, `captureChunk`, `renderPool`, `serveEntry`, `encodeFrames`, `muxAudio`, `splitFrames`) are exported too if you want to assemble your own pipeline.

---

## Examples

- **`examples/basics`** — a 6s reel showcasing the `kamishibai/react` sugar: fade in/out, an eased progress meter + count-up, staggered reveals, and eased motion.
- **`examples/video`** — frame-accurate video via WebCodecs, both raw (`index.ts`) and React (`react.tsx`). The clip is an AV1-in-MP4 test pattern generated by ffmpeg (`testsrc`, synthetic — no copyright).
- **`examples/narration`** — TTS as a build pre-pass: synthesize the voice-over up front with `say`, size each scene to its line with `narrationLayout`, and burn the text as captions.

```sh
pnpm build
node dist/cli.js render examples/basics/index.tsx -o basics.mp4 -w 4
node dist/cli.js render examples/video/react.tsx --public examples/video/public -o video.mp4 -w 4
node dist/cli.js render examples/narration/index.tsx -o narration.mp4 -w 4   # macOS `say`
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
