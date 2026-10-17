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

- **Conditions:** each tool with its official agent skills installed in the project (skill) and without them (noskill).
- **No tool:** a baseline that starts from an empty npm project and may use anything except a tool made for producing video from code, such as kamishibai, Remotion or HyperFrames.
- **Isolation:** each session starts from a clean home directory, without the user's `CLAUDE.md`, skills, plugins or MCP servers.
- **Repetitions:** 5 per brief and condition (3 for the explainer), in a seeded random order.

Every trial passed. Unless a section says otherwise, the tables pool the three briefs (`text`, `three` and `scenes`) and show medians, with the interquartile range in brackets. Tokens include cached input. Cost is the API-equivalent price.

### A narrated explainer: 16–17 October 2026

Claude Code 2.1.301 (2.1.302 for the last kit row), Opus 5.5. The `explainer` brief asks for a 30–50 second explainer in five scenes, narrated with macOS `say`, with burned-in captions and things that appear as the narration names them, rendered at 1920×1080 and at 1080×1920 with the same length. Each row is 3 trials, all of which passed. Two kamishibai conditions were added:

- **kit:** a kit reel, written as scenes in YAML or JSON (see [kit.md](kit.md)).
- **page:** a page reel only, drawn with React or the DOM and captured in Chrome.

The first kamishibai row could use either kind of reel, and in a later run 2 of its 3 trials chose a kit reel. The page condition rules that out.

| Condition | Tokens | Cost | Turns | Minutes |
|---|---:|---:|---:|---:|
| Remotion · skill | 392k [347k–461k] | $0.57 | 17 | 3.6 |
| kamishibai · skill | 663k [587k–685k] | $0.72 | 21 | 4.0 |
| kamishibai page · skill | 664k [561k–701k] | $0.75 | 20 | 3.8 |
| HyperFrames · skill | 789k [739k–873k] | $0.90 | 22 | 5.8 |
| kit · skill, `de9397a` | 2,099k [1,971k–2,126k] | $1.28 | 43 | 4.2 |
| kit · skill, `7c3509f` | 1,107k | $0.81 | 33 | 3.5 |
| kit · skill, `3cbf212` | 621k [587k–622k] | $0.60 | 23 | 2.6 |

- **Where the kit's tokens went.** In the first kit run, every agent read the bundled `dist/kit.js` 10 to 15 times, and all three ended up drawing the scenes in code. Then came:
  - `captions: burn`, and a guide that lists every field, which halved the tokens;
  - laying a row of cards across a wide stage by wrapping them (it had stacked them into a column), growing the parts of a sparse scene to fill the stage, a larger type scale, and `check` issues that say how to fix them.

  After those, the agents read `dist` once in 3 trials, and the kit took slightly fewer tokens than a page reel, at a lower cost.
- **Turns.** The kit still takes a few more turns than a page reel (23 against 20). The rest of its edits were choices of look, such as a card with a label or without, and the length of the last scene.
- **Quality.** Before the last change, the kit's videos were small and mostly empty next to the page reels. The page reels still have more detail in places.

### Same day: 11 October 2026

Claude Code 2.1.296. Each row is 15 trials. The 0.6.1 row was measured at `22dce32`, before two later changes to burned captions (the guide now says to burn them in only when asked, and the caption box has its own compositor layer).

| Condition | Tokens | Cost | Turns | Minutes |
|---|---:|---:|---:|---:|
| kamishibai 0.6.1 · skill | 264k [229k–364k] | $0.32 | 13 | 1.3 |
| kamishibai 0.6.0 · skill | 285k [270k–505k] | $0.40 | 15 | 1.7 |
| Remotion · skill | 177k [151k–203k] | $0.25 | 9 | 1.6 |
| No tool | 239k [196k–269k] | $0.29 | 11 | 3.5 |

By brief, in tokens:

| Brief | kamishibai 0.6.1 | kamishibai 0.6.0 | Remotion | No tool |
|---|---:|---:|---:|---:|
| text | 238k | 270k | 196k | 268k |
| three | 258k | 283k | 177k | 239k |
| scenes | 373k | 536k | 168k | 205k |

- **What changed in 0.6.1.** The transcripts of the 0.6.0 trials showed where the tokens went:
  - In all 5 scenes trials, the agent searched the package's type definitions for `<Subtitle>`'s props, which the guide didn't give.
  - In 2 of them it also met a bug: a burned caption from `cues` ignored the `background` in its `style`. The agent read the library's code and drew the captions itself.
  - Loading the skill, then printing the guide, took a turn of its own, and the guide stayed in the context for every turn after.

  0.6.1 fixes the caption bug, gives `<Subtitle>`'s props in the guide, halves the guide, and has the skill include the guide when it loads. Scenes fell from 536k to 373k, and turns from 15 to 13.
- **Against Remotion.** kamishibai still takes about 1.5× Remotion's tokens. Every turn re-reads the context, so turns cost the most. In most of the earlier skill trials, Remotion didn't load a skill at all and wrote from what the model already knows.
- **Time.** With 0.6.1, the agent finished in 1.3 minutes, against 1.6 for Remotion and 3.5 with no tool.
- **No tool.** The agent wrote its own renderer every time.
  - For text and scenes, it drew each frame with Python and Pillow and piped the frames to ffmpeg, with no browser.
  - For three, it captured a three.js page with Puppeteer or Playwright.
  - That took fewer tokens than kamishibai, but more than twice the time.
  - These briefs are short and simple. They don't test long videos, narration, previews or edits after the first render.
- **Quality:** these numbers say nothing about how good the videos look, only that they pass the check.

### All three tools: 9 October 2026

Claude Code 2.1.295, kamishibai 0.5.0. Each row is 15 trials. A second kamishibai run later that day printed the guide as a core and topics, where it used to print the whole guide at once (the whole guide had overflowed the agent's shell output in 26 of 30 trials).

| Condition | Tokens | Cost | Turns | Minutes |
|---|---:|---:|---:|---:|
| kamishibai · skill, core and topics | 351k [310k–463k] | $0.38 | 14 | 1.5 |
| kamishibai · noskill, same run | 465k [395k–612k] | $0.46 | 14 | 2.4 |
| kamishibai · skill, whole guide | 472k [393k–544k] | $0.51 | 17 | 1.9 |
| kamishibai · noskill | 512k [432k–615k] | $0.50 | 14 | 1.9 |
| Remotion · skill | 206k [168k–222k] | $0.29 | 10 | 1.4 |
| Remotion · noskill | 204k [176k–230k] | $0.26 | 10 | 1.5 |
| HyperFrames · skill | 368k [353k–435k] | $0.44 | 14 | 1.8 |
| HyperFrames · noskill | 328k [283k–347k] | $0.34 | 14 | 1.8 |

- Runs on different days differ by more than the noise within a run: Remotion with its skill took 206k on 9 October and 177k on 11 October. Compare within a day.
- In 13 of Remotion's 15 skill trials, the agent didn't load a skill.
- In every kamishibai skill trial, the agent loaded the `kamishibai` skill and never loaded `video-craft`.
