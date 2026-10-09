// The Lexicon of motion: one entry per term, one file of terms per chapter
// in ./terms/. A term's loop is drawn by ./draw.ts, under the same id.
import { TERMS as camera } from "./terms/camera.ts";
import { TERMS as motion } from "./terms/motion.ts";
import { TERMS as transition } from "./terms/transition.ts";
import { TERMS as editing } from "./terms/editing.ts";
import { TERMS as light } from "./terms/light.ts";
import { TERMS as type } from "./terms/type.ts";
import { TERMS as shape } from "./terms/shape.ts";
import { TERMS as distortion } from "./terms/distortion.ts";
import { TERMS as texture } from "./terms/texture.ts";
import { TERMS as generative } from "./terms/generative.ts";

export type Category = "Camera" | "Motion" | "Transition" | "Editing" | "Light" | "Type" | "Shape" | "Distortion" | "Texture" | "Generative";

export interface Term {
  /** the permalink slug: /lexicon/<id>/ */
  id: string;
  cat: Category;
  en: string;
  ja: string;
  /** what it is, in a sentence or two */
  desc: string;
  /** words to hand to an agent that makes the video */
  ask: string;
  /** drawn on a dark ground (NIGHT in draw/kit.ts), as light is */
  dark?: boolean;
}

export const CHAPTERS: { cat: Category; ja: string }[] = [
  { cat: "Camera", ja: "カメラ" },
  { cat: "Motion", ja: "動き" },
  { cat: "Transition", ja: "切り替え" },
  { cat: "Editing", ja: "編集" },
  { cat: "Light", ja: "光" },
  { cat: "Type", ja: "文字" },
  { cat: "Shape", ja: "図形" },
  { cat: "Distortion", ja: "歪み" },
  { cat: "Texture", ja: "質感" },
  { cat: "Generative", ja: "ジェネラティブ" },
];

/** Every loop is this long; the reels are drawn so that it repeats seamlessly. */
export const LOOP_MS = 2600;

export const TERMS: Term[] = [camera, motion, transition, editing, light, type, shape, distortion, texture, generative].flat();

/** A card in the deck: a chapter's title card, or a term. */
export type DeckCard =
  | { kind: "chapter"; id: string; cat: Category; ja: string; chapter: number; count: number }
  | ({ kind: "term"; no: number } & Term);

/** The deck: each chapter's title card, then its terms. */
export function buildDeck(): DeckCard[] {
  const deck: DeckCard[] = [];
  let no = 0;
  CHAPTERS.forEach(({ cat, ja }, i) => {
    const terms = TERMS.filter((t) => t.cat === cat);
    deck.push({ kind: "chapter", id: cat.toLowerCase(), cat, ja, chapter: i + 1, count: terms.length });
    for (const t of terms) deck.push({ kind: "term", no: ++no, ...t });
  });
  return deck;
}
