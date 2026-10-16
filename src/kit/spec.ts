// A kit reel as plain data: what JSON, YAML and code all describe. The
// functions in parts.ts build the same objects, so a reel written in any of
// the three is checked, laid out and drawn the same way.
// ------------------------------------------------------------------
import type { FontSource } from "../canvas/types.ts";
import type { Context2D } from "../canvas/types.ts";
import type { Verb } from "./model.ts";
import type { Theme } from "./theme.ts";

/** The version of the layout rules a reel was written for. */
export const KIT_VERSION = 1;

type Common = {
  /** Same id in the next scene: the part moves there. Default: its type, numbered when repeated. */
  id?: string;
  /** how it comes in when it first appears */
  enter?: Verb;
  /** come in as this sentence of the scene's say starts (0 = the first, with the scene) */
  cue?: number;
};

export type TitleSpec = Common & { type: "title"; text: string; kicker?: string };
export type TextSpec = Common & { type: "text"; text: string; tone?: "display" | "lead" | "body" | "note"; align?: "start" | "center" };
export type GroupSpec = Common & {
  type: "row" | "col";
  parts: PartSpec[];
  gap?: number;
  align?: "start" | "center" | "end" | "stretch";
  /** a row that doesn't fit across: "stack" into a column (default), "wrap" like tiles, or "keep" */
  narrow?: "stack" | "wrap" | "keep";
};
export type CardSpec = Common & {
  type: "card";
  label?: string;
  body?: string;
  /** code as text, or "path#L44" / "path#L40-48" read from the reel's folder */
  code?: string;
  /** a substring of the code to highlight */
  mark?: string;
  tone?: "plain" | "accent" | "dim";
  width?: number;
};
export type ArrowSpec = Common & { type: "arrow"; kind?: "right" | "down" | "versus" | "equals" };
export type ChipSpec = Common & { type: "chip"; text: string; state?: "active" | "done" };
export type StatSpec = Common & { type: "stat"; value: number; unit?: string; label?: string; tone?: "plain" | "accent"; digits?: number };
export type ListSpec = Common & { type: "list"; items: string[]; mark?: number };
export type ImageSpec = Common & {
  type: "image";
  /** a path relative to the reel */
  src: string;
  /** the box, in layout units (default: the image's own size, fitted to the stage) */
  width?: number;
  height?: number;
  caption?: string;
};
/** A box drawn by code (only in a code reel): `fn` paints w×h at the reel's time. */
export type PaintSpec = Common & {
  type: "paint";
  width: number;
  height: number;
  /** the same key in the next scene moves the box; another key crossfades */
  key?: string;
  fn: (g: Context2D, ms: number, w: number, h: number) => void;
};
/** A part defined with definePart. */
export type CustomSpec = Common & { type: string; [k: string]: unknown };

export type BuiltinSpec = TitleSpec | TextSpec | GroupSpec | CardSpec | ArrowSpec | ChipSpec | StatSpec | ListSpec | ImageSpec | PaintSpec;
export type PartSpec = BuiltinSpec | CustomSpec;

/** Where the camera looks: a part's id (the camera moves in to frame it), or that with a cue and a zoom to stop at. */
export type FocusSpec = string | { on: string; cue?: number; zoom?: number };

/** How a scene comes in after the one before it. */
export type Transition = "morph" | "cut" | "fade" | "push" | "wipe";

/** One keyframe: what the screen shows while `say` is spoken. */
export type SceneSpec = {
  id?: string;
  /** the narration, and its captions: split into sentences, or given as a list of them */
  say?: string | string[];
  /** hold this long instead of the narration's length */
  ms?: number;
  /** a scene shape from `kata`, filled in with the fields beside it */
  kata?: string;
  parts?: PartSpec[];
  /** how it comes in: "morph" (default: what stays moves), "cut", "fade", "push" or "wipe" */
  transition?: Transition;
  /** move the camera in on a part, or a list of those, each with a cue */
  focus?: FocusSpec | FocusSpec[];
  [field: string]: unknown;
};

/** A voice for the narration: a built-in adapter of kamishibai/tts and its options. */
export type VoiceSpec = { provider: "say" | "kokoro" | "openai" | "elevenlabs" | "google" | "gemini" | "polly"; [opt: string]: unknown };

export type KitReelSpec = {
  /** the layout rules' version (KIT_VERSION) */
  kit: number;
  /** modules that define parts and shapes (definePart, defineKata), relative to the reel; read for a JSON or YAML reel */
  uses?: string[];
  title?: string;
  fps?: number;
  /** the default view (1920×1080) */
  width?: number;
  height?: number;
  /** the shapes it lays out for, as "9:16" or a number (default 9:16 to 16:9) */
  aspect?: { min: string | number; max: string | number };
  fonts?: FontSource[];
  theme?: Partial<Theme>;
  voice?: VoiceSpec;
  /** reading substitutions for the voice only (captions keep the text) */
  lexicon?: Record<string, string>;
  /** a track under the whole reel, lowered while the voice speaks */
  music?: { src: string; gain?: number; duck?: boolean };
  /** captions from each scene's `say`: a subtitle track (true, the default), drawn into the picture ("burn"), or none */
  captions?: boolean | "burn";
  scenes: SceneSpec[];
};
