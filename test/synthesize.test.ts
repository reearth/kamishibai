import { describe, it, expect } from "vitest";
import { synthesize } from "../src/render.ts";

describe("synthesize", () => {
  it("refuses a URL entry, whose narration requests never reach kamishibai", async () => {
    await expect(synthesize({ entry: "http://127.0.0.1:1/reel" })).rejects.toThrow(
      /tts needs a script or \.html entry/,
    );
  });
});
