import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { request } from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dev, type DevServer } from "../src/dev/server.ts";

/** GET a raw path, as sent. */
function get(base: string, path: string): Promise<{ status: number; type: string; body: string }> {
  const { port } = new URL(base);
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method: "GET" }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () =>
        resolve({
          status: res.statusCode ?? 0,
          type: String(res.headers["content-type"] ?? ""),
          body: Buffer.concat(chunks).toString("utf8"),
        }),
      );
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end();
  });
}

/** Read server-sent events until one matches, or time out. */
function nextEvent(base: string, match: (e: { type: string }) => boolean, timeoutMs = 5000): Promise<{ type: string; message?: string }> {
  const { port } = new URL(base);
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path: "/__kamishibai/events", method: "GET" }, (res) => {
      let buf = "";
      res.on("data", (c: Buffer) => {
        buf += c.toString("utf8");
        for (const m of buf.matchAll(/^data: (.*)$/gm)) {
          const e = JSON.parse(m[1]!);
          if (match(e)) {
            clearTimeout(timer);
            req.destroy();
            resolve(e);
          }
        }
      });
    });
    const timer = setTimeout(() => {
      req.destroy();
      reject(new Error("no matching event"));
    }, timeoutMs);
    req.on("error", () => {});
    req.end();
  });
}

const REEL = (n: number) =>
  `window.kamishibai = { meta: { fps: 1, durationMs: ${n * 1000}, width: 10, height: 10 }, seek() {} };`;

let root: string;
let server: DevServer;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "kamishibai-dev-test-"));
  await mkdir(join(root, "public"));
  await writeFile(join(root, "reel.js"), REEL(1));
  await writeFile(join(root, "public", "beep.wav"), "RIFF");
  server = await dev({ entry: join(root, "reel.js"), publicDir: join(root, "public"), port: 0, cc: "storyboard" });
}, 20_000);

afterAll(async () => {
  await server?.close();
  await rm(root, { recursive: true, force: true });
});

describe("kamishibai dev", () => {
  it("serves the player and its script", async () => {
    expect(server.url).toMatch(/\/__kamishibai\/$/);
    const page = await get(server.url, "/__kamishibai/");
    expect(page.status).toBe(200);
    expect(page.body).toContain("/__kamishibai/player.js");
    const script = await get(server.url, "/__kamishibai/player.js");
    expect(script.status).toBe(200);
    expect(script.type).toContain("javascript");
    expect(script.body).toContain("seek");
  });

  it("passes the options to the player", async () => {
    const cfg = JSON.parse((await get(server.url, "/__kamishibai/config")).body);
    expect(cfg).toMatchObject({ page: "/", mute: null, cc: "storyboard", sweep: true });
  });

  it("serves the reel at the root with the error bridge, uncached", async () => {
    const page = await get(server.url, "/");
    expect(page.body).toContain("kamishibai-root");
    expect(page.body).toContain('kamishibaiDev:"error"');
    const bundle = await get(server.url, "/bundle.js");
    expect(bundle.body).toContain("durationMs: 1e3");
  });

  it("serves audio from publicDir, and nothing outside the allowed roots", async () => {
    const ok = await get(server.url, `/__kamishibai/file?src=${encodeURIComponent("/beep.wav")}`);
    expect(ok.status).toBe(200);
    expect(ok.type).toBe("audio/wav");
    expect((await get(server.url, `/__kamishibai/file?src=${encodeURIComponent("/etc/hosts")}`)).status).toBe(403);
    expect((await get(server.url, `/__kamishibai/file?src=nope.wav`)).status).toBe(404);
  });

  it("reports a build error, then reloads once it's fixed", async () => {
    const failed = nextEvent(server.url, (e) => e.type === "error");
    await writeFile(join(root, "reel.js"), "const broken = ;");
    expect((await failed).message).toContain("Unexpected");

    const reload = nextEvent(server.url, (e) => e.type === "reload");
    await writeFile(join(root, "reel.js"), REEL(2));
    await reload;
    expect((await get(server.url, "/bundle.js")).body).toContain("durationMs: 2e3");
  });

  it("refuses a URL entry", async () => {
    await expect(dev({ entry: "http://localhost:3000" })).rejects.toThrow(/script or \.html entry/);
  });
});
