import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { request } from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serveEntry, type Served } from "../src/serve.ts";

/** GET a raw (un-normalized) path, so `..` segments reach the server as sent. */
function get(base: string, path: string): Promise<{ status: number; body: string }> {
  const { port } = new URL(base);
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method: "GET" }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end();
  });
}

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "kamishibai-serve-test-"));
  // `site` and `site-secret` share a prefix: a string-prefix check lets one reach the other.
  await mkdir(join(root, "site"));
  await mkdir(join(root, "site-secret"));
  await mkdir(join(root, "public"));
  await writeFile(join(root, "site", "index.html"), "<!doctype html><html><head><title>t</title></head><body>PAGE</body></html>");
  await writeFile(join(root, "site", "shared.txt"), "FROM-SITE");
  await writeFile(join(root, "site-secret", "key.txt"), "SECRET");
  await writeFile(join(root, "public", "shared.txt"), "FROM-PUBLIC");
  await writeFile(join(root, "public", "asset.txt"), "ASSET");
  await writeFile(join(root, "public", "index.html"), "PUBLIC-INDEX");
  await writeFile(join(root, "entry.js"), "window.kamishibai = { meta: { fps: 1, durationMs: 1000, width: 10, height: 10 }, seek() {} };");
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("serveEntry (.html entry)", () => {
  let served: Served;
  beforeAll(async () => {
    served = await serveEntry(join(root, "site", "index.html"), { publicDir: join(root, "public") });
  });
  afterAll(async () => {
    await served.close();
  });

  it("serves the entry page", async () => {
    const r = await get(served.url, "/index.html");
    expect(r.status).toBe(200);
    expect(r.body).toContain("PAGE");
  });

  it.each(["/../site-secret/key.txt", "/%2e%2e/site-secret/key.txt", "/..%2fsite-secret%2fkey.txt"])(
    "refuses to escape the root via %s",
    async (path) => {
      const r = await get(served.url, path);
      expect(r.status).not.toBe(200);
      expect(r.body).not.toContain("SECRET");
    },
  );

  it("answers 404 for a missing file and keeps serving", async () => {
    expect((await get(served.url, "/nope.png")).status).toBe(404);
    expect((await get(served.url, "/index.html")).status).toBe(200);
  });

  it("falls back to publicDir; the entry's own directory wins on a clash", async () => {
    expect((await get(served.url, "/asset.txt")).body).toBe("ASSET");
    expect((await get(served.url, "/shared.txt")).body).toBe("FROM-SITE");
  });
});

describe("serveEntry (.html entry, burnSubtitles)", () => {
  it("injects the burn flag into the served page", async () => {
    const served = await serveEntry(join(root, "site", "index.html"), { burnSubtitles: true });
    try {
      const r = await get(served.url, "/index.html");
      expect(r.body).toMatch(/<head><script>window\.__KAMISHIBAI_BURN_SUBTITLES__=true<\/script><title>/);
    } finally {
      await served.close();
    }
  });
});

describe("serveEntry (script entry)", () => {
  it("serves the generated host page over a public/index.html", async () => {
    const served = await serveEntry(join(root, "entry.js"), { publicDir: join(root, "public") });
    try {
      const page = await get(served.url, "/");
      expect(page.body).toContain("kamishibai-root");
      expect(page.body).not.toContain("PUBLIC-INDEX");
      expect((await get(served.url, "/asset.txt")).body).toBe("ASSET");
      expect((await get(served.url, "/bundle.js")).status).toBe(200);
    } finally {
      await served.close();
    }
  });
});

describe("serveEntry (bad input)", () => {
  it("rejects a missing entry up front", async () => {
    await expect(serveEntry(join(root, "missing.html"))).rejects.toThrow(/Entry not found/);
  });

  it("rejects a missing public dir up front", async () => {
    await expect(serveEntry(join(root, "site", "index.html"), { publicDir: join(root, "nope") })).rejects.toThrow(
      /Public dir not found/,
    );
  });
});
