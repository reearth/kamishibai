[← kamishibai](../README.md) · [all docs](README.md)

# Audio

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

Per clip: `gain` (dB) · `trimStartMs` / `durationMs` (use a sub-section) · `fadeInMs` / `fadeOutMs` · `loop` (tile the source to the reel length) · `duck` (auto-dip under the non-ducked clips) · `gainKeyframes` (manual dB automation).

**Auto-ducking** derives the dip from the schedule — every clip's start and length are known before the mux, so the music dips while narration plays and rises in the gaps, deterministically (no audio analysis). A ducked clip dips under every *non-ducked* clip (ducked clips never dip under each other); a clip's length is its `durationMs`, else its source file's length after `trimStartMs` (probed with ffprobe at render time), else — for a `loop` clip — the reel end. A clip whose length can't be probed doesn't trigger a dip. `duck: true` uses defaults (−12 dB, 250 ms attack, 600 ms release); tune with `duck: { amountDb: -16, attackMs: 200, releaseMs: 500 }`, or automate by hand with `gainKeyframes`.

`src` is read **from the filesystem by ffmpeg** (cwd-relative or absolute) — unlike `<Video>` / `staticFile` paths, which the *browser* fetches and must be served via `--public`. There's no `--audio` CLI flag (audio belongs to the reel); the programmatic `render({ audio })` option still works and is **merged** with the page's markers — handy for adding audio to a URL entry you don't control.
