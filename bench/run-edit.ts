// Render again after an edit: how long does it take after a small change?
// ------------------------------------------------------------------
// The same 86 s reel (edit/spec.json) in each tool (edit/<tool>/). Each rep
// starts from a fresh copy of every project, renders it (step "base"), then
// applies a sequence of edits to its spec.json and renders again after each:
//   heading  one scene's heading text              (about one scene of frames)
//   accent   one scene's accent colour             (about one scene)
//   timing   one scene's bullets start 0.5 s later (about 2.5 s of frames)
//   audio    the music's fade-out, 1.5 s → 3 s     (no frames)
//   global   the text colour everywhere            (every frame)
// Edits accumulate, as in a real revision loop.
//
// Conditions: kamishibai with no cache (kamishibai-full), kamishibai with
// --incremental and a frames dir kept across the edits (kamishibai-inc),
// Remotion and HyperFrames with their defaults. HyperFrames' HTML is written
// from spec.json before each render (edit/gen-hyperframes.mjs, not timed).
// Within each step the condition order rotates.
//
// Besides wall time, each render's decoded frames are hashed, so we know how
// many frames each edit really changed (kamishibai-full against the step
// before). The incremental run's captured PNGs are checked against the
// uncached run's, pixel for pixel (their mp4s differ: an incremental render
// encodes in segments).
//
//   node run-edit.ts [--reps 3] [--label edit] [--conds …]
// ------------------------------------------------------------------
import { execFileSync } from "node:child_process";
import { readFile, writeFile, appendFile, rm, mkdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { loadavg, cpus } from "node:os";
import { join, dirname } from "node:path";
import { parseArgs } from "node:util";
import { BENCH, RESULTS, WORK, cloneDir, frameMd5s, list, renderEnv, runCommand, toolHome } from "./lib.ts";

const EDIT = join(BENCH, "edit");
const { values: args } = parseArgs({
  options: {
    reps: { type: "string", default: "3" },
    label: { type: "string", default: "edit" },
    conds: { type: "string", default: "kamishibai-full,kamishibai-inc,remotion,hyperframes" },
    // .noindex: Spotlight and media analysis skip it on macOS.
    "work-dir": { type: "string", default: join(WORK, "edit.noindex") },
    "timeout-min": { type: "string", default: "20" },
  },
});

interface Cond { id: string; tool: string; cmd: string }
const ALL: Cond[] = [
  // -f keeps the uncached run's PNGs too (without -i every frame is captured
  // again), so the incremental run's frames can be checked against them.
  { id: "kamishibai-full", tool: "kamishibai", cmd: "npx kamishibai render reel.tsx -o out.mp4 -f frames" },
  { id: "kamishibai-inc", tool: "kamishibai", cmd: "npx kamishibai render reel.tsx -o out.mp4 -f frames -i" },
  { id: "remotion", tool: "remotion", cmd: "npx remotion render Long out.mp4" },
  { id: "hyperframes", tool: "hyperframes", cmd: "npx -y hyperframes@0.8.143 render -o out.mp4" },
];
const conds = ALL.filter((c) => list(args.conds!).includes(c.id));

type Spec = { fps: number; sceneMs: number; crossfadeMs: number; textColor: string; fadeOutMs: number; scenes: { heading: string; accent: string; bulletStartMs: number }[] };
const STEPS: { id: string; edit: (s: Spec) => void }[] = [
  { id: "base", edit: () => {} },
  { id: "heading", edit: (s) => void (s.scenes[4]!.heading = "Edit once, render again") },
  { id: "accent", edit: (s) => void (s.scenes[1]!.accent = "#D7263D") },
  { id: "timing", edit: (s) => void (s.scenes[6]!.bulletStartMs = 900) },
  { id: "audio", edit: (s) => void (s.fadeOutMs = 3000) },
  { id: "global", edit: (s) => void (s.textColor = "#FFD8A8") },
];

const baseSpec: Spec = JSON.parse(await readFile(join(EDIT, "spec.json"), "utf8"));
const n = baseSpec.scenes.length;
const FRAMES = Math.round(((n * baseSpec.sceneMs - (n - 1) * baseSpec.crossfadeMs) / 1000) * baseSpec.fps);

const diff = (a?: string[], b?: string[]) => (a && b ? a.reduce((m, x, i) => m + (x !== b[i] ? 1 : 0), Math.abs(a.length - b.length)) : undefined);

/** A fresh project for one condition: the tool's sources, the spec, the music. */
async function fresh(c: Cond, dir: string) {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dirname(dir), { recursive: true });
  cloneDir(join(EDIT, c.tool), dir);
  await rm(join(dir, "frames"), { recursive: true, force: true });
  await rm(join(dir, "out.mp4"), { force: true });
  await copyFile(join(EDIT, "spec.json"), join(dir, "spec.json"));
  const music = join(dir, c.tool === "remotion" ? "public" : "assets");
  await mkdir(music, { recursive: true });
  await copyFile(join(EDIT, "bgm.mp3"), join(music, "bgm.mp3"));
}

async function render(c: Cond, dir: string) {
  await rm(join(dir, "out.mp4"), { force: true });
  if (c.tool === "hyperframes") execFileSync("node", [join(EDIT, "gen-hyperframes.mjs"), dir]);
  const r = await runCommand(c.cmd, dir, renderEnv(toolHome(c.tool)), Number(args["timeout-min"]));
  const out = join(dir, "out.mp4");
  return { ...r, md5s: existsSync(out) ? frameMd5s(out) : undefined, loadavg: loadavg(), log: r.log.slice(-1500) };
}

for (const c of conds) if (!existsSync(toolHome(c.tool))) throw new Error(`no warm home for ${c.tool}: run setup.sh first`);
await mkdir(RESULTS, { recursive: true });
const file = join(RESULTS, `${args.label}.jsonl`);
await writeFile(file, JSON.stringify({ type: "env", date: new Date().toISOString(), cpu: cpus()[0]?.model, cores: cpus().length, node: process.version, args, conds, steps: STEPS.map((s) => s.id), frames: FRAMES }) + "\n");

// One unmeasured warm-up render per condition (bundler and browser caches).
const workRoot = args["work-dir"]!;
for (const c of conds) {
  const dir = join(workRoot, "warm", c.id);
  await fresh(c, dir);
  const r = await render(c, dir);
  console.log(`warm ${c.id.padEnd(16)} ${(r.wallMs / 1000).toFixed(1)}s exit ${r.exitCode}`);
}

for (let rep = 0; rep < Number(args.reps); rep++) {
  const dirs = new Map<string, string>();
  for (const c of conds) {
    const dir = join(workRoot, `r${rep}`, c.id);
    await fresh(c, dir);
    dirs.set(c.id, dir);
  }
  let prevFull: string[] | undefined;
  for (const [si, step] of STEPS.entries()) {
    const k = (rep + si) % conds.length;
    const order = [...conds.slice(k), ...conds.slice(0, k)];
    const md5s = new Map<string, string[] | undefined>();
    const pngs = new Map<string, string[]>();
    for (const c of order) {
      const dir = dirs.get(c.id)!;
      const specFile = join(dir, "spec.json");
      const spec = JSON.parse(await readFile(specFile, "utf8"));
      step.edit(spec);
      await writeFile(specFile, JSON.stringify(spec, null, 2) + "\n");
      const r = await render(c, dir);
      md5s.set(c.id, r.md5s);
      if (c.tool === "kamishibai") pngs.set(c.id, frameMd5s(join(dir, "frames", "f%06d.png")));
      const ok = r.exitCode === 0 && r.md5s?.length === FRAMES;
      await appendFile(file, JSON.stringify({ type: "run", rep, step: step.id, cond: c.id, tool: c.tool, wallMs: r.wallMs, exitCode: r.exitCode, frames: r.md5s?.length, ok, loadavg: r.loadavg, log: c.id === "kamishibai-inc" || !ok ? r.log : undefined }) + "\n");
      console.log(`r${rep} ${step.id.padEnd(8)} ${c.id.padEnd(16)} ${(r.wallMs / 1000).toFixed(1).padStart(6)}s ${ok ? "ok" : `FAIL exit ${r.exitCode} frames ${r.md5s?.length}`}`);
    }
    const full = md5s.get("kamishibai-full");
    await appendFile(
      file,
      JSON.stringify({
        type: "check", rep, step: step.id,
        changedFrames: diff(prevFull, full), // frames this edit changed (uncached kamishibai)
        incVsFull: diff(pngs.get("kamishibai-inc"), pngs.get("kamishibai-full")), // frames whose incremental PNG differs from the uncached one
      }) + "\n",
    );
    prevFull = full;
  }
}
console.log(`wrote ${file}`);
