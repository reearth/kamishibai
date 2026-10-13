import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { elevenLabsAdapter, geminiAdapter, googleAdapter, kokoroAdapter, openaiAdapter, pollyAdapter } from "../src/tts/index.ts";
import { createTTSEngine } from "../src/tts/engine.ts";

const geminiResponse = () =>
  new Response(
    JSON.stringify({
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  mimeType: "audio/L16;codec=pcm;rate=24000",
                  data: Buffer.alloc(2400).toString("base64"),
                },
              },
            ],
          },
        },
      ],
    }),
  );

/** Run one line through a fresh engine and return the URL fetch was called with.
 *  The canned body need not be playable: only the request is checked. */
async function requestedUrl(
  adapter: Parameters<ReturnType<typeof createTTSEngine>["handle"]>[0]["adapter"],
  response: () => Response,
): Promise<{ url: string; init: RequestInit }> {
  const fetchMock = vi.fn(async () => response());
  vi.stubGlobal("fetch", fetchMock);
  const engine = createTTSEngine({ cacheDir: await mkdtemp(join(tmpdir(), "kamishibai-baseurl-")) });
  await engine.handle({ adapter, items: { a: "Hello" } }).catch(() => {});
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string | URL, RequestInit];
  return { url: String(url), init };
}

describe("TTS base URL", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("keeps the base URL out of the cache id", () => {
    expect(geminiAdapter({ baseUrl: "https://proxy.example" }).id).toBe(geminiAdapter().id);
    expect(openaiAdapter({ baseUrl: "https://proxy.example/v1" }).id).toBe(openaiAdapter().id);
    expect(pollyAdapter({ baseUrl: "https://proxy.example" }).id).toBe(pollyAdapter().id);
  });

  it("sends Gemini to the adapter's baseUrl, trailing slash trimmed", async () => {
    vi.stubEnv("GEMINI_API_KEY", "k");
    vi.stubEnv("GEMINI_BASE_URL", "https://env.example");
    const { url } = await requestedUrl(
      geminiAdapter({ baseUrl: "https://proxy.example/gemini/" }),
      geminiResponse,
    );
    expect(url).toBe(
      "https://proxy.example/gemini/v1beta/models/gemini-2.5-flash-preview-tts:generateContent",
    );
  });

  it("falls back to the env var when the adapter has no baseUrl", async () => {
    vi.stubEnv("GEMINI_API_KEY", "k");
    vi.stubEnv("GEMINI_BASE_URL", "https://env.example");
    const { url } = await requestedUrl(geminiAdapter(), geminiResponse);
    expect(url).toBe(
      "https://env.example/v1beta/models/gemini-2.5-flash-preview-tts:generateContent",
    );
  });

  it("reads OPENAI_BASE_URL like the OpenAI SDK (base includes /v1)", async () => {
    vi.stubEnv("OPENAI_API_KEY", "k");
    vi.stubEnv("OPENAI_BASE_URL", "http://localhost:8000/v1");
    const { url } = await requestedUrl(openaiAdapter(), () => new Response("x"));
    expect(url).toBe("http://localhost:8000/v1/audio/speech");
  });

  const keyed = [
    { name: "OpenAI", env: ["OPENAI_API_KEY"], adapter: openaiAdapter, url: "http://localhost:8880/v1/audio/speech", base: "http://localhost:8880/v1" },
    { name: "ElevenLabs", env: ["ELEVENLABS_API_KEY"], adapter: elevenLabsAdapter, url: "http://localhost:8880/v1/text-to-speech/v", base: "http://localhost:8880" },
    { name: "Google", env: ["GOOGLE_API_KEY", "GOOGLE_TTS_API_KEY"], adapter: googleAdapter, url: "http://localhost:8880/v1/text:synthesize", base: "http://localhost:8880" },
    { name: "Gemini", env: ["GEMINI_API_KEY", "GOOGLE_API_KEY"], adapter: geminiAdapter, url: "http://localhost:8880/v1beta/models/gemini-2.5-flash-preview-tts:generateContent", base: "http://localhost:8880" },
  ];

  it.each(keyed)("calls a compatible $name server without a key, sending none", async (p) => {
    for (const e of p.env) vi.stubEnv(e, "");
    const { url, init } = await requestedUrl(
      p.adapter({ baseUrl: p.base, voiceId: "v" } as never),
      () => new Response("x"),
    );
    expect(url).toBe(p.url);
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization ?? headers["xi-api-key"] ?? headers["x-goog-api-key"]).toBeUndefined();
  });

  it.each(keyed)("still needs a key for $name's own endpoint", async (p) => {
    for (const e of [...p.env, "OPENAI_BASE_URL", "ELEVENLABS_BASE_URL", "GOOGLE_TTS_BASE_URL", "GEMINI_BASE_URL"])
      vi.stubEnv(e, "");
    const fetchMock = vi.fn(async () => new Response("x"));
    vi.stubGlobal("fetch", fetchMock);
    const engine = createTTSEngine({ cacheDir: await mkdtemp(join(tmpdir(), "kamishibai-baseurl-")) });
    await expect(
      engine.handle({ adapter: p.adapter({ voiceId: "v" } as never), items: { a: "Hello" } }),
    ).rejects.toThrow(`${p.env[0]}`);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends Kokoro to the local Kokoro-FastAPI, with no key, as an OpenAI speech request", async () => {
    vi.stubEnv("KOKORO_BASE_URL", "");
    vi.stubEnv("OPENAI_API_KEY", "k");
    const { url, init } = await requestedUrl(kokoroAdapter({ voice: "jf_alpha", speed: 1.1 }), () => new Response("x"));
    expect(url).toBe("http://localhost:8880/v1/audio/speech");
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
    expect(JSON.parse(String(init.body))).toMatchObject({ model: "kokoro", voice: "jf_alpha", speed: 1.1, input: "Hello" });
  });

  it("reads KOKORO_BASE_URL, and keeps Kokoro's cache apart from OpenAI's", async () => {
    vi.stubEnv("KOKORO_BASE_URL", "http://gpu-box:8880/v1/");
    const { url } = await requestedUrl(kokoroAdapter(), () => new Response("x"));
    expect(url).toBe("http://gpu-box:8880/v1/audio/speech");
    expect(kokoroAdapter({ baseUrl: "http://x/v1" }).id).toBe(kokoroAdapter().id);
    expect(kokoroAdapter({ voice: "af_heart" }).id).not.toBe(openaiAdapter({ voice: "af_heart" }).id);
  });

  it("says how to start Kokoro when nothing listens", async () => {
    vi.stubEnv("KOKORO_BASE_URL", "");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    const engine = createTTSEngine({ cacheDir: await mkdtemp(join(tmpdir(), "kamishibai-baseurl-")) });
    await expect(engine.handle({ adapter: kokoroAdapter(), items: { a: "Hello" } })).rejects.toThrow(
      /no Kokoro server at http:\/\/localhost:8880\/v1 .*docker run/,
    );
  });

  it("signs Polly for the host it actually calls", async () => {
    vi.stubEnv("AWS_ACCESS_KEY_ID", "AKID");
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "secret");
    vi.stubEnv("AWS_SESSION_TOKEN", "");
    const { url, init } = await requestedUrl(
      pollyAdapter({ region: "ap-northeast-1", baseUrl: "https://vpce.example:8443/polly" }),
      () => new Response("x"),
    );
    expect(url).toBe("https://vpce.example:8443/polly/v1/speech");
    const auth = (init.headers as Record<string, string>).authorization;
    expect(auth).toContain("/ap-northeast-1/polly/aws4_request");
  });
});
