// kamishibai dev — a live preview of a reel in the browser.
// ------------------------------------------------------------------
// Serves the reel exactly where a render serves it (the page at the root,
// publicDir behind it), plus a player at /__kamishibai/ that drives the reel
// through the same one contract the renderer uses: seek(ms). So any page that
// renders also previews — React or not — and what the player shows is what
// the capture would see.
//
// On top of serving it:
//   - rebuilds a script entry on save (esbuild watch), or watches an .html
//     entry's directory, and tells the player to reload over SSE;
//   - answers /__tts from the cache only: a line synthesized before plays
//     with its real audio, a new or edited one comes back with no audio and
//     an estimated length (a placeholder) — editing costs nothing, and
//     `kamishibai tts` bakes the real voice when the script is settled;
//   - hands the player the audio files the reel declares, so it can play
//     them in time with the picture.
// ------------------------------------------------------------------
import { build, context, formatMessages, type BuildContext, type Message } from "esbuild";
import { watch, existsSync, type FSWatcher } from "node:fs";
import { mkdtemp, rm, writeFile, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  SCRIPT_EXT,
  bundleOptions,
  closeServer,
  hostHtml,
  injectEarly,
  isInside,
  isUrl,
  mimeType,
  staticServer,
} from "../serve.ts";
import { resolveAudioSrc } from "../render.ts";
import { createTTSEngine, type TTSAdapter } from "../tts/engine.ts";
import { PLAYER_HTML } from "./player-html.ts";

/** What the player overlays (switchable in the player too): nothing; soft
 *  subtitles and the lines with no audio yet; or also every sound as text. */
export type CcMode = "off" | "captions" | "storyboard";
export const CC_MODES: readonly CcMode[] = ["off", "captions", "storyboard"];

export interface DevOptions {
  /** an .html file or a script (.ts/.tsx/.js/.jsx) — not a URL */
  entry: string;
  /** static assets served at the root, as in render */
  publicDir?: string;
  /** port to listen on; falls back to a free one when it's taken (default: 4321) */
  port?: number;
  /** start the player muted (default: the player's last setting, else sound on) */
  mute?: boolean;
  /** the player's starting overlay (default: its last setting, else "captions") */
  cc?: CcMode;
  /** sweep every frame in the background to collect the audio and subtitle
   *  markers up front (default: true) */
  sweep?: boolean;
  /** custom TTS adapters (only their provider names matter: dev never synthesizes) */
  ttsAdapters?: TTSAdapter[];
  /** the TTS cache to read (default: <cwd>/.kamishibai-tts) */
  ttsCacheDir?: string;
  onLog?: (msg: string) => void;
}

export interface DevServer {
  /** the player's URL */
  url: string;
  close(): Promise<void>;
}

const DEFAULT_PORT = 4321;
const PREFIX = "/__kamishibai/";

/** Forwards the reel's errors to the player, which shows them over the stage. */
const ERROR_BRIDGE = `<script>(function(){
var post=function(m){try{parent.postMessage({kamishibaiDev:"error",message:String(m)},"*")}catch(e){}};
addEventListener("error",function(e){post(e.message||e.error)});
addEventListener("unhandledrejection",function(e){var r=e.reason;post(r&&r.message||r)});
})()</script>`;

/** Extensions a browser's decodeAudioData reads as they are; anything else
 *  (AIFF from macOS `say`, a video's audio track) is converted to WAV. */
const BROWSER_AUDIO = new Set([".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac", ".webm"]);

/** Decode any file ffmpeg reads into WAV bytes. */
function toWav(file: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      "ffmpeg",
      ["-v", "error", "-i", file, "-vn", "-f", "wav", "-"],
      { encoding: "buffer", maxBuffer: 1 << 30 },
      (err, stdout, stderr) => {
        if (err) reject(new Error(stderr.toString().trim() || err.message));
        else resolve(stdout);
      },
    );
  });
}

/** The player's script: the built file next to this module (dist), or — when
 *  running from source — bundled from player.ts on first use. */
async function playerScript(): Promise<string> {
  const here = dirname(fileURLToPath(import.meta.url));
  const built = join(here, "dev-player.js");
  if (existsSync(built)) return readFile(built, "utf8");
  const out = await build({
    entryPoints: [join(here, "player.ts")],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    write: false,
    logLevel: "silent",
  });
  return out.outputFiles[0]!.text;
}

async function errorText(messages: Message[]): Promise<string> {
  return (await formatMessages(messages, { kind: "error", color: false })).join("\n").trim();
}

/** Start the dev server. Resolves once it's listening and the first build is done. */
export async function dev(opts: DevOptions): Promise<DevServer> {
  const log = opts.onLog ?? (() => {});
  if (isUrl(opts.entry)) {
    throw new Error(
      `dev needs a script or .html entry: a URL entry is served by its own server, so ` +
        `kamishibai can't watch it or drive it from the player ("${opts.entry}")`,
    );
  }
  const abs = resolve(opts.entry);
  const ext = extname(abs).toLowerCase();
  if (!(await stat(abs).then((s) => s.isFile(), () => false))) {
    throw new Error(`Entry not found: "${opts.entry}"`);
  }
  const isHtml = ext === ".html";
  if (!isHtml && !SCRIPT_EXT.has(ext)) {
    throw new Error(
      `Unsupported entry "${opts.entry}". Expected an .html file or a script (${[...SCRIPT_EXT].join(", ")}).`,
    );
  }
  const publicDir = opts.publicDir ? resolve(opts.publicDir) : undefined;
  if (publicDir && !(await stat(publicDir).then((s) => s.isDirectory(), () => false))) {
    throw new Error(`Public dir not found: "${opts.publicDir}"`);
  }

  // ---- reload channel (server-sent events) --------------------------
  const clients = new Set<ServerResponse>();
  let lastError: string | undefined;
  const send = (event: { type: "reload" } | { type: "error"; message: string }) => {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of clients) res.write(data);
  };
  const heartbeat = setInterval(() => {
    for (const res of clients) res.write(": ping\n\n");
  }, 15_000);
  heartbeat.unref?.();

  // ---- narration: cache only ----------------------------------------
  const tts = createTTSEngine({ adapters: opts.ttsAdapters, cacheDir: opts.ttsCacheDir, cacheOnly: true });
  let reportedEstimates = -1;
  const handleTts = async (body: unknown) => {
    const out = await tts.handle(body as Parameters<typeof tts.handle>[0]);
    const pending = Object.values(out).filter((c) => c.src === "").length;
    // Once per change, not per request: the player's two pages both ask.
    if (pending !== reportedEstimates) {
      reportedEstimates = pending;
      if (pending > 0) {
        log(
          `${pending} narration line(s) have no audio yet — previewed with an estimated length. ` +
            `Bake them with: kamishibai tts ${opts.entry}`,
        );
      }
    }
    return out;
  };

  // ---- the page -----------------------------------------------------
  let dir: string | undefined;
  let ctx: BuildContext | undefined;
  const watchers: FSWatcher[] = [];
  let reloadTimer: ReturnType<typeof setTimeout> | undefined;
  const reloadSoon = () => {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      lastError = undefined;
      send({ type: "reload" });
    }, 80);
  };
  const roots: string[] = [];
  if (isHtml) {
    roots.push(dirname(abs));
    watchers.push(watch(dirname(abs), { recursive: true }, reloadSoon));
  } else {
    dir = await mkdtemp(join(tmpdir(), "kamishibai-dev-"));
    await writeFile(join(dir, "index.html"), hostHtml(), "utf8");
    roots.push(dir);
    ctx = await context({
      ...bundleOptions(abs, join(dir, "bundle.js")),
      plugins: [
        {
          name: "kamishibai-dev",
          setup(b) {
            b.onEnd(async (result) => {
              if (result.errors.length > 0) {
                lastError = await errorText(result.errors);
                log(`Build failed:\n${lastError}`);
                send({ type: "error", message: lastError });
              } else {
                lastError = undefined;
                send({ type: "reload" });
              }
            });
          },
        },
      ],
    });
    await ctx.rebuild().catch(() => {}); // errors are reported by onEnd
    await ctx.watch();
  }
  if (publicDir) {
    roots.push(publicDir);
    watchers.push(watch(publicDir, { recursive: true }, reloadSoon));
  }

  // Audio the player may fetch: files under the working dir, the entry's
  // directory, publicDir, or the TTS cache — never anywhere else on disk.
  const audioRoots = [process.cwd(), dirname(abs), tts.cacheDir, ...(publicDir ? [publicDir] : [])];
  const page = isHtml ? `/${encodeURIComponent(basename(abs))}` : "/";
  const config = JSON.stringify({
    page,
    entry: opts.entry,
    mute: opts.mute ?? null,
    cc: opts.cc ?? null,
    sweep: opts.sweep ?? true,
  });
  const script = await playerScript();
  // Converted audio, by path + mtime, so a file is decoded once per change.
  const wavCache = new Map<string, Promise<Buffer>>();
  const playableAudio = async (file: string): Promise<{ type: string; body: Buffer }> => {
    if (BROWSER_AUDIO.has(extname(file).toLowerCase())) {
      return { type: mimeType(file), body: await readFile(file) };
    }
    const key = `${file}@${(await stat(file)).mtimeMs}`;
    let wav = wavCache.get(key);
    if (!wav) {
      wav = toWav(file);
      wavCache.set(key, wav);
      wav.catch(() => wavCache.delete(key));
    }
    return { type: "audio/wav", body: await wav };
  };

  const handle = async (req: IncomingMessage, res: ServerResponse, urlPath: string) => {
    if (!urlPath.startsWith(PREFIX) && urlPath !== PREFIX.slice(0, -1)) return false;
    const route = urlPath.slice(PREFIX.length);
    const noStore = { "cache-control": "no-store" };
    if (route === "") {
      res.writeHead(200, { ...noStore, "content-type": "text/html; charset=utf-8" }).end(PLAYER_HTML);
    } else if (route === "player.js") {
      res.writeHead(200, { ...noStore, "content-type": "text/javascript; charset=utf-8" }).end(script);
    } else if (route === "config") {
      res.writeHead(200, { ...noStore, "content-type": "application/json" }).end(config);
    } else if (route === "events") {
      res.writeHead(200, { ...noStore, "content-type": "text/event-stream", connection: "keep-alive" });
      res.write(": connected\n\n");
      if (lastError) res.write(`data: ${JSON.stringify({ type: "error", message: lastError })}\n\n`);
      clients.add(res);
      req.on("close", () => clients.delete(res));
    } else if (route === "file") {
      const src = new URL(req.url ?? "/", "http://x").searchParams.get("src") ?? "";
      const file = resolve(resolveAudioSrc(src, publicDir));
      if (!src || /^https?:\/\//i.test(src) || !existsSync(file)) {
        res.writeHead(404).end();
      } else if (!audioRoots.some((r) => isInside(resolve(r), file))) {
        res.writeHead(403).end();
      } else {
        try {
          const { type, body } = await playableAudio(file);
          res.writeHead(200, { ...noStore, "content-type": type }).end(body);
        } catch (err) {
          res.writeHead(415, { "content-type": "text/plain; charset=utf-8" }).end(
            `can't convert ${file} for the browser: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } else {
      res.writeHead(404).end("not found");
    }
    return true;
  };

  const listen = (port: number) =>
    staticServer(roots, {
      tts: handleTts,
      handle,
      headers: { "cache-control": "no-store" },
      transformHtml: (html) => injectEarly(html, ERROR_BRIDGE),
      port,
    });
  const wanted = opts.port ?? DEFAULT_PORT;
  let served: Awaited<ReturnType<typeof listen>>;
  try {
    served = await listen(wanted);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE" || wanted === 0) throw err;
    served = await listen(0);
    log(`Port ${wanted} is in use; using ${served.port} instead.`);
  }

  return {
    url: `http://127.0.0.1:${served.port}${PREFIX}`,
    close: async () => {
      clearInterval(heartbeat);
      clearTimeout(reloadTimer);
      for (const w of watchers) w.close();
      for (const res of clients) res.end();
      clients.clear();
      await ctx?.dispose();
      served.server.closeAllConnections();
      await closeServer(served.server);
      if (dir) await rm(dir, { recursive: true, force: true });
    },
  };
}
