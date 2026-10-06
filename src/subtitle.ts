// kamishibai/subtitle — parse SRT / WebVTT into time-indexed cues.
// ------------------------------------------------------------------
// Framework-free. The React <Subtitle> component (kamishibai/react) declares
// cues for a soft track (or draws the active cue per frame in burn mode), but
// the parser is pure and usable anywhere.
// ------------------------------------------------------------------

export interface Cue {
  /** start time in ms */
  start: number;
  /** end time in ms */
  end: number;
  text: string;
}

/** Parse a timestamp like HH:MM:SS,mmm / HH:MM:SS.mmm / MM:SS.mmm into ms. */
function parseTimestamp(s: string): number {
  const t = s.trim().replace(",", ".");
  const parts = t.split(":");
  let h = 0;
  let m = 0;
  let sec = 0;
  if (parts.length === 3) [h, m, sec] = parts.map(Number) as [number, number, number];
  else if (parts.length === 2) [m, sec] = parts.map(Number) as [number, number];
  else sec = Number(parts[0]);
  return Math.round((h * 3600 + m * 60 + sec) * 1000);
}

/**
 * Whether a cue can ever show: finite times and `end` after `start`. An
 * inverted or zero-length cue never matches cueAt (so burn mode never draws
 * it), and ffmpeg rejects it in a soft track (failing the mux after the whole
 * capture) — so both paths drop it up front and agree.
 */
export function isPlayableCue(c: Cue): boolean {
  return Number.isFinite(c.start) && Number.isFinite(c.end) && c.end > c.start;
}

/** Warn about a cue dropped by isPlayableCue. */
export function warnUnplayable(c: Cue): void {
  console.warn(
    `kamishibai: dropping subtitle cue "${String(c.text ?? "").slice(0, 40)}" — its end (${c.end}ms) ` +
      `is not after its start (${c.start}ms)`,
  );
}

/** Parse SRT or WebVTT text into cues (sorted by start). Cues whose end is not
 *  after their start are dropped with a warning (see isPlayableCue). */
export function parseSubtitles(input: string): Cue[] {
  const text = input
    .replace(/^﻿/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const cues: Cue[] = [];
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.split("\n");
    const idx = lines.findIndex((l) => l.includes("-->"));
    if (idx === -1) continue; // header / NOTE / STYLE / numbering-only blocks
    const m = lines[idx]!.match(/([\d:.,]+)\s*-->\s*([\d:.,]+)/);
    if (!m) continue;
    const cueText = lines.slice(idx + 1).join("\n").trim();
    if (!cueText) continue;
    const cue = { start: parseTimestamp(m[1]!), end: parseTimestamp(m[2]!), text: cueText };
    if (!isPlayableCue(cue)) {
      warnUnplayable(cue);
      continue;
    }
    cues.push(cue);
  }
  cues.sort((a, b) => a.start - b.start);
  return cues;
}

/** The active cue at `ms` (start ≤ ms < end), or undefined. */
export function cueAt(cues: Cue[], ms: number): Cue | undefined {
  for (let i = cues.length - 1; i >= 0; i--) {
    const c = cues[i]!;
    if (c.start <= ms && ms < c.end) return c;
  }
  return undefined;
}

/** Fetch + parse a subtitle file (the src must be reachable by the browser). */
export async function loadSubtitles(src: string): Promise<Cue[]> {
  const res = await fetch(src);
  return parseSubtitles(await res.text());
}

/** Sort cues by start and drop exact duplicates (same start/end/text) — used to
 *  merge cues collected from several <Subtitle>s across parallel capture. Also
 *  drops (with a warning) any cue that can't play, as a last guard for cues
 *  pushed onto window.kamishibai.subtitles directly, so the mux never sees one. */
export function mergeCues(cues: Cue[]): Cue[] {
  const seen = new Set<string>();
  const out: Cue[] = [];
  for (const c of cues) {
    if (!isPlayableCue(c)) {
      warnUnplayable(c);
      continue;
    }
    const key = `${c.start}@${c.end}@${c.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  out.sort((a, b) => a.start - b.start || a.end - b.end);
  return out;
}

/** Format ms as an SRT timestamp: HH:MM:SS,mmm. */
function srtTime(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const millis = total % 1000;
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${p2(h)}:${p2(m)}:${p2(s)},${String(millis).padStart(3, "0")}`;
}

/** Serialize cues to SRT text (merged + sorted first). Empty for no cues. */
export function cuesToSrt(cues: Cue[]): string {
  const merged = mergeCues(cues);
  return merged
    .map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`)
    .join("\n");
}
