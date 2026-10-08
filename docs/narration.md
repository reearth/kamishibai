[← kamishibai](../README.md) · [all docs](README.md)

# Narration (TTS)

TTS is non-deterministic (neural voices resample every call) and billable per request — the two things parallel capture can't tolerate. So kamishibai never synthesizes during `seek()`. Instead `prepareNarration` runs **once, before capture**, as a top-level `await`: it bakes each line to a **content-hashed file**, measures its duration with ffprobe, and hands back `{ src, durationMs, text }`. From then on the reel only references a path — the core contract never learns TTS exists; it rides the existing `<Audio>` mux path. The hash cache (`.kamishibai-tts/`) means identical lines are never re-synthesized or re-billed, and every parallel worker reads the same frozen file — so a non-deterministic API becomes a deterministic file reference.

Because the durations come back before `mount()`, you can size each scene to the line it's about to speak. `narrationLayout` does exactly that — one scene per line, sized to its measured duration — and `seriesDuration` then fits the reel to the voice-over:

```tsx
import { mount, Series, Narration, seriesDuration } from "kamishibai/react";
import { sayAdapter, prepareNarration, narrationLayout } from "kamishibai/tts";

const voice = sayAdapter();                    // dev default: free, offline, deterministic
const vo = await prepareNarration(voice, {
  intro: "Welcome to kamishibai.",
  body:  "Every frame is a pure function of time.",
});

const scenes = narrationLayout([vo.intro, vo.body], { padMs: 500, crossfadeMs: 400 })
  .map(({ clip, ...spec }) => ({
    ...spec,
    content: <Narration clip={clip} subtitle />,  // plays the clip AND adds the text as a caption
  }));

mount(<Series scenes={scenes} />, {
  fps: 30, durationMs: seriesDuration(scenes), width: 1280, height: 720,
});
```

Helpers (`kamishibai/tts`, also re-exported from `kamishibai/react`): `narrationLayout(clips, { padMs, crossfadeMs, exitFadeMs })` → one scene spec per clip (the crossfade isn't clamped: keep `padMs ≥ crossfadeMs`, or a crossfade overlaps the end of the previous line's audio and, past a scene's length, `seriesDuration` / `<Series>` throw a `RangeError`) · `narrationTotal(clips)` → total voice-over length · `narrationSequence(clips, { gapMs, startMs })` → cumulative start offsets for several lines in one scene (reveal element X when line Y starts via `<Cue at={atMs}>`), with `gapMs` as a number, array, or `(i, clip) => ms` for uneven pacing · `narrationScene(clips, { leadMs, gapMs, tailMs })` → `{ steps, durationMs }`, the "several lines in one scene" shape in one call.

`<NarrationSteps steps subtitle />` places a `<Narration>` (audio + caption) at each step's `atMs`, so a multi-line scene is three lines:

```tsx
const s = narrationScene([vo.what, vo.why, vo.how], { leadMs: 300, gapMs: 400, tailMs: 800 });
const scene = {
  durationMs: s.durationMs,
  content: <>
    <NarrationSteps steps={s.steps} subtitle />
    {s.steps.map((step, i) => <Cue key={i} at={step.atMs}><Bullet>{labels[i]}</Bullet></Cue>)}
  </>,
};
```

Adapters are deliberately dumb (`text → bytes`) — no SSML layer, no voice UI. `say` is **macOS-only** (it shells out to the `say` binary), so it's the free local dev default; on Linux/Windows/CI use a network adapter. **Run the dev loop on `say`, then swap one line for the final render** — same reel. macOS system voices are licensed for personal, non-commercial use, so don't publish `say` output; and synthesized audio from any provider is subject to that provider's terms (e.g. AI-voice disclosure, plan-dependent commercial use).

```ts
import { openaiAdapter, googleAdapter, geminiAdapter, pollyAdapter, elevenLabsAdapter } from "kamishibai/tts";
const voice = openaiAdapter({ model: "tts-1-hd", voice: "nova" });    // OPENAI_API_KEY
const voice = googleAdapter({ name: "en-US-Neural2-F" });             // GOOGLE_API_KEY
const voice = geminiAdapter({ voice: "Kore" });                       // GEMINI_API_KEY (falls back to GOOGLE_API_KEY)
const voice = pollyAdapter({ voiceId: "Matthew", engine: "neural" }); // AWS_ACCESS_KEY_ID/SECRET (+AWS_REGION)
const voice = elevenLabsAdapter({ voiceId: "…" });                    // ELEVENLABS_API_KEY
```

(Polly is signed with a minimal built-in SigV4 — no AWS SDK dependency. Google returns base64 audio, decoded for you; Gemini returns raw PCM, wrapped as WAV.)

To send requests through a proxy or a compatible server, give any network adapter a `baseUrl`, or set its env var in the render process: `OPENAI_BASE_URL` (default `https://api.openai.com/v1`), `GOOGLE_TTS_BASE_URL`, `GEMINI_BASE_URL`, `ELEVENLABS_BASE_URL`, `AWS_ENDPOINT_URL_POLLY`. The base URL stays out of the cache key, so switching it never re-synthesizes.

The adapter sets the voice for the whole batch; a single line can override its options (merged over the adapter's) with the object form. The override folds into the cache key, so only that line re-synthesizes — and changing `voice`/`model` busts *every* line. **Finalize the narration text first, then iterate on timing/visuals** (those are free); text and voice changes cost money.

```ts
const vo = await prepareNarration(sayAdapter(), {
  intro: "Spoken with the default voice.",
  aside: { text: "…but this one, slower.", opts: { rate: 150 } },
});
```

**Reading vs. caption.** What the voice should *say* and what the caption should *show* often differ (Japanese readings, acronyms). Pass a `lexicon` to substitute readings in the spoken text only, or give a line an explicit `caption`; the clip's `text` (used by `<Narration subtitle>`) is always the caption. Only the spoken text is hashed, so editing a caption never re-synthesizes. Lexicon matching is one left-to-right pass where the longest key *starting at each position* wins — so with `{ "京都": …, "都庁舎": … }`, "東京都庁舎" matches `京都` first; add a key for the whole word to pin its reading.

```ts
const vo = await prepareNarration(voice, {
  a: "町字の単位で集計します",                              // spoken: まちあざの単位で…
  b: { text: "パブサブで配信", caption: "Pub/Sub で配信" },  // explicit per-line caption
}, { lexicon: { "町字": "まちあざ", "Pub/Sub": "パブサブ" } });
```

**Long narration.** The first synthesis of many lines can take minutes. The page-load wait only counts *idle* time — while lines are still synthesizing it keeps waiting, and `Synthesizing narration…` / `…narration 12/72 line(s)` show progress. To pay for (and check) every line up front, run `kamishibai tts reel.tsx` — it loads the page once to fill the cache and stops, so the render that follows reads every line from cache. If a line fails, the run stops as soon as nothing else is in flight, with the provider's error and how many lines finished; finished lines are cached, so re-running resumes. Durations are measured with ffprobe (it ships with ffmpeg), so it must be on PATH — a clip it can't read fails its line rather than coming back as 0 ms. A clip ffprobe reports as invalid data is never kept in the cache (a cached one is deleted), so re-running synthesizes that line again. If ffprobe fails for any other reason (missing from PATH, failing to start, permission denied, a crash), the line fails too but the clip is kept — a freshly synthesized one included, so the paid audio isn't lost — and the next run measures it once ffprobe works.

A custom provider implements the Node `TTSAdapter` (`{ provider, synthesize }`) and registers it via `render({ ttsAdapters: [myAdapter] })`; the reel references it with an adapter whose `provider` matches. (Why the split: the reel is bundled for the browser, so its adapter is a serializable ref — `{ id, provider, opts }` — while the actual synthesis runs in Node, served to the page over `POST /__tts`.)
