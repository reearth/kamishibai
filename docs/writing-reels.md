[← kamishibai](../README.md) · [all docs](README.md)

# Writing reels — the React sugar

You don't need React — any page that sets `window.kamishibai` works. But `kamishibai/react` wires a React tree to the contract with a small, clock-driven vocabulary:

- `useClock()` — the current clock: `{ ms, durationMs, fps, epochMs }`
- `ramp` / `eases` / `bezier` / `spring` / `track` / `stagger` / `interpolateColor` — re-exported from [`kamishibai/easing`](#easing)
- `<Stage>` — root surface · `<Cue at hold>` — reveal children during a window, with a **local clock** that restarts at 0 · `<Enter>` — fade + rise in
- `<Series>` / `<Series.Scene durationMs crossfadeMs exitFadeMs>` — lay scenes back-to-back, each with its own local clock ([Scenes](#scenes) below)
- `<Audio>` · `<Bgm>` — declare sound ([Audio](audio.md)) · `<Video>` — frame-accurate video ([Video](video.md))
- `<Subtitle>` — soft captions, mux-time ([Subtitles](subtitles.md)) · `<Narration>` / `<NarrationSteps>` — play pre-synthesized lines ([Narration](narration.md))
- `<Camera x y zoom>` / `<Camera shots>` — film a "world" layer: put a world point at the frame center and push in, pan or pull back ([Camera & paths](#camera--paths))
- `mount(node, meta)` — render and expose `window.kamishibai` (also free-runs on the wall clock in a normal browser, until something calls `seek`)

## Scenes

`<Series>` plays scenes back-to-back, each with its own local clock (so `useClock()` and `<Audio delayMs>` are measured from the scene's start). A `crossfadeMs` overlaps a scene with the previous one: the incoming scene fades in over the outgoing one, which stays fully opaque until it ends. Between two opaque scenes that's a linear mix, and nothing beneath the `<Series>` shows through mid-fade (an incoming scene with no background lets the outgoing one show through it until the outgoing one ends). `exitFadeMs` fades a scene's *content* out, finishing right where the next scene's crossfade begins (so crossfading two different layouts doesn't ghost). Everything the scene renders fades — Stages, their children, and any content outside a Stage — but each `<Stage>` with no other `<Stage>` or `<Series.Scene>` between it and the fading scene leaves an opaque, childless copy of its box (`background` plus `style`, laid out against the full frame) underneath while the content fades, so only the backgrounds blend. The copies stack in tree order, like the Stages. A Stage inside a nested `<Series>` (or another Stage) leaves no copy, so it fades with the content; give the inner scene its own `exitFadeMs` if it needs one. A scene with no Stage fades to whatever is under the `<Series>` until the next scene fades in.

Timings are checked: a negative length, or a `crossfadeMs` longer than either scene it joins, throws a `RangeError` from `seriesLayout` / `seriesDuration` / `<Series>`. Thrown while rendering, it fails the capture with that message. Thrown before `mount()` (e.g. `seriesDuration` in `meta`), it is logged as a page error right away, and the probe fails naming it (with every other distinct error the page threw, in order) once the page-load wait times out (`--probe-timeout`, default 15s of idle time): a page error alone never stops the wait, since the page may still mount.

Markers (`<Audio>`, soft `<Subtitle>`) register when their component mounts, and the renderer only mounts what a sampled frame (`i × 1000 / fps` ms) shows. A `<Cue hold>` or `<Series.Scene>` window shorter than one frame that no frame lands in is mounted hidden for one frame instead (the next frame, or the last frame for a window after it), so its markers still land at their exact times while nothing paints (a `<Stage>` in it leaves no exit-fade copy either). "Frame" means the capture's frame grid: with `--fps`, the page is told the override before it loads.

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

## Camera & paths

`<Camera>` lays its children out in world coordinates and puts the world point `(x, y)` at the frame center, scaled by `zoom` (must be > 0; `cameraAt` throws otherwise), optionally rolled by `rotate` degrees (positive rolls the camera clockwise, so the world turns counter-clockwise on screen). Give it a fixed state, or `shots` — keyframes on the current clock. Between shots the position eases (default `eases.inOut`) and the zoom interpolates in log space, so 1×→4× reads as evenly as 4×→16×. `cameraAt(ms, shots)` is the same math without React.

```tsx
import { Camera } from "kamishibai/react";

<Camera shots={[
  { at: 0,    x: 960,  y: 540, zoom: 1 },   // the whole map
  { at: 2000, x: 1400, y: 300, zoom: 4 },   // push in on one city
  { at: 5000, x: 1400, y: 300, zoom: 4 },   // hold
  { at: 6500, x: 960,  y: 540, zoom: 1 },   // pull back
]}>
  <WorldMap />   {/* drawn in world px, e.g. a 1920×1080 svg at 0,0 */}
</Camera>
```

`kamishibai/path` gives positions along an SVG path — for a dot travelling a route or a particle following a line. It measures with the browser's own `getPointAtLength` on a hidden, cached `<path>` per `d`, so it's exact and deterministic across workers (browser-only):

```tsx
import { pointAt, pointAtLength, pathLength } from "kamishibai/path";

const ROUTE = "M 100 600 C 400 100, 900 100, 1180 600";
const { x, y, angle } = pointAt(ROUTE, ramp(ms, 0, 3000, 0, 1, eases.inOut)); // t: 0..1
```

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
- `spring({ stiffness, damping, mass })` — a physical spring as an easing (overshoots, settles); analytical, so it's deterministic. `p` is one second of spring time, and like every ease it ends at exactly 1, so a `ramp` lands on its target — any motion left at `p = 1` is taken out linearly, so pick a spring that settles within that second
- `track(ms, [{ at, value, ease? }])` — multi-stop interpolation (the n-point `ramp`)
- `stagger(i, { each, from })` — cascade delay (ms) for item `i`
- `interpolateColor(a, b, t)` — tween between hex colors
