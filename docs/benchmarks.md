[← kamishibai](../README.md) · [all docs](README.md)

# Benchmarks

kamishibai next to [Remotion](https://www.remotion.dev/) and [HyperFrames](https://github.com/heygen-com/hyperframes) on one machine. There are three questions:

1. **Re-rendering after an edit:** how long does a render take after a small change to a long reel?
2. **Render speed:** how long does a short reel take from a cold start?
3. **Agents:** how many tokens does a coding agent spend turning a brief into a video?

These are one machine's numbers, from October 2026. They are not a guarantee. The harness, with the briefs and every tool's reference implementation, is in [`bench/`](../bench/README.md), so you can run it on your own machine.

## Setup

| | |
|---|---|
| Machine | Apple M1, 8 cores, macOS. The measurements started once the machine was idle, and one render ran at a time. |
| kamishibai | For the render timings, `main` after 0.5.0 (`8084341`). It captures with one headless Chrome, a page per chunk, and draws WebGL on the GPU. |
| Remotion | 4.0.534, from `create-video --blank` |
| HyperFrames | 0.8.143, from `hyperframes init --example blank` |
| Output | 1920×1080, 30 fps, H.264 mp4 |
| Timing | Wall-clock time of the render command, as a fresh process each time. Times are medians. |

Each tool runs its own defaults, so the intermediate frames differ:

- kamishibai writes PNGs and encodes them after capture.
- Remotion's template uses JPEG frames and streams them to ffmpeg during capture.
- HyperFrames captures with `drawElement` where it can, and otherwise falls back to JPEG screenshots.

Every reel is a separate implementation of the same written spec, one per tool, in that tool's usual style.

## Re-rendering after an edit

The reel lasts 86 seconds (2,580 frames): nine scenes, each a heading and three bullets that fade in, joined by crossfades, with background music. Starting from the same base, five edits are applied one after another, the way a revision loop goes. Each tool renders after every edit.

| Edit | What changes on screen |
|---|---|
| heading | One scene's heading text (359 frames) |
| accent | One scene's accent colour (491 frames) |
| timing | One scene's bullets start 0.5 s later (289 frames) |
| audio | The music fades out over 3 s instead of 1.5 s (no frames) |
| global | The text colour everywhere (all 2,580 frames) |

Conditions:

- **kamishibai `-i`:** `render -f frames -i`, which keeps the frames and encoded segments from the previous run.
- **kamishibai:** a full render with no cache.
- **Remotion:** `remotion render`, with the defaults.
- **HyperFrames:** `hyperframes render`, with the defaults.

Each condition ran the base and all five edits three times. The table shows the median in seconds.

| Edit | kamishibai `-i` | kamishibai | Remotion | HyperFrames |
|---|---:|---:|---:|---:|
| base (first render) | 42.6 | 44.1 | 57.3 | 51.2 |
| heading | **25.0** | 42.7 | 48.1 | 51.3 |
| accent | **22.7** | 40.6 | 47.5 | 51.0 |
| timing | **21.3** | 40.9 | 48.3 | 50.9 |
| audio | **19.8** | 43.6 | 48.1 | 51.7 |
| global | 42.1 | **40.1** | 48.6 | 50.9 |

- **Local edits:** with `-i`, a render after an edit takes about half as long as a full render. The frames that didn't change are copied, and only the 2-second segments that hold changed frames are encoded again.
  - The audio edit changes no frames, so nothing is encoded and only the sound is mixed again.
  - Every frame is still sought to get its fingerprint, so a render after an edit doesn't drop to zero.
- **Global edits:** when every frame changes, `-i` saves nothing and costs a little extra.
- **Correctness:** after each edit, the video from `-i` was compared frame by frame with a full render. In all 18 comparisons, no frame differed.
- **Full renders:** kamishibai took about 40–44 s, Remotion about 48 s and HyperFrames about 51 s on this reel. Remotion's first run is slower, at 57 s.

## Render speed

There are three short reels, from the same briefs as the agent trials below:

| Reel | Length | What's in it |
|---|---|---|
| text | 8 s, 240 frames | A title, three growing bars and a counter: DOM and CSS |
| three | 6 s, 180 frames | 500 three.js spheres, an orbiting camera and a DOM lower third: WebGL |
| scenes | 12 s, 360 frames | Three scenes with crossfades, burned-in captions and music |

There are two configs:

- **default:** each tool's own defaults, with parallel capture.
- **single:** one capture worker (`-w 1`, `--concurrency=1`, `--workers 1`).

Each condition ran once as a warm-up and then 5 more times. The table shows the median in seconds, with the range of the 5 runs in brackets. All 90 timed runs passed the output check.

| Reel | Config | kamishibai | Remotion | HyperFrames |
|---|---|---:|---:|---:|
| text | default | **5.9** [5.5–6.0] | 6.2 [5.3–6.6] | 17.8 [17.4–18.4] |
| three | default | 7.3 [7.2–8.5] | **7.1** [5.9–7.2] | 8.1 [7.9–9.4] |
| scenes | default | **6.7** [6.5–7.2] | 9.3 [8.8–10.1] | 12.7 [12.4–13.3] |
| text | single | 15.1 [14.7–15.7] | **13.0** [12.6–13.2] | 16.5 [16.3–17.2] |
| three | single | 13.0 [12.7–13.6] | 12.2 [12.1–12.3] | **11.0** [10.8–11.6] |
| scenes | single | 22.4 [21.8–28.1] | 19.3 [19.1–19.6] | **10.3** [10.2–11.7] |

- **With parallel capture**, kamishibai and Remotion are within about a second of each other on text and three, and kamishibai is faster on scenes.
- **With one worker**, kamishibai is the slowest on all three reels. Remotion encodes while it captures, but kamishibai encodes only after capture has finished. On scenes, HyperFrames' single-worker render was its fastest.
- **HyperFrames on text:** its default render tries `drawElement` capture, which fails a self-check on this reel. It then falls back to one worker with JPEG screenshots, so default is slower than single here.
- **WebGL:**
  - For the three reel, Remotion runs with `--gl=angle`, so all three tools draw WebGL on the GPU. Without that flag, Remotion uses SwiftShader, its default.
  - kamishibai turns the GPU on only for reels that create a WebGL context. Its three reel also passes `--probe-timeout 60`.
- **Fonts:** Remotion's reels load Inter with `@remotion/google-fonts`, so each of its renders fetches the font over the network.

## Agents

Each trial is a headless Claude Code session (Opus 5.5) that gets the same brief for each tool and must produce an `out.mp4` that passes an automatic check. The check covers size, frame rate, duration to within one frame, and the audio track.

- **Conditions:** each tool ran with its official agent skills installed in the project (skill) and without them (noskill).
- **No tool:** a baseline (bare) starts from an empty npm project and may use anything except a tool made for producing video from code, such as kamishibai, Remotion or HyperFrames.
- **Isolation:** each session starts from a clean home directory, without the user's `CLAUDE.md`, skills, plugins or MCP servers.
- **Repetitions:** 5 per condition, in a seeded random order.
- **Three runs:**
  - The first, on 9 October 2026, covered all three tools (90 trials) with kamishibai 0.5.0.
  - The second, later the same day, ran only kamishibai (30 trials). It used the guide that `kamishibai skill` now prints: a core with a list of topics, where it used to print the whole guide at once. The full guide had overflowed the agent's shell output in 26 of 30 trials, so the agent read it a second time.
  - The third, on 11 October 2026, ran only the baseline with no tool (15 trials), on Claude Code 2.1.296 instead of 2.1.295.

All 135 trials passed. The table pools all three briefs and shows medians, with the interquartile range in brackets. Tokens include cached input. Cost is the API-equivalent price.

| Condition | Pass | Tokens | Cost | Turns | Minutes |
|---|---:|---:|---:|---:|---:|
| kamishibai · skill, core and topics (second run) | 15/15 | 351k [310k–463k] | $0.38 | 14 | 1.5 |
| kamishibai · noskill (second run) | 15/15 | 465k [395k–612k] | $0.46 | 14 | 2.4 |
| kamishibai · skill, whole guide (first run) | 15/15 | 472k [393k–544k] | $0.51 | 17 | 1.9 |
| kamishibai · noskill (first run) | 15/15 | 512k [432k–615k] | $0.50 | 14 | 1.9 |
| Remotion · skill | 15/15 | 206k [168k–222k] | $0.29 | 10 | 1.4 |
| Remotion · noskill | 15/15 | 204k [176k–230k] | $0.26 | 10 | 1.5 |
| HyperFrames · skill | 15/15 | 368k [353k–435k] | $0.44 | 14 | 1.8 |
| HyperFrames · noskill | 15/15 | 328k [283k–347k] | $0.34 | 14 | 1.8 |
| No tool (third run) | 15/15 | 239k [196k–269k] | $0.29 | 11 | 3.5 |

- **Tokens:** with its skill, kamishibai takes about as many tokens as HyperFrames and about 1.7× as many as Remotion. Splitting the guide cut about a quarter: text went from 418k to 316k, three from 381k to 314k, and scenes stayed at 567k.
- **Scenes:** the scenes brief, which has music, captions and crossfades, costs kamishibai the most. Without the skill in the second run, its median was 1,307k, with an interquartile range of 729k to 2,086k.
- **Comparing runs:** Remotion and HyperFrames weren't run again, so their numbers come from the first run. With 5 trials per brief, a difference of a few tens of thousands of tokens is within the noise.
- **Remotion:** in 13 of its 15 skill trials, Remotion didn't load a skill at all. Its numbers are close to what the model already knows about Remotion.
- **Skills loaded:** in every kamishibai skill trial of both runs, the agent loaded the `kamishibai` skill and never loaded `video-craft`.
- **No tool:** without a tool, the agent wrote its own renderer every time.
  - For text and scenes, it drew each frame with Python and Pillow and piped the frames to ffmpeg, with no browser.
  - For three, it captured a three.js page with Puppeteer or Playwright.
  - It took fewer tokens than kamishibai with its skill (239k against 351k), close to Remotion. By brief: text 268k, three 239k, scenes 205k, against kamishibai's 316k, 314k and 567k.
  - It took about twice as long as kamishibai with its skill (3.5 minutes against 1.5).
  - These briefs are short and simple. They don't test long videos, narration, previews or edits after the first render.
- **Quality:** these numbers say nothing about how good the videos look, only that they pass the check.
