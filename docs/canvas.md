[← docs](README.md)

# Canvas reels (no browser)

A canvas reel is a second kind of reel. It isn't a page: it is a module whose default export draws a frame on a 2D canvas for a time `ms`. `kamishibai render` paints it on the CPU with [Skia](https://skia.org/) (`@napi-rs/canvas`), with no Chrome, so it renders where a headless browser is heavy or unavailable, in a small container for example. The same module also plays in a browser: `kamishibai dev` previews it, `kamishibai export` makes it one HTML file that plays at the shape of any window, and `--renderer chrome` captures it in a page.

Use a page when the reel needs the DOM, CSS or WebGL. Use a canvas reel when everything it draws fits a 2D canvas.

```sh
npm i -D @napi-rs/canvas      # Skia for Node; only canvas reels need it
```

## The contract

```ts
import { canvasReel } from "kamishibai/canvas";

export default canvasReel({
  meta: { fps: 30, durationMs: 4000, width: 1920, height: 1080, aspect: { min: 9 / 16, max: 16 / 9 } },
  fonts: [{ family: "Geist", src: "fonts/Geist.ttf", weight: "100 900" }],
  setup(view, env) {
    // Once per view: lay out here.
    const { width: W, height: H } = view;
    return (g, ms) => {
      // Every frame: draw the whole frame for `ms`, in layout units.
      g.fillStyle = "#fafaf7";
      g.fillRect(0, 0, W, H);
      // …
    };
  },
});
```

[`examples/canvas/reel.ts`](../examples/canvas/reel.ts) is a complete one.

- **`meta`** is a page's meta, plus `aspect`: the shapes (width / height) the reel lays out for. Without it, the reel has only its own shape.
- **`fonts`** are font files, as paths relative to the module. They are registered before `setup` runs, in Node and in a browser alike. A variable font draws at any weight: `650 48px Geist`, or a weight that changes from frame to frame.
- **`setup(view, env)`** runs once per view, before any of its frames, and returns the painter. Do the expensive work here, such as layout and loading images.
- **The painter `(g, ms)`** draws the frame at `ms`. `g` is already scaled to the output, so it is drawn in layout units, and it starts each frame cleared, with a fresh state. It returns what `seek()` returns: `false` for "same as the previous frame", a fingerprint string, or nothing.
- **`audio`** and **`subtitles`** are the page's markers, declared up front. Audio paths may be relative to the module.

The rules for a page hold here too. A frame is a pure function of `ms` and the view: no `Date.now()`, no unseeded `Math.random()`, no state carried from the previous call. Time doesn't depend on the view: `durationMs`, `audio` and `subtitles` are the same for every shape, so the soundtrack fits each one.

### `view`

`view` says what the frames are for. It is one object, so new fields can be added without breaking a reel.

| Field | |
|---|---|
| `width`, `height` | layout units across and down |
| `pixelRatio` | output pixels per layout unit (`--scale`, or the screen's) |
| `medium` | `"video"` when rendering, `"player"` in `kamishibai dev` |
| `insets` | `{ top, right, bottom, left }`: space to keep clear of, such as an app's own buttons and captions laid over a vertical video. 0 unless `--inset` sets it |

### `env`

`env` is what differs between Node and a browser:

- `env.readText(path)`: a text file next to the reel, such as source code it quotes (synchronous, for use in `setup`).
- `env.loadImage(path)`: an image file next to the reel.
- `env.createCanvas(w, h)`: an offscreen canvas, for layers and scratch work. Use it instead of `document.createElement("canvas")`, which doesn't exist in Node.

## Rendering

```sh
kamishibai render reel.ts -o out.mp4                    # at meta's size
kamishibai render reel.ts --aspect 9:16 -o tall.mp4     # 1080×1920: the long side keeps meta's
kamishibai render reel.ts --size 1080x1350 -o post.mp4
kamishibai render reel.ts --aspect 9:16 --inset 160,140,360,40 -o app.mp4
```

The frames go through the same pipeline as a page's: a frames directory, `-i`/`--incremental`, `--only`, `encode`, audio and subtitles. A cache is kept per view, so rendering another shape doesn't reuse the frames of the last one.

`kamishibai render` paints a script entry on the CPU when its default export is a canvas reel, and treats anything else as a page. The entry is bundled and looked at first, and run only when it has a default export, so a page's code never runs in Node. `--renderer canvas` requires a canvas reel; `--renderer chrome` mounts one in a page and captures it in Chrome, at its meta size.

Narration works as in a page: `await prepareNarration(...)` at the top of the module. Each line is synthesized once, before any frame is painted.

## In a browser

`kamishibai dev reel.ts` previews a canvas reel in the player, as it does a page. The reel's folder is served too, so its fonts and files load by their relative paths.

### One HTML file: `kamishibai export`

```sh
npm i -D subset-font                          # export cuts fonts with it
kamishibai export reel.ts -o reel.html        # a player with controls
kamishibai export reel.ts --bare -o reel.html # no controls: a canvas that autoplays, to embed
kamishibai export reel.ts --bare --loop 0 -o loop.html  # …and plays forever
kamishibai export reel.ts --bare --no-autoplay -o scroll.html  # waits for the page to start it
```

The flags set the file's defaults, and the query string of its URL can change them, so one file can be embedded in several ways:

| Query | |
|---|---|
| `controls=0` / `1` | hide or show the controls |
| `autoplay=0` / `1` | wait, or start at once |
| `loop=<n>` | as `--loop`: `0` forever, `-1` once, `n` that many more times |
| `t=<seconds>` | start there, e.g. `t=12.5` |
| `muted=1` | start with the sound off |

```html
<iframe src="reel.html?controls=0&loop=0&muted=1" width="640" height="360"></iframe>
```

The file plays from anywhere, offline included, without a server. It lays the reel out for the window's shape, within `meta.aspect`, and again when the window changes, so a phone held upright plays it tall. Where a video file is needed (to post it, or to play it where scripts don't run), render an mp4 from the same reel.

`export` paints every frame once on the CPU, for the default view and both ends of `meta.aspect`, and puts in the file what the reel reads at run time:

- each font in `fonts`, cut to the characters drawn in it, as WOFF2 (a variable font keeps its weight axis);
- the files `setup` read with `env.readText` and `env.loadImage`, under the paths it asked for, so no local paths end up in the file;
- what `prepareNarration` returned, so the page lays out to the voice-over's real length with no TTS server;
- the soundtrack, mixed into one AAC track by the same pass that mixes an mp4's (gains, fades and ducking included). The player follows its clock while it plays. Browsers start sound only after the viewer has interacted with the page, so an autoplaying file starts muted.

The example reel exports to 12 KB. A soundtrack adds about 16 KB a second of audio (96 kbps AAC, as base64).

### In your own page: `play`

`play(reel, el, options)` from `kamishibai/canvas` is the player `export` uses. It lays the reel out for the element's shape and returns a handle the page can drive, from scroll for example:

```ts
import { play } from "kamishibai/canvas";
import reel from "./reel.ts";

const player = await play(reel, document.querySelector("#reel")!, { controls: false, autoplay: false });
addEventListener("scroll", () => player.seek(scrollY * 4));
```

| Option | |
|---|---|
| `controls` | play/pause, a seek bar and the time (default `true`) |
| `autoplay` | start at once (default: `true`, unless the viewer prefers reduced motion) |
| `loop` | play again from the start: `true` forever, a number that many more times (default: once) |
| `startMs` | where to start |
| `muted` | start with the soundtrack muted |
| `insets` | space the reel keeps clear of |
| `medium` | `"player"` (default) or `"embed"`, passed on as `view.medium` |
| `base` | where the reel's fonts and files are fetched from (default: the page's URL) |
| `soundtrack` | one audio file for the whole reel |

The handle has `play()`, `pause()`, `seek(ms)`, `ms`, `playing`, `durationMs`, `view` and `destroy()`. `optionsFromQuery(location.search, defaults)` reads the query parameters above into these options.

`mountCanvas(reel)` instead draws it at its meta size and exposes `window.kamishibai`, the page contract.

## Node and Chrome

Both draw with Skia, but not the same version, so their frames match closely and not exactly: about 0.2% of the pixels of the example differ, at the edges of shapes and letters. Fingerprints describe content, not pixels, so caching is unaffected.

The Node host makes text behave as it does in a browser, where Skia's own defaults differ:

- any weight in `font`, for a variable font (Skia parses only multiples of 100 there, and puts the exact weight on the font's `wght` axis);
- `textBaseline` placed as browsers place it (Skia measures `middle` and `top` on the font's own ascent and descent, several pixels off from a browser).
