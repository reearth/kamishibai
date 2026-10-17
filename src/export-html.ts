// The HTML file `kamishibai export` writes, for a canvas reel or a page:
// a host element, the data the player reads, and one module script.
// ------------------------------------------------------------------
import { readFile, writeFile, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { applyDucking, type AudioClip } from "./audio.ts";
import { assertFfmpeg, mixAudio, transcodeAudio } from "./ffmpeg.ts";
import { prepareAudio, resolveAudioSrc } from "./render.ts";

export interface ExportHtml {
  out: string;
  title: string;
  /** no frame around the player, a transparent page (for an iframe) */
  bare: boolean;
  /** read by the player and the prelude from #kamishibai-data */
  data: unknown;
  /** the bundled module */
  js: string;
  /** a page reel draws into #kamishibai-root */
  pageRoot?: boolean;
}

/** Write the file; returns its size in bytes. */
export async function writeExportHtml(o: ExportHtml): Promise<number> {
  // In a <script> element, "</" must not appear: escape "<" in the data and "</script" in the code.
  const json = JSON.stringify(o.data).replace(/</g, "\\u003c");
  const title = o.title.replace(/[<&]/g, (c) => (c === "<" ? "&lt;" : "&amp;"));
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>html,body{margin:0;height:100%;background:${o.bare ? "transparent" : "#e7e5df"}}#kamishibai{position:fixed;inset:${o.bare ? "0" : "16px"}}</style>
</head>
<body>
<div id="kamishibai"></div>${o.pageRoot ? `\n<div id="kamishibai-root"></div>` : ""}
<script type="application/json" id="kamishibai-data">${json}</script>
<script type="module">${o.js.replace(/<\/script/gi, "<\\/script")}</script>
</body>
</html>
`;
  await writeFile(resolve(o.out), html);
  return (await stat(resolve(o.out))).size;
}

const AUDIO_MIME: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".mp4": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".opus": "audio/ogg",
  ".webm": "audio/webm",
  ".flac": "audio/flac",
};

/** Formats every current browser's decodeAudioData reads; others (AIFF, CAF…) are re-encoded. */
const DECODABLE = new Set([".mp3", ".m4a", ".mp4", ".aac", ".wav", ".ogg", ".oga", ".opus", ".webm", ".flac"]);

export interface ExportedSound {
  /** mix: one track the length of the reel, as a data: URL */
  soundtrack?: string;
  /** live: the clips, played with Web Audio, and their files by key */
  liveAudio?: { clips: AudioClip[]; files: Record<string, string> };
  bytes: number;
}

/**
 * The reel's sound for an exported file. "mix" mixes the clips into one AAC
 * track with ffmpeg, as for an mp4. "live" carries each file once, with the
 * clips' timing and levels (ducking already turned into gain keyframes), for
 * the player to schedule. Live needs ffmpeg only to check the clips; without
 * it, they are taken as they are.
 */
export async function exportSound(o: {
  clips: AudioClip[];
  mode: "mix" | "live";
  durationMs: number;
  publicDir?: string;
  bitrate?: string;
  tmp: string;
  log: (msg: string) => void;
}): Promise<ExportedSound> {
  if (!o.clips.length) return { bytes: 0 };
  let kept: AudioClip[];
  if (o.mode === "mix") {
    await assertFfmpeg();
    kept = await prepareAudio(o.clips, o.publicDir, o.durationMs, o.log);
  } else {
    const probe = await assertFfmpeg().then(
      () => true,
      () => false,
    );
    if (probe) kept = await prepareAudio(o.clips, o.publicDir, o.durationMs, o.log);
    else {
      o.log(`  (no ffprobe: clips are kept unchecked, and ducking uses only the lengths they declare)`);
      kept = applyDucking(
        o.clips.filter((c) => c.src !== "").map((c) => ({ ...c, src: resolveAudioSrc(c.src, o.publicDir) })),
        { reelMs: o.durationMs },
      );
    }
  }
  if (!kept.length) return { bytes: 0 };

  if (o.mode === "mix") {
    const m4a = join(o.tmp, "soundtrack.m4a");
    o.log(`Mixing ${kept.length} audio clip(s) into one track…`);
    await mixAudio({ clips: kept, out: m4a, durationMs: o.durationMs, bitrate: o.bitrate });
    const bytes = await readFile(m4a);
    return { soundtrack: `data:audio/mp4;base64,${bytes.toString("base64")}`, bytes: bytes.length };
  }

  // Each file once, under a key, so no local path goes in the file; a URL stays a URL.
  // A format a browser can't decode (such as macOS say's AIFF) is re-encoded as AAC.
  const files: Record<string, string> = {};
  const keys = new Map<string, string>();
  const ffmpeg = await assertFfmpeg().then(
    () => true,
    () => false,
  );
  let bytes = 0;
  for (const c of kept) {
    if (keys.has(c.src) || /^https?:\/\//i.test(c.src)) continue;
    let file = c.src;
    let ext = extname(file).toLowerCase();
    if (!DECODABLE.has(ext)) {
      if (!ffmpeg) {
        o.log(`  (skipping ${c.src}: browsers can't decode ${ext || "it"}, and there is no ffmpeg to re-encode it)`);
        continue;
      }
      const out = join(o.tmp, `audio-${keys.size}.m4a`);
      await transcodeAudio({ src: file, out, bitrate: o.bitrate });
      file = out;
      ext = ".m4a";
    }
    const key = `audio-${keys.size}${ext}`;
    keys.set(c.src, key);
    const body = await readFile(file);
    bytes += body.length;
    files[key] = `data:${AUDIO_MIME[ext] ?? "application/octet-stream"};base64,${body.toString("base64")}`;
  }
  o.log(`Embedding ${keys.size} audio file(s) to play live (${(bytes / 1024).toFixed(0)} KB)…`);
  const clips = kept.filter((c) => keys.has(c.src) || /^https?:\/\//i.test(c.src)).map((c) => ({ ...c, src: keys.get(c.src) ?? c.src }));
  return { liveAudio: { clips, files }, bytes };
}
