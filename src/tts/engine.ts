// kamishibai TTS engine — the Node half of the narration pre-pass.
// ------------------------------------------------------------------
// Holds the real adapters (say / OpenAI / ElevenLabs, plus any custom ones),
// synthesizes on demand behind a content-hash cache, and measures duration
// with ffprobe. Served to the reel over POST /__tts (see ../serve.ts), it is
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
}

export interface TTSEngine {
  /** handle a /__tts request body, returning the key -> clip map */
  handle(body: {
    adapter: TTSAdapterRef;
    items: Record<string, string>;
  }): Promise<Record<string, NarrationClip>>;
  cacheDir: string;
}

const FORMATS: TTSFormat[] = ["mp3", "aiff", "wav"];

// ---- built-in adapters --------------------------------------------

const sayAdapter: TTSAdapter = {
  provider: "say",
  async synthesize(text, opts) {
    if (process.platform !== "darwin") {
      throw new Error(
        "the `say` adapter only works on macOS — use openai / google / polly / " +
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
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
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
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
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
    const res = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(key)}`,
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

// --- AWS SigV4 (minimal, for a single Polly POST — no SDK dependency) ---

function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

/** Sign a Polly request and return the auth headers fetch should send. */
function signPolly(o: {
  region: string;
  host: string;
  body: string;
  accessKey: string;
  secretKey: string;
  sessionToken?: string;
}): Record<string, string> {
  const service = "polly";
  const path = "/v1/speech";
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
    path,
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
    const host = `polly.${region}.amazonaws.com`;
    const body = JSON.stringify({
      OutputFormat: "mp3",
      Text: text,
      VoiceId: opts.voiceId ?? "Joanna",
      Engine: opts.engine ?? "neural",
      ...(opts.languageCode ? { LanguageCode: opts.languageCode } : {}),
    });
    const headers = signPolly({
      region,
      host,
      body,
      accessKey,
      secretKey,
      sessionToken: process.env.AWS_SESSION_TOKEN,
    });
    const res = await fetch(`https://${host}/v1/speech`, { method: "POST", headers, body });
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
  const builtins = [sayAdapter, openaiAdapter, elevenLabsAdapter, googleAdapter, pollyAdapter];
  for (const a of [...builtins, ...(opts.adapters ?? [])]) {
    registry.set(a.provider, a);
  }

  const inflight = new Map<string, Promise<NarrationClip>>();
  const durations = new Map<string, number>();

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
    let ms = 0;
    try {
      const { stdout } = await execFileAsync("ffprobe", [
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "csv=p=0",
        file,
      ]);
      const sec = parseFloat(stdout.trim());
      if (Number.isFinite(sec)) ms = Math.round(sec * 1000);
    } catch {
      // ffprobe missing/failed — leave 0 and let the reel decide.
    }
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
      .update(`${ref.id} ${text}${ov ? ` ${stableJson(ov)}` : ""}`)
      .digest("hex")
      .slice(0, 32);

    const existing = existingFile(hash);
    if (existing) return { src: existing, durationMs: await probeDurationMs(existing), text };

    let p = inflight.get(hash);
    if (!p) {
      p = (async () => {
        const adapter = registry.get(ref.provider);
        if (!adapter) throw new Error(`no TTS adapter registered for provider "${ref.provider}"`);
        const effectiveOpts = { ...(ref.opts ?? {}), ...ov };
        const { audio, format } = await adapter.synthesize(text, effectiveOpts);
        await mkdir(cacheDir, { recursive: true });
        const file = join(cacheDir, `${hash}.${format}`);
        // Write to a temp name then rename, so a half-written file can never be
        // read by a parallel worker (atomic publish).
        const tmp = join(cacheDir, `.${hash}.${randomUUID()}.tmp`);
        await writeFile(tmp, audio);
        await rename(tmp, file);
        return { src: file, durationMs: await probeDurationMs(file), text };
      })();
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
        out[key] = await synthOne(body.adapter, text, overrideOpts);
      }),
    );
    return out;
  }

  return { handle, cacheDir };
}
