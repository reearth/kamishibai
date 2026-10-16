// Agents: how many tokens (and how much time) does an agent spend making the
// same video with kamishibai, Remotion and HyperFrames?
// ------------------------------------------------------------------
// One trial = one headless Claude Code run that turns a brief's BRIEF.md
// (briefs/<task>/) into out.mp4, starting from a clone of the tool's
// ready-made template (setup.sh). Conditions: tool × task × skill/noskill,
// where `kit` is kamishibai with its kit's optional dependencies installed,
// asked for a kit reel (scenes as data) by name,
// each repeated `reps` times. `--tools bare` adds a baseline with no video
// tool at all: an empty project, noskill only. Within each repetition the order of conditions is shuffled with a
// fixed seed, so drift over the day (API latency, machine load) spreads
// evenly.
//
// Isolation, so the tool is the only thing that differs between trials:
//   - HOME is a fresh clone of .work/home-seed (warm browser caches), so
//     the user's ~/.claude (CLAUDE.md, skills, plugins, hooks, memory) is not
//     there to load, and nothing leaks out. --setting-sources project and
//     --strict-mcp-config keep the rest out. Only Claude Code's built-in
//     skills remain, the same in every condition.
//   - the trial lives outside any git repo, and gets a minimal environment.
//   - noskill trials also pass --disable-slash-commands.
//
// Auth is the user's Claude subscription: a long-lived OAuth token from
// `claude setup-token`, read from --token-file (or CLAUDE_CODE_OAUTH_TOKEN)
// and passed as CLAUDE_CODE_OAUTH_TOKEN. Subscription limits apply, so the
// runner reads every rate_limit_event: a trial cut off by a limit is logged,
// not counted, and retried after the window resets; and the run stops once
// the 7-day window passes --stop-at-weekly, leaving the rest of the quota to
// the user (resume later with --resume).
//
// Every trial appends one line to results/<label>.jsonl as soon as it ends:
// usage and cost from the final `result` event, turn count, tool-use counts
// (image reads, renders, skill loads), the init event's tool/skill list (to
// prove isolation), and the automatic checks on out.mp4. A blind contact
// sheet of each output goes to results/<label>-blind/ for judging later.
//
//   node run-agents.ts --dry-run                   # print the plan only
//   node run-agents.ts --label agents [--reps 5] [--token-file path]
//     [--stop-at-weekly 0.8]
//     [--tools kamishibai,kit,remotion,hyperframes] [--tasks text,three,scenes,explainer]
//     [--skills skill,noskill] [--model claude-opus-5-5]
//     [--budget-usd 20] [--timeout-min 45] [--limit N] [--resume]
// ------------------------------------------------------------------
import { spawn, execFileSync } from "node:child_process";
import { mkdir, writeFile, appendFile, readFile, cp, rm, readdir } from "node:fs/promises";
import { createWriteStream, existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { randomBytes } from "node:crypto";
import { BENCH, RESULTS, SPEC, WORK, check, cloneDir, list, renderEnv } from "./lib.ts";

const { values: args } = parseArgs({
  options: {
    label: { type: "string", default: "agents" },
    reps: { type: "string", default: "5" },
    tools: { type: "string", default: "kamishibai,remotion,hyperframes" },
    tasks: { type: "string", default: "text,three,scenes" },
    skills: { type: "string", default: "skill,noskill" },
    model: { type: "string", default: "claude-opus-5-5" },
    "budget-usd": { type: "string", default: "20" },
    "timeout-min": { type: "string", default: "45" },
    "trials-dir": { type: "string", default: join(tmpdir(), "kamishibai-bench-trials") },
    limit: { type: "string" },
    seed: { type: "string", default: "20261009" },
    "permission-mode": { type: "string", default: "bypassPermissions" },
    resume: { type: "boolean", default: false },
    /** a file holding a `claude setup-token` token (or set CLAUDE_CODE_OAUTH_TOKEN) */
    "token-file": { type: "string" },
    /** stop before a trial once the 7-day subscription window is this full */
    "stop-at-weekly": { type: "string", default: "0.8" },
    "dry-run": { type: "boolean", default: false },
    "keep-trials": { type: "boolean", default: false },
    /** plumbing test: run this shell command (env KB_TOOL, KB_TASK) instead
     *  of claude, in the same isolated trial environment */
    "agent-cmd": { type: "string" },
  },
});

const TOOL_NAMES: Record<string, string> = { kamishibai: "kamishibai", kit: "kamishibai", remotion: "Remotion", hyperframes: "HyperFrames" };
/** What the prompt asks the video to be made with, where it isn't just the tool's name. */
const MADE_WITH: Record<string, string> = { kit: "kamishibai's kit (a kit reel, from `kamishibai/kit`)" };
/** Made for producing video from code: the bare baseline may not use these,
 *  and each bare trial records any it finds in the project afterwards. */
const VIDEO_TOOLS = ["Remotion", "HyperFrames", "kamishibai", "Motion Canvas", "Revideo", "Manim", "editly", "Etro"];
/** npm / pip names to look for in a bare project. */
const VIDEO_PACKAGES = /^(remotion|@remotion\/.*|hyperframes|@hyperframes\/.*|kamishibai|@motion-canvas\/.*|@revideo\/.*|manim|manimgl|editly|etro)$/i;

/** The same words for every tool; only the tool's name changes. "bare" is the
 *  baseline with no video tool: an empty project, where the agent picks its own way.
 *  A brief with one output reads as it always has; one with more names them all. */
const prompt = (tool: string, task: string) => {
  const files = SPEC[task]!.outputs.map((o) => `./${o.file}`);
  const to = files.length === 1 ? files[0] : `${files.slice(0, -1).join(", ")} and ${files.at(-1)}`;
  const done = files.length === 1 ? "out.mp4 matches it" : "they match it";
  return tool === "bare"
    ? `This is an empty project, and ffmpeg is on PATH. ` +
        `Make the video described in BRIEF.md and render it to ${to}, writing the rendering yourself: ` +
        `do not use a tool or framework made for producing video from code (${VIDEO_TOOLS.join(", ")} or the like). ` +
        `Any other library is fine. ` +
        `The brief is final: do not ask questions, make any remaining choices yourself. ` +
        `Check your result against the brief, fix what doesn't match, and stop when ${done}.`
    : `This project is already set up for ${TOOL_NAMES[tool]}, with its dependencies installed. ` +
        `Make the video described in BRIEF.md with ${MADE_WITH[tool] ?? TOOL_NAMES[tool]} and render it to ${to}. ` +
        `The brief is final: do not ask questions, make any remaining choices yourself. ` +
        `Check your result against the brief, fix what doesn't match, and stop when ${done}.`;
};

interface Trial { id: string; tool: string; task: string; skill: boolean; rep: number }

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function plan(): Trial[] {
  const rand = mulberry32(Number(args.seed));
  const out: Trial[] = [];
  for (let rep = 0; rep < Number(args.reps); rep++) {
    const block: Trial[] = [];
    for (const tool of list(args.tools!))
      for (const task of list(args.tasks!))
        for (const s of list(args.skills!)) {
          const skill = s === "skill";
          if (tool === "bare" && skill) continue; // no tool, so no skills
          block.push({ id: `${tool}-${task}-${s}-r${rep}`, tool, task, skill, rep });
        }
    for (let i = block.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [block[i], block[j]] = [block[j], block[i]];
    }
    out.push(...block);
  }
  return args.limit ? out.slice(0, Number(args.limit)) : out;
}

/** 12 evenly spaced frames of each output tiled 4×3 (6×2 for a tall one),
 *  saved under one random name so the judge can't tell the tool; the mapping
 *  is kept separately. */
function contactSheet(project: string, task: string, blindDir: string, seconds: number | undefined): string | undefined {
  const name = randomBytes(6).toString("hex");
  const step = (seconds ?? SPEC[task].seconds) / 12;
  let made = false;
  for (const [i, o] of SPEC[task].outputs.entries()) {
    const file = join(project, o.file);
    if (!existsSync(file)) continue;
    const tall = o.height > o.width;
    const suffix = i === 0 ? "" : `-${o.file.replace(/^out-?|\.mp4$/g, "")}`;
    try {
      execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", file, "-vf", `fps=1/${step},scale=${tall ? "-1:480" : "480:-1"},tile=${tall ? "6x2" : "4x3"}`, "-frames:v", "1", join(blindDir, `${task}-${name}${suffix}.png`)]);
      made = true;
    } catch {}
  }
  return made ? `${task}-${name}.png` : undefined;
}

/** Pull the numbers we compare out of the stream-json transcript. */
function digest(lines: any[]) {
  const init = lines.find((l) => l.type === "system" && l.subtype === "init");
  const result = lines.findLast((l) => l.type === "result");
  const uses: Array<{ name: string; input: any }> = [];
  for (const l of lines) {
    if (l.type !== "assistant") continue;
    for (const c of l.message?.content ?? []) if (c.type === "tool_use") uses.push({ name: c.name, input: c.input });
  }
  const limits = lines.filter((l) => l.type === "rate_limit_event").map((l) => l.rate_limit_info);
  const lastLimit = limits.at(-1);
  const resultText = String(result?.result ?? "");
  const isImage = (p: string) => /\.(png|jpe?g|webp|gif)$/i.test(p ?? "");
  const bash = uses.filter((u) => u.name === "Bash").map((u) => String(u.input?.command ?? ""));
  return {
    init: init && { model: init.model, tools: init.tools, skills: init.skills, slash_commands: init.slash_commands, plugins: init.plugins, mcp_servers: init.mcp_servers },
    result: result && {
      subtype: result.subtype,
      is_error: result.is_error,
      num_turns: result.num_turns,
      duration_ms: result.duration_ms,
      duration_api_ms: result.duration_api_ms,
      total_cost_usd: result.total_cost_usd,
      usage: result.usage,
      modelUsage: result.modelUsage,
    },
    toolUses: uses.reduce<Record<string, number>>((m, u) => ((m[u.name] = (m[u.name] ?? 0) + 1), m), {}),
    imageReads: uses.filter((u) => u.name === "Read" && isImage(u.input?.file_path)).length,
    skillLoads: uses.filter((u) => u.name === "Skill").map((u) => u.input?.skill),
    renders: bash.filter((c) => /\b(kamishibai|remotion|hyperframes)\b[^|;&]*\b(render|export)\b|npm run render/.test(c)).length,
    rateLimit: lastLimit && {
      status: lastLimit.status,
      resetsAt: lastLimit.resetsAt,
      fiveHour: lastLimit.unifiedWindows?.five_hour?.utilization,
      sevenDay: lastLimit.unifiedWindows?.seven_day?.utilization,
      sevenDayResetsAt: lastLimit.unifiedWindows?.seven_day?.resetsAt,
    },
    limited: limits.some((l) => l.status && l.status !== "allowed") || /usage limit|rate limit|limit reached/i.test(resultText),
    notLoggedIn: /not logged in|please run \/login|invalid api key|oauth/i.test(resultText) && !result?.num_turns,
    frameExtracts: bash.filter((c) => /ffmpeg[^|;&]*(-frames:v|select=|fps=|-ss )/.test(c)).length,
    outside: outsideAccess(uses),
    bashCommands: bash,
  };
}

/** Tool calls that name a path in the real home, outside the trial: trials
 *  run with bypassPermissions, so this is the after-the-fact check that the
 *  agent stayed in its sandboxed dirs. Only the shared npm cache is expected
 *  there. Lists the tool and the offending input, cut short. */
function outsideAccess(uses: Array<{ name: string; input: any }>) {
  const realHome = homedir();
  const allowed = [join(realHome, ".npm")];
  const inHome = new RegExp(`${realHome.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![^/\\s"'\`;|&)<>])[^\\s"'\`;|&)<>]*`, "g");
  const hits: Array<{ tool: string; path: string; input: string }> = [];
  for (const u of uses) {
    const text = JSON.stringify(u.input ?? {});
    for (const m of text.matchAll(inHome)) {
      const path = m[0].replace(/\\+$/, "");
      if (allowed.some((a) => path === a || path.startsWith(a + "/"))) continue;
      hits.push({ tool: u.name, path, input: text.slice(0, 300) });
    }
  }
  return hits;
}

/** Video tools a bare trial used anyway: dependencies in package.json or
 *  node_modules, and install or run commands naming one. */
function videoToolsIn(project: string, commands: string[]) {
  const found = new Set<string>();
  try {
    const pkg = JSON.parse(readFileSync(join(project, "package.json"), "utf8"));
    for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) if (VIDEO_PACKAGES.test(name)) found.add(name);
  } catch {}
  try {
    for (const name of readdirSync(join(project, "node_modules"))) {
      const names = name.startsWith("@") ? readdirSync(join(project, "node_modules", name)).map((n) => `${name}/${n}`) : [name];
      for (const n of names) if (VIDEO_PACKAGES.test(n)) found.add(n);
    }
  } catch {}
  for (const c of commands)
    for (const word of c.split(/[\s;&|()]+/)) {
      const name = word.replace(/@[\d.^~]+$/, "");
      if (VIDEO_PACKAGES.test(name)) found.add(name);
    }
  return [...found];
}

async function runTrial(t: Trial, file: string, blindDir: string) {
  const root = join(args["trials-dir"]!, args.label!, t.id);
  const project = join(root, "project");
  const home = join(root, "home");
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  cloneDir(join(WORK, "templates", t.tool, t.skill ? "skill" : "noskill"), project);
  cloneDir(join(WORK, "home-seed"), home);
  await cp(join(BENCH, "briefs", t.task), project, { recursive: true });

  // The npm cache is the only thing shared: the tools are already installed.
  const env = renderEnv(home, { TMPDIR: join(root, "tmp"), CLAUDE_CODE_OAUTH_TOKEN: token });
  await mkdir(env.TMPDIR, { recursive: true });
  const cli = [
    "-p", prompt(t.tool, t.task),
    "--setting-sources", "project",
    "--strict-mcp-config",
    "--model", args.model!,
    "--output-format", "stream-json",
    "--verbose",
    "--no-session-persistence",
    "--permission-mode", args["permission-mode"]!,
    "--max-budget-usd", args["budget-usd"]!,
    ...(t.skill ? [] : ["--disable-slash-commands"]),
  ];
  const transcript = join(root, "stream.jsonl");
  const out = createWriteStream(transcript);
  const started = Date.now();
  let timedOut = false;
  const exitCode = await new Promise<number | null>((resolve) => {
    const child = args["agent-cmd"]
      ? spawn("sh", ["-c", args["agent-cmd"]], { cwd: project, env: { ...env, KB_TOOL: t.tool, KB_TASK: t.task }, stdio: ["ignore", "pipe", "pipe"] })
      : spawn("claude", cli, { cwd: project, env, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.pipe(out);
    child.stderr.pipe(createWriteStream(join(root, "stderr.txt")));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 10_000);
    }, Number(args["timeout-min"]) * 60_000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  const wallMs = Date.now() - started;
  await new Promise((r) => out.end(r));

  const lines = (await readFile(transcript, "utf8")).split("\n").filter(Boolean).flatMap((l) => {
    try {
      return [JSON.parse(l)];
    } catch {
      return [];
    }
  });
  const digested = digest(lines);
  if (digested.limited || digested.notLoggedIn) {
    // Not a measurement: the subscription cut it off (or auth failed).
    const rec = { type: digested.notLoggedIn ? "auth-failure" : "rate-limited", ...t, wallMs, rateLimit: digested.rateLimit };
    await appendFile(file, JSON.stringify(rec) + "\n");
    return rec;
  }
  const checked = check(project, t.task);
  const rec = {
    type: "trial",
    ...t,
    model: args.model,
    exitCode,
    timedOut,
    wallMs,
    ...digested,
    check: checked,
    videoTools: t.tool === "bare" ? videoToolsIn(project, digested.bashCommands) : undefined,
    sheet: contactSheet(project, t.task, blindDir, (checked as { duration?: number }).duration),
  };
  await appendFile(file, JSON.stringify(rec) + "\n");
  if (rec.sheet) await appendFile(join(blindDir, "..", `${args.label}-blind-key.jsonl`), JSON.stringify({ sheet: rec.sheet, id: t.id }) + "\n");
  if (!args["keep-trials"]) {
    // Keep the transcript and the video; drop the cloned dependencies.
    await rm(home, { recursive: true, force: true });
    await rm(join(project, "node_modules"), { recursive: true, force: true });
  }
  return rec;
}

// ---- main ---------------------------------------------------------------
const trials = plan();
console.log(`${trials.length} trials · model ${args.model} · budget $${args["budget-usd"]}/trial · timeout ${args["timeout-min"]} min`);
if (args["dry-run"]) {
  for (const t of trials) console.log(t.id);
  for (const tool of new Set(trials.map((t) => t.tool)))
    for (const task of new Set(trials.map((t) => t.task))) console.log(`\nprompt (${tool}, ${task}): ${prompt(tool, task)}`);
  process.exit(0);
}
const token =
  process.env.CLAUDE_CODE_OAUTH_TOKEN ??
  (args["token-file"] && existsSync(args["token-file"]) ? (await readFile(args["token-file"], "utf8")).trim() : "");
if (!token && !args["agent-cmd"]) {
  console.error(
    "No subscription token. Run `claude setup-token` in your own terminal, then set CLAUDE_CODE_OAUTH_TOKEN " +
      "or save the token to a file (chmod 600) and pass --token-file.",
  );
  process.exit(1);
}
for (const tool of list(args.tools!))
  for (const s of tool === "bare" ? ["noskill"] : ["skill", "noskill"])
    if (!existsSync(join(WORK, "templates", tool, s))) throw new Error(`missing template ${tool}/${s}: run setup.sh first`);

const blindDir = join(RESULTS, `${args.label}-blind`);
await mkdir(blindDir, { recursive: true });
const file = join(RESULTS, `${args.label}.jsonl`);
const done = new Set<string>();
if (args.resume && existsSync(file)) {
  for (const l of (await readFile(file, "utf8")).split("\n").filter(Boolean)) {
    const r = JSON.parse(l);
    if (r.type === "trial") done.add(r.id);
  }
} else {
  await writeFile(file, "");
  for (const f of await readdir(blindDir)) await rm(join(blindDir, f));
}
await appendFile(
  file,
  JSON.stringify({
    type: "env",
    date: new Date().toISOString(),
    claude: args["agent-cmd"] ? `agent-cmd: ${args["agent-cmd"]}` : execFileSync("claude", ["--version"], { encoding: "utf8" }).trim(),
    inventory: await readFile(join(WORK, "templates", "INVENTORY.md"), "utf8"),
    prompts: Object.fromEntries(list(args.tools!).flatMap((tool) => list(args.tasks!).map((task) => [`${tool}/${task}`, prompt(tool, task)]))),
    args,
  }) + "\n",
);

function pct(x: number | undefined): string {
  return typeof x === "number" ? `${Math.round(x * 100)}%` : "?";
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stopAt = Number(args["stop-at-weekly"]);
for (const [i, t] of trials.entries()) {
  if (done.has(t.id)) continue;
  let r: any;
  for (;;) {
    r = await runTrial(t, file, blindDir);
    if (r.type === "auth-failure") {
      console.error(`${t.id}: not logged in — check the subscription token. Stopping.`);
      process.exit(1);
    }
    if (r.type !== "rate-limited") break;
    const resetMs = (r.rateLimit?.resetsAt ?? Date.now() / 1000 + 3600) * 1000;
    const waitMs = Math.max(60_000, resetMs - Date.now() + 60_000);
    console.log(`${t.id}: subscription limit hit — waiting ${(waitMs / 60000).toFixed(0)} min for the window to reset, then retrying`);
    await sleep(waitMs);
  }
  const u = r.result?.usage ?? {};
  console.log(
    `[${i + 1}/${trials.length}] ${t.id.padEnd(34)} ${r.check.pass ? "PASS" : "FAIL"} ` +
      `$${(r.result?.total_cost_usd ?? 0).toFixed(2)} turns ${r.result?.num_turns ?? "?"} ` +
      `in ${(u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)} out ${u.output_tokens ?? 0} ` +
      `img ${r.imageReads} renders ${r.renders} ${(r.wallMs / 60000).toFixed(1)} min${r.timedOut ? " TIMEOUT" : ""}` +
      ` · 5h ${pct(r.rateLimit?.fiveHour)} 7d ${pct(r.rateLimit?.sevenDay)}` +
      (r.check.pass ? "" : ` (${r.check.reasons.join("; ")})`),
  );
  if ((r.rateLimit?.sevenDay ?? 0) >= stopAt) {
    console.log(`7-day subscription window at ${pct(r.rateLimit.sevenDay)} (≥ ${pct(stopAt)}): stopping. Continue later with --resume.`);
    break;
  }
}
console.log(`wrote ${file}`);
