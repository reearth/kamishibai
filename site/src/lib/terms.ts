// The Lexicon of motion: one entry per term.
// ------------------------------------------------------------------
// Shared by the site's pages and by the reels in ../../reels/ that draw
// each term's loop, so it imports nothing.
// ------------------------------------------------------------------

export type Category = "Camera" | "Motion" | "Transition" | "Light";

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
  /** drawn on a dark ground (lighting terms) */
  dark?: boolean;
}

export const CHAPTERS: { cat: Category; ja: string }[] = [
  { cat: "Camera", ja: "カメラ" },
  { cat: "Motion", ja: "動き" },
  { cat: "Transition", ja: "切り替え" },
  { cat: "Light", ja: "照明" },
];

/** Every loop is this long; the reels are drawn so that it repeats seamlessly. */
export const LOOP_MS = 2600;

export const TERMS: Term[] = [
  { id: "pan", cat: "Camera", en: "Pan", ja: "パン",
    desc: "The camera turns left or right from a fixed spot. Everything slides by at the same speed.",
    ask: "Pan right slowly across the skyline over 3 seconds, at an even speed." },
  { id: "truck", cat: "Camera", en: "Truck", ja: "トラック",
    desc: "The camera itself moves sideways. Near things pass faster than far ones: parallax.",
    ask: "Truck left past the posts: the posts in front move fast, the hills behind move slowly." },
  { id: "tilt", cat: "Camera", en: "Tilt", ja: "ティルト",
    desc: "The camera turns up or down from a fixed spot, like nodding.",
    ask: "Tilt up from the street to the top of the tower over 3 seconds." },
  { id: "dolly-in", cat: "Camera", en: "Dolly in", ja: "ドリーイン",
    desc: "The camera moves toward the subject. It grows, and the space around it opens out.",
    ask: "Slow dolly in on the subject over 4 seconds, ending in a close-up." },
  { id: "dolly-zoom", cat: "Camera", en: "Dolly zoom", ja: "ドリーズーム",
    desc: "Dolly out while zooming in. The subject keeps its size while the background stretches. Also called the Vertigo effect.",
    ask: "Dolly zoom on the subject over 2 seconds: move back while zooming in, so the subject stays the same size and the background stretches." },
  { id: "whip-pan", cat: "Camera", en: "Whip pan", ja: "ホイップパン",
    desc: "A pan so fast the picture smears. Often used to cut from one scene to the next.",
    ask: "Whip pan from the first scene to the second in about 0.3 seconds, with motion blur." },
  { id: "rack-focus", cat: "Camera", en: "Rack focus", ja: "ピント送り",
    desc: "Focus moves from one subject to another at a different distance.",
    ask: "Rack focus from the cup in front to the person behind, over 1 second." },

  { id: "ease-in-out", cat: "Motion", en: "Ease in-out", ja: "イーズインアウト",
    desc: "Starts slow, speeds up, slows into place. Most camera and UI moves use it.",
    ask: "Move the card across with an ease-in-out over 0.8 seconds." },
  { id: "overshoot", cat: "Motion", en: "Overshoot", ja: "オーバーシュート",
    desc: "Passes the target, then settles back. Feels springy and alive.",
    ask: "Slide the badge in with a slight overshoot, settling in 0.6 seconds." },
  { id: "anticipation", cat: "Motion", en: "Anticipation", ja: "予備動作",
    desc: "A small move the other way before the main one, so the eye knows it is coming.",
    ask: "Before the arrow shoots right, pull it back a little for 0.2 seconds." },
  { id: "stagger", cat: "Motion", en: "Stagger", ja: "ずらし",
    desc: "The same motion, started a little later for each item.",
    ask: "Bring the bars up one after another, 60 ms apart." },
  { id: "squash-and-stretch", cat: "Motion", en: "Squash and stretch", ja: "つぶしと伸ばし",
    desc: "The shape deforms with speed and impact, while its volume stays the same.",
    ask: "Bounce the ball with squash on impact and a little stretch while falling." },

  { id: "nuki", cat: "Transition", en: "Nuki (pull)", ja: "抜き",
    desc: "The kamishibai card change: the picture is pulled out sideways to show the next. Pulled fast, slowly, or stopped halfway.",
    ask: "Change scenes like a kamishibai card: pull the picture out to the side, stop halfway for a beat, then pull it out." },
  { id: "crossfade", cat: "Transition", en: "Crossfade", ja: "ディゾルブ",
    desc: "One shot fades into the next, and for a moment both are visible.",
    ask: "Crossfade to the next shot over 0.6 seconds." },
  { id: "wipe", cat: "Transition", en: "Wipe", ja: "ワイプ",
    desc: "A moving edge replaces one shot with the next.",
    ask: "Wipe left to right to the next shot over 0.5 seconds." },
  { id: "iris", cat: "Transition", en: "Iris", ja: "アイリス",
    desc: "A circle opens or closes on the picture.",
    ask: "Iris out on the character to end the scene." },
  { id: "push", cat: "Transition", en: "Push", ja: "プッシュ",
    desc: "The next shot pushes the current one out of the frame.",
    ask: "Push the next slide in from the right over 0.5 seconds." },

  { id: "key-light", cat: "Light", en: "Key light", ja: "キーライト", dark: true,
    desc: "The main light. Its direction sets the shape and the mood of the subject.",
    ask: "Light the product with one warm key light from the upper left." },
  { id: "rim-light", cat: "Light", en: "Rim light", ja: "リムライト", dark: true,
    desc: "A light from behind that traces the edge of the subject and lifts it off the background.",
    ask: "Add a rim light from behind so the silhouette separates from the dark background." },
  { id: "color-temperature", cat: "Light", en: "Color temperature", ja: "色温度",
    desc: "Warm light reads as evening or comfort, cool light as night or distance.",
    ask: "Shift the light from warm evening to cool night over 4 seconds." },
];

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
