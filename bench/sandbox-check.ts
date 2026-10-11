// Does each tool's render work inside Claude Code's Bash sandbox?
// ------------------------------------------------------------------
// For each tool × task, copies the reference implementation (speed/) into a
// trial-like dir under os.tmpdir() with its own HOME, then has a cheap model
// run, via the Bash tool, (1) a read of the real home, which the sandbox
// should refuse, and (2) the render command from speed.json. The output is
// checked with lib.ts, and the sandbox's denials are pulled from the tool
// results. Same auth and isolation flags as run-agents.ts.
//
//   node sandbox-check.ts [--tools …] [--tasks …] [--model claude-haiku-5-5]
//                         [--mach 'org.chromium.*']  # sandbox.network.allowMachLookup
//                         [--no-sandbox]   # the same runs without it, as a control
// ------------------------------------------------------------------
import { spawn } from "node:child_process";
import { readFile, mkdir, rm, mkdtemp, appendFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { BENCH, RESULTS, check, cloneDir, list, renderEnv, toolHome } from "./lib.ts";

const { values: args } = parseArgs({
  options: {
    tools: { type: "string", default: "kamishibai,remotion,hyperframes" },
    tasks: { type: "string", default: "text,three,scenes" },
    model: { type: "string", default: "claude-haiku-5-5" },
    "no-sandbox": { type: "boolean", default: false },
    /** comma-separated sandbox.network.allowMachLookup entries */
    mach: { type: "string", default: "" },
    /** a file holding a `claude setup-token` token (or set CLAUDE_CODE_OAUTH_TOKEN) */
    "token-file": { type: "string" },
    label: { type: "string", default: "sandbox-check" },
  },
});
const token = process.env.CLAUDE_CODE_OAUTH_TOKEN ?? (args["token-file"] ? (await readFile(args["token-file"], "utf8")).trim() : "");
if (!token) throw new Error("set CLAUDE_CODE_OAUTH_TOKEN or pass --token-file (see run-agents.ts)");
const realHome = homedir();

/** The sandbox an agent trial would get. Writes: the project (cwd), plus the
 *  trial root (its HOME and TMPDIR) and the shared npm cache. Reads: the
 *  real home is denied except the npm cache. Network: bypassPermissions lets
 *  any host through the proxy; localhost binding is on for dev servers. */
const settings = (root: string) => ({
  sandbox: {
    enabled: true,
    failIfUnavailable: true,
    allowUnsandboxedCommands: false,
    autoAllowBashIfSandboxed: true,
    network: { allowLocalBinding: true, ...(args.mach ? { allowMachLookup: list(args.mach) } : {}) },
    filesystem: {
      allowWrite: [root, join(realHome, ".npm")],
      denyRead: [realHome],
      allowRead: [join(realHome, ".npm")],
    },
  },
});

await mkdir(RESULTS, { recursive: true });
const out = join(RESULTS, `${args.label}${args["no-sandbox"] ? "-control" : ""}.jsonl`);
for (const tool of list(args.tools!))
  for (const task of list(args.tasks!)) {
    const spec = JSON.parse(await readFile(join(BENCH, "speed", tool, task, "speed.json"), "utf8"));
    const cmd: string = spec.render.default;
    const root = await mkdtemp(join(tmpdir(), "kb-sbx-"));
    const project = join(root, "project");
    cloneDir(join(BENCH, "speed", tool, task), project);
    cloneDir(toolHome(tool), join(root, "home"));
    await rm(join(project, "out.mp4"), { force: true });
    await mkdir(join(root, "tmp"));
    const env = renderEnv(join(root, "home"), { TMPDIR: join(root, "tmp"), CLAUDE_CODE_OAUTH_TOKEN: token });
    const prompt = [
      "Run these two shell commands with the Bash tool, one call each, in the current directory, and nothing else. Do not change, retry or fix them.",
      `1. ls ${realHome}`,
      `2. ${cmd}   (use a Bash timeout of 600000 ms)`,
      "Then reply with each command's exit status.",
    ].join("\n");
    const cli = [
      "-p", prompt,
      "--setting-sources", "project",
      "--strict-mcp-config",
      "--model", args.model!,
      "--output-format", "stream-json",
      "--verbose",
      "--no-session-persistence",
      "--permission-mode", "bypassPermissions",
      ...(args["no-sandbox"] ? [] : ["--settings", JSON.stringify(settings(root))]),
    ];
    const t0 = performance.now();
    let raw = "";
    await new Promise<void>((resolve) => {
      const child = spawn("claude", cli, { cwd: project, env, stdio: ["ignore", "pipe", "pipe"] });
      child.stdout.on("data", (d) => (raw += d));
      child.stderr.on("data", (d) => (raw += d));
      const timer = setTimeout(() => child.kill("SIGKILL"), 20 * 60_000);
      child.on("exit", () => (clearTimeout(timer), resolve()));
    });
    const events = raw.split("\n").flatMap((l) => {
      try {
        return [JSON.parse(l)];
      } catch {
        return [];
      }
    });
    const uses = new Map<string, string>();
    const calls: { command: string; isError: boolean; tail: string }[] = [];
    for (const e of events) {
      for (const c of e.message?.content ?? []) {
        if (c.type === "tool_use") uses.set(c.id, c.input?.command ?? JSON.stringify(c.input));
        if (c.type === "tool_result") {
          const text = typeof c.content === "string" ? c.content : (c.content ?? []).map((x: any) => x.text ?? "").join("\n");
          calls.push({ command: uses.get(c.tool_use_id) ?? "?", isError: !!c.is_error, tail: text.slice(-1500) });
        }
      }
    }
    const result = events.find((e) => e.type === "result");
    const ok = check(project, task);
    const rec = { tool, task, sandbox: !args["no-sandbox"], wallMs: performance.now() - t0, check: ok, calls, result: result?.result, cost: result?.total_cost_usd };
    await appendFile(out, JSON.stringify(rec) + "\n");
    const homeRead = calls.find((c) => c.command.startsWith("ls "));
    console.log(
      `${tool}/${task}: render ${ok.pass ? "ok" : `FAIL ${ok.reasons.join("; ")}`} · home read ${homeRead ? (homeRead.isError ? "denied" : "ALLOWED") : "not run"} · ${(rec.wallMs / 1000).toFixed(0)}s`,
    );
    await rm(root, { recursive: true, force: true });
  }
console.log(`wrote ${out}`);
