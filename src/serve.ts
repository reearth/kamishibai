// Serving the page to capture.
// ------------------------------------------------------------------
// Two ways in:
//   - a URL  -> used as-is (you serve it however you like)
//   - a local entry (.ts/.tsx/.js/.jsx) -> bundled with esbuild into a
//     self-contained page and served on localhost
//   - a local .html -> its directory is served statically (scripts must
//     already be browser-ready)
//
// Either way you get back { url, close } and the renderer points Chrome
// at `url`.
// ------------------------------------------------------------------
import { build } from "esbuild";
import { createServer, type Server, type IncomingMessage } from "node:http";
import { mkdtemp, rm, writeFile, stat, cp } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, resolve, dirname, basename } from "node:path";

export interface Served {
  url: string;
  close(): Promise<void>;
}

/** Minimal POST handler for the narration pre-pass (the TTS engine's `handle`). */
export type TTSRequestHandler = (body: unknown) => Promise<unknown>;

export interface ServeOptions {
  /**
   * A directory of static assets to serve at the server root, so the page
   * can reference them by path (the equivalent of Remotion's staticFile /
   * a Vite `public/`). Only applies to bundled script entries.
   */
  publicDir?: string;
  /**
   * Handles `POST /__tts` from the page's `prepareNarration` — synthesizes
   * (and caches) narration audio in Node, before capture. Only wired for
   * bundled script entries.
   */
  tts?: TTSRequestHandler;
}

const SCRIPT_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

function isUrl(entry: string): boolean {
  return /^https?:\/\//i.test(entry);
}

/** Minimal self-contained host page for a bundled script entry. */
function hostHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>kamishibai</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { overflow: hidden; background: #fff; }
      #kamishibai-root { position: absolute; inset: 0; }
    </style>
  </head>
  <body>
    <div id="kamishibai-root"></div>
    <script type="module" src="./bundle.js"></script>
  </body>
</html>
`;
}

/** Read a request body as a UTF-8 string. */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** Start a tiny static file server rooted at `root`, return it + its port. */
async function staticServer(
  root: string,
  opts: { tts?: TTSRequestHandler } = {},
): Promise<{ server: Server; port: number }> {
  const server = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/");

      // Narration pre-pass: synthesize (and cache) in Node, return durations.
      if (req.method === "POST" && urlPath === "/__tts") {
        if (!opts.tts) {
          res.writeHead(404).end("TTS not enabled");
          return;
        }
        try {
          const body = JSON.parse((await readBody(req)) || "{}");
          const result = await opts.tts(body);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(result));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          res.writeHead(500, { "content-type": "text/plain; charset=utf-8" }).end(message);
        }
        return;
      }

      let filePath = join(root, urlPath);
      // Directory -> index.html
      try {
        if ((await stat(filePath)).isDirectory()) filePath = join(filePath, "index.html");
      } catch {
        /* fall through to 404 below */
      }
      // Prevent path traversal outside the served root.
      if (!resolve(filePath).startsWith(resolve(root))) {
        res.writeHead(403).end("forbidden");
        return;
      }
      const ext = extname(filePath).toLowerCase();
      res.writeHead(200, { "content-type": MIME[ext] ?? "application/octet-stream" });
      createReadStream(filePath)
        .on("error", () => res.writeHead(404).end("not found"))
        .pipe(res);
    } catch {
      res.writeHead(500).end("server error");
    }
  });

  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return { server, port };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((r) => server.close(() => r()));
}

/**
 * Make a capturable page reachable over HTTP.
 * Returns the URL to point Chrome at, plus a cleanup function.
 */
export async function serveEntry(entry: string, opts: ServeOptions = {}): Promise<Served> {
  // 1. Already a URL — nothing to build or host.
  if (isUrl(entry)) {
    return { url: entry, close: async () => {} };
  }

  const abs = resolve(entry);
  const ext = extname(abs).toLowerCase();

  // 2. Plain .html — serve its directory as-is.
  if (ext === ".html") {
    const { server, port } = await staticServer(dirname(abs));
    return {
      url: `http://127.0.0.1:${port}/${basename(abs)}`,
      close: () => closeServer(server),
    };
  }

  // 3. Script entry — bundle with esbuild, then host a generated page.
  if (!SCRIPT_EXT.has(ext)) {
    throw new Error(
      `Unsupported entry "${entry}". Expected a URL, an .html file, or a script (${[...SCRIPT_EXT].join(", ")}).`,
    );
  }

  const dir = await mkdtemp(join(tmpdir(), "kamishibai-"));
  try {
    await build({
      entryPoints: [abs],
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2022",
      outfile: join(dir, "bundle.js"),
      sourcemap: "inline",
      jsx: "automatic",
      define: { "process.env.NODE_ENV": '"production"' },
      loader: {
        ".png": "dataurl",
        ".jpg": "dataurl",
        ".jpeg": "dataurl",
        ".svg": "dataurl",
        ".woff": "dataurl",
        ".woff2": "dataurl",
        ".gif": "dataurl",
      },
      logLevel: "silent",
    });
    await writeFile(join(dir, "index.html"), hostHtml(), "utf8");
    // Copy static assets so the page can reach them at the server root.
    if (opts.publicDir) {
      await cp(resolve(opts.publicDir), dir, { recursive: true });
    }
  } catch (err) {
    await rm(dir, { recursive: true, force: true });
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to bundle entry "${entry}":\n${message}`);
  }

  const { server, port } = await staticServer(dir, { tts: opts.tts });
  return {
    url: `http://127.0.0.1:${port}/`,
    close: async () => {
      await closeServer(server);
      await rm(dir, { recursive: true, force: true });
    },
  };
}
