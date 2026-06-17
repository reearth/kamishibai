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

/**
 * A serializable reference to a TTS adapter. The reel hands this to
 * `prepareNarration`; the server matches `provider` to a Node implementation
 * and uses `id` (which folds in the voice/model) as the cache key.
 */
export interface TTSAdapterRef {
  /** cache-key component — must capture every output-affecting option, e.g.
   *  "openai:tts-1-hd:nova" (so changing the voice busts the cache) */
  id: string;
  /** which Node-side implementation handles this: "say" | "openai" | "elevenlabs" | … */
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
 */
export type NarrationInput = string | { text: string; opts?: Record<string, unknown> };

/** Pull the text out of a NarrationInput (string or { text }). */
function inputText(input: NarrationInput): string {
  return typeof input === "string" ? input : input.text;
}

/** What `prepareNarration` returns per key — enough to place + caption the clip. */
export interface NarrationClip {
  /** path to the synthesized audio file (read by the audio mux); "" in a
   *  serverless live preview, where the duration is only estimated */
  src: string;
  /** measured duration in ms — so a scene can fit the narration */
  durationMs: number;
  /** the source text (reused as the subtitle caption) */
  text: string;
}

/**
 * macOS `say` — zero cost, offline, deterministic. The dev-loop default.
 * NOTE: macOS only (uses the `say` binary). On Linux/Windows/CI use a network
 * adapter (openai / google / polly / elevenlabs) — same reel, one line swapped.
 */
export function sayAdapter(opts: { voice?: string; rate?: number } = {}): TTSAdapterRef {
  const id = ["say", opts.voice ?? "default", opts.rate ?? "-"].join(":");
  return { id, provider: "say", opts };
}

/** OpenAI text-to-speech. Needs OPENAI_API_KEY in the render process's env. */
export function openaiAdapter(opts: { model?: string; voice?: string } = {}): TTSAdapterRef {
  const model = opts.model ?? "tts-1";
  const voice = opts.voice ?? "alloy";
  return { id: `openai:${model}:${voice}`, provider: "openai", opts: { model, voice } };
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
  opts: { endpoint?: string } = {},
): Promise<Record<K, NarrationClip>> {
  const endpoint = opts.endpoint ?? "/__tts";
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ adapter, items: texts }),
    });
  } catch {
    // No server reachable — a standalone live preview (not a render). Estimate
    // durations so the layout still works; capture always has the server, so
    // this branch never affects a real render.
    const out = {} as Record<K, NarrationClip>;
    for (const k in texts) {
      const text = inputText(texts[k]);
      out[k] = { src: "", durationMs: estimateMs(text), text };
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
