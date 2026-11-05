// `kamishibai timing`: where a kit reel's scenes, sentences and sounds fall
// on its clock, with the narration's real lengths (from the TTS cache, or
// synthesized into it as a render would), with no frame drawn.
// ------------------------------------------------------------------
import { loadCanvasEntry, setTTSHook } from "./canvas/node.ts";
import type { SceneTiming } from "./kit/reel.ts";
import { createTTSEngine, type TTSAdapter } from "./tts/engine.ts";

export interface TimingOptions {
  entry: string;
  ttsAdapters?: TTSAdapter[];
  ttsCacheDir?: string;
  onLog?: (msg: string) => void;
}

/** A sound on the reel's clock: a sentence's voice, music, or a scene's sound. */
export type TimedSound = { label?: string; atMs: number; durationMs?: number; src: string };

export interface TimingResult {
  durationMs: number;
  scenes: SceneTiming[];
  audio: TimedSound[];
}

export async function timingEntry(opts: TimingOptions): Promise<TimingResult> {
  let said = false;
  const onProgress = () => void (said || ((said = true), opts.onLog?.("Synthesizing narration (uncached lines only)…")));
  const tts = createTTSEngine({ adapters: opts.ttsAdapters, cacheDir: opts.ttsCacheDir, onProgress });
  setTTSHook((body) => tts.handle(body as Parameters<typeof tts.handle>[0]));
  let entry;
  try {
    entry = await loadCanvasEntry(opts.entry);
  } finally {
    setTTSHook(undefined);
  }
  if (!entry) throw new Error(`${opts.entry} is not a canvas reel: timing reads a kit reel (kamishibai/kit, or a .json / .yaml one)`);
  try {
    const reel = entry.reel as typeof entry.reel & { timing?: SceneTiming[] };
    if (!reel.timing) throw new Error(`${opts.entry} is a canvas reel without scenes: timing reads a kit reel (kamishibai/kit)`);
    const audio = (reel.audio ?? []).map((c) => ({ label: c.label, atMs: c.atMs ?? 0, durationMs: c.durationMs, src: c.src }));
    return { durationMs: reel.meta.durationMs, scenes: reel.timing, audio };
  } finally {
    await entry.close();
  }
}

const s = (ms: number) => `${(ms / 1000).toFixed(2)} s`;

/** The result as lines for a terminal: each scene, its sentences under it, then the sounds. */
export function formatTiming(r: TimingResult): string {
  const out = [`${r.scenes.length} scene${r.scenes.length === 1 ? "" : "s"}, ${s(r.durationMs)}`];
  for (const sc of r.scenes) {
    out.push(`${s(sc.start).padStart(9)}  ${sc.id}  (${s(sc.ms)})`);
    for (const l of sc.say) out.push(`${s(l.atMs).padStart(9)}    ${JSON.stringify(l.text)}  (${s(l.ms)})`);
  }
  if (r.audio.length) {
    out.push("Sounds:");
    for (const a of r.audio) out.push(`${s(a.atMs).padStart(9)}  ${a.label ?? ""}  ${a.src}${a.durationMs !== undefined ? `  (${s(a.durationMs)})` : ""}`);
  }
  return out.join("\n") + "\n";
}
