// kamishibai/subtitle — parse SRT / WebVTT into time-indexed cues.
// ------------------------------------------------------------------
// Framework-free. The React <Subtitle> component (kamishibai/react) draws
// the active cue per frame, but the parser is pure and usable anywhere.
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

/** Parse SRT or WebVTT text into cues (sorted by start). */
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
    cues.push({ start: parseTimestamp(m[1]!), end: parseTimestamp(m[2]!), text: cueText });
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
