// How each Lexicon term's loop is drawn: one file per chapter in ./draw/,
// with the rules and the tools in ./draw/kit.ts.
import * as camera from "./draw/camera.ts";
import * as motion from "./draw/motion.ts";
import * as transition from "./draw/transition.ts";
import * as editing from "./draw/editing.ts";
import * as light from "./draw/light.ts";
import * as type from "./draw/type.ts";
import * as shape from "./draw/shape.ts";
import * as distortion from "./draw/distortion.ts";
import * as texture from "./draw/texture.ts";
import * as generative from "./draw/generative.ts";
import type { Paint, Shapes } from "./draw/kit.ts";

export { INK, W, H } from "./draw/kit.ts";
export type { Shape, Paint, Shapes } from "./draw/kit.ts";

const chapters = [camera, motion, transition, editing, light, type, shape, distortion, texture, generative];

/** Terms drawn as shapes, by id. */
export const SHAPES: Record<string, Shapes> = Object.assign({}, ...chapters.map((c) => c.SHAPES));
/** Terms painted on a canvas, by id. */
export const PAINT: Record<string, Paint> = Object.assign({}, ...chapters.map((c) => c.PAINT));
