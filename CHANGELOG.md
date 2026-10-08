# Changelog

All notable changes to kamishibai are listed here. The project follows
[Semantic Versioning](https://semver.org/); while it is 0.x, a minor version
can contain breaking changes, and they are called out under **Changed**.

## Unreleased

### Added

- **`kamishibai dev <entry>`:** a live preview in the browser. It serves the reel, rebuilds it on save, and drives it through `seek(ms)` only, so any reel that renders also previews. It has play, scrub, frame stepping, an In/Out range with loop, and **Copy --only** to copy the range as `--only a-b`. The timeline zooms and scrolls for long reels. A mute button, and a CC button that steps through `off` / `captions` (soft subtitles and lines with no audio yet) / `storyboard` (every sound as text); `--mute` and `--cc` set them at start. It shows what `seek` returned for each frame (fingerprint or `false`), marks the frames a render would capture rather than copy, and counts them. A hidden copy of the reel sweeps every frame in the background to collect the sound and those results (`--no-sweep` turns this off). Other flags: `-p`, `--port`, `--no-open`. Also available as `dev()` from the library.
- **TTS cache-only mode:** `createTTSEngine({ cacheOnly: true })` never calls a provider. A cached line comes back as usual; an uncached one comes back with `src: ""` and an estimated duration. `dev` uses this, so editing narration costs nothing. `TTSStats` gains `estimated`.
- **Placeholder clips and labels:** an `AudioClip` with `src: ""` is a placeholder for a sound with no file yet. A render skips it and logs that it did. `AudioClip.label` (and `<Audio label>`) names a clip for the dev player and is never muxed. `<Narration>` now always declares its clip, labeled with the caption, including before the line has audio.
- **TTS base URL:** every network adapter takes a `baseUrl`, so requests can go through a proxy or a compatible server. Without it, the adapter reads `OPENAI_BASE_URL`, `GOOGLE_TTS_BASE_URL`, `GEMINI_BASE_URL`, `ELEVENLABS_BASE_URL` or `AWS_ENDPOINT_URL_POLLY`. The base URL is not part of the cache key.

### Changed

- **Docs:** the README is now a short overview (the idea, the contract, a quick start). The details moved to [`docs/`](https://github.com/reearth/kamishibai/blob/main/docs/README.md), one page per topic.

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
