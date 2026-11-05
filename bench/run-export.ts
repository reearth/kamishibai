// How long `kamishibai export` takes for a kit reel, by length, and how much
// of it is painting every frame (export paints each frame once, small, to
// learn which characters each font draws).
// ------------------------------------------------------------------
// Writes kit reels of the given lengths into .work/export/ (a scene every
// 5 s: a heading and a word, a list, a number that counts, a pair of cards,
// each with a burned caption), and exports each with this checkout's
// dist/cli.js (run `pnpm build` first), `--reps` times after one warm-up.
// Each run appends a line to results/<label>.jsonl: its wall time, the
// frames painted, the seconds export reported painting them, and the file's
// size.
//
//   node run-export.ts [--lengths 30,150,600] [--reps 3] [--label export]
// ------------------------------------------------------------------
import { appendFile, mkdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { BENCH, RESULTS, WORK, list, runCommand } from "./lib.ts";

const { values: args } = parseArgs({
  options: {
    lengths: { type: "string", default: "30,150,600" },
    reps: { type: "string", default: "3" },
    label: { type: "string", default: "export" },
  },
});

const repo = join(BENCH, "..");
const cli = join(repo, "dist", "cli.js");
if (!existsSync(cli)) throw new Error("no dist/cli.js: run pnpm build in the repository first");
const font = join(repo, "examples", "kit", "fonts", "Geist.ttf");
const dir = join(WORK, "export");
await mkdir(dir, { recursive: true });
await mkdir(RESULTS, { recursive: true });

const WORDS = ["accommodation", "headquarters", "receipt", "schedule", "department", "available", "temperature", "appointment"];

/** A kit reel `seconds` long: a scene every 5 s, four kinds in turn, each with a caption burned in. */
function reel(seconds: number): string {
  const n = Math.max(1, Math.round(seconds / 5));
  const scenes = Array.from({ length: n }, (_, i) => {
    const w = WORDS[i % WORDS.length]!;
    const say = JSON.stringify(`Scene ${i + 1}: ${w}.`);
    switch (i % 4) {
      case 0:
        return `  - { ms: 5000, say: ${say}, parts: [{ type: title, text: "Word ${i + 1}" }, { type: text, role: display, text: ${w} }] }`;
      case 1:
        return `  - { ms: 5000, say: ${say}, kata: points, title: "How to use it", items: ["Hear it", "Say it back", "Use it in a sentence"], at: ${i % 3} }`;
      case 2:
        return `  - { ms: 5000, say: ${say}, kata: stat, title: "Words so far", value: ${i * 7 + 13}, unit: words }`;
      default:
        return `  - { ms: 5000, say: ${say}, kata: compare, title: ${JSON.stringify(w)}, left: { label: Before, body: "Read it aloud" }, right: { label: After, body: "Read it at a glance" } }`;
    }
  });
  return [
    "kit: 1",
    `fonts: [{ family: Geist, src: ${JSON.stringify(font)}, weight: "100 900" }]`,
    "theme: { fonts: { sans: Geist, mono: Geist } }",
    "captions: burn",
    "scenes:",
    ...scenes,
    "",
  ].join("\n");
}

type Row = { label: string; seconds: number; rep: number; wallS: number; frames: number; paintS: number; bytes: number; load1: number };
const rows: Row[] = [];
for (const seconds of list(args.lengths).map(Number)) {
  const file = join(dir, `reel-${seconds}s.yaml`);
  const out = join(dir, `reel-${seconds}s.html`);
  await writeFile(file, reel(seconds));
  for (let rep = 0; rep <= Number(args.reps); rep++) {
    const load1 = loadavg()[0]!;
    const r = await runCommand(`node ${JSON.stringify(cli)} export ${JSON.stringify(file)} -o ${JSON.stringify(out)}`, dir, process.env as Record<string, string>, 30);
    if (r.exitCode !== 0) throw new Error(`export failed for ${seconds} s:\n${r.log}`);
    // Each view's line: "  painted 4500 frame(s) in 0.41 s".
    const painted = [...r.log.matchAll(/painted (\d+) frame\(s\) in ([\d.]+) s/g)];
    const row: Row = {
      label: args.label,
      seconds,
      rep,
      wallS: r.wallMs / 1000,
      frames: painted.reduce((n, m) => n + Number(m[1]), 0),
      paintS: painted.reduce((n, m) => n + Number(m[2]), 0),
      bytes: (await stat(out)).size,
      load1,
    };
    // Rep 0 warms the caches up, and is left out.
    if (rep === 0) continue;
    rows.push(row);
    await appendFile(join(RESULTS, `${args.label}.jsonl`), JSON.stringify(row) + "\n");
    console.log(`${seconds} s, rep ${rep}: ${row.wallS.toFixed(2)} s in all, ${row.frames} frames painted in ${row.paintS.toFixed(2)} s, ${(row.bytes / 1024).toFixed(0)} KB`);
  }
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
console.log("\n| Reel | Frames painted | Export | Painting | File |\n|---|---:|---:|---:|---:|");
for (const seconds of [...new Set(rows.map((r) => r.seconds))]) {
  const rs = rows.filter((r) => r.seconds === seconds);
  const [wall, paint] = [median(rs.map((r) => r.wallS)), median(rs.map((r) => r.paintS))];
  console.log(`| ${seconds} s | ${rs[0]!.frames.toLocaleString("en-US")} | ${wall.toFixed(1)} s | ${paint.toFixed(1)} s (${Math.round((paint / wall) * 100)}%) | ${(rs[0]!.bytes / 1024).toFixed(0)} KB |`);
}
