// kamishibai/tts — narration as a build pre-pass, not a render-time call.
// ------------------------------------------------------------------
// TTS is non-deterministic (neural voices resample every call) and costs
// money per request — exactly the two things kamishibai's parallel capture
// can't tolerate. So we never synthesize during seek(): we synthesize ONCE,
// before capture, bake the audio to a content-hashed file, and from then on
// the reel only references a path. The core contract (meta + seek) never
// learns TTS exists; it just rides the existing <Audio> mux path.
//
// This module is the *browser* half — pure, serializable, no Node imports —
// so it bundles into the reel. `prepareNarration` POSTs to the kamishibai
// server's /__tts endpoint (the Node half, see ../tts/engine.ts), which holds
// the real adapters + cache + ffprobe, and awaits { src, durationMs } back.
// Because that resolves *before* mount(), a scene can size itself to the
// narration it's about to play.
//
// Adapters are deliberately dumb: text + opts -> bytes. No SSML layer, no
// voice-picker UI. Built-ins ship a browser-side ref here and a Node-side
// implementation in engine.ts; a custom provider implements the Node
// `TTSAdapter` and registers it via render({ ttsAdapters }).

import type { SceneSpec } from "../series.ts";

/**
 * A serializable reference to a TTS adapter. The reel hands this to
 * `prepareNarration`; the server matches `provider` to a Node implementation
 * and uses `id` (which folds in the voice/model) as the cache key.
 */
export interface TTSAdapterRef {
  /** cache-key component — must capture every output-affecting option, e.g.
   *  "openai:tts-1-hd:nova" (so changing the voice busts the cache) */
  id: string;
  /** which Node-side implementation handles this: a built-in ("say" | "openai" |
   *  "elevenlabs" | "google" | "gemini" | "polly") or a custom adapter's provider */
  provider: string;
  /** provider-specific options, passed straight through to synthesize() */
  opts?: Record<string, unknown>;
}

/**
 * One narration line. A bare string uses the adapter's options as-is; the
 * object form overrides them per line (merged over the adapter's opts) — e.g.
 * slow just one line's `rate`, or switch `voice` for a single quote. The
 * override folds into the cache key, so changing it re-synthesizes only that
 * line.
 *
 * `text` is what gets *spoken*; `caption` (default: the original text) is what
 * the clip carries for subtitles. Use it when the voice needs a reading the
 * caption shouldn't show — `{ text: "まちあざ", caption: "町字" }`. Changing
 * only the caption never re-synthesizes.
 */
export type NarrationInput =
  | string
  | { text: string; caption?: string; opts?: Record<string, unknown> };

/**
 * Reading substitutions applied to the *spoken* text only, e.g.
 * `{ "町字": "まちあざ", "Pub/Sub": "パブサブ" }`. Captions keep the original
 * spelling. Matching runs left to right in one pass: at each position the
 * longest key starting there wins, and a match consumes its characters. So a
 * key that starts earlier beats a longer one that starts later —
 * `{ "京都": "きょうと", "都庁舎": "とちょうしゃ" }` reads "東京都庁舎" as
 * "東きょうと庁舎". Add a key spanning the whole word (e.g. "東京都庁舎") to
 * pin its reading.
 */
export type Lexicon = Record<string, string>;

/** Apply a lexicon to `text` (one left-to-right pass; at each position the
 *  longest key starting there wins — see Lexicon). */
export function applyLexicon(text: string, lexicon: Lexicon | undefined): string {
  const keys = lexicon ? Object.keys(lexicon).filter((k) => k.length > 0) : [];
  if (keys.length === 0) return text;
  keys.sort((a, b) => b.length - a.length);
  const escaped = keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return text.replace(new RegExp(escaped.join("|"), "g"), (m) => lexicon![m]!);
}

/** Split a NarrationInput into what to speak and what to caption. */
function resolveInput(
  input: NarrationInput,
  lexicon: Lexicon | undefined,
): { text: string; caption: string; opts?: Record<string, unknown> } {
  if (typeof input === "string") return { text: applyLexicon(input, lexicon), caption: input };
  return {
    text: applyLexicon(input.text, lexicon),
    caption: input.caption ?? input.text,
    opts: input.opts,
  };
}

/** What `prepareNarration` returns per key — enough to place + caption the clip. */
export interface NarrationClip {
  /** path to the synthesized audio file (read by the audio mux); "" in a
   *  serverless live preview, where the duration is only estimated */
  src: string;
  /** measured duration in ms — so a scene can fit the narration */
  durationMs: number;
  /** the caption text — the line as written (its `caption`, if given), not
   *  the lexicon-substituted reading that was spoken */
  text: string;
}

/**
 * macOS `say` — zero cost, offline, deterministic. The dev-loop default.
 * NOTE: macOS only (uses the `say` binary). On Linux/Windows/CI use a network
 * adapter (openai / google / gemini / polly / elevenlabs) — same reel, one line swapped.
 */
export function sayAdapter(opts: { voice?: string; rate?: number } = {}): TTSAdapterRef {
  const id = ["say", opts.voice ?? "default", opts.rate ?? "-"].join(":");
  return { id, provider: "say", opts };
}

/** OpenAI text-to-speech. Needs OPENAI_API_KEY in the render process's env. */
export function openaiAdapter(opts: {
  model?: string;
  voice?: string;
  /** playback rate 0.25–4.0 for tts-1 / tts-1-hd (gpt-4o-mini-tts ignores it —
   *  steer its pace with `instructions`); passed straight through */
  speed?: number;
  /** voice/style direction, e.g. pace or tone (gpt-4o-mini-tts) */
  instructions?: string;
} = {}): TTSAdapterRef {
  const model = opts.model ?? "tts-1";
  const voice = opts.voice ?? "alloy";
  const o: Record<string, unknown> = { model, voice };
  if (opts.speed != null) o.speed = opts.speed;
  if (opts.instructions != null) o.instructions = opts.instructions;
  // speed + instructions affect the audio, so fold them into the cache id.
  const id = `openai:${model}:${voice}:${opts.speed ?? ""}:${opts.instructions ?? ""}`;
  return { id, provider: "openai", opts: o };
}

/** ElevenLabs text-to-speech. Needs ELEVENLABS_API_KEY in the render env. */
export function elevenLabsAdapter(opts: {
  voiceId: string;
  model?: string;
}): TTSAdapterRef {
  const model = opts.model ?? "eleven_multilingual_v2";
  return {
    id: `elevenlabs:${opts.voiceId}:${model}`,
    provider: "elevenlabs",
    opts: { voiceId: opts.voiceId, model },
  };
}

/** Google Cloud Text-to-Speech. Needs GOOGLE_API_KEY in the render env. */
export function googleAdapter(opts: {
  languageCode?: string;
  /** a specific voice, e.g. "en-US-Neural2-F" */
  name?: string;
  /** "MALE" | "FEMALE" | "NEUTRAL" (when `name` is not pinned) */
  ssmlGender?: string;
} = {}): TTSAdapterRef {
  const languageCode = opts.languageCode ?? "en-US";
  const voice: Record<string, unknown> = { languageCode };
  if (opts.name) voice.name = opts.name;
  if (opts.ssmlGender) voice.ssmlGender = opts.ssmlGender;
  return {
    id: `google:${languageCode}:${opts.name ?? opts.ssmlGender ?? "default"}`,
    provider: "google",
    opts: voice,
  };
}

/** Gemini text-to-speech (Gemini API). Needs GEMINI_API_KEY (or
 *  GOOGLE_API_KEY) in the render env. */
export function geminiAdapter(opts: {
  /** a TTS-capable Gemini model (default "gemini-2.5-flash-preview-tts") */
  model?: string;
  /** a prebuilt voice name, e.g. "Kore", "Puck", "Charon" (default "Kore") */
  voice?: string;
  /** style direction prepended to each line, e.g. "Say cheerfully" */
  instructions?: string;
} = {}): TTSAdapterRef {
  const model = opts.model ?? "gemini-2.5-flash-preview-tts";
  const voice = opts.voice ?? "Kore";
  const o: Record<string, unknown> = { model, voice };
  if (opts.instructions != null) o.instructions = opts.instructions;
  return {
    id: `gemini:${model}:${voice}:${opts.instructions ?? ""}`,
    provider: "gemini",
    opts: o,
  };
}

/** AWS Polly. Needs AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY (and AWS_REGION
 *  or `region`) in the render env. */
export function pollyAdapter(opts: {
  voiceId?: string;
  /** "neural" | "standard" | "long-form" | "generative" (default "neural") */
  engine?: string;
  /** bilingual voices: the language to speak, e.g. "en-US" */
  languageCode?: string;
  /** AWS region for the endpoint (default AWS_REGION env, else us-east-1) */
  region?: string;
} = {}): TTSAdapterRef {
  const voiceId = opts.voiceId ?? "Joanna";
  const engine = opts.engine ?? "neural";
  const synth: Record<string, unknown> = { voiceId, engine };
  if (opts.languageCode) synth.languageCode = opts.languageCode;
  // region picks the endpoint, not the audio — kept out of the cache id.
  if (opts.region) synth.region = opts.region;
  return {
    id: `polly:${voiceId}:${engine}:${opts.languageCode ?? ""}`,
    provider: "polly",
    opts: synth,
  };
}

/** ~14 readable chars/sec, floored — only used for serverless live preview. */
function estimateMs(text: string): number {
  return Math.max(600, Math.round((text.length / 14) * 1000));
}

/**
 * Synthesize a batch of narration lines (a key -> text map) as a pre-pass,
 * returning a key -> { src, durationMs, text } map. Awaited before mount() so
 * scenes can size to the narration. Identical (adapter, text) pairs resolve to
 * the same cached file across runs and parallel workers — non-deterministic
 * TTS turned into a deterministic file reference.
 */
export async function prepareNarration<K extends string>(
  adapter: TTSAdapterRef,
  texts: Record<K, NarrationInput>,
  opts: {
    endpoint?: string;
    /** reading substitutions for the spoken text only (captions unchanged) */
    lexicon?: Lexicon;
  } = {},
): Promise<Record<K, NarrationClip>> {
  const endpoint = opts.endpoint ?? "/__tts";
  const items = {} as Record<K, { text: string; caption: string; opts?: Record<string, unknown> }>;
  for (const k in texts) items[k] = resolveInput(texts[k], opts.lexicon);
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ adapter, items }),
    });
  } catch {
    // No server reachable — a standalone live preview (not a render). Estimate
    // durations so the layout still works. Capture serves script and .html
    // entries with the /__tts handler, so this branch never affects their
    // render. A URL entry is served by you: kamishibai's handler isn't there,
    // and whatever your server answers decides the outcome.
    const out = {} as Record<K, NarrationClip>;
    for (const k in items) {
      const { text, caption } = items[k];
      out[k] = { src: "", durationMs: estimateMs(text), text: caption };
    }
    return out;
  }
  // The server is present but synthesis failed — surface it, don't paper over
  // it with an estimate (that would silently ship a video with no audio).
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`kamishibai TTS failed (${res.status})${detail ? `: ${detail}` : ""}`);
  }
  return (await res.json()) as Record<K, NarrationClip>;
}

// ---- narration-driven layout --------------------------------------
// prepareNarration hands back each line's *measured* duration, so the common
// "one scene per line, sized to its voice-over" structure can be derived
// instead of hand-built. These are pure data helpers (no React): feed the
// result to <Series scenes> and meta.durationMs = seriesDuration(...), and the
// reel fits the narration exactly. Pass clips in the order they should play.

/** Total measured narration time (sum of clip durations), in ms. */
export function narrationTotal(clips: NarrationClip[]): number {
  return clips.reduce((n, c) => n + Math.round(c.durationMs), 0);
}

export interface NarrationLayoutOptions {
  /** breathing room added after each clip, in ms (default 0) */
  padMs?: number;
  /** crossfade for every scene after the first, in ms (default 0) */
  crossfadeMs?: number;
  /** content exit-fade for every scene, in ms (default 0) */
  exitFadeMs?: number;
}

/** A scene spec sized to a narration clip, with the clip kept for the content. */
export interface NarrationScene extends SceneSpec {
  clip: NarrationClip;
}

/**
 * Lay a sequence of clips out as one scene per clip, each sized to its measured
 * duration (+ padMs), with an optional uniform crossfade / exit-fade. Map the
 * result to `<Series scenes>` items (add `content`) and size the reel with
 * `seriesDuration`. The crossfade is applied as given, not clamped: a scene
 * starts `crossfadeMs` before the previous one ends, so keep `padMs >=
 * crossfadeMs` — otherwise its narration overlaps the end of the previous
 * line, and a crossfade longer than a (short) scene makes seriesDuration /
 * seriesLayout / <Series> throw a RangeError.
 */
export function narrationLayout(
  clips: NarrationClip[],
  opts: NarrationLayoutOptions = {},
): NarrationScene[] {
  const { padMs = 0, crossfadeMs = 0, exitFadeMs = 0 } = opts;
  return clips.map((clip, i) => {
    const scene: NarrationScene = { durationMs: Math.round(clip.durationMs) + padMs, clip };
    if (i > 0 && crossfadeMs) scene.crossfadeMs = crossfadeMs;
    if (exitFadeMs) scene.exitFadeMs = exitFadeMs;
    return scene;
  });
}

/** A clip placed within a scene, with its start offset from the scene start. */
export interface NarrationStep {
  clip: NarrationClip;
  /** start offset within the enclosing scene, in ms */
  atMs: number;
}

export interface NarrationSequenceOptions {
  /**
   * Pause inserted *after* a clip (before the next one), in ms. A number is
   * uniform; an array or a function set it per position — `gapMs[i]` /
   * `gapMs(i, clip)` is the pause following clip `i`, so you can hold a longer
   * beat where the topic turns. Default 0.
   */
  gapMs?: number | number[] | ((index: number, clip: NarrationClip) => number);
  /** offset of the first clip from the scene start, in ms (default 0) */
  startMs?: number;
}

/**
 * Sequence several clips *within one scene*: returns each clip with its
 * cumulative start offset. Drop `<Narration clip={s.clip} delayMs={s.atMs} />`
 * for each, and reveal matching content with `<Cue at={s.atMs}>` — i.e. show
 * element X exactly when clip Y starts playing. `gapMs` can vary per position
 * for uneven pacing (a longer pause at a topic change).
 */
export function narrationSequence(
  clips: NarrationClip[],
  opts: NarrationSequenceOptions = {},
): NarrationStep[] {
  const { gapMs = 0, startMs = 0 } = opts;
  const gapAfter = (i: number, clip: NarrationClip): number => {
    const g = typeof gapMs === "function" ? gapMs(i, clip) : Array.isArray(gapMs) ? (gapMs[i] ?? 0) : gapMs;
    return Math.round(g);
  };
  let cursor = startMs;
  return clips.map((clip, i) => {
    const step: NarrationStep = { clip, atMs: cursor };
    cursor += Math.round(clip.durationMs) + gapAfter(i, clip);
    return step;
  });
}

export interface NarrationSceneOptions {
  /** silence before the first clip, in ms (default 0) */
  leadMs?: number;
  /** pause between clips — a number, per-position array, or function, as in
   *  narrationSequence (default 0) */
  gapMs?: NarrationSequenceOptions["gapMs"];
  /** hold after the last clip ends, in ms (default 0) */
  tailMs?: number;
}

/** Several clips sequenced inside one scene, plus the scene length they need. */
export interface NarrationSceneLayout {
  /** each clip with its start offset from the scene start */
  steps: NarrationStep[];
  /** lead + clips + gaps + tail — use it as the scene's durationMs */
  durationMs: number;
}

/**
 * The "one scene, several lines" shape in one call: sequence `clips` after
 * `leadMs`, separated by `gapMs`, and size the scene to end `tailMs` after the
 * last line. Feed `steps` to `<NarrationSteps>` (audio + captions) and
 * `<Cue at={step.atMs}>`, and `durationMs` to the scene.
 */
export function narrationScene(
  clips: NarrationClip[],
  opts: NarrationSceneOptions = {},
): NarrationSceneLayout {
  const { leadMs = 0, gapMs, tailMs = 0 } = opts;
  const steps = narrationSequence(clips, { startMs: leadMs, gapMs });
  const last = steps[steps.length - 1];
  const end = last ? last.atMs + Math.round(last.clip.durationMs) : leadMs;
  return { steps, durationMs: end + tailMs };
}
