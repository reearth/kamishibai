[← kamishibai](../README.md) · [all docs](README.md)

# Subtitles

Captions are a **soft track by default**, not pixels. Like `<Audio>`, a `<Subtitle>` *declares* its cues and the renderer bakes them in at mux time — into an mp4 `mov_text` track (toggleable in players) **and** a sidecar `.srt` next to the output. Captions cost no frames, so the captured pixels (and their incremental fingerprints) don't change with the caption text. Drop `<Subtitle>` into a scene three composable ways — cue times count from that scene's start:

```tsx
import { Subtitle, Cue } from "kamishibai/react";

// 1. from an SRT/VTT file (served via --public)
<Subtitle src="/captions.vtt" />

// 2. from inline cues
<Subtitle cues={[{ start: 0, end: 1500, text: "hello" }, { start: 1500, end: 3000, text: "world" }]} />

// 3. direct text — timing via the enclosing <Cue>
<Cue at={500} hold={2000}><Subtitle>just this line</Subtitle></Cue>
```

**Burn-in** (`--burn-subtitles` / `render({ burnSubtitles })`) draws the captions as pixels instead, using the `<Subtitle>` CSS (`bottom`, `style`; and `<Narration subtitleBottom subtitleStyle>`) for full visual control — those props do nothing for the soft track. It's a global switch — soft `mov_text` is plain text styled by the player, so reach for burn-in when you need pixel-perfect captions, or for **GIF output**, which has no subtitle track (gif always burns or drops, and a sidecar `.srt` is still written).

A cue whose end is not after its start can never show, so it's dropped with a warning in both modes (rather than failing the soft-track mux after the capture); the page's `kamishibai:` warnings are printed in the render log. A `src` that fails to load (e.g. a 404) fails the capture in both modes.

The parser/serializer is also framework-free for the raw API or Node:

```ts
import { parseSubtitles, cueAt, cuesToSrt } from "kamishibai/subtitle";
const cues = parseSubtitles(srtOrVttText);
const text = cueAt(cues, ms)?.text;            // draw it yourself in seek()
const srt = cuesToSrt(cues);                   // …or serialize back out
```
