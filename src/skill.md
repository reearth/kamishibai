# kamishibai — agent skill

kamishibai seeks a web page to each moment, screenshots it, and encodes the
stills into a video. You write a page that draws "the state at time `ms`".
A reel can also be a module drawn on a 2D canvas, painted with no browser
(`kamishibai skill canvas`), or scenes written as YAML from a kit of parts
(`kamishibai skill kit`), and any reel can be exported as one HTML file that
plays with no server (`kamishibai skill export`).

<!-- topics -->

## Mental model

- A video is a **pure function of time**: given `ms`, draw the frame, and
  resolve once the DOM has settled.
- Nothing plays in real time. A heavy frame takes longer but never drops, and
  frames are captured in parallel.
- Work in a loop: **render → look at frames → fix → render again.**

## Setup

kamishibai needs Node ≥ 20, `ffmpeg` on PATH (not bundled), and Playwright's
Chromium. Skip what the project already has:

```sh
npm i kamishibai react react-dom                    # react is a peer dep
npm i -D typescript @types/react @types/react-dom
npx playwright install chromium
mkdir -p public                                     # files the page fetches
```

Write `reel.tsx`, then type-check before each render. `tsc` finds a wrong prop
in seconds; a capture takes far longer to show a blank reel.

```jsonc
// tsconfig.json (type-checking only; the CLI bundles with esbuild)
{ "compilerOptions": { "target": "esnext", "lib": ["dom", "esnext"], "module": "esnext",
  "moduleResolution": "bundler", "jsx": "react-jsx", "strict": true, "noEmit": true, "skipLibCheck": true } }
```

```sh
npx tsc && npx kamishibai render reel.tsx -o out.mp4 -p public
```

React is optional: any page that sets `window.kamishibai` works (see **Raw**).

## Before the full build

When someone asks you for a video, agree on its direction before building all
of it, unless they say the brief is final or to just make it:

1. **Outline.** For each scene, a few lines: what is said, what is shown, the
   motion or transition, the tone. Show it and fold in their changes; a wrong
   direction is cheapest to fix here.
2. **Pilot.** Build the first scene or two as they will ship, render them, show
   the video, and settle the look, voice and pacing. Then build the rest.

With narration, also get the whole script approved before the first paid
synthesis (see **narration**).

## The one contract

```ts
window.kamishibai = {
  meta: { fps: 30, durationMs: 6000, width: 1920, height: 1080 },
  // Draw the still for `ms`; resolve once the DOM has settled. Return false for
  // "same as the previous frame", or a fingerprint string of the frame's content.
  seek(ms: number): Promise<boolean | string | void> | boolean | string | void;
};
```

- `meta` sets the size, fps and length.
- `seek(ms)` may do anything (React, canvas, WebGL), but must be a **pure
  function of `ms`**: no `Date.now()`, no unseeded `Math.random()`, no real-time
  animation. Parallel workers otherwise disagree.

**Fingerprints.** Where two adjacent frames have the same fingerprint, the
second is copied instead of captured, on every render, with or without `-i`.
So a frame that isn't a pure function of `ms` can be wrongly reused. React reels get one automatically, from
the DOM and the stylesheets. It can't see `<canvas>`/WebGL pixels or a file
replaced under the same URL: add a cheap token for those with
`useFingerprint(token)` (a string, or a function of ms such as a frame index,
not a pixel hash), or put a version in the URL (`/map.png?v=2`).

<!-- topic: incremental | Skipping static spans, fingerprints, and re-rendering only what changed (`-i`, `--only`, `--preview`) -->
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

`seek` can also return a **fingerprint string** — a stable key for the frame's
content. The renderer copies the previous still when two adjacent prints match,
and (with `--incremental`) reuses a cached PNG across runs when a print matches
the previous run's. `kamishibai/react` returns one automatically by hashing the
committed DOM, so React reels get both for free; raw pages can return their own.

## Incremental builds

Re-render only what changed and reuse the rest. Both modes keep PNGs on disk,
so both need a persisted `--frames-dir`:

- `--incremental` (`-i`) — walks **every** frame and compares its fingerprint to
  the previous run's (stored in `<frames-dir>/.kamishibai-cache.json`). Unchanged
  frames keep their PNG (the screenshot is skipped, but the page is still seeked
  to compute the print); only changed frames are re-captured. The cache
  auto-invalidates if the output geometry (fps / size / scale) changes. Use it
  when the change is **scattered** and you don't know which frames moved.
- `--only 0-30,90,120-150` — render just the named frames, leaving every other
  PNG untouched (needs a prior full render to fill the gaps). It never visits the
  other frames at all, so when you know exactly what changed — especially a
  **tail-only edit** — it's far faster than `-i`, which still has to walk the
  whole reel to fingerprint it. It refuses a dir captured at a different
  fps / size / scale, and a range starting past the last frame is an error.
  Audio and captions come from the prior full render's mux sidecar
  (`kamishibai skill capture-encode`).

```sh
kamishibai render reel.tsx -f frames -o reel.mp4        # seed the cache
# …edit the reel…
kamishibai render reel.tsx -f frames -i -o reel.mp4     # re-render only changes
```

Once capture is reduced to a few frames (by `-i`/`--only`), the remaining cost
is the **full re-encode** of the whole PNG sequence — every confirm re-encodes
the entire reel, not just the changed frames. For a fast confirm loop, pair the
reuse flag with `--preview` (= `--preset ultrafast`), which trades a larger file
for a much quicker H.264 pass; drop it for the final render. `--preset <name>`
sets any libx264 preset directly (preview only affects the mp4 encode, not gif).

```sh
kamishibai render reel.tsx -f frames -i --preview -o reel.mp4   # fast confirm
```

**Confirm loop & gotchas.** After a localized edit, the fastest *playable* check
is `--only <range> --preview` — capture only the frames that moved, then a quick
ultrafast encode you can scrub in a player (the encode still scales with reel
length, so a long reel is minutes, not seconds). Run **one render per frames-dir
at a time**: concurrent encodes just contend (both slow), and a render killed
mid-encode leaves an mp4 with **no moov atom** that players reject — re-run.
<!-- /topic -->

## Writing a reel

### Raw (no framework)

```ts
const box = document.body.appendChild(document.createElement("div"));
window.kamishibai = {
  meta: { fps: 30, durationMs: 4000, width: 1280, height: 720 },
  seek(ms) {
    box.style.transform = `translateX(${Math.min(1, ms / 2000) * 400}px)`;
  },
};
```

### React (`kamishibai/react`)

```tsx
import { mount, Enter, ramp, eases, useClock } from "kamishibai/react";

const Reel = () => {
  const { ms } = useClock();
  const x = ramp(ms, 0, 1000, 0, 400, eases.smooth); // time → value
  return (
    <Enter at={200} dur={600}>
      <div style={{ transform: `translateX(${x}px)` }}>hello</div>
    </Enter>
  );
};

// mount() renders the tree and sets window.kamishibai.
mount(<Reel />, { fps: 30, durationMs: 6000, width: 1920, height: 1080 });
```

Components and hooks (times in ms):

- `useClock()` → `{ ms, durationMs, fps, epochMs }`; `ms` is local to the
  enclosing `<Cue>` or scene.
- `<Stage background style>`: the root surface.
- `<Cue at hold>`: children only from `at` for `hold`, with a clock restarting at 0.
- `<Enter at dur lift ease>`: fade and rise in.
- `<Series>` / `<Series.Scene durationMs crossfadeMs exitFadeMs>`: scenes back
  to back, each with its own clock, optionally crossfading. Or from data:
  `<Series scenes={[{ durationMs, crossfadeMs, content }]} />`, with
  `seriesDuration(scenes)` for `meta.durationMs`.
- `<Audio src delayMs atMs gain fadeInMs fadeOutMs loop trimStartMs durationMs>`:
  a sound from the scene's start (+`delayMs`). `src` is a file path read by
  ffmpeg, not a URL. `gain` is in dB.
- `<Bgm src gain fadeInMs fadeOutMs duck>`: background music from 0 s, looped
  and cut to the reel's length, with `fadeOutMs` ending at the reel's end.
  `duck` dips it under other sounds.
- `<Subtitle src | cues | children delayMs bottom style>`: captions from an
  SRT/VTT file, `cues` (`{ start, end, text }[]`), or text timed by the
  enclosing `<Cue>`. Times count from the scene. By default a soft track (an
  mp4 text track and a sidecar `.srt`), and that is enough: burn captions into
  the picture only when asked to, or for a gif. With `--burn-subtitles` they are
  drawn into the frames: centred, `bottom` px (80) up, white 40 px text on a
  `rgba(0,0,0,0.62)` box; `style` overrides any of it, e.g.
  `style={{ background: "rgba(0,0,0,0.6)" }}`.
- `<Video src startMs muted gain fadeInMs fadeOutMs style>`: a frame-accurate
  clip, served via `--public` (`kamishibai skill video`).
- `<Narration clip delayMs atMs gain fadeInMs fadeOutMs subtitle subtitleBottom
  subtitleStyle>` / `<NarrationSteps steps subtitle>`: TTS voice-over
  (`kamishibai skill narration`); `subtitle` adds the line as a caption.
- `<Camera x y zoom rotate>` or `<Camera shots={[{ at, x, y, zoom, ease }]}>`:
  children in world px; `(x, y)` sits at the frame centre, scaled by `zoom`
  (> 0); a positive `rotate` turns the camera clockwise.
  `cameraAt(ms, shots)` is the same without React.

```tsx
import { mount, Series, Audio, seriesDuration } from "kamishibai/react";
const scenes = [
  { durationMs: 4000, content: <><Audio src="vo/a.m4a" delayMs={500} /><A /></> },
  { durationMs: 6000, crossfadeMs: 600, content: <B /> },
];
mount(<Series scenes={scenes} />, { fps: 30, durationMs: seriesDuration(scenes), width: 1920, height: 1080 });
```

<!-- topic: scenes | `<Series>` in depth: sizing with crossfades, local clocks, exit fades against ghosting, timing errors -->
### Scenes (`<Series>`)

- **Sizing.** A crossfade *overlaps* the previous scene, so a reel is
  `Σ durations − Σ crossfades` long. Pass `seriesDuration(scenes)` to
  `meta.durationMs` (or `seriesLayout(scenes)` for the per-scene start times);
  both are exported from `kamishibai/react` (plain functions, no React needed). A hand-summed total that
  forgets crossfades leaves **trailing blank frames** (too long) or **cuts the
  last scene** (too short).
- **Local clocks.** Inside a scene the clock is scene-local: `useClock()` returns
  `ms`/`durationMs` measured from the scene start, and `<Audio>` / `<Narration>`
  `delayMs` is relative to the scene (use `atMs` for an absolute time). `<Cue>`
  nests the same way, resetting the local clock again.
- **Wrapping.** Scenes self-register with the enclosing `<Series>` (from an
  effect, much like `<Audio>` markers), so `const MyScene = (p) => <Series.Scene
  durationMs={p.d}>…</Series.Scene>` renders correctly whether it's a direct
  child or nested in your own components. Keep scenes statically ordered —
  registration order is source order.
- **Transitions / anti-ghosting.** A crossfade fades the incoming scene in
  over the outgoing one, which stays fully opaque until it ends (a linear mix
  between opaque scenes; nothing beneath the Series shows through; an incoming
  scene with no background shows the outgoing one through it until that ends).
  So two different layouts **ghost** (e.g. a centered title bleeding through
  the incoming slide). Set `exitFadeMs` on the outgoing scene to fade its
  *content* out; the fade ends where the next scene's crossfade begins, so the
  old content is gone before the new one shows. Everything in the scene fades
  (Stages, their children, content outside a Stage), but each `<Stage>` with
  no other Stage or `<Series.Scene>` between it and the fading scene leaves an
  opaque, childless copy of its box (`background` + `style`, laid out against
  the full frame) underneath, in tree order, so only the backgrounds blend. A
  Stage inside a nested `<Series>` leaves no copy (it fades with the content;
  give the inner scene its own `exitFadeMs` if needed). With no Stage, the scene fades to what's under the Series until the next
  scene fades in. The two add up: a 700ms crossfade + 600ms exit-fade starts
  dimming the content 1300ms before the outgoing scene ends.
- **Checked timings.** A negative length, or a `crossfadeMs` longer than either
  scene it joins, throws a `RangeError` (seriesLayout / seriesDuration / Series).
  Any error the reel throws while rendering fails the capture with its message.
  One thrown before `mount()` is logged as a page error at once, and the probe
  fails naming it (with every other distinct page error, in order) when the
  idle page-load wait (`--probe-timeout`, default 15s) runs out — a page error alone never stops the wait, as the page may still
  mount.
- **Sub-frame windows.** Markers (`<Audio>`, soft `<Subtitle>`) register when
  mounted, and only sampled frames (`i × 1000 / fps`) mount anything. A `<Cue
  hold>` or scene shorter than one frame that no frame lands in is mounted
  hidden for one frame (the next one, or the last frame for a window after
  it), so its markers still count while nothing paints (a Stage in it leaves
  no exit-fade copy). Frames are the capture's: under `--fps` the page is told
  the override before it loads.
  Other transitions (wipe/swipe) are a few lines of `ramp()` + `transform` on the
  scene content.
<!-- /topic -->

## Easing and paths

From `kamishibai/easing` (also re-exported by `kamishibai/react`; no React needed):

- `ramp(ms, fromMs, toMs, fromV, toV, ease?)`: clamped time → value.
- `eases.linear | smooth | inOut | pop`, `bezier(x1, y1, x2, y2)`,
  `spring({ stiffness, damping, mass })` (ends at exactly 1).
- `track(ms, [{ at, value, ease? }])`: several stops.
- `stagger(i, { each, from })`: a delay per item.
- `interpolateColor(a, b, t)`: between two hex colours.

`kamishibai/path` places things along an SVG path, in the browser:
`pointAt(d, t)` → `{ x, y, angle }` at progress `t`; `pointAtLength(d, len)`;
`pathLength(d)`.

<!-- topic: canvas | Canvas reels: a module drawn on a 2D canvas, painted on the CPU with no browser, laid out for any shape (`--aspect 9:16`) -->
## Canvas reels

A reel can be a module instead of a page: its default export draws a frame on
a 2D canvas, and `kamishibai render` paints it on the CPU with Skia, no
browser. It needs `npm i -D @napi-rs/canvas`. Use it when everything fits a 2D
canvas; keep a page for the DOM, CSS or WebGL.

```ts
import { canvasReel } from "kamishibai/canvas";

export default canvasReel({
  meta: { fps: 30, durationMs: 4000, width: 1920, height: 1080, aspect: { min: 9 / 16, max: 16 / 9 } },
  fonts: [{ family: "Geist", src: "fonts/Geist.ttf", weight: "100 900" }], // relative to this file
  setup(view, env) {
    // once per view: lay out for view.width × view.height (layout units)
    return (g, ms) => {
      // every frame: draw the whole frame for ms; return false / a fingerprint like seek()
    };
  },
});
```

- `setup` runs once per view; the painter must be a pure function of `ms`.
  Time (`durationMs`, `audio`, `subtitles`) must not depend on the view.
- `view` = `{ width, height, pixelRatio, medium, insets }`. Lay out from
  `width`/`height`, and keep text out of `insets` (an app's controls over a
  vertical video).
- `env.readText(path)`, `env.loadImage(path)`, `env.createCanvas(w, h)` instead
  of `fs`, `<img>` or `document.createElement("canvas")`; paths are relative to
  the reel.
- Any weight works in `font` for a variable font, and `textBaseline` is placed
  as in a browser.

```sh
kamishibai render reel.ts -o out.mp4
kamishibai render reel.ts --aspect 9:16 -o tall.mp4   # the long side keeps meta's
kamishibai render reel.ts --aspect 9:16 --inset 160,140,360,40 -o app.mp4
kamishibai dev reel.ts                                # the same player as a page
kamishibai export reel.ts -o reel.html                # one HTML file, any window shape (npm i -D subset-font)
```

`kamishibai export` works for a page reel too: see `kamishibai skill export`.

Frames, `-i`, `--only`, `encode`, audio and narration work as for a page. Look
at the frames of every shape you render: a layout that fits 16:9 may not fit
9:16.
<!-- /topic -->

<!-- topic: kit | Kit reels: scenes as YAML/JSON/code from a kit of parts (title, card, flow, stat…), laid out for any shape, parts moving between scenes, `kamishibai check` -->
## Kit reels

The cheapest way to an explainer: write scenes as data, and the kit lays them
out for any shape, moves parts that keep their id from scene to scene, and
holds each scene as long as its `say` takes. A canvas reel underneath (no
browser). Needs `npm i -D @napi-rs/canvas yoga-layout` (and `yaml` for YAML).

```yaml
kit: 1
fonts: [{ family: Geist, src: fonts/Geist.ttf, weight: "100 900" }]   # relative to this file
theme: { fonts: { sans: Geist, mono: Geist } }
voice: { provider: kokoro, voice: af_heart }   # optional; without it, lengths are estimated
scenes:
  - { kata: cover, say: "…", title: "…", kicker: "…", sub: "…" }
  - { kata: flow, say: "…", title: "…", steps: [A, B, C], at: 1 }
  - kata: compare
    say: "…"
    title: "…"
    left: { label: Docs, body: "…" }
    right: { label: Code, code: "src/x.ts#L40-L44", mark: "now >= t" }
  - say: "…"
    parts:
      - { type: title, text: "…" }
      - type: row
        parts: [{ type: card, body: "…" }, { type: arrow }, { type: card, body: "…", tone: accent }]
```

- Shapes (`kata`): `cover`, `flow`, `compare`, `code`, `stat`, `points`, `picture`.
  Parts: `title`, `text`, `row`, `col`, `card`, `arrow`, `chip`, `stat`, `list`,
  `image`. `kamishibai schema` prints every field.
- Same `id` in the next scene: the part moves there. Without an id, a part's
  id is its type (`title` stays put across scenes); the shapes' ids are fixed,
  so moving `at` along a `flow` walks it. Gone parts fade; new ones come in.
- `code` is text or `"path#L44"` / `"path#L40-L48"` read next to the reel.
- `say` is spoken a sentence at a time (or give a list of sentences); a part
  with `cue: n` comes in as sentence n starts (0 = with the scene), so one
  scene can build up instead of being split.
- `{ type: figure, width, height, items }` draws as data: items `rect: [x, y,
  w, h]`, `circle: [cx, cy, r]`, `line: [[x, y], …]` (`arrow: true`), `text`
  with `at: [x, y]`; colours by theme name (`accent`, `ink3`…). Items keep
  ids across scenes, so a diagram can change shape; an item can have a `cue`.
- `uses: [parts.ts]` loads modules that `definePart` (parts beyond the kit).
- Loop: `kamishibai check reel.yaml` (overlap, off-stage, overflow, contrast,
  widow, for 16:9 and 9:16, no frames; `--json` for parsing; exit 1 on any),
  fix, then `render` and look at a few frames of each shape.
- In code: `export default await kit({ … })` from `kamishibai/kit`, with
  `title()`, `card()`, `row()`… building the same data; `definePart` adds a part.

Give it font files for every script it draws (a container has few fonts).
<!-- /topic -->

<!-- topic: export | One HTML file that plays the reel with no server: `kamishibai export`, `--bare`, `--loop`, query parameters -->
## One HTML file: `kamishibai export`

```sh
kamishibai export reel.tsx -o reel.html                    # player with controls
kamishibai export reel.tsx --bare --loop 0 -o embed.html   # no controls, autoplays, loops (--loop as --gif-loop)
kamishibai export reel.tsx --bare --no-autoplay -o s.html  # waits for the page: window.kamishibaiPlayer.seek(ms)
```

- The file plays offline, with the sound, the narration and captions. The
  sound is mixed into one track (`--audio mix`, the default), or each file is
  carried and the clips are played live with Web Audio (`--audio live`;
  smaller when a short loop runs under a long reel). Its URL can change the defaults:
  `reel.html?controls=0&autoplay=0&loop=0&t=10&muted=1&cc=0`.
- A page is seeked through every frame in Chrome once, and every file it reads
  from its own server is embedded (`-p` as for render). Files on other
  servers stay links. It plays at its meta size, scaled to the window.
- A canvas reel's fonts are cut to the glyphs it draws (`npm i -D subset-font`),
  and it is laid out for the window's shape.
- Open the file and play it through before handing it over.
<!-- /topic -->

## Rendering (CLI)

```
kamishibai render <entry|url> [options]
```

The entry is a `.tsx`/`.ts`/`.jsx`/`.js` script (bundled), an `.html` file (its
directory is served), or a URL you serve.

| Option | | |
|---|---|---|
| `--out` | `-o` | `.mp4` (default) or `.gif` |
| `--public` | `-p` | a directory served at the root, for files the page fetches |
| `--frames-dir` | `-f` | keep the PNG frames here |
| `--incremental` | `-i` | capture only frames that changed (needs `-f`) |
| `--only` | | only these frames, e.g. `0-30,90` (needs `-f`) |
| `--burn-subtitles` | | draw captions into the frames: only when asked, or for a gif |
| `--workers` | `-w` | parallel pages (default: cores − 2, at most 8) |
| `--scale` | `-s` | device scale: output px = meta size × scale |
| `--fps` | | re-sample the reel at another frame rate |
| `--preview` | | a fast, larger encode, for checking |

`kamishibai render --help` lists the rest (quality, gif, raw ffmpeg arguments).
Resolution comes from `meta.width`/`meta.height`, not a flag.

<!-- topic: dev | `kamishibai dev`, the live player for the person you work with -->
### Live preview for people: `kamishibai dev`

```sh
kamishibai dev reel.tsx [-p public] [--mute] [--cc off|captions|storyboard] [--no-sweep]
```

A browser player that reloads on save. It is for the person you work with, so
suggest it when they want to watch while editing. To check frames yourself,
keep using `capture --only` and look at the PNGs. It needs a long-running
process and a browser, so don't start it unless asked.

- It drives the reel only through `seek(ms)`, so any reel that renders previews.
- It **never calls a TTS provider.** Cached lines play with their real audio;
  a new or edited line gets an estimated length and no audio (`src: ""`, a
  placeholder that a render never muxes). Run `kamishibai tts reel.tsx` to bake
  the real voice. Lengths, and so the layout, can shift when you do.
- The **Copy --only** button gives the person a frame range in the form
  `--only 120-150`, ready to pass to `capture`/`render`.
<!-- /topic -->

<!-- topic: capture-encode | Splitting a render into `capture` and `encode`: re-encode kept frames, look at a few frames without a video -->
### Splitting a render: `capture` + `encode`

A render is **capture** (seek the page → PNG frames) then **encode** (frames →
video). `render` does both; the two halves are also their own subcommands, so you
can capture once and encode many times:

```
kamishibai capture <entry|url> -f <frames-dir> [options]   # frames only, no video
kamishibai encode  -f <frames-dir> [options]               # frames → video, no capture
```

`render reel.tsx -f frames -o out.mp4` is exactly `capture reel.tsx -f frames`
then `encode -f frames -o out.mp4` — same frames, same output.

To **look at a few frames without making a video**, use `capture` with
`--only` on a frames dir from a prior full render: `kamishibai capture reel.tsx
-f frames --only 120-130` re-shoots just those PNGs and writes no mp4 (`render
--only` still encodes).

**`capture`** writes the PNGs, the fingerprint manifest, and a **mux sidecar**
(the ducked audio clips, srcs resolved to absolute paths so `encode` works from
any cwd, and the soft subtitle cues) into the dir. It
takes the capture-time flags: `-w`, `--fps`, `-s/--scale`, `-p/--public`, `-i`,
`--only`, `--burn-subtitles`, `--probe-timeout`.

**`encode`** rebuilds the video from that dir — **no browser, no probe, no TTS,
just ffmpeg** — and replays the sidecar, so audio and captions come back without
re-capturing. The fastest path when the frames are already correct and you only
want different encode/mux settings (a new `--crf`/`--preset`, a `--max-width`,
`--encode-args`, or a `.gif`).

- fps comes from the dir's manifest. `--fps` here re-times the kept frames (a
  speed change), unlike `render --fps`, which re-samples the reel.
- A `--only` capture does **not** update the sidecar (it seeks just the selected
  frames, so its markers are partial); the prior full capture's sidecar is kept,
  and `render --only` muxes that sidecar too.
- The PNGs must run gap-free from `f000000.png`; `encode` refuses a sequence
  with a missing frame (ffmpeg would silently stop there).
- Without a usable sidecar (e.g. a raw dir of PNGs, where you must pass
  `--fps`) the output is silent; the log says whether the sidecar was missing,
  unreadable, or from another version.
- `encode` honors `--out`, `--fps`, `--crf`, `--preset`/`--preview`,
  `--max-width`, `--gif-loop`, `--encode-args`, `--mux-args`, `--verbose`.
- `tts` honors only `-p/--public` and `--probe-timeout`. Any subcommand warns
  about (and ignores) flags it doesn't use.

```
kamishibai render reel.tsx -f frames -o reel.mp4        # capture once (writes the sidecar)
kamishibai encode -f frames --preview -o preview.mp4    # re-encode fast, audio + subs intact
kamishibai encode -f frames --crf 28 -o smaller.mp4     # try a setting without re-capturing
```
<!-- /topic -->

<!-- topic: audio | Sound: clips, background music, gain and fades, auto-ducking, credits -->
## Audio

kamishibai does not generate sound. **Audio is declared in the page** — files +
start times — and muxed at the end. `atMs` is the clip's start in milliseconds;
`gain` is dB (negative = quieter). The output is clamped to the reel length
(video is the master timeline). The renderer reads `window.kamishibai.audio`
after capture and muxes it. With React, use `<Audio>` / `<Narration>` / `<Bgm>`
(in the sugar list of the core guide); with the raw API, push markers yourself:

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

Per-clip: `gain` (dB), `trimStartMs`/`durationMs` (use a sub-section),
`fadeInMs`/`fadeOutMs`, `loop` (tile the source to the reel length), `duck`
(auto-dip under the non-ducked clips — see below), and `gainKeyframes` (`[{ atMs, gain }]`)
— dB volume automation over the clip's timeline, linearly interpolated, for
manual ducking/swells.

**Background music:** declare it like any other clip — `<Bgm src="theme.mp3"
gain={-18} fadeOutMs={1500} duck />` at the top level (or `<Audio loop>`). It
muxes *alongside* the narration markers (they mix; nothing is dropped), **tiles**
a short track to fill the whole reel, and clamps to the video length, so you
never hand-stitch loops; `fadeOutMs` lands at the reel end.

**Auto-ducking:** `duck` (on `<Bgm>` or any `<Audio>`) dips the clip while any
*non-ducked* clip plays (ducked clips never dip under each other). A clip's
length is its `durationMs`, else its source file's length after `trimStartMs`
(probed with ffprobe at render time), else — for a `loop` clip — the reel end; a
clip whose length can't be probed doesn't trigger a dip (the render logs it).
Because every clip's start and length are known before the mux,
kamishibai derives the dip envelope from the schedule (no audio analysis): it's
just generated `gainKeyframes`, so it stays deterministic. `duck` alone uses
sensible defaults (−12 dB, 250 ms attack, 600 ms release, bridging short gaps);
tune with `duck={{ amountDb: -16, attackMs: 200, releaseMs: 500 }}`. Explicit
`gainKeyframes` override it.

`src` is read **from the filesystem by ffmpeg** (relative to the render's working
directory, or absolute) — unlike `<Video>` / `staticFile` paths, which the
*browser* fetches and so must be served via `--public`. Run the render from a
stable cwd: relative audio paths **and** the `.kamishibai-tts/` cache resolve
against it, so running from elsewhere silently misses the cache (and re-bills
TTS).

There is no `--audio` CLI flag — audio belongs to the reel. The library
`render({ audio })` option still accepts clips, but they're **merged** with the
page's markers (not a replacement), which is useful for adding audio to a URL
entry you don't control.

**Credits:** third-party music, SFX, footage and TTS voices usually come with
attribution terms — and the required *form* varies (an on-screen line, the
video description, or a **spoken** credit: incompetech requires the credit to
be voiced in audio-only works). Check each asset's license when you add it,
keep a credits list, and tell the requester what must be credited and where
before the final render.
<!-- /topic -->

<!-- topic: video | Frame-accurate video clips (`kamishibai/video`, `<Video>`) -->
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
<!-- /topic -->

<!-- topic: narration | Voice-over with TTS: `prepareNarration`, narration-driven layout, readings, adapters, the cache -->
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
import { kokoroAdapter, prepareNarration, narrationLayout } from "kamishibai/tts";

const voice = kokoroAdapter(); // free and local; needs a Kokoro-FastAPI server
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
  `<Series scenes>` items by adding `content`. The crossfade isn't clamped:
  keep `padMs ≥ crossfadeMs`, or it overlaps the previous line's audio and,
  past a short scene's length, seriesDuration / Series throw a RangeError.
- `narrationTotal(clips)` → the raw voice-over length (sum of durations), handy
  for a sanity check against `seriesDuration(scenes)` (which adds pad/crossfade).
- `narrationSequence(clips, { gapMs, startMs })` → for **several clips in one
  scene**, each clip's cumulative `atMs`. Reveal element X exactly when clip Y
  starts by pairing `<Narration clip delayMs={atMs} />` with `<Cue at={atMs}>`.
  `gapMs` can be a number (uniform), an array, or `(i, clip) => ms` — so you can
  hold a longer beat at a topic change (`gapMs[i]` is the pause after clip `i`).
- `narrationScene(clips, { leadMs, gapMs, tailMs })` → `{ steps, durationMs }`:
  the same sequence after a lead-in, plus the scene length (last clip end +
  tail). The usual way to build a multi-line scene:

```tsx
const s = narrationScene([vo.a, vo.b, vo.c], { leadMs: 300, gapMs: 400, tailMs: 800 });
const scene = {
  durationMs: s.durationMs,
  content: <>
    <NarrationSteps steps={s.steps} subtitle />
    {s.steps.map((step, i) => <Cue key={i} at={step.atMs}><Bullet>{labels[i]}</Bullet></Cue>)}
  </>,
};
```

**Reading vs. caption.** To speak one thing and caption another (Japanese
readings, acronyms), pass `prepareNarration(adapter, lines, { lexicon: { "町字":
"まちあざ", "Pub/Sub": "パブサブ" } })` — substitutions apply to the spoken text
only — or give a line `{ text: "<reading>", caption: "<as written>" }`. The clip's
`text` (what `<Narration subtitle>` shows) is always the caption, and only the
spoken text is hashed, so caption edits never re-synthesize. Lexicon matching
is one left-to-right pass: the longest key *starting at each position* wins, so
an earlier key beats a longer later one (`京都` beats `都庁舎` in "東京都庁舎") —
add a key for the whole word to pin its reading.

**Long narration.** First-time synthesis of many lines can take minutes. The
page-load wait counts only *idle* time, so it keeps waiting while lines are in
flight (`Synthesizing narration…`, then `…narration N/M line(s)` every few
seconds). Prefer **`kamishibai tts reel.tsx`** before the first render: it only
fills the TTS cache (no capture, no encode; a script or `.html` entry, not a
URL) and exits non-zero if a line fails,
so the render afterwards reads every line from cache. If a line fails, the run
stops as soon as nothing else is in flight, naming the provider's error and how
many lines finished; finished lines are cached, so re-running resumes.
Durations are measured with ffprobe (ships with ffmpeg; must be on PATH) — an
unreadable clip fails its line instead of returning 0 ms. A clip ffprobe
reports as invalid data is never kept in the cache (a cached one is deleted),
so re-running synthesizes it again. If ffprobe fails for any other reason
(missing, can't start, permission denied, a crash), the line fails but the
clip — even a freshly synthesized one — is kept, and the next run measures it
once ffprobe works. `--probe-timeout <s>`
(default 15) raises the idle limit for a page that is slow for other reasons.

Show the requester the whole script before the first paid synthesis: an
edited line is billed again and re-times its scene.

Free voices: prefer `kokoroAdapter({ voice, speed })` — Kokoro through a local
Kokoro-FastAPI server (`docker run -p 8880:8880
ghcr.io/remsky/kokoro-fastapi-cpu`; `KOKORO_BASE_URL` to move it), on any OS,
with Apache-2.0 weights whose audio may be published. Voices: `af_heart`
(English), `jf_alpha` (Japanese), …. `sayAdapter()` needs no setup but is
macOS-only and its voices are for personal, non-commercial use, so never
publish `say` output. Swap one line for a paid voice in the final render. Check a voice's
terms when you pick it, not at ship time: commercial use (often not on a free
tier), a required credit, AI-voice disclosure, and for a local model the
license of its weights (some are non-commercial). Even where nothing requires
it, suggest saying the voice is AI ("Narration: AI voice (Kokoro)"), in the
video or outside it, such as the description. Adapters: `openaiAdapter({ model, voice })`
(`OPENAI_API_KEY`), `googleAdapter({ name })` (`GOOGLE_API_KEY`),
`geminiAdapter({ voice, model, instructions })` (`GEMINI_API_KEY`, falling
back to `GOOGLE_API_KEY`),
`pollyAdapter({ voiceId, engine })` (`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`,
`AWS_REGION`; signed with a built-in SigV4, no AWS SDK), or
`elevenLabsAdapter({ voiceId, model })` (`ELEVENLABS_API_KEY`). Each
network adapter takes a `baseUrl` (a proxy or a compatible server), else reads
`OPENAI_BASE_URL` / `GOOGLE_TTS_BASE_URL` / `GEMINI_BASE_URL` /
`ELEVENLABS_BASE_URL` / `AWS_ENDPOINT_URL_POLLY`; it is not part of the cache
key. A key is required only for the provider's own endpoint (Polly always
signs), so another OpenAI-compatible server works through
`openaiAdapter({ baseUrl })`. The adapter sets the batch voice; a single line can override its opts with the
object form `{ text, opts }` (merged over the adapter's, e.g. `{ rate: 150 }`)
— the override folds into the cache key. Custom
provider: a module whose default export is a Node `TTSAdapter`
(`{ provider, synthesize(text, opts) → { audio, format } }`), passed with
`--tts-adapter <file>` (render, capture, tts) or `render({ ttsAdapters })`; the
reel uses the ref `{ id, provider, opts }`, with every output-affecting option
in `id`. (Browser/Node split: the reel's adapter is a serializable ref;
synthesis runs in Node, served to the page over `POST /__tts`.)

The cache key folds in the adapter id + text + per-line opts. Change one
character of a line and **only that line** re-synthesizes; change
`voice`/`model`/`instructions` and **every** line is re-billed. So the cheap
workflow is: **finalize the narration text first, then iterate on timing and
visuals** (those are free) — text and voice changes cost money.
<!-- /topic -->

## Checking a render

- **Look at frames.** Render with `-f frames` and open a few PNGs: `f000123.png`
  is frame 123, at `123 / fps` seconds. A blank tail means `meta.durationMs` is
  longer than the content.
- A glitch that moves when `--workers` changes means `seek` depends on the
  previous seek. Fix that; don't pin `--workers 1`. A difference of a level or
  two on an element's antialiased edge, from the first frame a page captured,
  comes from Chrome repainting only part of the page: give that element
  `will-change: transform`.
- The log is about a dozen lines, whatever the length. Read all of it; don't
  pipe it through `tail` or `head`, which hides `Done → <path>` and errors.
- When done, show the video to whoever asked (on macOS, `open out.mp4`), unless
  told otherwise.

## Determinism checklist

- Load custom fonts before drawing text (the renderer awaits `document.fonts.ready`).
- Pin Chromium through your Playwright version; emoji and sub-pixel rendering
  depend on the Chrome build.
- No wall-clock time or unseeded randomness in `seek`.
- Resolve `seek` only once the DOM shows the target `ms`. `kamishibai/react`
  does this; with the raw API, a frame still showing the previous `ms` lets a
  worker capture a stale frame.

## Library

```ts
import { render } from "kamishibai";
await render({ entry: "reel.tsx", out: "reel.mp4", publicDir: "public", onLog: console.log });
```
