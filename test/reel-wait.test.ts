import { describe, it, expect } from "vitest";
import { errors, type Page } from "playwright";
import { waitForReel } from "../src/renderer.ts";

/** A page that never exposes window.kamishibai: each wait slice times out. */
const neverMounts = {
  async waitForFunction(_fn: unknown, _arg: unknown, o: { timeout: number }) {
    await new Promise((r) => setTimeout(r, o.timeout));
    throw new errors.TimeoutError("timeout");
  },
} as unknown as Page;

describe("waitForReel", () => {
  it("fails fast with the failure reason instead of idling out", async () => {
    const t = Date.now();
    await expect(
      waitForReel(neverMounts, {
        timeoutMs: 30_000,
        failed: () => "narration failed: provider exploded",
        describe: () => "raise the limit with --probe-timeout",
      }),
    ).rejects.toThrow(/narration failed: provider exploded$/);
    expect(Date.now() - t).toBeLessThan(5_000);
  });

  it("keeps the idle-timeout message when nothing failed", async () => {
    await expect(
      waitForReel(neverMounts, { timeoutMs: 300, describe: () => "still waiting" }),
    ).rejects.toThrow(/within 0.3s — still waiting/);
  });
});
