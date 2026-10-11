# Benchmarks

The harness behind [docs/benchmarks.md](../docs/benchmarks.md): kamishibai next to Remotion and HyperFrames on the same briefs, on your machine.

| Runner | What it measures |
|---|---|
| `run-edit.ts` | Render again after an edit: an 86-second reel, five edits in a row, each tool rendering after every edit |
| `run-speed.ts` | Render speed: a reference implementation of each brief per tool, with each tool's defaults and with one capture worker |
| `run-agents.ts` | Agents: tokens, cost, turns and time for a headless Claude Code session to turn a brief into a passing `out.mp4`, with and without each tool's skills, and with no video tool at all (`bare`) |

## Files

| Path | What |
|---|---|
| `setup.sh` | Packs kamishibai, builds the agent templates and the warm homes, and installs the projects' dependencies. Everything it builds goes under `.work/`. |
| `briefs/<task>/` | The three briefs (`text`, `three`, `scenes`), the same for every tool. Agents get these; `run-speed.ts` renders the reference implementations of them. |
| `speed/<tool>/<task>/` | Reference implementations, each with a `speed.json` naming its render commands and noting anything that deviates from the tool's defaults. |
| `edit/` | The edit reel: `spec.json` describes it, `edit/<tool>/` draws it, and `gen-hyperframes.mjs` writes HyperFrames' HTML from the spec. |
| `lib.ts` | Paths, the render environment, the automatic check (size, 30 fps, duration ±1 frame, audio) and frame hashes. |
| `summarize.ts` | Tables for any mix of results files. |
| `sandbox-check.ts` | Whether each render works inside Claude Code's Bash sandbox. On macOS it doesn't (see below). |
| `smoke-agent.sh` | A fake "agent" for testing the trial plumbing without an API token. |

The music in `briefs/scenes/assets/` and `edit/` is a sine-wave chord made with ffmpeg:

```sh
ffmpeg -f lavfi -i sine=frequency=220:duration=14 -f lavfi -i sine=frequency=277.18:duration=14 \
  -f lavfi -i sine=frequency=329.63:duration=14 \
  -filter_complex "[0][1][2]amix=inputs=3,volume=0.6,tremolo=f=2:d=0.3" -c:a libmp3lame -q:a 4 bgm.mp3
```

The edit reel's is 88 s long, at 220, 277 and 330 Hz with `tremolo=f=2:d=0.4`.

## Requirements

- macOS or Linux. `docs/benchmarks.md` was measured on an Apple M1.
- Node.js 22.18 or later, which runs the `.ts` runners directly. Also pnpm (to pack this repo) and ffmpeg on `PATH`.
- For `run-agents.ts`: Claude Code (`claude`) and a token from `claude setup-token`.
- Disk: up to about 8 GB for `.work/` and the projects' `node_modules`, less on APFS, where the copies are clones. `run-edit.ts` keeps each rep's frames, about 1.5 GB per rep.

## Running

```sh
./setup.sh                                  # packs ../ (or: KAMISHIBAI_TARBALL=… ./setup.sh)
node run-speed.ts                           # about 25 minutes: 18 conditions × (1 warm-up + 5)
node run-edit.ts                            # about 1.5 hours: 3 reps × 6 steps × 4 conditions
node summarize.ts results/speed.jsonl results/edit.jsonl
```

Each runner takes flags to narrow it down: `--tools`, `--tasks`, `--configs`, `--reps`, `--conds`, `--label` (the results file's name). See the comment at the top of each file.

Run the timings on a quiet machine. Close what you can, keep the machine on power, and wait for the load to settle. The runners record the load average with each render, and `summarize.ts` prints it.

To time your own change to kamishibai, run `setup.sh` again on that checkout, and compare the results files with `summarize.ts`.

### Agents

```sh
claude setup-token                          # in your own terminal: it prints a token
export CLAUDE_CODE_OAUTH_TOKEN=…            # or save it to a file (chmod 600) and pass --token-file
node run-agents.ts --dry-run                # the plan: 90 trials by default
node run-agents.ts --agent-cmd ./smoke-agent.sh --limit 3   # the plumbing, without the API
node run-agents.ts                          # resumable with --resume
node summarize.ts results/agents.jsonl
```

- **Auth** is your Claude subscription. Trials take a lot of quota and share it with your normal use, so expect a full run to span several 5-hour windows.
  - A trial cut off by a subscription limit is logged as `rate-limited`, not counted, and retried after the window resets.
  - The run stops once the 7-day window reaches `--stop-at-weekly` (0.8 by default), leaving the rest for your normal work. Continue it later with `--resume`.
  - `total_cost_usd` is still recorded, as the API-equivalent cost.
- **Permissions:** trials run with `--permission-mode bypassPermissions`, in their own directories with a throwaway HOME, but as your account. Each trial records every tool call that names a path in your real home (other than the npm cache), and the summary lists them under "Access outside the trial".
- **No sandbox:** Claude Code's Bash sandbox doesn't work here. On macOS, Seatbelt stops Chromium from registering its Mach rendezvous service, so every tool's render crashes at browser launch. `sandbox.network.allowMachLookup` doesn't help, even with `"*"`. `sandbox-check.ts` reproduces this.

## Fairness decisions

- **Same prompt** for every tool. Only the tool's name changes, and the prompt says the brief is final, so the agent asks no questions.
- **Isolation:**
  - HOME is a fresh clone of `.work/home-seed`, so your `~/.claude` (CLAUDE.md, skills, plugins, hooks, memory) isn't there.
  - `--setting-sources project --strict-mcp-config` keeps the rest out. Only Claude Code's built-in skills remain, and they're the same in every condition.
  - The environment is minimal, and the trial runs outside any git repo.
  - noskill trials also pass `--disable-slash-commands`.
  - The summary's isolation audit lists what each session could see.
- **Skills** are each tool's official recommendation, installed in the project:
  - kamishibai: both of its skills, from this checkout.
  - Remotion: all of `remotion-dev/skills`.
  - HyperFrames: the core set from `hyperframes skills update`.

  noskill also removes HyperFrames' generated `CLAUDE.md` and `AGENTS.md`, which only route to its skills.
- **Order.** Agent trials run in a seeded shuffle within each repetition. Speed runs go in ABBA order. Edit runs rotate the conditions within each step.
- **Cost per success** counts the spend of failed trials too.
- **Judging.** The automatic check is pass/fail. Contact sheets go to `results/<label>-blind/` under random names, with the key in a separate file, for blind quality judging.
- **Speed configs:**
  - `default`: each tool's own defaults. Remotion's template sets JPEG frames, and HyperFrames uses `drawElement` capture where it can.
  - `single`: one capture worker.

  Every run is a fresh process. Determinism is measured from the md5 of the decoded frames.
- **WebGL.** For the three brief, Remotion renders with `--gl=angle`, so all three tools draw WebGL on the GPU. Its `speed.json` keeps Remotion's own default (SwiftShader) as `cpu` and `cpu-single`.
