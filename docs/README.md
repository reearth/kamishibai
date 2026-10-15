[← kamishibai](../README.md)

# kamishibai docs

The [README](../README.md) covers the idea, the one contract and a quick start. These pages go into the details.

**Writing a reel**

- [Writing reels — the React sugar](writing-reels.md): `kamishibai/react`, scenes, camera and paths, easing
- [Audio](audio.md): declaring sound, background music, auto-ducking
- [Video (frame-accurate)](video.md): video clips decoded frame by frame with WebCodecs
- [Subtitles](subtitles.md): soft tracks, burn-in, SRT/VTT
- [Narration (TTS)](narration.md): voice-over synthesized once, before capture, and cached
- [Canvas reels](canvas.md): a reel drawn on a 2D canvas, painted on the CPU with no browser, at any shape

**Running it**

- [Live preview: `kamishibai dev`](dev.md): a player that reloads on save
- [One HTML file: `kamishibai export`](export.md): a reel and its player in one file that plays with no server
- [CLI](cli.md): `render`, `capture`, `encode`, `tts` and their flags
- [Skipping frames & incremental builds](performance.md): static spans, fingerprints, `--incremental`, `--only`
- [Library](library.md): calling `render` and friends from code
- [Benchmarks](benchmarks.md): render times and agent tokens next to Remotion and HyperFrames
