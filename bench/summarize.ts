// Summarize results: agent trials (run-agents.ts), render speed
// (run-speed.ts) and rendering again after edits (run-edit.ts). Pass one or
// more results/*.jsonl files; the line types decide which tables are printed.
//
//   node summarize.ts results/agents.jsonl results/speed.jsonl results/edit.jsonl
//
// Trials: per tool × task × skill condition, the success rate (automatic
// check) and the median and IQR of tokens, cost, turns, wall time, image reads
// and renders. "$/success" divides ALL spend (failed trials included) by the
// number of passing trials, so a tool that fails cheaply gains nothing.
// Tokens are reported raw (input + cache read + cache write + output) and as
// cost, because prompt caching makes the two diverge.
// Speed: per tool × task × config, the median wall time with min–max over
// reps, and how many distinct outputs the reps produced (1 = deterministic).
// Edit: per step × condition, the median wall time, and whether the
// incremental render's frames matched the uncached one's.
import { readFile } from "node:fs/promises";

const lines = (await Promise.all(process.argv.slice(2).map((f) => readFile(f, "utf8"))))
  .flatMap((t) => t.split("\n").filter(Boolean))
  .map((l) => JSON.parse(l));

const q = (xs: number[], p: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * p;
  return s[Math.floor(i)] + (s[Math.ceil(i)] - s[Math.floor(i)]) * (i - Math.floor(i));
};
const med = (xs: number[]) => q(xs, 0.5);
const iqr = (xs: number[], f = (n: number) => n.toFixed(0)) => `${f(med(xs))} [${f(q(xs, 0.25))}–${f(q(xs, 0.75))}]`;
const k = (n: number) => `${(n / 1000).toFixed(0)}k`;
const group = <T,>(xs: T[], key: (x: T) => string) => {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const kk = key(x);
    if (!m.has(kk)) m.set(kk, []);
    m.get(kk)!.push(x);
  }
  return m;
};

// ---- trials -------------------------------------------------------------
const trials = lines.filter((l) => l.type === "trial");
if (trials.length) {
  const tokens = (t: any) => {
    const u = t.result?.usage ?? {};
    return (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.output_tokens ?? 0);
  };
  const row = (name: string, ts: any[]) => {
    const pass = ts.filter((t) => t.check?.pass).length;
    const cost = ts.map((t) => t.result?.total_cost_usd ?? 0);
    const spend = cost.reduce((a, b) => a + b, 0);
    return [
      name,
      `${pass}/${ts.length}`,
      iqr(ts.map(tokens), k),
      iqr(ts.map((t) => t.result?.usage?.output_tokens ?? 0), k),
      iqr(cost, (n) => `$${n.toFixed(2)}`),
      pass ? `$${(spend / pass).toFixed(2)}` : "-",
      iqr(ts.map((t) => t.result?.num_turns ?? 0)),
      iqr(ts.map((t) => t.wallMs / 60000), (n) => n.toFixed(1)),
      iqr(ts.map((t) => t.imageReads)),
      iqr(ts.map((t) => t.renders)),
      String(ts.filter((t) => t.timedOut).length),
    ].join(" | ");
  };
  const head = "condition | pass | tokens (all) | output tokens | cost | $/success | turns | wall min | image reads | renders | timeouts";
  console.log("## Agent trials — median [IQR]\n");
  console.log(head);
  for (const [name, ts] of [...group(trials, (t) => `${t.tool} · ${t.task} · ${t.skill ? "skill" : "noskill"}`)].sort())
    console.log(row(name, ts));
  console.log("\n## By tool and skill condition (all tasks pooled)\n");
  console.log(head);
  for (const [name, ts] of [...group(trials, (t) => `${t.tool} · ${t.skill ? "skill" : "noskill"}`)].sort()) console.log(row(name, ts));

  // Isolation audit: what each condition's session could actually see.
  console.log("\n## Isolation audit — skills / slash commands visible at init\n");
  for (const [name, ts] of [...group(trials, (t) => `${t.tool} · ${t.skill ? "skill" : "noskill"}`)].sort()) {
    const seen = new Set<string>();
    for (const t of ts) for (const s of [...(t.init?.skills ?? []), ...(t.init?.slash_commands ?? [])]) seen.add(typeof s === "string" ? s : (s.name ?? JSON.stringify(s)));
    const models = new Set(ts.map((t) => t.init?.model));
    console.log(`${name}: model ${[...models].join(",")} · ${[...seen].sort().join(", ") || "(none)"}`);
  }
  // Trials run with bypassPermissions: list every tool call that named a path
  // in the real home (outside the trial dirs and the npm cache).
  const outside = trials.filter((t) => t.outside?.length);
  console.log(`\n## Access outside the trial — ${outside.length ? `${outside.length} trial(s)` : "none"}\n`);
  for (const t of outside) for (const h of t.outside) console.log(`${t.id}: ${h.tool} ${h.path}\n    ${h.input}`);
  // The bare baseline may not use a video tool: list any trial that did.
  const bare = trials.filter((t) => t.tool === "bare");
  if (bare.length) {
    const used = bare.filter((t) => t.videoTools?.length);
    console.log(`\n## Video tools in bare trials — ${used.length ? `${used.length} trial(s)` : "none"}\n`);
    for (const t of used) console.log(`${t.id}: ${t.videoTools.join(", ")}`);
  }
  const failures = trials.filter((t) => !t.check?.pass);
  if (failures.length) {
    console.log("\n## Failed checks\n");
    for (const t of failures) console.log(`${t.id}: ${(t.check?.reasons ?? []).join("; ")}${t.timedOut ? " (timeout)" : ""}${t.result?.subtype && t.result.subtype !== "success" ? ` (${t.result.subtype})` : ""}`);
  }
}

// ---- speed --------------------------------------------------------------
const runs = lines.filter((l) => l.type === "run" && l.config && l.rep >= 0);
if (runs.length) {
  console.log("\n## Render speed — median (min–max) seconds over reps\n");
  console.log("tool | task | config | wall s | pass | distinct outputs | MB");
  for (const [, rs] of [...group(runs, (r) => `${r.task}|${r.tool}|${r.config}`)].sort()) {
    const w = rs.map((r) => r.wallMs / 1000);
    const md5s = new Set(rs.map((r) => r.md5).filter(Boolean));
    console.log(
      [rs[0].tool, rs[0].task, rs[0].config, `${med(w).toFixed(1)} (${Math.min(...w).toFixed(1)}–${Math.max(...w).toFixed(1)})`,
        `${rs.filter((r) => r.check?.pass).length}/${rs.length}`, String(md5s.size), (med(rs.map((r) => r.bytes)) / 2 ** 20).toFixed(1)].join(" | "),
    );
  }
  const loads = runs.map((r) => r.loadavg?.[0]).filter((x) => typeof x === "number");
  console.log(`\n1-min load average during runs: median ${med(loads).toFixed(2)}, max ${Math.max(...loads).toFixed(2)}`);
}

// ---- edit ---------------------------------------------------------------
const edits = lines.filter((l) => l.type === "run" && l.step);
if (edits.length) {
  const steps = [...new Set(edits.map((r) => r.step))];
  const conds = [...new Set(edits.map((r) => r.cond))];
  console.log("\n## Render again after an edit — median (min–max) seconds over reps\n");
  console.log(["step", ...conds, "frames changed", "inc ≠ full"].join(" | "));
  const checks = lines.filter((l) => l.type === "check");
  for (const step of steps) {
    const cells = conds.map((c) => {
      const rs = edits.filter((r) => r.step === step && r.cond === c);
      const w = rs.filter((r) => r.ok).map((r) => r.wallMs / 1000);
      const fails = rs.length - w.length;
      return w.length ? `${med(w).toFixed(1)} (${Math.min(...w).toFixed(1)}–${Math.max(...w).toFixed(1)})${fails ? ` ${fails} failed` : ""}` : "-";
    });
    const cs = checks.filter((c) => c.step === step);
    const changed = [...new Set(cs.map((c) => c.changedFrames ?? "-"))].join("/");
    const inc = cs.map((c) => c.incVsFull).filter((x) => typeof x === "number");
    console.log([step, ...cells, changed, inc.length ? String(Math.max(...inc)) : "-"].join(" | "));
  }
}
