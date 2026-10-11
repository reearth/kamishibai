// Render speed: render the reference implementation of each brief with each
// tool, under the same conditions, and time it.
// ------------------------------------------------------------------
// The implementations live in speed/<tool>/<task>/, each with a speed.json
// naming its render commands:
//   default  the tool's own defaults (its parallelism, its frame format)
//   single   one capture worker, so per-frame pipeline cost is compared
//            without each tool's different parallelism policy
// Every run is a fresh process, after one unmeasured warm-up per condition
// (first renders pay for bundler, font and shader caches), in ABBA order
// across all conditions, so thermal drift and background load spread evenly.
// HOME is the tool's warm home from setup.sh.
//
// Besides time, each run records the output check (lib.ts) and the decoded
// frames' md5, so determinism across runs is measured, not assumed.
//
//   node run-speed.ts [--tools …] [--tasks …] [--configs default,single]
//                     [--reps 5] [--warmup 1] [--label speed]
// ------------------------------------------------------------------
import { readFile, writeFile, appendFile, rm, mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { loadavg, cpus } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { BENCH, RESULTS, check, frameMd5s, list, renderEnv, runCommand, toolHome } from "./lib.ts";

const { values: args } = parseArgs({
  options: {
    tools: { type: "string", default: "kamishibai,remotion,hyperframes" },
    tasks: { type: "string", default: "text,three,scenes" },
    configs: { type: "string", default: "default,single" },
    reps: { type: "string", default: "5" },
    label: { type: "string", default: "speed" },
    "timeout-min": { type: "string", default: "15" },
    /** unmeasured runs per condition first; logged with rep -1, and
     *  summarize.ts drops them */
    warmup: { type: "string", default: "1" },
  },
});

interface Cond { id: string; tool: string; task: string; config: string; dir: string; cmd: string }

async function conditions(): Promise<Cond[]> {
  const out: Cond[] = [];
  for (const tool of list(args.tools!))
    for (const task of list(args.tasks!)) {
      const dir = join(BENCH, "speed", tool, task);
      const spec = JSON.parse(await readFile(join(dir, "speed.json"), "utf8"));
      for (const config of list(args.configs!)) {
        const cmd = spec.render?.[config];
        if (!cmd) throw new Error(`${tool}/${task}: speed.json has no render.${config}`);
        out.push({ id: `${tool}|${task}|${config}`, tool, task, config, dir, cmd });
      }
    }
  return out;
}

async function runOnce(c: Cond) {
  const out = join(c.dir, "out.mp4");
  await rm(out, { force: true });
  const r = await runCommand(c.cmd, c.dir, renderEnv(toolHome(c.tool)), Number(args["timeout-min"]));
  const ok = check(c.dir, c.task);
  return {
    wallMs: r.wallMs,
    exitCode: r.exitCode,
    check: ok,
    bytes: existsSync(out) ? (await stat(out)).size : 0,
    // One hash of the whole decoded stream: equal across runs = deterministic.
    md5: ok.exists ? createHash("md5").update(frameMd5s(out).join("\n")).digest("hex") : undefined,
    loadavg: loadavg(),
    logTail: r.exitCode === 0 ? undefined : r.log.slice(-2000),
  };
}

const conds = await conditions();
for (const c of conds) if (!existsSync(toolHome(c.tool))) throw new Error(`no warm home for ${c.tool}: run setup.sh first`);
await mkdir(RESULTS, { recursive: true });
const file = join(RESULTS, `${args.label}.jsonl`);
await writeFile(
  file,
  JSON.stringify({ type: "env", date: new Date().toISOString(), cpu: cpus()[0]?.model, cores: cpus().length, node: process.version, args, conds }) + "\n",
);
console.log(`${conds.length} conditions × ${args.reps} reps (ABBA), ${args.warmup} warm-up each`);
for (let w = 0; w < Number(args.warmup); w++) {
  for (const c of conds) {
    const res = await runOnce(c);
    await appendFile(file, JSON.stringify({ type: "run", ...c, rep: -1, ...res }) + "\n");
    console.log(`warm ${c.id.padEnd(30)} ${(res.wallMs / 1000).toFixed(1).padStart(6)}s ${res.check.pass ? "ok" : "FAIL"}`);
  }
}
for (let r = 0; r < Number(args.reps); r++) {
  for (const c of r % 2 === 0 ? conds : [...conds].reverse()) {
    const res = await runOnce(c);
    await appendFile(file, JSON.stringify({ type: "run", ...c, rep: r, ...res }) + "\n");
    console.log(
      `r${r} ${c.id.padEnd(30)} ${(res.wallMs / 1000).toFixed(1).padStart(6)}s ${res.check.pass ? "ok" : `FAIL ${res.check.reasons.join("; ")}`} ${res.md5?.slice(0, 8) ?? ""}`,
    );
  }
}
console.log(`wrote ${file}`);
