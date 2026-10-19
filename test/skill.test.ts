import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseSkill, skillText } from "../src/skill.ts";

const GUIDE = readFileSync(new URL("../src/skill.md", import.meta.url), "utf8");

describe("the shipped guide", () => {
  const guide = parseSkill(GUIDE);

  it("keeps the core small enough to read in one shell call", () => {
    // Agents' shell tools cut output around 30k characters and spill the rest
    // to a file the agent then has to page through.
    expect(guide.core.length).toBeLessThan(25_000);
  });

  it("lists every topic in the core, with a pointer where it was cut", () => {
    for (const t of guide.topics) {
      expect(guide.core).toContain(`kamishibai skill ${t.name}  `);
      expect(guide.core).toContain(`> **More:** \`kamishibai skill ${t.name}\``);
      expect(t.body).toMatch(/^#+ /);
    }
  });

  it("only refers to topics that exist", () => {
    const names = new Set([...guide.topics.map((t) => t.name), "all"]);
    for (const [, name] of GUIDE.matchAll(/kamishibai skill ([a-z][a-z0-9-]*)/g)) expect(names).toContain(name);
  });

  it("keeps what every reel needs in the core", () => {
    expect(guide.core).toContain("useFingerprint");
    expect(guide.core).toContain("## Determinism checklist");
  });

  it("prints the whole document for all, without markers", () => {
    expect(guide.all).not.toContain("<!--");
    for (const t of guide.topics) expect(guide.all).toContain(t.body.trim());
  });
});

describe("parseSkill", () => {
  const md = [
    "# Guide",
    "<!-- topics -->",
    "## Core",
    "core text",
    "",
    "<!-- topic: extra | More detail -->",
    "## Extra",
    "extra text",
    "<!-- /topic -->",
    "",
    "## Tail",
    "",
  ].join("\n");

  it("splits the core from the topics", () => {
    const g = parseSkill(md);
    expect(g.topics).toEqual([{ name: "extra", summary: "More detail", body: "## Extra\nextra text\n" }]);
    expect(g.core).toContain("kamishibai skill extra  # More detail");
    expect(g.core).toContain("> **More:** `kamishibai skill extra` — More detail.");
    expect(g.core).not.toContain("extra text");
    expect(g.all).toBe("# Guide\n## Core\ncore text\n\n## Extra\nextra text\n\n## Tail\n");
  });

  it("rejects malformed fences", () => {
    expect(() => parseSkill("<!-- topic: a | A -->\n<!-- topic: b | B -->\n")).toThrow(/opens inside/);
    expect(() => parseSkill("<!-- topic: a | A -->\ntext\n")).toThrow(/never closed/);
    expect(() => parseSkill("<!-- /topic -->\n")).toThrow(/without an open topic/);
    expect(() => parseSkill("<!-- topic: a | A -->\n<!-- /topic -->\n<!-- topic: a | A -->\n<!-- /topic -->\n")).toThrow(/twice/);
  });

  it("answers skill arguments", () => {
    expect(skillText(md, [])).toBe(parseSkill(md).core);
    expect(skillText(md, ["extra"])).toBe("## Extra\nextra text\n");
    expect(skillText(md, ["all"])).toBe(parseSkill(md).all);
    expect(() => skillText(md, ["nope"])).toThrow('unknown skill topic "nope". Topics: extra, all');
  });
});

describe("kamishibai/skill", () => {
  it("gives a program what the CLI prints", async () => {
    const { skill, skillTopics } = await import("../src/skill-guide.ts");
    expect(skill()).toBe(parseSkill(GUIDE).core);
    const topics = skillTopics();
    expect(topics.map((t) => t.name)).toContain("kit");
    for (const t of topics) expect(skill()).toContain(`kamishibai skill ${t.name}`);
    expect(skill(["kit"])).not.toContain("(kit-fields left out)");
    expect(skill(["all"]).length).toBeGreaterThan(skill().length);
    expect(() => skill(["nope"])).toThrow(/unknown skill topic "nope"/);
  });
});
