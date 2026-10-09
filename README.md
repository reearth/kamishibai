# kamishibai

> **Turn any web page into a video — by making every frame a pure function of its time.**
> A *mechanism*, not a framework. How you draw — React, plain DOM, canvas, WebGL — is up to you.

![A reel rendered with kamishibai](examples/basics/demo.gif)

<sub>The [`examples/basics`](examples/basics/index.tsx) reel — spring entrances, staggered bars, multi-stop tracks, color tweens. ([full mp4](examples/basics/out.mp4))</sub>

`kamishibai` turns any web page (DOM, canvas, anything) into a video by **seeking to each moment and capturing a still**, then assembling the stills with `ffmpeg`. Because every frame is a pure function of its time, capture is reproducible — in a pinned environment, any order of frames gives the same video — and **trivially parallelisable** across several headless Chrome instances.

It deliberately does *not* try to be a frame-accurate compositing engine or ship an editor. It gives you the renderer and one tiny contract; the rest is yours.

**Free · DOM-or-anything · code/CI-first · AI-friendly · no guarantees (MIT)** — that's the combination it's built for.

**Website: [reearth.github.io/kamishibai](https://reearth.github.io/kamishibai/)** · [Lexicon of motion](https://reearth.github.io/kamishibai/lexicon/), camera moves, motion, transitions and light, each with a loop and words to hand an agent.

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

Watch it while you edit, then render it:

```sh
npx kamishibai dev reel.tsx              # a player that reloads on save
npx kamishibai render reel.tsx -o reel.mp4
```

There's no GUI editor; you're the editor. The loop is **edit → look → render**: the [dev player](https://github.com/reearth/kamishibai/blob/main/docs/dev.md) shows the reel as you save, and a render writes the frames you can inspect one by one.

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
  // Return false to mean "identical to the previous frame", or a fingerprint
  // string for the frame's content (see below).
  seek(ms: number): Promise<boolean | string | void> | boolean | string | void;
};
```

Whatever happens inside `seek` — a React re-render, `ctx.clearRect` + hand-drawing, a Konva `layer.draw()` — is entirely up to you. The renderer just calls `seek(ms)`, screenshots, advances, and repeats. It **never plays back in real time**, so a slow frame takes longer but never drops, and in a pinned environment the output is reproducible (see [Determinism & guarantees](#determinism--guarantees)).

### Parallel capture

A reel of N frames is cut into contiguous chunks of frame indices, and each chunk is captured by its own Chrome. Since frame *i* depends only on its time, it doesn't matter which Chrome renders which chunk:

```
frames 0–684     → Chrome #1 ┐
frames 685–1369  → Chrome #2 ├ run at once → PNG sequence → ffmpeg → mp4
frames 1370–…    → Chrome #3 ┘
```

`seek` can also say a frame is **the same as the one before**, by returning `false` or a fingerprint of its content. The renderer then copies the previous still instead of capturing it, and with `--incremental` it reuses frames from the last run whose fingerprint didn't change, so after an edit only the changed frames are captured again. `kamishibai/react` returns the fingerprint for you. See [Skipping frames & incremental builds](https://github.com/reearth/kamishibai/blob/main/docs/performance.md).

---

## What's in the box

| | |
|---|---|
| [**React sugar**](https://github.com/reearth/kamishibai/blob/main/docs/writing-reels.md) | `kamishibai/react`: a clock, scenes back-to-back with crossfades, a camera over a world layer, positions along a path, easing and springs. Optional: any page that sets `window.kamishibai` works |
| [**Audio**](https://github.com/reearth/kamishibai/blob/main/docs/audio.md) | declare files and start times; they're muxed after capture, with fades, loops and auto-ducking |
| [**Video**](https://github.com/reearth/kamishibai/blob/main/docs/video.md) | video clips decoded frame by frame with WebCodecs, so a clip is a pure function of time too |
| [**Subtitles**](https://github.com/reearth/kamishibai/blob/main/docs/subtitles.md) | a soft track and a sidecar `.srt` by default, or burned into the pixels |
| [**Narration**](https://github.com/reearth/kamishibai/blob/main/docs/narration.md) | text to speech once, before capture, content-hashed and cached, with scenes sized to each line. OpenAI, Google, Gemini, Polly, ElevenLabs, or macOS `say` |
| [**Live preview**](https://github.com/reearth/kamishibai/blob/main/docs/dev.md) | `kamishibai dev`: play, scrub, a range to loop, sound or a storyboard, and which frames a render will capture |
| [**CLI**](https://github.com/reearth/kamishibai/blob/main/docs/cli.md) | `render`, or its halves `capture` and `encode`, plus `tts` to bake narration |
| [**Library**](https://github.com/reearth/kamishibai/blob/main/docs/library.md) | the same from code: `render`, `capture`, `encode` and the building blocks under them |

All docs: [docs/](https://github.com/reearth/kamishibai/blob/main/docs/README.md)

---

## Examples

- **`examples/basics`** — a 6s reel showcasing the `kamishibai/react` sugar: fade in/out, an eased progress meter + count-up, staggered reveals, and eased motion.
- **`examples/video`** — frame-accurate video via WebCodecs, both raw (`index.ts`) and React (`react.tsx`). The clip is an AV1-in-MP4 test pattern generated by ffmpeg (`testsrc`, synthetic — no copyright).
- **`examples/narration`** — TTS as a build pre-pass: synthesize the voice-over up front with `say`, size each scene to its line with `narrationLayout`, and add the text as captions.

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
