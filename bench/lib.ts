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

/** What the automatic check expects of each brief's out.mp4. */
export const SPEC: Record<string, { seconds: number; audio: boolean }> = {
  text: { seconds: 8, audio: false },
  three: { seconds: 6, audio: false },
  scenes: { seconds: 12, audio: true },
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

/** The automatic part of judging: does out.mp4 exist and match the brief? */
export function check(project: string, task: string) {
  const file = join(project, "out.mp4");
  if (!existsSync(file)) return { exists: false, pass: false, reasons: ["no out.mp4"] };
  const spec = SPEC[task]!;
  const reasons: string[] = [];
  try {
    const p = ffprobe(file);
    const v = p.streams.find((s) => s.codec_type === "video");
    const a = p.streams.find((s) => s.codec_type === "audio");
    const dur = Number(p.format.duration);
    const [n, d] = String(v?.r_frame_rate ?? "0/1").split("/").map(Number);
    if (!v) reasons.push("no video stream");
    if (v && (v.width !== 1920 || v.height !== 1080)) reasons.push(`size ${v.width}x${v.height}`);
    if (Math.abs(n! / d! - 30) > 0.01) reasons.push(`fps ${v?.r_frame_rate}`);
    // One frame of slack each way; containers round durations.
    if (Math.abs(dur - spec.seconds) > 1 / 30 + 0.02) reasons.push(`duration ${dur}`);
    if (spec.audio && !a) reasons.push("no audio stream");
    if (!spec.audio && a) reasons.push("unexpected audio stream");
    return { exists: true, pass: reasons.length === 0, reasons, duration: dur, width: v?.width, height: v?.height, fps: v?.r_frame_rate, audio: !!a };
  } catch (e) {
    return { exists: true, pass: false, reasons: [`ffprobe failed: ${String(e).slice(0, 200)}`] };
  }
}
