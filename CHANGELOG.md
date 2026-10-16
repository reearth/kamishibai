# Changelog

All notable changes to kamishibai are listed here. The project follows
[Semantic Versioning](https://semver.org/); while it is 0.x, a minor version
can contain breaking changes, and they are called out under **Changed**.

## Unreleased

### Added

- **Canvas reels: video with no browser.** A script whose default export is `{ meta, setup }` from `kamishibai/canvas` draws each frame on a 2D canvas, and `kamishibai render` paints it on the CPU with Skia (`@napi-rs/canvas`, an optional peer dependency), with no Chrome. `setup(view, env)` runs once per view and returns the painter `(g, ms)`, which returns what `seek()` returns. Frames, `--incremental`, `--only`, `encode`, audio, subtitles and narration (`kamishibai tts` included) work as for a page. See [docs/canvas.md](docs/canvas.md).
- **`--size`, `--aspect` and `--inset`** render a canvas reel at another shape (for example a 9:16 vertical video from a 16:9 reel), within the shapes its `meta.aspect` allows, and keep its picture clear of an app's controls. The frames cache is kept per view.
- **`--renderer auto|node|chrome`** says where frames are drawn: `node` paints a canvas reel with Skia, and `chrome` mounts it in a page (`mountCanvas`) and captures it in Chrome. `kamishibai dev` previews a canvas reel too.
- **`kamishibai export reel.tsx -o reel.html`** writes a reel and its player as one HTML file that plays offline, with its soundtrack (mixed into one track), narration and captions. A page is seeked through every frame in Chrome once, and the files it reads from its server are embedded and served back to it from the file. A canvas reel is laid out for the window's shape, its fonts cut to the characters it draws (`subset-font`, an optional peer dependency). See [docs/export.md](docs/export.md). `--bare` leaves out the controls, for a page to embed, `--loop` takes the values of `--gif-loop` (`0` forever, `-1` once by default, `n` more times), and `--no-autoplay` waits to be started. These are the file's defaults: its URL's query (`?controls=0&autoplay=1&loop=0&t=10&muted=1`) can change them, so one file embeds several ways.
- **`kamishibai export --audio live`** carries each sound file once and plays the clips live with Web Audio, as `kamishibai dev` does, instead of mixing them into one track with ffmpeg (`mix`, the default). A format browsers can't decode, such as macOS `say`'s AIFF, is re-encoded as AAC.
- **Kit reels (`kamishibai/kit`): scenes written as data.** A reel can be a list of scenes, each a scene shape (`cover`, `flow`, `compare`, `code`, `stat`, `points`, `picture`) or parts (`title`, `text`, `row`, `col`, `card`, `arrow`, `chip`, `stat`, `list`, `image`), in YAML, JSON or code. The kit lays each scene out with Yoga for the view's shape (rows stack on a tall stage, Japanese breaks between phrases), moves the parts that keep their id from one scene to the next, brings in new ones, and holds each scene for as long as its narration takes (a `voice` from `kamishibai/tts`, or an estimate). A scene's `say` is spoken and captioned a sentence at a time, and a part with `cue: n` comes in as sentence `n` starts. A `figure` part draws rects, circles, lines and text as data, and an item that keeps its id moves to its place in the next scene. A JSON or YAML reel names modules that define more parts in `uses`. It is a canvas reel, so it renders with no browser, and `dev`, `export` and `tts` take a `.json`, `.yaml` or `.yml` entry as they take a script. `definePart` and `defineKata` add parts and shapes. It needs `yoga-layout`, and `yaml` for a YAML reel (optional peer dependencies). See [docs/kit.md](docs/kit.md).
- **Kit reels: transitions, a camera, and more ways in.** A scene's `transition` is `morph` (the default), `cut`, `fade`, `push` or `wipe`. `focus` moves the camera in on a part by its id, as close as frames it, at a sentence's `cue`, and back out in the next scene. A part's `enter` also takes `from-left`, `from-right`, `from-top`, `from-bottom`, `wipe` and `blur`. `captions: burn` draws the captions into the picture instead of a subtitle track.
- **`kamishibai check <entry>`** lays a kit reel out for each shape it allows and lists what is off the stage, overflowing, overlapping, low in contrast or left alone on a line, with no frame drawn (`--json` for a program; exit 1 on any). **`kamishibai schema`** prints the JSON Schema of a kit reel.
- **`play(reel, el, options)`** from `kamishibai/canvas` plays a canvas reel in any element, laid out for its shape, and returns a handle (`play`, `pause`, `seek`, …) a page can drive.

### Docs

- **`kamishibai --help` starts by pointing at `kamishibai skill`**, the guide for writing a reel, and its first line, like the guide's, now names canvas reels and HTML export.

## 0.8.1

### Fixed

- **Long ducked reels no longer fail at the audio mix.** A `duck` clip, or any clip with `gainKeyframes`, got an ffmpeg volume expression that nested one `if()` per keyframe, and ffmpeg rejects an expression nested about 100 deep. A reel with more than about 100 keyframes failed after every frame had been captured. The expression is now a flat sum, so its depth no longer grows with the keyframes.

### Docs

- The guide again has the agent outline a requested video and render a pilot of its first scenes for the requester, before building the whole video, unless the brief is final. This step went with the `video-craft` skill in 0.7.0, so agents had gone straight to the full build.

## 0.8.0

### Added

- **`kokoroAdapter({ voice, speed, baseUrl })`**: free, local voices from [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M) through a Kokoro-FastAPI server (`http://localhost:8880/v1`, or `KOKORO_BASE_URL`). It runs on any OS, and Kokoro's Apache-2.0 weights let the audio be published, unlike macOS `say`. The guide now recommends it for free voices, with `say` for no setup.
- **`--tts-adapter <file>`** loads a custom TTS adapter from the CLI, on `render`, `capture` and `tts`. The module's default export is a `TTSAdapter` or an array of them; `.ts` works on every supported Node, and its imports resolve from the project. Before, a custom adapter needed a script calling `render({ ttsAdapters })`.

### Changed

- **A TTS adapter pointed at another server needs no key.** When `baseUrl` (or the adapter's env var) points away from the provider's own endpoint, `openaiAdapter`, `elevenLabsAdapter`, `googleAdapter` and `geminiAdapter` no longer fail a line for a missing key, and send none. A local OpenAI-compatible server such as Kokoro-FastAPI works with no key. `pollyAdapter` still needs its credentials, since every Polly endpoint checks the signature.

### Docs

- The guide says to check a voice's terms when picking it: commercial use, a required credit, AI-voice disclosure, and a local model's weight license. It also suggests saying the voice is AI even where nothing requires it, in the video or in its description.
- The `kamishibai` agent skill recommends Kokoro over `say` for free voices, and tells 0.7.0 and older, which lack `kokoroAdapter`, to reach Kokoro through `openaiAdapter({ baseUrl })` with `OPENAI_API_KEY` set to any value.

## 0.7.0

### Removed

- **The `video-craft` agent skill.** Agents never loaded it in the benchmark, and current models (Claude Opus 5.5 as of October 2026) already know the directing and motion craft it taught. Its kamishibai-specific advice stays in the guide: credit third-party assets and TTS voices as their licenses require, and show the requester the script before paid synthesis.

### Docs

- The README shows a new demo reel, drawn with the Lexicon's pictures, before the feature list, and recommends Claude Opus 5.5 for making videos (as of October 2026).

## 0.6.1

### Fixed

- **Burned captions keep their style.** With `--burn-subtitles`, a `<Subtitle>` with `src` or `cues` (and so `<Narration subtitle>`) set its box to `rgba(0,0,0,0.62)` and `8px 22px` on every frame, over any `background` or `padding` in `style`. The box now takes `style` as static captions do, and is hidden between cues.
- **Burned captions are the same whatever the worker count.** A page that started capturing in the middle of a caption drew the box's rounded corners one level different from a page that had captured the frames before, so the worker count changed a pixel per frame. The caption box now has its own compositor layer (`will-change: transform`).

### Docs

- `docs/benchmarks.md` leads its agent section with a same-day comparison: kamishibai 0.6.0 and 0.6.1, Remotion, and no tool.
- The guide gives `<Subtitle>`'s props, the shape of `cues`, and the burned caption's default look. In the agent benchmark, every trial that needed captions searched the package for these.
- The core guide that `kamishibai skill` prints is half as long (about 10,700 characters, from 20,500). It keeps every API, says each thing once, and leaves the rarer CLI options to `kamishibai render --help`.
- The guide says to leave captions as the soft track and the `.srt` unless the person asks for them in the picture (or the output is a gif).
- The `kamishibai` agent skill now includes the core guide when it loads: in Claude Code it runs `npx --no-install kamishibai skill` itself (allowed by the skill's `allowed-tools`), so the guide still matches the installed version. Agents that don't run the line are told to run the command.

## 0.6.0

### Added

- **`kamishibai dev <entry>`:** a live preview in the browser. It serves the reel, rebuilds it on save, and drives it through `seek(ms)` only, so any reel that renders also previews. It has play, scrub, frame stepping, an In/Out range with loop, and **Copy --only** to copy the range as `--only a-b`. The timeline zooms and scrolls for long reels. A mute button, and a CC button that steps through `off` / `captions` (the soft subtitles) / `storyboard` (every sound as text); `--mute` and `--cc` set them at start. It shows what `seek` returned for each frame (fingerprint or `false`), marks the frames a render would capture rather than copy, and counts them. A hidden copy of the reel sweeps every frame in the background to collect the sound and those results (`--no-sweep` turns this off). Other flags: `-p`, `--port`, `--no-open`. Also available as `dev()` from the library.
- **TTS cache-only mode:** `createTTSEngine({ cacheOnly: true })` never calls a provider. A cached line comes back as usual; an uncached one comes back with `src: ""` and an estimated duration. `dev` uses this, so editing narration costs nothing. `TTSStats` gains `estimated`.
- **Placeholder clips and labels:** an `AudioClip` with `src: ""` is a placeholder for a sound with no file yet. A render skips it and logs that it did. `AudioClip.label` (and `<Audio label>`) names a clip for the dev player and is never muxed. `<Narration>` now always declares its clip, labeled with the caption, including before the line has audio.
- **TTS base URL:** every network adapter takes a `baseUrl`, so requests can go through a proxy or a compatible server. Without it, the adapter reads `OPENAI_BASE_URL`, `GOOGLE_TTS_BASE_URL`, `GEMINI_BASE_URL`, `ELEVENLABS_BASE_URL` or `AWS_ENDPOINT_URL_POLLY`. The base URL is not part of the cache key.
- **Incremental encode:** with `-i` or `--only`, the mp4 is encoded in 2-second segments kept in the frames dir (`.kamishibai-segments/`), each keyed by its frames' fingerprints and the encode settings. A re-render encodes only the segments whose frames changed and joins them with the rest without re-encoding, so an edit to the sound alone re-encodes no video. Each segment starts with a keyframe, so the file is somewhat larger than a full render's.
- **Website and benchmarks:** [reearth.github.io/kamishibai](https://reearth.github.io/kamishibai/), with the Lexicon of motion. [`docs/benchmarks.md`](https://github.com/reearth/kamishibai/blob/main/docs/benchmarks.md) compares kamishibai with Remotion and HyperFrames, and its harness is in [`bench/`](https://github.com/reearth/kamishibai/tree/main/bench).
- **Capture timings:** `captureChunk` takes `onTiming`, called after each frame with how it was produced (`shot`, `copy`, `cached` or `skipped`) and how long its seek, settle, screenshot and copy took. With `onPageTimings`, it also receives what the page recorded inside each seek; kamishibai/react records its commit, settler, paint and fingerprint phases. Both are for benchmarking and cost nothing when unset. `FrameTiming` is exported.

### Changed

- **Faster capture.** Chrome runs without its 60 Hz frame cap, so each animation frame the capture waits for comes as soon as the previous one is drawn. Screenshots use Chrome's fast PNG encoder: the same pixels, in larger intermediate PNGs. A frame whose `seek` returned a fingerprint is screenshotted as soon as `seek` resolves, without two more animation frames first, so a raw page that returns a fingerprint must return it only once the frame is drawn (`kamishibai/react` already does).
- **WebGL on the GPU (macOS).** Headless Chrome draws WebGL with SwiftShader, on the CPU. When the probe sees the page create a WebGL context, the capture's Chrome draws it with ANGLE over Metal instead: a three.js reel of 500 spheres renders about 4 times faster. A page without WebGL is captured as before. `probeReel()` returns the meta and whether the page uses WebGL.
- **One Chrome for all workers.** The workers are pages of one headless Chrome instead of a Chrome each. Starting several Chromes at once, each with its own GPU process, cost seconds before the first frame: a short reel renders 5 to 20% faster, and a WebGL one the most. The pixels are the same.
- **Docs:** the README is now a short overview (the idea, the contract, a quick start). The details moved to [`docs/`](https://github.com/reearth/kamishibai/blob/main/docs/README.md), one page per topic.
- **`kamishibai skill` prints the core guide and a topic list**, not the whole guide. The core is about half the guide, which fits in one read of an agent's shell tool. `kamishibai skill <topic…>` prints topics (`incremental`, `scenes`, `dev`, `capture-encode`, `audio`, `video`, `narration`), and `kamishibai skill all` prints the whole guide as before. An unknown topic exits with an error that lists them. In a benchmark, all 30 agent runs printed the guide, and in 26 the output overflowed the shell tool and was read a second time from a file.

### Fixed

- **The worker count changed the pixels.** A reel rendered with `-w 1` and `-w 6` could differ in runs of frames that start where a worker's chunk began, for two reasons:
  - A fingerprint hashes the DOM as serialized, which writes numbers to 6 significant digits, so the last frames of an animation (`scale(0.9999998)`, an opacity of 0.9999999) shared a print with the exact values but painted a little differently. Which of them a run of copied frames showed depended on where the chunk began. `kamishibai/react` now re-applies each inline style from its serialization before hashing, so the page paints exactly what its print describes.
  - Chrome kept compositing state for text animated in (opacity and transform changing together), so a worker that hadn't drawn the animation painted the text differently. The renderer now drops that state before each screenshot.

  The last frames of such animations can differ slightly from earlier versions. A `-i` cache keeps its old frames for them, so render once without `-i` to refresh it.

## 0.5.0

### Added

- **Gemini TTS:** `geminiAdapter({ model, voice, instructions })`. It uses `GEMINI_API_KEY` and falls back to `GOOGLE_API_KEY`.
- **`kamishibai tts <entry>`** (and `synthesize()`): bakes the narration into the TTS cache without capturing frames.
- **Narration progress** in the log: `Synthesizing narration…` / `…narration N/M`.
- **`--probe-timeout <s>`.** The page-load wait now counts only idle time, so narration that is still synthesizing no longer trips it.
- **Reading vs caption:** `prepareNarration(…, { lexicon })` and a per-line `caption`. Only the spoken text is hashed, so editing a caption never re-synthesizes.
- **`narrationScene()` and `<NarrationSteps>`** for scenes with several lines.
- **`<Camera>` / `cameraAt()`:** world-space camera with log-space zoom.
- **`kamishibai/path`:** `pointAt` / `pointAtLength` / `pathLength`.
- **`.html` entries** now support `-p/--public`, `--burn-subtitles` and narration.
- **Page warnings and errors** that start with `kamishibai` are forwarded to the CLI log.

### Changed

- **Crossfades are a true dissolve.** The outgoing scene stays opaque and only the incoming scene fades in, so nothing underneath shows through and three overlapping scenes no longer overexpose.
- **Exit-fade and backgrounds.** With `exitFadeMs`, the scene's whole content fades out, ending where the next crossfade begins. The background of an outermost `<Stage>` is left behind as an opaque copy, so only the backgrounds blend.
- **Wider frame fingerprint.** It now covers all of `<body>` and the stylesheet text, so `<style>` changes and portals outside the stage are seen. Existing `-i` caches re-capture once.
- **Sub-frame windows.** A `<Cue>` or scene shorter than one frame interval (including one inside the last frame interval) is mounted hidden for one frame. Its `<Audio>`/`<Subtitle>` markers are still registered.
- **`spring()` ends exactly at 1** at the end of its window. Before, it froze at `spring(1)`.
- **New errors.** These cases used to produce wrong output; they now fail with an error:
  - **Invalid scene timings:** negative values, or a crossfade longer than either scene it joins. `seriesLayout` / `seriesDuration` / `<Series>` throw a `RangeError`. With `narrationLayout`, keep `padMs ≥ crossfadeMs`.
  - **Camera:** a camera shot with `zoom ≤ 0`.
  - **`--only` / `parseFrameRanges`:**
    - a selection that is empty or out of range;
    - a frames dir captured with a different fps, size, scale or burn-subtitles setting.
  - **Worker count:** a non-integer value, for `--workers` and `splitFrames`.
  - **`encode`:** a PNG sequence with a missing frame.
  - **Zero frames:** a reel that rounds to 0 frames.
  - **Failed loads:** a `<Video>` or `<Subtitle src>` that fails to load (including HTTP 404) rejects the seek, so the capture stops.
  - **Errors thrown while the reel renders** stop the capture and show the original error. An error thrown before `mount()` is logged right away and named in the timeout error.
  - **CLI flags:** `--crf`, `--gif-loop` and `--workers` are validated before capture. `--gif-loop -1` now works with a space.
- **`render --only` mux inputs.** It muxes the audio and subtitles of the prior full capture, the same way `capture --only` + `encode` does, instead of muxing the partial markers.
- **Ducking.** It now dips under clips that have no `durationMs`, using their probed length. Ducked clips never dip each other.
- **`--public` precedence.** It is served as a second root, so the generated `index.html` and `bundle.js` win when names clash.
- **Ignored flags warn.** A subcommand warns about flags it ignores, and HELP groups flags by subcommand.
- **`kamishibai tts` with a URL entry** is now an error, because kamishibai can't see that page's narration.
- **ffprobe is required for TTS.** A clip ffprobe can't read fails its line instead of becoming 0 ms.
- **The ffprobe check also runs before `kamishibai tts`.**
- **Docs wording.** They say *reproducible* (in a pinned environment) instead of *deterministic*, and add credit/license guidance for assets and TTS voices.

### Fixed

- **Static server path traversal.** Sibling directories were readable through `..` (containment was a string-prefix check).
- **Missing files crashed the server.** A missing file (`ERR_HTTP_HEADERS_SENT`) crashed the whole process. It now returns 404.
- **Stale trailing frames.** With `-i`/`--only`, PNGs from an earlier, longer run are removed. They used to be encoded.
- **Manifest refresh.** It is always rewritten, even with no fingerprints. A stale fps could make `encode` play at the wrong speed.
- **Interrupted runs and the cache.** A crashed run can no longer leave a cache entry pointing at the wrong pixels.
- **`--only` copy chain.** A page returning `false` no longer makes `--only` copy a stale PNG across an unrendered gap.
- **Audio dedup.** It compares every clip field, so clips that differ only in trim, length, fades or loop are no longer merged. Changed `<Audio>` props replace the old marker.
- **Inverted or zero-length subtitle cues** are dropped with a warning. They used to crash the mux after a full capture.
- **`<Narration atMs subtitle>`** now places the caption at `atMs`, together with the audio.
- **Settler errors.** All settlers are awaited, and errors are no longer swallowed: a broken `<Video>` used to render a blank canvas.
- **Mux sidecar.**
  - It stores absolute audio paths, so `encode` works from any directory.
  - Its log tells a missing sidecar apart from an unreadable or outdated one.
- **TTS failures.**
  - A failed synthesis fails fast with the provider's error, instead of waiting out the timeout and suggesting `--probe-timeout`.
  - Only clips whose content ffprobe reports as invalid are deleted from the cache. A missing or broken ffprobe keeps the file. Freshly synthesized audio is kept when ffprobe can't run, and measured on the next run.
- **Exit-fade backdrop copies** stack in tree order, so the output no longer depends on the worker count.
- **`--fps` override and frame math.** The page now uses the capture fps, so short windows aren't dropped.
- **`kamishibai tts` output** distinguishes "nothing to narrate" from "all cached".

### Dependencies

- playwright 1.63 (lockfile), esbuild 0.28.
- Dev: vitest 5 (vite 8), React 19, TypeScript 6, @types/node 26.

## 0.4.0 — 2026-06-20

- `kamishibai capture` and `kamishibai encode`: capture frames and encode them separately; `encode` re-encodes a kept frames dir without re-capturing.
- Periodic progress heartbeats for long captures and encodes.
- `--preset` / `--preview` for fast confirm encodes, and `--encode-args` / `--mux-args` raw ffmpeg passthrough.
- Audio and subtitles are muxed in a single pass.

## 0.3.0 — 2026-06-20

- Incremental builds (`-i`) via per-frame fingerprints, and `--only` frame ranges.
- Subtitles are a soft track by default; burning them in is opt-in (`--burn-subtitles`).
- mp4box 2.4.1.

## 0.2.0 — 2026-06-19

- Registry-based `<Series>` with a `scenes` prop, `exitFadeMs` and `seriesDuration`.
- Looping audio, `<Bgm>`, and schedule-derived auto-ducking.
- Narration layout helpers, with per-position gaps in `narrationSequence`.
- **Breaking:** the `--audio` CLI flag was removed; programmatic audio is merged with the page's markers.
- Fixed rare initial-frame flashes by committing seek state synchronously.
- Agent skills (`skills/kamishibai`, `skills/video-craft`).

## 0.1.1 — 2026-06-17

- First published release: a seek-and-capture web-to-mp4 mechanism with parallel capture, React sugar, `kamishibai/easing`, audio (trim/fade/gain/keyframes), WebCodecs video, SRT/VTT subtitles, GIF output, `--fps`, and TTS narration as a build pre-pass.
