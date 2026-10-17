// Shared by the runners: where things live, the environment a render runs
// in, the automatic check on out.mp4, and frame hashes.
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** This directory. */
export const BENCH = dirname(fileURLToPath(import.meta.url));
/** What setup.sh builds: the packed kamishibai, agent templates, warm homes. */
export const WORK = join(BENCH, ".work");
export const RESULTS = join(BENCH, "results");
/** The warm HOME each tool renders with (a clone of the agents' home seed). */
export const toolHome = (tool: string) => join(WORK, "home", tool);

export const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

/** One video a brief asks for. */
type Output = { file: string; width: number; height: number };
const WIDE: Output = { file: "out.mp4", width: 1920, height: 1080 };

/**
 * What the automatic check expects of each brief's videos: an exact length
 * (`seconds`), or, when the narration sets it, a range (`range`) that every
 * output shares.
 */
export const SPEC: Record<string, { seconds: number; range?: [number, number]; audio: boolean; outputs: Output[] }> = {
  text: { seconds: 8, audio: false, outputs: [WIDE] },
  three: { seconds: 6, audio: false, outputs: [WIDE] },
  scenes: { seconds: 12, audio: true, outputs: [WIDE] },
  // About 30 s of speech from `say -v Samantha`, plus the pauses.
  explainer: { seconds: 38, range: [30, 50], audio: true, outputs: [WIDE, { file: "out-tall.mp4", width: 1080, height: 1920 }] },
};

/** A minimal environment: the tool's own HOME, the shared npm download cache,
 *  and no telemetry. */
export function renderEnv(home: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    PATH: process.env.PATH!,
    HOME: home,
    LANG: "en_US.UTF-8",
    npm_config_cache: process.env.npm_config_cache ?? join(homedir(), ".npm"),
    DO_NOT_TRACK: "1",
    HYPERFRAMES_TELEMETRY: "0",
    DISABLE_TELEMETRY: "1",
    ...extra,
  };
}

/** Run a shell command; resolve with its exit code, wall time and output. */
export function runCommand(cmd: string, cwd: string, env: Record<string, string>, timeoutMin: number) {
  return new Promise<{ exitCode: number | null; wallMs: number; log: string }>((resolve) => {
    const t0 = performance.now();
    let log = "";
    const child = spawn("sh", ["-c", cmd], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (d) => (log += d));
    child.stderr.on("data", (d) => (log += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMin * 60_000);
    child.on("exit", (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, wallMs: performance.now() - t0, log });
    });
  });
}

/** Copy a directory: an APFS clone where it can (near-instant, no space),
 *  a plain copy elsewhere. */
export function cloneDir(src: string, dst: string) {
  try {
    execFileSync("cp", ["-cR", src, dst], { stdio: "ignore" });
  } catch {
    execFileSync("cp", ["-R", src, dst]);
  }
}

/** md5 of every decoded video frame (or PNG of a f%06d.png sequence), in order. */
export function frameMd5s(input: string): string[] {
  const out = execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", input, "-map", "0:v", "-f", "framemd5", "-"], { encoding: "utf8", maxBuffer: 64 * 2 ** 20 });
  return out.split("\n").filter((l) => l && !l.startsWith("#")).map((l) => l.split(",").pop()!.trim());
}

function ffprobe(file: string) {
  const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height,r_frame_rate,nb_frames:format=duration", "-of", "json", file], { encoding: "utf8" });
  return JSON.parse(out) as { streams: any[]; format: { duration: string } };
}

/** The automatic part of judging: do the videos exist and match the brief? */
export function check(project: string, task: string) {
  const spec = SPEC[task]!;
  const reasons: string[] = [];
  const files: Record<string, unknown>[] = [];
  const durations: number[] = [];
  for (const o of spec.outputs) {
    const file = join(project, o.file);
    const at = spec.outputs.length > 1 ? `${o.file}: ` : "";
    if (!existsSync(file)) {
      reasons.push(`no ${o.file}`);
      continue;
    }
    try {
      const p = ffprobe(file);
      const v = p.streams.find((s) => s.codec_type === "video");
      const a = p.streams.find((s) => s.codec_type === "audio");
      const dur = Number(p.format.duration);
      const [n, d] = String(v?.r_frame_rate ?? "0/1").split("/").map(Number);
      if (!v) reasons.push(`${at}no video stream`);
      if (v && (v.width !== o.width || v.height !== o.height)) reasons.push(`${at}size ${v.width}x${v.height}`);
      if (Math.abs(n! / d! - 30) > 0.01) reasons.push(`${at}fps ${v?.r_frame_rate}`);
      // One frame of slack each way; containers round durations.
      if (spec.range ? dur < spec.range[0] || dur > spec.range[1] : Math.abs(dur - spec.seconds) > 1 / 30 + 0.02) reasons.push(`${at}duration ${dur}`);
      if (spec.audio && !a) reasons.push(`${at}no audio stream`);
      if (!spec.audio && a) reasons.push(`${at}unexpected audio stream`);
      durations.push(dur);
      files.push({ file: o.file, duration: dur, width: v?.width, height: v?.height, fps: v?.r_frame_rate, audio: !!a });
    } catch (e) {
      reasons.push(`${at}ffprobe failed: ${String(e).slice(0, 200)}`);
    }
  }
  // Outputs of one brief are the same reel in another shape: the same length.
  if (durations.length > 1 && Math.max(...durations) - Math.min(...durations) > 2 / 30 + 0.02) reasons.push(`lengths differ: ${durations.join(", ")}`);
  const exists = files.length > 0;
  const first = files[0] ?? {};
  return { exists, pass: reasons.length === 0 && files.length === spec.outputs.length, reasons, ...first, outputs: files };
}
