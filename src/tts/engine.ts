// kamishibai TTS engine — the Node half of the narration pre-pass.
// ------------------------------------------------------------------
// Holds the real adapters (say / OpenAI / ElevenLabs / Google / Gemini / Polly,
// plus any custom ones), synthesizes on demand behind a content-hash cache, and
// measures duration with ffprobe. Served to the reel over POST /__tts (see ../serve.ts), it is
// the single point where non-deterministic, billable TTS happens — exactly
// once per (adapter, text), frozen to a file thereafter.
//
// Determinism guarantee: render() uses ONE server for the probe pass and all
// capture workers, so this engine instance sees every page load. An in-flight
// map dedups concurrent first-time requests and the on-disk cache catches the
// rest, so every worker reads the identical file → identical duration → the
// same scene layout. The first synthesis wins and is frozen.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, rename, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { TTSAdapterRef, NarrationClip, NarrationInput } from "./index.ts";

const execFileAsync = promisify(execFile);

/** ffprobe ran and reported the clip's content invalid ("Invalid data found
 *  when processing input"), so the file itself is bad and may be deleted. Any
 *  other ffprobe failure (missing, unable to start, permission denied, a crash
 *  or broken install) says nothing about the clip and never removes it. */
class UnreadableClipError extends Error {}

/** ffprobe's stderr when it read a file and found no media it understands
 *  (garbage, an empty file, a truncated header). */
const INVALID_CONTENT = /Invalid data found when processing input/;

/** Deterministic JSON (keys sorted) — so an opts override hashes stably. */
function stableJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`).join(",")}}`;
}

/** Output container the engine knows how to cache + probe. */
export type TTSFormat = "mp3" | "aiff" | "wav";

/**
 * A TTS provider implementation. The extension point: implement this and pass
 * it via render({ ttsAdapters }), then reference it from the reel with a
 * TTSAdapterRef whose `provider` matches.
 */
export interface TTSAdapter {
  /** matched against a ref's `provider` */
  provider: string;
  /** synthesize `text`; `opts` is the ref's opts, passed straight through */
  synthesize(
    text: string,
    opts: Record<string, unknown>,
  ): Promise<{ audio: Uint8Array; format: TTSFormat }>;
}

export interface TTSEngineOptions {
  /** custom adapters; a matching `provider` overrides a built-in */
  adapters?: TTSAdapter[];
  /** where baked audio is cached (default: <cwd>/.kamishibai-tts) */
  cacheDir?: string;
  /** called whenever a synthesis (a cache miss) starts or settles */
  onProgress?: (stats: TTSStats) => void;
}

/** Running totals of the synthesis work. `total` / `done` / `failed` count
 *  cache misses only (a cache hit never calls the provider); `cached` counts
 *  the lines served from the cache instead. */
export interface TTSStats {
  /** syntheses started so far */
  total: number;
  /** syntheses finished and written to the cache */
  done: number;
  /** syntheses that threw */
  failed: number;
  /** lines served from the cache without calling the provider */
  cached: number;
  /** the most recent error from any line — a synthesis, or measuring a
   *  cached file — if any */
  lastError?: string;
}

export interface TTSEngine {
  /** handle a /__tts request body, returning the key -> clip map */
  handle(body: {
    adapter: TTSAdapterRef;
    items: Record<string, NarrationInput>;
  }): Promise<Record<string, NarrationClip>>;
  cacheDir: string;
  /** synthesis totals so far */
  stats(): TTSStats;
  /** whether a synthesis is still in flight (so a caller waiting on the page
   *  knows it's slow TTS, not a stuck reel) */
  busy(): boolean;
}

const FORMATS: TTSFormat[] = ["mp3", "aiff", "wav"];

// ---- built-in adapters --------------------------------------------

/** The API origin (plus any path prefix) an adapter sends to: the ref's
 *  `baseUrl`, else the env var, else the provider's public endpoint. Lets a
 *  render go through a proxy or a compatible server. */
function resolveBaseUrl(opts: Record<string, unknown>, envVar: string, fallback: string): string {
  const v = (opts.baseUrl as string | undefined) || process.env[envVar] || fallback;
  return v.replace(/\/+$/, "");
}

const sayAdapter: TTSAdapter = {
  provider: "say",
  async synthesize(text, opts) {
    if (process.platform !== "darwin") {
      throw new Error(
        "the `say` adapter only works on macOS — use openai / google / gemini / polly / " +
          "elevenlabs on other platforms",
      );
    }
    const out = join(tmpdir(), `kamishibai-say-${randomUUID()}.aiff`);
    const args = ["-o", out];
    if (opts.voice) args.push("-v", String(opts.voice));
    if (opts.rate) args.push("-r", String(opts.rate));
    args.push("--", text);
    await execFileAsync("say", args);
    const audio = new Uint8Array(await readFile(out));
    await unlink(out).catch(() => {});
    return { audio, format: "aiff" };
  },
};

const openaiAdapter: TTSAdapter = {
  provider: "openai",
  async synthesize(text, opts) {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OPENAI_API_KEY is not set");
    const body: Record<string, unknown> = {
      model: opts.model ?? "tts-1",
      voice: opts.voice ?? "alloy",
      input: text,
      response_format: "mp3",
    };
    // `speed` works on tts-1/tts-1-hd; gpt-4o-mini-tts takes `instructions`
    // (e.g. pace/tone) instead. Both are passed straight through.
    if (opts.speed != null) body.speed = opts.speed;
    if (opts.instructions != null) body.instructions = opts.instructions;
    const base = resolveBaseUrl(opts, "OPENAI_BASE_URL", "https://api.openai.com/v1");
    const res = await fetch(`${base}/audio/speech`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`OpenAI TTS ${res.status}: ${await res.text().catch(() => "")}`);
    return { audio: new Uint8Array(await res.arrayBuffer()), format: "mp3" };
  },
};

const elevenLabsAdapter: TTSAdapter = {
  provider: "elevenlabs",
  async synthesize(text, opts) {
    const key = process.env.ELEVENLABS_API_KEY;
    if (!key) throw new Error("ELEVENLABS_API_KEY is not set");
    const voiceId = String(opts.voiceId);
    const base = resolveBaseUrl(opts, "ELEVENLABS_BASE_URL", "https://api.elevenlabs.io");
    const res = await fetch(`${base}/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: { "xi-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({ text, model_id: opts.model ?? "eleven_multilingual_v2" }),
    });
    if (!res.ok)
      throw new Error(`ElevenLabs TTS ${res.status}: ${await res.text().catch(() => "")}`);
    return { audio: new Uint8Array(await res.arrayBuffer()), format: "mp3" };
  },
};

const googleAdapter: TTSAdapter = {
  provider: "google",
  async synthesize(text, opts) {
    const key = process.env.GOOGLE_API_KEY ?? process.env.GOOGLE_TTS_API_KEY;
    if (!key) throw new Error("GOOGLE_API_KEY is not set");
    const voice: Record<string, unknown> = { languageCode: opts.languageCode ?? "en-US" };
    if (opts.name) voice.name = opts.name;
    if (opts.ssmlGender) voice.ssmlGender = opts.ssmlGender;
    const base = resolveBaseUrl(opts, "GOOGLE_TTS_BASE_URL", "https://texttospeech.googleapis.com");
    const res = await fetch(
      `${base}/v1/text:synthesize?key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: { text }, voice, audioConfig: { audioEncoding: "MP3" } }),
      },
    );
    if (!res.ok) throw new Error(`Google TTS ${res.status}: ${await res.text().catch(() => "")}`);
    // The API returns base64 audio in JSON, not raw bytes.
    const data = (await res.json()) as { audioContent?: string };
    if (!data.audioContent) throw new Error("Google TTS returned no audioContent");
    return { audio: new Uint8Array(Buffer.from(data.audioContent, "base64")), format: "mp3" };
  },
};

/** Wrap raw little-endian 16-bit PCM in a WAV (RIFF) header so ffprobe and
 *  the audio mux can read it. */
export function pcmToWav(pcm: Uint8Array, sampleRate: number, channels = 1): Uint8Array {
  const bytesPerSample = 2;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * bytesPerSample, 28); // byte rate
  header.writeUInt16LE(channels * bytesPerSample, 32); // block align
  header.writeUInt16LE(bytesPerSample * 8, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  return new Uint8Array(Buffer.concat([header, pcm]));
}

const geminiAdapter: TTSAdapter = {
  provider: "gemini",
  async synthesize(text, opts) {
    const key = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
    if (!key) throw new Error("GEMINI_API_KEY (or GOOGLE_API_KEY) is not set");
    const model = String(opts.model ?? "gemini-2.5-flash-preview-tts");
    // Gemini TTS has no separate style field — direction is part of the prompt.
    const prompt = opts.instructions ? `${opts.instructions}: ${text}` : text;
    const base = resolveBaseUrl(opts, "GEMINI_BASE_URL", "https://generativelanguage.googleapis.com");
    const res = await fetch(
      `${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "x-goog-api-key": key, "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: opts.voice ?? "Kore" } },
            },
          },
        }),
      },
    );
    if (!res.ok) throw new Error(`Gemini TTS ${res.status}: ${await res.text().catch(() => "")}`);
    // The API returns base64 raw PCM (mimeType "audio/L16;codec=pcm;rate=24000"),
    // not a container — wrap it as WAV.
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[];
    };
    const inline = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
    if (!inline?.data) throw new Error("Gemini TTS returned no audio");
    const rate = Number(/rate=(\d+)/.exec(inline.mimeType ?? "")?.[1] ?? 24000);
    return { audio: pcmToWav(Buffer.from(inline.data, "base64"), rate), format: "wav" };
  },
};

// --- AWS SigV4 (minimal, for a single Polly POST — no SDK dependency) ---

function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

/** Sign a Polly request and return the auth headers fetch should send. */
function signPolly(o: {
  region: string;
  host: string;
  path: string;
  body: string;
  accessKey: string;
  secretKey: string;
  sessionToken?: string;
}): Record<string, string> {
  const service = "polly";
  // YYYYMMDDTHHMMSSZ + the YYYYMMDD date stamp.
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  const headers: [string, string][] = [
    ["content-type", "application/json"],
    ["host", o.host],
    ["x-amz-date", amzDate],
  ];
  if (o.sessionToken) headers.push(["x-amz-security-token", o.sessionToken]);
  headers.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const canonicalHeaders = headers.map(([k, v]) => `${k}:${v}\n`).join("");
  const signedHeaders = headers.map(([k]) => k).join(";");

  const canonicalRequest = [
    "POST",
    o.path,
    "",
    canonicalHeaders,
    signedHeaders,
    sha256Hex(o.body),
  ].join("\n");
  const scope = `${dateStamp}/${o.region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const hmac = (key: Buffer | string, data: string) =>
    createHmac("sha256", key).update(data, "utf8").digest();
  let signingKey = hmac(`AWS4${o.secretKey}`, dateStamp);
  signingKey = hmac(signingKey, o.region);
  signingKey = hmac(signingKey, service);
  signingKey = hmac(signingKey, "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");

  const out: Record<string, string> = {
    "content-type": "application/json",
    "x-amz-date": amzDate,
    authorization:
      `AWS4-HMAC-SHA256 Credential=${o.accessKey}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
  if (o.sessionToken) out["x-amz-security-token"] = o.sessionToken;
  return out;
}

const pollyAdapter: TTSAdapter = {
  provider: "polly",
  async synthesize(text, opts) {
    const accessKey = process.env.AWS_ACCESS_KEY_ID;
    const secretKey = process.env.AWS_SECRET_ACCESS_KEY;
    if (!accessKey || !secretKey)
      throw new Error("AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY are not set");
    const region = String(opts.region ?? process.env.AWS_REGION ?? "us-east-1");
    // The signature covers the host and path, so both come from the URL
    // actually requested. The region still names the signing scope.
    const url = new URL(
      `${resolveBaseUrl(opts, "AWS_ENDPOINT_URL_POLLY", `https://polly.${region}.amazonaws.com`)}/v1/speech`,
    );
    const body = JSON.stringify({
      OutputFormat: "mp3",
      Text: text,
      VoiceId: opts.voiceId ?? "Joanna",
      Engine: opts.engine ?? "neural",
      ...(opts.languageCode ? { LanguageCode: opts.languageCode } : {}),
    });
    const headers = signPolly({
      region,
      host: url.host,
      path: url.pathname,
      body,
      accessKey,
      secretKey,
      sessionToken: process.env.AWS_SESSION_TOKEN,
    });
    const res = await fetch(url, { method: "POST", headers, body });
    if (!res.ok) throw new Error(`AWS Polly ${res.status}: ${await res.text().catch(() => "")}`);
    return { audio: new Uint8Array(await res.arrayBuffer()), format: "mp3" };
  },
};

// ---- engine -------------------------------------------------------

/** Build a TTS engine with the built-in adapters plus any custom ones. */
export function createTTSEngine(opts: TTSEngineOptions = {}): TTSEngine {
  const cacheDir = resolve(opts.cacheDir ?? ".kamishibai-tts");
  const registry = new Map<string, TTSAdapter>();
  // Built-ins first, then customs — so a matching provider overrides.
  const builtins = [
    sayAdapter,
    openaiAdapter,
    elevenLabsAdapter,
    googleAdapter,
    geminiAdapter,
    pollyAdapter,
  ];
  for (const a of [...builtins, ...(opts.adapters ?? [])]) {
    registry.set(a.provider, a);
  }

  const inflight = new Map<string, Promise<NarrationClip>>();
  const durations = new Map<string, number>();
  const stats: TTSStats = { total: 0, done: 0, failed: 0, cached: 0 };
  const report = () => opts.onProgress?.({ ...stats });

  function existingFile(hash: string): string | undefined {
    for (const ext of FORMATS) {
      const p = join(cacheDir, `${hash}.${ext}`);
      if (existsSync(p)) return p;
    }
    return undefined;
  }

  async function probeDurationMs(file: string): Promise<number> {
    const cached = durations.get(file);
    if (cached != null) return cached;
    let stdout: string;
    try {
      ({ stdout } = await execFileAsync("ffprobe", [
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "csv=p=0",
        file,
      ]));
    } catch (err) {
      // A guessed 0 would silently collapse the scene sized to this line, so
      // a missing ffprobe or an unreadable file fails the line instead.
      const code = (err as NodeJS.ErrnoException | { code?: unknown }).code;
      if (code === "ENOENT") {
        throw new Error(
          "ffprobe not found on PATH — it ships with ffmpeg and is needed to measure " +
            "narration durations (e.g. `brew install ffmpeg`)",
        );
      }
      const stderr = (err as { stderr?: string }).stderr?.trim() ?? "";
      const detail = stderr || (err as Error).message;
      // Only ffprobe running to completion and calling the content invalid
      // condemns the file. A spawn error (EMFILE, EACCES, …), a kill, or a
      // non-zero exit for another reason (permission denied, a dyld/library
      // error, a crash) says nothing about it.
      if (typeof code === "number" && INVALID_CONTENT.test(stderr)) {
        throw new UnreadableClipError(`ffprobe could not read narration audio ${file}: ${detail}`);
      }
      throw new Error(`ffprobe failed on narration audio ${file}: ${detail}`);
    }
    // ffprobe ran but may report no duration ("N/A") for a clip with zero
    // samples — e.g. `say` given empty text. That is a genuine 0.
    const sec = parseFloat(stdout.trim());
    const ms = Number.isFinite(sec) ? Math.round(sec * 1000) : 0;
    durations.set(file, ms);
    return ms;
  }

  async function synthOne(
    ref: TTSAdapterRef,
    text: string,
    overrideOpts?: Record<string, unknown>,
  ): Promise<NarrationClip> {
    // ref.id already folds in the adapter's opts; only a per-line override
    // needs to extend the key (so unchanged lines keep their cached file).
    const ov = overrideOpts && Object.keys(overrideOpts).length > 0 ? overrideOpts : undefined;
    const hash = createHash("sha256")
      .update(`${ref.id}\0${text}${ov ? `\0${stableJson(ov)}` : ""}`)
      .digest("hex")
      .slice(0, 32);

    const existing = existingFile(hash);
    if (existing) {
      try {
        const durationMs = await probeDurationMs(existing);
        stats.cached += 1;
        return { src: existing, durationMs, text };
      } catch (err) {
        // A cached clip ffprobe calls invalid (e.g. left by an older version,
        // or corrupted on disk) would fail every run. Drop it so the next run
        // synthesizes the line afresh, and count the line as failed. Any other
        // failure (ffprobe missing, unable to start, or failing for a reason
        // other than the content) says nothing about the clip, so the
        // paid-for file stays — and is measured again on the next run.
        const unreadable = err instanceof UnreadableClipError;
        if (unreadable) await unlink(existing).catch(() => {});
        stats.total += 1;
        stats.failed += 1;
        const msg = err instanceof Error ? err.message : String(err);
        stats.lastError = unreadable
          ? `${msg} (removed from the cache; it will be synthesized again on the next run)`
          : msg;
        report();
        throw new Error(stats.lastError);
      }
    }

    let p = inflight.get(hash);
    if (!p) {
      stats.total += 1;
      report();
      p = (async () => {
        const adapter = registry.get(ref.provider);
        if (!adapter) throw new Error(`no TTS adapter registered for provider "${ref.provider}"`);
        const effectiveOpts = { ...(ref.opts ?? {}), ...ov };
        const { audio, format } = await adapter.synthesize(text, effectiveOpts);
        await mkdir(cacheDir, { recursive: true });
        const file = join(cacheDir, `${hash}.${format}`);
        // Write to a temp name then rename, so a half-written file can never be
        // read by a parallel worker (atomic publish). Measure the temp file
        // first (ffprobe detects the format by content, not extension): a clip
        // ffprobe calls invalid is never published, so it can't poison later
        // runs. If ffprobe fails for any other reason, the paid-for audio is
        // published unmeasured and the line fails; the next run finds it in
        // the cache and measures it like any cached clip (deleting it only if
        // ffprobe then calls it invalid).
        const tmp = join(cacheDir, `.${hash}.${randomUUID()}.tmp`);
        await writeFile(tmp, audio);
        let durationMs: number;
        try {
          durationMs = await probeDurationMs(tmp);
        } catch (err) {
          if (err instanceof UnreadableClipError) {
            await unlink(tmp).catch(() => {});
            throw err;
          }
          const published = await rename(tmp, file).then(
            () => true,
            () => false,
          );
          const msg = err instanceof Error ? err.message : String(err);
          throw new Error(
            published
              ? `${msg} (the synthesized audio is kept at ${file}; it will be measured on the next run)`
              : `${msg} (the synthesized audio is left at ${tmp})`,
          );
        } finally {
          durations.delete(tmp);
        }
        await rename(tmp, file);
        durations.set(file, durationMs);
        return { src: file, durationMs, text };
      })();
      p.then(
        () => {
          stats.done += 1;
          report();
        },
        (err: unknown) => {
          stats.failed += 1;
          stats.lastError = err instanceof Error ? err.message : String(err);
          report();
        },
      );
      // Clear the slot once settled so a later (post-cache) call re-checks disk.
      p.finally(() => inflight.delete(hash)).catch(() => {});
      inflight.set(hash, p);
    }
    return p;
  }

  async function handle(body: {
    adapter: TTSAdapterRef;
    items: Record<string, NarrationInput>;
  }): Promise<Record<string, NarrationClip>> {
    if (!body?.adapter?.provider || !body.items) {
      throw new Error("invalid /__tts request: expected { adapter, items }");
    }
    const out: Record<string, NarrationClip> = {};
    await Promise.all(
      Object.entries(body.items).map(async ([key, input]) => {
        // A bare string uses the adapter's opts; the object form overrides
        // them per line (see NarrationInput).
        const text = typeof input === "string" ? input : input.text;
        const overrideOpts = typeof input === "string" ? undefined : input.opts;
        const clip = await synthOne(body.adapter, text, overrideOpts);
        // The caption rides along unhashed: changing it never re-synthesizes.
        const caption = typeof input === "string" ? undefined : input.caption;
        out[key] = caption != null ? { ...clip, text: caption } : clip;
      }),
    );
    return out;
  }

  return { handle, cacheDir, stats: () => ({ ...stats }), busy: () => inflight.size > 0 };
}
