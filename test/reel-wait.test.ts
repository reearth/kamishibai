import { describe, it, expect } from "vitest";
import { errors, type Page } from "playwright";
import { waitForReel, watchPage } from "../src/renderer.ts";

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

/** neverMounts plus page events the test can fire. */
function eventPage() {
  const handlers = new Map<string, (arg: unknown) => void>();
  const page = {
    waitForFunction: (neverMounts as unknown as { waitForFunction: unknown }).waitForFunction,
    on(event: string, fn: (arg: unknown) => void) {
      handlers.set(event, fn);
    },
  } as unknown as Page;
  const fire = (event: string, arg: unknown) => handlers.get(event)?.(arg);
  return { page, fire };
}

const consoleMsg = (type: string, text: string) => ({ type: () => type, text: () => text });

describe("watchPage", () => {
  it("fails the wait with the error a page threw before mounting", async () => {
    const { page, fire } = eventPage();
    const logs: string[] = [];
    const wait = watchPage(page, { timeoutMs: 30_000, onPageLog: (m) => logs.push(m) });
    fire("pageerror", new RangeError("kamishibai: scene 1: bad"));
    const t = Date.now();
    await expect(waitForReel(page, wait)).rejects.toThrow(
      /the page threw: kamishibai: scene 1: bad$/,
    );
    expect(Date.now() - t).toBeLessThan(5_000);
    expect(logs).toEqual(["page error: kamishibai: scene 1: bad"]);
  });

  it("forwards only kamishibai console warnings/errors, and only when asked", () => {
    const { page, fire } = eventPage();
    const logs: string[] = [];
    watchPage(page, { onPageLog: (m) => logs.push(m) }, true);
    fire("console", consoleMsg("warning", "kamishibai: dropping subtitle cue"));
    fire("console", consoleMsg("warning", "some other library"));
    fire("console", consoleMsg("log", "kamishibai: just info"));
    expect(logs).toEqual(["kamishibai: dropping subtitle cue"]);

    const quiet = eventPage();
    const none: string[] = [];
    watchPage(quiet.page, { onPageLog: (m) => none.push(m) });
    quiet.fire("console", consoleMsg("warning", "kamishibai: x"));
    expect(none).toEqual([]);
  });
});
