// kamishibai/kit: keyframe reels from a kit of parts. Write each scene as
// parts (or a scene shape), and the kit lays it out for any shape of view,
// moves what stays between scenes, and times the scenes to the narration.
// The result is a canvas reel, rendered with no browser.
// ------------------------------------------------------------------
export { kit, type KitReel, type SceneTiming } from "./reel.ts";
export { arrow, card, chip, col, definePart, figure, image, list, paint, row, stat, text, textBox, title, rect, isTall, type FigureItem } from "./parts.ts";
export type { Ctx, Frame, PartDef, Placed, Stage, TextOpts } from "./parts.ts";
export { defineKata, type KataDef } from "./kata.ts";
export { f, type Field, type Fields } from "./fields.ts";
export { KitSpecError, normalize } from "./normalize.ts";
export { kitBrief, kitSchema } from "./schema.ts";
export { contrast, type Issue, type IssueKind } from "./check.ts";
export { DEFAULT_THEME, SIZE, type Theme, type FontRole } from "./theme.ts";
export type { Box, Paint, Rect, Style } from "./layout.ts";
export type { Drawable, Verb } from "./model.ts";
export * from "./spec.ts";

import type { PartSpec, SceneSpec } from "./spec.ts";

/** A scene written with parts. */
export function scene(say: string, parts: PartSpec[], o: { id?: string; ms?: number } = {}): SceneSpec {
  return { ...o, say, parts };
}
