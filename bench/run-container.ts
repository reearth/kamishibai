// Render a kit reel on the CPU inside a Linux container, with no browser, at
// a few CPU limits: how long a sandbox like Cloudflare's takes to make a video.
// ------------------------------------------------------------------
// Builds bench/container/Dockerfile (from .work/kamishibai.tgz, so run
// setup.sh first), then renders examples/kit/reel.yaml at 1080p with
// `docker run --cpus <n>`, `--reps` times each, after one warm-up. Each run
// appends a line to results/<label>.jsonl with its wall time, and the video's
// check (size, frame rate, audio) goes in with it.
//
//   node run-container.ts [--cpus 1,2,4] [--reps 3] [--platform linux/amd64] [--label container]
// ------------------------------------------------------------------
import { execFileSync } from "node:child_process";
import { appendFile, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { BENCH, RESULTS, WORK, list, runCommand } from "./lib.ts";

const { values: args } = parseArgs({
  options: {
    cpus: { type: "string", default: "1,2,4" },
    reps: { type: "string", default: "3" },
    platform: { type: "string" },
    label: { type: "string", default: "container" },
    reel: { type: "string", default: "reel/reel.yaml" },
  },
});

if (!existsSync(join(WORK, "kamishibai.tgz"))) throw new Error("no .work/kamishibai.tgz: run setup.sh first");
const repo = join(BENCH, "..");
const tag = `kamishibai-bench-cpu${args.platform ? `-${args.platform.replace(/\W/g, "-")}` : ""}`;
console.log(`building ${tag}…`);
execFileSync("docker", ["build", ...(args.platform ? ["--platform", args.platform] : []), "-f", "bench/container/Dockerfile", "-t", tag, "."], { cwd: repo, stdio: "inherit" });

const out = join(RESULTS, `${args.label}-out`);
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const file = join(RESULTS, `${args.label}.jsonl`);
await writeFile(file, "");
const arch = execFileSync("docker", ["image", "inspect", tag, "--format", "{{.Architecture}}"], { encoding: "utf8" }).trim();
await appendFile(file, JSON.stringify({ type: "env", date: new Date().toISOString(), tag, arch, reel: args.reel, host: execFileSync("uname", ["-mrs"], { encoding: "utf8" }).trim() }) + "\n");

const env = { PATH: process.env.PATH!, HOME: process.env.HOME! };
for (const cpus of list(args.cpus!)) {
  for (let rep = -1; rep < Number(args.reps); rep++) {
    const name = `cpus${cpus}-r${rep}.mp4`;
    const cmd = `docker run --rm --cpus ${cpus} ${args.platform ? `--platform ${args.platform}` : ""} -v "${out}:/out" ${tag} render ${args.reel} -o /out/${name}`;
    const r = await runCommand(cmd, repo, env, 30);
    const ok = r.exitCode === 0 && existsSync(join(out, name));
    if (rep < 0) {
      console.log(`warm cpus ${cpus}: ${(r.wallMs / 1000).toFixed(1)} s ${ok ? "" : "FAIL"}`);
      if (!ok) console.log(r.log.slice(-2000));
      continue;
    }
    const probe = ok ? JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height,r_frame_rate:format=duration", "-of", "json", join(out, name)], { encoding: "utf8" })) : undefined;
    await appendFile(file, JSON.stringify({ type: "container", cpus: Number(cpus), rep, wallMs: r.wallMs, ok, probe }) + "\n");
    console.log(`cpus ${cpus} r${rep}: ${(r.wallMs / 1000).toFixed(1)} s ${ok ? "" : "FAIL"}`);
  }
}
console.log(`wrote ${file}`);
