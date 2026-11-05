// A kit reel as plain data: what JSON, YAML and code all describe. The
// functions in parts.ts build the same objects, so a reel written in any of
// the three is checked, laid out and drawn the same way.
// ------------------------------------------------------------------
import type { FontSource } from "../canvas/types.ts";
import type { Context2D } from "../canvas/types.ts";
import type { Verb } from "./model.ts";
import type { Theme, ThemeSpec } from "./theme.ts";
import type { PLACES } from "./kata.ts";

/** The version of the layout rules a reel was written for. */
export const KIT_VERSION = 1;

type Common = {
  /** Same id in the next scene: the part moves there. Default: its type, numbered when repeated. */
  id?: string;
  /** how it comes in when it first appears: a verb, or { type?, ms?, delay? } to set how long it takes and when it starts */
  enter?: EnterSpec;
  /** come in as this sentence of the scene's say starts (0 = the first, with the scene) */
  cue?: number;
};

export type TitleSpec = Common & { type: "title"; text: string; kicker?: string };
export type TextSpec = Common & {
  type: "text";
  text: string;
  /** what the text is for, which sets its size: a cover's title, a large line, a sentence, or a small grey note */
  role?: "display" | "lead" | "body" | "note";
  align?: "start" | "center" | "end";
  /** a theme colour's name or CSS (default: by role) */
  color?: string;
  /** set smaller until its longest word fits: true (down to half its size) or the least share of it (above 0, up to 1) */
  shrink?: boolean | number;
  /** the colour of runs written between ** (a theme colour's name or CSS; default accentText) */
  mark?: string;
};
export type GroupSpec = Common & {
  type: "row" | "col";
  parts: PartSpec[];
  gap?: number;
  align?: "start" | "center" | "end" | "stretch";
  /** a row that doesn't fit across: "stack" into a column (default), "wrap" like tiles, "fit" (stay a row on a wide stage, the scene shrunk to fit), or "keep" */
  narrow?: "stack" | "wrap" | "fit" | "keep";
};
export type CardSpec = Common & {
  type: "card";
  label?: string;
  body?: string;
  /** code as text, or "path#L44" / "path#L40-48" read from the reel's folder */
  code?: string;
  /** a substring of the code to highlight */
  highlight?: string;
  tone?: "plain" | "accent" | "dim";
  width?: number;
};
export type ArrowSpec = Common & { type: "arrow"; kind?: "right" | "down" | "versus" | "equals" };
export type ChipSpec = Common & { type: "chip"; text: string; state?: "active" | "done"; n?: number };
export type StatSpec = Common & { type: "stat"; value: number; prefix?: string; unit?: string; label?: string; tone?: "plain" | "accent"; digits?: number };
export type ListSpec = Common & {
  type: "list";
  items: string[];
  /** the index of the item to stress */
  at?: number;
  /** number the items instead of bullets */
  numbered?: boolean;
};
export type ImageSpec = Common & {
  type: "image";
  /** a path relative to the reel */
  src: string;
  /** at most this wide and tall, in layout units (default: as large as the room under the heading allows) */
  width?: number;
  height?: number;
  /** false: never wider than the file's own pixels (default true) */
  upscale?: boolean;
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

/** A sound a scene plays: a file next to the reel, `at` ms after the scene starts (or after sentence `cue` starts), at `gain` dB. */
export type SoundSpec = { src: string; at?: number; cue?: number; gain?: number };

/** Room kept clear at the stage's edges, in layout units: one number for all four, or each edge. */
export type MarginSpec = number | { top?: number; right?: number; bottom?: number; left?: number };

/** How a scene comes in after the one before it. */
export type Transition = "morph" | "cut" | "fade" | "push" | "wipe";
/** A transition, or one with its length: `{ type: "fade", ms: 200 }`. A field left out takes the reel's. */
export type TransitionSpec = Transition | { type?: Transition; ms?: number };

/**
 * How a part comes in: a verb, or the verb with its length (`ms`, the whole
 * of it) and `delay`, the ms from the scene's start (or its cue's sentence)
 * to when it starts.
 */
export type EnterSpec = Verb | { type?: Verb; ms?: number; delay?: number };
/** When a scene's new parts come in, by default: `delay` before the first, `ms` each takes, and `stagger` between one and the next. */
export type SceneEnter = { delay?: number; ms?: number; stagger?: number };

/** One keyframe: what the screen shows while `say` is spoken. */
export type SceneSpec = {
  id?: string;
  /** the narration, and its captions: split into sentences, or given as a list of them (each text or a SayLine) */
  say?: string | Array<string | SayLine>;
  /** this scene's narration timing, over the reel's */
  pace?: Pace;
  /** hold this long instead of the narration's length */
  ms?: number;
  /** a scene shape from `kata`, filled in with the fields beside it */
  kata?: string;
  parts?: PartSpec[];
  /** how it comes in: "morph" (default: what stays moves), "cut", "fade", "push" or "wipe", or { type, ms } with its length */
  transition?: TransitionSpec;
  /** when its new parts come in, unless a part says: { delay?, ms?, stagger? } */
  enter?: SceneEnter;
  /** move the camera in on a part, or a list of those, each with a cue */
  focus?: FocusSpec | FocusSpec[];
  /** grow the parts under the heading when they leave the stage mostly empty: true (default, up to 1.6×), "max" (as large as the room allows, up to 4×), or false */
  fill?: boolean | "max" | number;
  /** where the parts under the heading sit in their room (default "center"): an edge or a corner */
  place?: (typeof PLACES)[number];
  /** sounds the scene plays: each `at` ms after it starts, or after sentence `cue` starts */
  sounds?: SoundSpec[];
  /** this scene's margins, over the reel's (0 lets a picture reach the edge) */
  margin?: MarginSpec;
  [field: string]: unknown;
};

/** A voice for the narration: a built-in adapter of kamishibai/tts and its options. */
/**
 * The narration's voice: a built-in provider ("say", "kokoro", "openai",
 * "elevenlabs", "google", "gemini", "polly") or one a `--tts-adapter` module
 * registers, with the provider's options beside it.
 */
export type VoiceSpec = { provider: string; [opt: string]: unknown };

/** One sentence written out: what is spoken, what the caption shows, the voice's options for it alone, and the silence after it (before the next sentence, or after the last before the scene ends). */
export type SayLine = { text: string; caption?: string; voice?: Record<string, unknown>; pause?: number };

/** Burned captions: text and box colours (a theme name or CSS), size in layout units (40 wide, 48 tall), and font role (bold). */
export type CaptionStyle = { color?: string; box?: string; size?: number; font?: "sans" | "bold" | "black" | "mono" };

/** A bar across the foot (or the top) of the picture that fills as the reel plays: its colour, its thickness in layout units, and the colour of the track under it. */
export type ProgressSpec = { color?: string; size?: number; at?: "bottom" | "top"; track?: string };

/** What an overlay is told as it paints: the stage's size, the reel's length, and its scenes on the clock. */
export type OverlayInfo = { W: number; H: number; durationMs: number; timing: ReadonlyArray<{ id: string; start: number; ms: number }> };

/**
 * Drawn over every scene (only in a code reel), outside the camera, in stage
 * units. `room` keeps that much clear at each edge, so the parts and the
 * checks stay out of it. `paint` returns a fingerprint of what it drew, so
 * frames that look the same are drawn once; with none, every frame is drawn.
 */
export type OverlaySpec = {
  paint: (g: Context2D, ms: number, o: OverlayInfo) => string | void;
  room?: { top?: number; right?: number; bottom?: number; left?: number };
};

/** Narration timing, in ms: before the first sentence, between sentences, and after the last before the scene ends. */
export type Pace = { lead?: number; gap?: number; tail?: number };

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
  aspect?: string | number | { min?: string | number; max?: string | number };
  fonts?: FontSource[];
  theme?: ThemeSpec;
  voice?: VoiceSpec;
  /** reading substitutions for the voice only (captions keep the text) */
  lexicon?: Record<string, string>;
  /** a track under the whole reel, lowered while the voice speaks */
  music?: { src: string; gain?: number; duck?: boolean | { amountDb?: number; attackMs?: number; releaseMs?: number }; fadeInMs?: number; fadeOutMs?: number; trimStartMs?: number };
  /** narration timing for every scene (default lead 400, gap 250, tail 700) */
  pace?: Pace;
  /** room kept clear at the stage's edges (default 88 at the top and 96 elsewhere on a wide stage, 120 and 72 on a tall one) */
  margin?: MarginSpec;
  /** how every scene comes in, unless it says (default "morph") */
  transition?: TransitionSpec;
  /** when new parts come in, in every scene, unless it says */
  enter?: SceneEnter;
  /** captions from each scene's `say`: a subtitle track (true, the default), drawn into the picture ("burn"), or none */
  captions?: boolean | "burn";
  /** how burned captions look */
  captionStyle?: CaptionStyle;
  /** keep room at the foot of the stage for the captions (default true when there are captions); false lets the parts use it, and a player's captions cover them */
  captionRoom?: boolean;
  /** a bar at the foot that fills as the reel plays: true (the accent, 10 units), or how it looks */
  progress?: boolean | ProgressSpec;
  /** drawn over every scene, by code (only in a code reel) */
  overlay?: OverlaySpec;
  scenes: SceneSpec[];
};
