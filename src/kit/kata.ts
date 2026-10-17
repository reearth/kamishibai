// Scene shapes (かた): most scenes pick one and fill it in, and write parts
// directly only when none fits. The parts a shape makes keep the same ids
// from scene to scene ("title" above all), so its heading stays and the
// rest moves.
// ------------------------------------------------------------------
import { f, type Fields } from "./fields.ts";
import { arrow, card, chip, col, list, row, stat, text, title, image } from "./parts.ts";
import type { CardSpec, PartSpec } from "./spec.ts";

export interface KataDef {
  doc: string;
  fields: Fields;
  parts(o: Record<string, unknown>): PartSpec[];
}

const TRANSITIONS = ["morph", "cut", "fade", "push", "wipe"] as const;

/** A scene's own fields. A shape's fields sit beside them, so a shape can't take these names. */
export const SCENE_FIELDS: Fields = {
  id: f.str("a name for messages and the scene list"),
  say: f.text("the narration, and its captions: a text split into sentences, or a list of sentences"),
  ms: f.num("hold this long instead of the narration's length"),
  kata: f.str("a scene shape, filled in with the fields beside it"),
  parts: f.parts("parts, after the shape's"),
  transition: f.one(TRANSITIONS, 'how it comes in after the scene before: "morph" (default: what stays moves), "cut", "fade", "push" or "wipe"'),
  focus: f.any("move the camera in on a part: its id, { on, cue?, zoom? }, or a list of those"),
  fill: f.bool("grow the parts under the heading, up to 1.6×, when they leave the stage mostly empty (default true)"),
};

const registry = new Map<string, KataDef>();

/** Add a scene shape. A shape of the same name replaces it. */
export function defineKata<O>(name: string, def: { doc: string; fields: Fields; parts(o: O): PartSpec[] }): void {
  const taken = Object.keys(def.fields).filter((k) => k in SCENE_FIELDS);
  if (taken.length) throw new Error(`defineKata("${name}"): ${taken.map((k) => `"${k}"`).join(", ")} ${taken.length === 1 ? "is a scene field" : "are scene fields"}; give the shape's field another name`);
  registry.set(name, def as unknown as KataDef);
}
export const kataDef = (name: string): KataDef | undefined => registry.get(name);
export const kataNames = (): string[] => [...registry.keys()];

// A card with code takes the code's width; one with words, an even share,
// or less beside code.
const side = (o: CardSpec & { id?: string }, id: string, other: CardSpec): CardSpec =>
  card({ ...(o.code ? {} : { width: other.code ? 520 : 720 }), ...o, id: o.id ?? id });

defineKata<{ kicker?: string; title: string; sub?: string }>("cover", {
  doc: "The opening: a big title, with a line above and below.",
  fields: { title: f.str("the reel's title", true), kicker: f.str("a small line above"), sub: f.str("a line below") },
  parts: (o) => [
    col(
      [
        ...(o.kicker ? [text(o.kicker, { id: "cover.kicker", role: "lead", align: "center" })] : []),
        text(o.title, { id: "cover.title", role: "display" }),
        ...(o.sub ? [text(o.sub, { id: "cover.sub", role: "lead", align: "center" })] : []),
      ],
      { id: "cover", gap: 32, align: "center" },
    ),
  ],
});

defineKata<{ title: string; left: CardSpec; right: CardSpec; kind?: "versus" | "equals" | "right" }>("compare", {
  doc: 'Two cards side by side (stacked on a tall stage), with ≠, = or → between. left and right take a card\'s fields.',
  fields: { title: f.str("the heading", true), left: f.obj("a card's fields", true), right: f.obj("a card's fields", true), kind: f.one(["versus", "equals", "right"]) },
  parts: (o) => [title(o.title, { id: "title" }), row([side(o.left, "left", o.right), arrow({ id: "vs", kind: o.kind ?? "versus" }), side(o.right, "right", o.left)], { id: "cmp" })],
});

defineKata<{ title: string; steps: string[]; at?: number; note?: string }>("flow", {
  doc: "Steps in order as pills with arrows; at marks the current one (those before it are done). Move at from scene to scene to walk the flow.",
  fields: { title: f.str("the heading", true), steps: f.strs("the steps", true), at: f.num("the index of the current step"), note: f.str("a small line under") },
  parts: (o) => [
    title(o.title, { id: "title" }),
    row(
      o.steps.flatMap((s, i) => [
        ...(i ? [arrow({ id: `flow.a${i}` })] : []),
        chip(s, { id: `flow.${i}`, n: i + 1, state: i === o.at ? "active" : o.at !== undefined && i < o.at ? "done" : undefined }),
      ]),
      { id: "flow", gap: 20 },
    ),
    ...(o.note ? [text(o.note, { id: "flow.note", role: "note" })] : []),
  ],
});

defineKata<{ title: string; value: number; unit?: string; label?: string }>("stat", {
  doc: "One big number that counts up, under a heading.",
  fields: { title: f.str("the heading", true), value: f.num("the number", true), unit: f.str(), label: f.str("a line under it") },
  parts: (o) => [title(o.title, { id: "title" }), stat(o.value, { id: "stat", unit: o.unit, label: o.label, tone: "accent" })],
});

defineKata<{ title: string; items: string[]; at?: number }>("points", {
  doc: "A heading and a bulleted list; at stresses one item.",
  fields: { title: f.str("the heading", true), items: f.strs("the items", true), at: f.num("the index of the item to stress") },
  parts: (o) => [title(o.title, { id: "title" }), list(o.items, { id: "points", at: o.at })],
});

defineKata<{ title: string; code: string; highlight?: string; label?: string; note?: string }>("code", {
  doc: 'A heading and a code excerpt ("path#L40-48" from the reel\'s folder, or the code itself), with one part marked. Lines still shown in the next scene slide.',
  fields: { title: f.str("the heading", true), code: f.str('"path#L40-48" or the code', true), highlight: f.str("a substring to highlight"), label: f.str("a small line on the card"), note: f.str("a small line under") },
  parts: (o) => [
    title(o.title, { id: "title" }),
    card({ id: "code", label: o.label, code: o.code, highlight: o.highlight, tone: "accent" }),
    ...(o.note ? [text(o.note, { id: "code.note", role: "note" })] : []),
  ],
});

defineKata<{ title: string; src: string; caption?: string }>("picture", {
  doc: "A heading and one picture from a file next to the reel.",
  fields: { title: f.str("the heading", true), src: f.str("a path relative to the reel", true), caption: f.str("a small line under it") },
  parts: (o) => [title(o.title, { id: "title" }), image(o.src, { id: "picture", caption: o.caption })],
});
