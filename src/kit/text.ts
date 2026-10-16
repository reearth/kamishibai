// Text measured on the host's own canvas: Skia in Node, the browser's in a
// page. The layout measures with the context that later fills the text, so
// what it measured is what ends up on screen, on either host.
// ------------------------------------------------------------------
import type { Context2D } from "../canvas/types.ts";
import type { FontRole, Theme } from "./theme.ts";

export class Fonts {
  private widths = new Map<string, number>();
  private vertical = new Map<FontRole, { asc: number; desc: number }>();

  constructor(
    private g: Context2D,
    readonly theme: Theme,
  ) {}

  css(role: FontRole, size: number): string {
    const t = this.theme;
    const weight = role === "bold" ? t.weights.bold : role === "black" ? t.weights.black : t.weights.body;
    return `${weight} ${size}px ${role === "mono" ? t.fonts.mono : t.fonts.sans}`;
  }

  measure(s: string, role: FontRole, size: number, track = 0): number {
    const key = `${role}|${size}|${track}|${s}`;
    let w = this.widths.get(key);
    if (w === undefined) {
      this.g.font = this.css(role, size);
      this.g.letterSpacing = `${track * size}px`;
      w = this.g.measureText(s).width;
      this.widths.set(key, w);
    }
    return w;
  }

  /** The face's ascent and descent in em, to put the baseline inside a line box. */
  metrics(role: FontRole): { asc: number; desc: number } {
    let m = this.vertical.get(role);
    if (!m) {
      this.g.font = this.css(role, 1000);
      this.g.letterSpacing = "0px";
      this.g.textBaseline = "alphabetic";
      const t = this.g.measureText("Hg漢");
      m = { asc: t.fontBoundingBoxAscent / 1000, desc: t.fontBoundingBoxDescent / 1000 };
      // A host that reports no font box (an old browser): the usual proportions.
      if (!(m.asc > 0)) m = { asc: 0.88, desc: 0.12 };
      this.vertical.set(role, m);
    }
    return m;
  }

  /** Break `s` into lines no wider than `maxW` (an explicit "\n" always breaks). */
  wrap(s: string, role: FontRole, size: number, maxW: number, track = 0): string[] {
    const lines: string[] = [];
    for (const para of s.split("\n")) {
      let line = "";
      const ts = tokens(para).flatMap((t) => (isWide(t[0]!) && this.measure(t, role, size, track) > maxW ? [...t] : [t]));
      for (const t of ts) {
        const next = line + t;
        if (line && this.measure(next.trimEnd(), role, size, track) > maxW) {
          lines.push(line.trimEnd());
          line = t === " " ? "" : t;
        } else line = next;
      }
      lines.push(line.trimEnd());
    }
    return lines;
  }

  /** As wrap, at the narrowest width that needs no more lines (CSS text-wrap: balance). */
  balance(s: string, role: FontRole, size: number, maxW: number, track = 0): string[] {
    const ls = this.wrap(s, role, size, maxW, track);
    if (ls.length < 2 || !isFinite(maxW)) return ls;
    let [lo, hi] = [0, maxW];
    while (hi - lo > 2) {
      const mid = (lo + hi) / 2;
      if (this.wrap(s, role, size, mid, track).length > ls.length) lo = mid;
      else hi = mid;
    }
    return this.wrap(s, role, size, hi, track);
  }
}

// Characters a line may not start with, and may not end with (JIS X 4051, short).
const noStart = new Set([..."、。，．・：；？！ー」』）】〉》〕ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ々…‥,.!?:;)]}"]);
const noEnd = new Set([..."「『（【〈《〔([{"]);
const isWide = (ch: string) => /[　-鿿＀-￯]/.test(ch);
const kanaOnly = /^[ぁ-ゟー]+$/;
let segmenter: Intl.Segmenter | undefined;

/**
 * Split into units that may not be broken: a latin word, or a Japanese phrase.
 * A phrase is a word with the hiragana after it (particles, endings), so a
 * line breaks as 「期限切れの／判定が、」 and not inside a word.
 */
export function tokens(s: string): string[] {
  segmenter ??= new Intl.Segmenter("ja", { granularity: "word" });
  const out: string[] = [];
  for (const { segment: w } of segmenter.segment(s)) {
    const prev = out[out.length - 1];
    if (/\s/.test(w)) out.push(" ");
    else if (prev && prev !== " " && kanaOnly.test(w) && isWide(prev[prev.length - 1]!) && !noEnd.has(prev[prev.length - 1]!)) out[out.length - 1] = prev + w;
    else out.push(w);
  }
  // Glue kinsoku characters to their neighbour so a break never lands on them.
  const glued: string[] = [];
  for (const t of out) {
    const prev = glued[glued.length - 1];
    if (prev !== undefined && (noStart.has(t[0]!) || noEnd.has(prev[prev.length - 1]!))) glued[glued.length - 1] = prev + t;
    else glued.push(t);
  }
  return glued;
}

/**
 * Split narration into sentences: after 。！？ (and the closing brackets
 * that follow), and after . ! ? before a space.
 */
export function sentences(s: string): string[] {
  const out: string[] = [];
  const chars = [...s];
  const close = /[」』）)"'”’]/;
  let cur = "";
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    cur += ch;
    const wide = /[。！？]/.test(ch);
    if (!wide && !/[.!?]/.test(ch)) continue;
    // Keep a run of marks and the closing brackets after them in this sentence.
    while (i + 1 < chars.length && (/[。！？.!?]/.test(chars[i + 1]!) || close.test(chars[i + 1]!))) cur += chars[++i];
    // A latin mark ends a sentence only before a space or the end (3.5 and e.g. don't).
    if (wide || i + 1 >= chars.length || /\s/.test(chars[i + 1]!)) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/**
 * A guessed spoken length, for a scene with no audio yet: Japanese at about
 * 7.5 characters a second, other text at about 14.
 */
export function speechMs(s: string): number {
  let wide = 0;
  let narrow = 0;
  for (const ch of s) {
    if (/\s/.test(ch)) continue;
    if (isWide(ch)) wide++;
    else narrow++;
  }
  return Math.round((wide / 7.5 + narrow / 14) * 1000);
}
