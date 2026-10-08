import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { geminiAdapter, openaiAdapter, pollyAdapter } from "../src/tts/index.ts";
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
