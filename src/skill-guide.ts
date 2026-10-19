// kamishibai/skill: the guide `kamishibai skill` prints, for a program that
// hands it to an agent itself (a system prompt, a tool's result) instead of
// running the CLI. It is the installed version's guide, as the CLI's is.
// ------------------------------------------------------------------
import { kitBrief, kitReference } from "./kit/schema.ts";
import SKILL from "./skill.md";
import { parseSkill, skillText } from "./skill.ts";

// The kit topics carry the field list and what each field means, made from the fields themselves.
const fills = () => ({ "kit-fields": "```\n" + kitBrief() + "```", "kit-reference": "```\n" + kitReference() + "```" });

/**
 * The guide as `kamishibai skill [topics…]` prints it: with no topics, the
 * core and the list of topics; with names, those topics; with `"all"`, the
 * whole guide. Throws on a topic that does not exist.
 */
export function skill(topics: string[] = []): string {
  return skillText(SKILL, topics, fills());
}

/** The topics `skill()` takes, each with the line the core lists it by. */
export function skillTopics(): { name: string; summary: string }[] {
  return parseSkill(SKILL, fills()).topics.map(({ name, summary }) => ({ name, summary }));
}
