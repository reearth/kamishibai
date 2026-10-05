import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { geminiAdapter } from "../src/tts/index.ts";
import { createTTSEngine, pcmToWav } from "../src/tts/engine.ts";

describe("pcmToWav", () => {
  it("writes a 44-byte RIFF header describing 16-bit mono PCM", () => {
    const wav = Buffer.from(pcmToWav(new Uint8Array(480), 24000));
    expect(wav.length).toBe(44 + 480);
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.readUInt32LE(4)).toBe(36 + 480);
    expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
    expect(wav.readUInt16LE(20)).toBe(1); // PCM
    expect(wav.readUInt16LE(22)).toBe(1); // mono
    expect(wav.readUInt32LE(24)).toBe(24000);
    expect(wav.readUInt32LE(28)).toBe(48000); // byte rate
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.toString("ascii", 36, 40)).toBe("data");
    expect(wav.readUInt32LE(40)).toBe(480);
  });
});

describe("geminiAdapter", () => {
  it("folds model, voice and instructions into the cache id", () => {
    expect(geminiAdapter().id).toBe("gemini:gemini-2.5-flash-preview-tts:Kore:");
    expect(geminiAdapter({ voice: "Puck", instructions: "Say cheerfully" }).id).toBe(
      "gemini:gemini-2.5-flash-preview-tts:Puck:Say cheerfully",
    );
  });

  describe("engine", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    });

    it("calls the Gemini API and caches the PCM as WAV", async () => {
      vi.stubEnv("GEMINI_API_KEY", "test-key");
      const pcm = Buffer.alloc(2400);
      const fetchMock = vi.fn(async () =>
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      inlineData: {
                        mimeType: "audio/L16;codec=pcm;rate=24000",
                        data: pcm.toString("base64"),
                      },
                    },
                  ],
                },
              },
            ],
          }),
        ),
      );
      vi.stubGlobal("fetch", fetchMock);

      const engine = createTTSEngine({ cacheDir: await mkdtemp(join(tmpdir(), "kamishibai-gemini-")) });
      const out = await engine.handle({
        adapter: geminiAdapter({ voice: "Puck", instructions: "Say cheerfully" }),
        items: { a: "Hello" },
      });

      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent",
      );
      expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-key");
      const body = JSON.parse(String(init.body));
      expect(body.contents[0].parts[0].text).toBe("Say cheerfully: Hello");
      expect(body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe("Puck");

      expect(out.a.src.endsWith(".wav")).toBe(true);
      const wav = readFileSync(out.a.src);
      expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
      expect(wav.length).toBe(44 + pcm.length);
    });
  });
});
