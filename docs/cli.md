[← kamishibai](../README.md) · [all docs](README.md)

# CLI

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
| `--public` | `-p` | static assets dir served at the root (for `staticFile`-style paths); the entry's own files win on a name clash |
| `--frames-dir` | `-f` | write PNG frames here (created if needed; kept after rendering) |
| `--incremental` | `-i` | reuse cached frames; re-render only changed ones (needs `--frames-dir`) |
| `--only` | | render only these frames, e.g. `0-30,90,120-150` (needs `--frames-dir`) |
| `--burn-subtitles` | | burn captions into the frames instead of a soft track + sidecar `.srt` |
| `--gif-loop` | | gif loops: `0` infinite (default), `-1` once, `n` times |
| `--crf` | | H.264 quality `0`–`51`, lower = better (default: 18) |
| `--preset` | | libx264 speed preset (`ultrafast`…`veryslow`); speeds up the mp4 encode (mp4 only) |
| `--preview` | | shortcut for `--preset ultrafast` — a fast confirm encode |
| `--encode-args` | | raw ffmpeg args for the video encode pass, e.g. `"-tune animation"` (mp4 only) |
| `--mux-args` | | raw ffmpeg args for the audio/subtitle mux pass, e.g. `"-movflags +faststart"` (mp4 only) |
| `--probe-timeout` | | seconds to wait for the page to expose `window.kamishibai` with nothing in progress (default: 15); narration still synthesizing doesn't count |
| `--keep-frames` | | keep the intermediate PNG frames (in the temp dir; path is logged) |
| `--verbose` | | stream ffmpeg output |

The entry can be a **URL** you already serve (`http://localhost:3000`), a local **`.html`** file (its directory is served as-is), or a local **script** (`.ts` / `.tsx` / `.js` / `.jsx`) — bundled with esbuild and served for you. A URL is loaded untouched, so `--public`, `--burn-subtitles` and narration (TTS) only work with an `.html` or script entry; the CLI warns when you pass them with a URL.

Not every subcommand reads every flag: `capture` takes the capture-time ones (`-w`, `--fps`, `-s`, `-p`, `-f`, `-i`, `--only`, `--burn-subtitles`, `--probe-timeout`), `encode` the encode-time ones (`-o`, `-f`, `--fps`, `--max-width`, `--gif-loop`, `--crf`, `--preset`/`--preview`, `--encode-args`, `--mux-args`, `--verbose`), `tts` only `-p` and `--probe-timeout`, `dev` only `-p`, `--port`, `--mute`, `--cc`, `--no-sweep` and `--no-open`, and `render` all of them. A flag the subcommand doesn't use is ignored with a warning.

```sh
kamishibai render reel.tsx -o reel.mp4 -w 4
kamishibai render reel.tsx -s 2 -o reel@2x.mp4                   # 2× resolution
kamishibai render reel.tsx -o reel.gif --fps 25 --max-width 720 # animated GIF
kamishibai render reel.tsx -p public -o reel.mp4                # serve ./public at the root
kamishibai render reel.tsx -f frames -i --preview -o reel.mp4   # fast confirm encode
kamishibai render reel.tsx --encode-args "-tune animation" -o reel.mp4
kamishibai render http://localhost:3000 -o page.mp4
```

Resolution comes from `meta.width`/`meta.height` (your CSS is authored in those pixels); `--scale` multiplies only the captured pixels, so a 1920×1080 reel at `-s 2` outputs 3840×2160 with the same layout. GIF frame delays are quantized to 1/100s, so pair `.gif` with `--fps` set to a divisor of 100 (25, 50, …) for exact timing.

`--encode-args` and `--mux-args` are raw ffmpeg escape hatches, kept separate because the two passes differ: the **encode** pass compresses the PNGs to H.264 (`-tune`, `-x264-params`, `-profile:v`), while the **mux** pass stream-copies that video while adding audio/subtitles (`-c:a`, `-movflags`). Each string is appended just before the output, so it can override the built-in flags; it's split on whitespace, so quote the whole string.

## Splitting a render: `capture` + `encode`

A render is **capture** (seek the page into PNG frames) then **encode** (frames into a video). `render` does both, and the two halves are also their own subcommands — so you can capture once and re-encode many times:

```sh
kamishibai capture reel.tsx -f frames                   # frames + manifest + mux sidecar, no video
kamishibai encode  -f frames -o reel.mp4                # frames → video, no browser
kamishibai capture reel.tsx -f frames --only 120-130    # re-shoot a few frames to look at, no mp4
```

`render reel.tsx -f frames -o out.mp4` is exactly those two in sequence. `encode` rebuilds the video from the dir — **no browser, no capture, just ffmpeg** — and replays the mux sidecar a full capture left (the ducked audio clips with srcs resolved to absolute paths, so `encode` works from any cwd, and the soft subtitle cues), so audio and captions come back without re-capturing. It's the fastest path when the PNGs are already correct and you only want different encode/mux settings (`--crf`, `--preset`/`--preview`, `--max-width`, `--encode-args`, or a `.gif`). fps comes from the dir's manifest; `--fps` here re-times the kept frames (a speed change, not a re-sample like on `render`); a `--only` capture leaves the sidecar untouched (its markers are partial), so `render --only` muxes that same sidecar, and a dir of raw PNGs with no usable sidecar encodes silent (the log says whether it was missing, unreadable, or from another version). The PNGs must run gap-free from `f000000.png` — `encode` refuses a sequence with a missing frame, since ffmpeg would stop at it.

`--only` fills in frames of a prior full capture, so it refuses a dir captured at a different fps/size/scale (re-capture without `--only` first), and a range that starts past the last frame is an error. With `-i`/`--only`, frames past the reel's end (from an earlier, longer run) are removed.

```sh
kamishibai encode -f frames --preview -o preview.mp4    # re-encode fast, audio + subs intact
kamishibai encode -f frames --crf 28 -o smaller.mp4     # try a setting without re-capturing
```

`kamishibai tts reel.tsx` is a third, smaller half: it only runs the narration pre-pass (load the page once, synthesize uncached lines into `.kamishibai-tts/`), with no capture or encode. It needs a script or `.html` entry: a URL entry is served by its own server, so its narration requests never reach kamishibai.

For long jobs, capture and encode each print a `…captured X/total` / `…encoded X/total` heartbeat at most once a minute, so a slow reel shows it's advancing; short jobs finish before the first tick and stay quiet.
