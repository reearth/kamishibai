// The agent guide printed by `kamishibai skill`.
// ------------------------------------------------------------------
// skill.md is one document, in reading order. Sections that only some reels
// need are fenced as topics:
//
//   <!-- topic: audio | Music, clip gain and fades, ducking, credits -->
//   ## Audio
//   …
//   <!-- /topic -->
//
// `kamishibai skill` prints the core (everything outside a topic) with each
// topic replaced by a one-line pointer, and the topic list where the guide
// has `<!-- topics -->`. `kamishibai skill <topic…>` prints those topics, and
// `kamishibai skill all` the whole document. The core stays well under what
// an agent's shell tool shows in one go, so it is read once, not paged.
// ------------------------------------------------------------------

export interface SkillTopic {
  name: string;
  summary: string;
  body: string;
}

export interface SkillGuide {
  core: string;
  topics: SkillTopic[];
  all: string;
}

const OPEN = /^<!-- topic: ([a-z][a-z0-9-]*) \| (.+?) -->$/;
const CLOSE = "<!-- /topic -->";
const INDEX = "<!-- topics -->";

export function parseSkill(md: string): SkillGuide {
  const core: string[] = [];
  const all: string[] = [];
  const topics: SkillTopic[] = [];
  let open: { name: string; summary: string; lines: string[] } | undefined;
  let indexAt = -1;
  for (const line of md.split("\n")) {
    const m = OPEN.exec(line);
    if (m) {
      const [, name = "", summary = ""] = m;
      if (open) throw new Error(`skill.md: topic "${name}" opens inside "${open.name}"`);
      if (topics.some((t) => t.name === name)) throw new Error(`skill.md: topic "${name}" is defined twice`);
      open = { name, summary, lines: [] };
      core.push(`> **More:** \`kamishibai skill ${name}\` — ${summary}.`);
      continue;
    }
    if (line === CLOSE) {
      if (!open) throw new Error("skill.md: <!-- /topic --> without an open topic");
      topics.push({ name: open.name, summary: open.summary, body: trimBlank(open.lines).join("\n") + "\n" });
      open = undefined;
      continue;
    }
    if (line === INDEX) {
      indexAt = core.length;
      continue;
    }
    all.push(line);
    (open ? open.lines : core).push(line);
  }
  if (open) throw new Error(`skill.md: topic "${open.name}" is never closed`);
  if (indexAt >= 0) {
    const width = Math.max(...topics.map((t) => t.name.length));
    core.splice(
      indexAt,
      0,
      "This is the core: read all of it. Features that only some reels use are",
      "separate topics, not repeated here — print each one your reel needs before",
      "writing that part:",
      "",
      "```",
      ...topics.map((t) => `kamishibai skill ${t.name.padEnd(width)}  # ${t.summary.replaceAll("`", "")}`),
      `kamishibai skill ${"all".padEnd(width)}  # the whole guide, core and topics, in one document`,
      "```",
    );
  }
  return { core: collapseBlank(core).join("\n"), topics, all: collapseBlank(all).join("\n") };
}

/** The text for `kamishibai skill [args…]`; throws on an unknown topic. */
export function skillText(md: string, args: string[]): string {
  const guide = parseSkill(md);
  if (args.length === 0) return guide.core;
  if (args.includes("all")) return guide.all;
  const unknown = args.filter((a) => !guide.topics.some((t) => t.name === a));
  if (unknown.length) {
    throw new Error(
      `unknown skill topic ${unknown.map((u) => `"${u}"`).join(", ")}. Topics: ${guide.topics.map((t) => t.name).join(", ")}, all`,
    );
  }
  return args.map((a) => guide.topics.find((t) => t.name === a)!.body).join("\n");
}

function trimBlank(lines: string[]): string[] {
  let a = 0;
  let b = lines.length;
  while (a < b && !lines[a]?.trim()) a++;
  while (b > a && !lines[b - 1]?.trim()) b--;
  return lines.slice(a, b);
}

/** Removing a fenced topic can leave two blank lines in a row. */
function collapseBlank(lines: string[]): string[] {
  return lines.filter((l, i) => l.trim() !== "" || i === 0 || lines[i - 1]?.trim() !== "");
}
