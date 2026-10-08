// Serving the page to capture.
// ------------------------------------------------------------------
// Three ways in:
//   - a URL  -> used as-is (you serve it however you like; publicDir,
//     burnSubtitles and the TTS endpoint can't reach a page we don't host)
//   - a local entry (.ts/.tsx/.js/.jsx) -> bundled with esbuild into a
//     self-contained page and served on localhost
//   - a local .html -> its directory is served statically (scripts must
//     already be browser-ready)
//
// Every way you get back { url, close } and the renderer points Chrome
// at `url`.
// ------------------------------------------------------------------
import { build, type BuildOptions } from "esbuild";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, rm, writeFile, stat, readFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, resolve, dirname, basename, relative, isAbsolute, sep } from "node:path";

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
   * a Vite `public/`). Applies to script and .html entries (not a URL). It
   * is a fallback root: files the entry provides — the generated index.html
   * and bundle.js of a script entry, or the .html entry's own directory —
   * win over a same-named file in publicDir.
   */
  publicDir?: string;
  /**
   * Handles `POST /__tts` from the page's `prepareNarration` — synthesizes
   * (and caches) narration audio in Node, before capture. Wired for script
   * and .html entries (a URL entry's page posts to its own origin instead).
   */
  tts?: TTSRequestHandler;
  /**
   * Burn subtitles into the frames (pixels) instead of the default soft track.
   * Injected as a global (`window.__KAMISHIBAI_BURN_SUBTITLES__`) the page
   * reads before it mounts: into the generated host page of a script entry,
   * or into every served .html page of an .html entry. Not for a URL entry.
   */
  burnSubtitles?: boolean;
}

export const SCRIPT_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);

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
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".aiff": "audio/aiff",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

/** The content type to serve a file with, by its extension. */
export function mimeType(path: string): string {
  return MIME[extname(path).toLowerCase()] ?? "application/octet-stream";
}

export function isUrl(entry: string): boolean {
  return /^https?:\/\//i.test(entry);
}

/** Sets the burn flag before any page script runs, so <Subtitle> sees it at mount. */
const BURN_SCRIPT = `<script>window.__KAMISHIBAI_BURN_SUBTITLES__=true</script>`;

/** Insert `snippet` into a page as early as possible, before its own scripts. */
export function injectEarly(html: string, snippet: string): string {
  // After <head>, else after the doctype (prepending would force quirks mode).
  const m = /<head(\s[^>]*)?>/i.exec(html) ?? /<!doctype[^>]*>/i.exec(html);
  const at = m ? m.index + m[0].length : 0;
  return html.slice(0, at) + snippet + html.slice(at);
}

/** Insert the burn flag into an .html entry's page, as early as possible. */
function injectBurnFlag(html: string): string {
  return injectEarly(html, BURN_SCRIPT);
}

/** Minimal self-contained host page for a bundled script entry. */
export function hostHtml(burnSubtitles = false): string {
  const config = burnSubtitles ? `\n    ${BURN_SCRIPT}` : "";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>kamishibai</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { overflow: hidden; background: #fff; }
      #kamishibai-root { position: absolute; inset: 0; }
    </style>${config}
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

/** True when `p` is `root` itself or lies beneath it (no `..` escape). */
export function isInside(root: string, p: string): boolean {
  const rel = relative(root, p);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/**
 * Find the file a URL path names: the first root (in order) that has it wins;
 * a directory maps to its index.html. Returns undefined when no root has a
 * regular file there, or "outside" when the path escapes the roots.
 */
async function resolveFile(roots: string[], urlPath: string): Promise<string | "outside" | undefined> {
  for (const root of roots) {
    let p = join(root, urlPath);
    if (!isInside(root, p)) return "outside";
    try {
      if ((await stat(p)).isDirectory()) p = join(p, "index.html");
      if ((await stat(p)).isFile()) return p;
    } catch {
      /* not in this root — try the next one */
    }
  }
  return undefined;
}

export interface StaticServerOptions {
  tts?: TTSRequestHandler;
  /** rewrites every .html response */
  transformHtml?: (html: string) => string;
  /** answers a request before the static roots; return true once handled */
  handle?: (req: IncomingMessage, res: ServerResponse, urlPath: string) => Promise<boolean>;
  /** extra headers on every static file response */
  headers?: Record<string, string>;
  /** the port to listen on (default: any free one) */
  port?: number;
}

/**
 * Start a tiny static file server over `roots` (earlier roots shadow later
 * ones), return it + its port.
 */
export async function staticServer(
  roots: string[],
  opts: StaticServerOptions = {},
): Promise<{ server: Server; port: number }> {
  const absRoots = roots.map((r) => resolve(r));
  const server = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/");

      if (opts.handle && (await opts.handle(req, res, urlPath))) return;

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

      const filePath = await resolveFile(absRoots, urlPath);
      // Prevent path traversal outside the served roots.
      if (filePath === "outside") {
        res.writeHead(403).end("forbidden");
        return;
      }
      if (!filePath) {
        res.writeHead(404).end("not found");
        return;
      }
      const ext = extname(filePath).toLowerCase();
      const type = mimeType(filePath);
      if (ext === ".html" && opts.transformHtml) {
        const html = opts.transformHtml(await readFile(filePath, "utf8"));
        res.writeHead(200, { ...opts.headers, "content-type": type }).end(html);
        return;
      }
      // Send headers only once the file is actually open, so a read failure
      // can still answer with a status instead of a truncated 200.
      const stream = createReadStream(filePath);
      stream
        .on("open", () => {
          res.writeHead(200, { ...opts.headers, "content-type": type });
          stream.pipe(res);
        })
        .on("error", () => {
          if (res.headersSent) res.destroy();
          else res.writeHead(404).end("not found");
        });
    } catch {
      if (res.headersSent) res.destroy();
      else res.writeHead(500).end("server error");
    }
  });

  await new Promise<void>((r, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, "127.0.0.1", () => {
      server.off("error", reject);
      r();
    });
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return { server, port };
}

export function closeServer(server: Server): Promise<void> {
  return new Promise((r) => server.close(() => r()));
}

/** How a script entry is bundled into the page's bundle.js. */
export function bundleOptions(entry: string, outfile: string): BuildOptions {
  return {
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    outfile,
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
  };
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
  const isFile = await stat(abs).then((st) => st.isFile(), () => false);
  if (!isFile) throw new Error(`Entry not found: "${entry}"`);
  // publicDir is an extra, lower-priority root (see ServeOptions.publicDir).
  const publicRoots: string[] = [];
  if (opts.publicDir) {
    const isDir = await stat(opts.publicDir).then((st) => st.isDirectory(), () => false);
    if (!isDir) throw new Error(`Public dir not found: "${opts.publicDir}"`);
    publicRoots.push(opts.publicDir);
  }

  // 2. Plain .html — serve its directory as-is.
  if (ext === ".html") {
    const { server, port } = await staticServer([dirname(abs), ...publicRoots], {
      tts: opts.tts,
      transformHtml: opts.burnSubtitles ? injectBurnFlag : undefined,
    });
    return {
      url: `http://127.0.0.1:${port}/${encodeURIComponent(basename(abs))}`,
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
    await build(bundleOptions(abs, join(dir, "bundle.js")));
    await writeFile(join(dir, "index.html"), hostHtml(opts.burnSubtitles), "utf8");
  } catch (err) {
    await rm(dir, { recursive: true, force: true });
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to bundle entry "${entry}":\n${message}`);
  }

  // The generated page + bundle come first, so a public/index.html can't
  // replace the host page; publicDir serves everything else at the root.
  const { server, port } = await staticServer([dir, ...publicRoots], { tts: opts.tts });
  return {
    url: `http://127.0.0.1:${port}/`,
    close: async () => {
      await closeServer(server);
      await rm(dir, { recursive: true, force: true });
    },
  };
}
