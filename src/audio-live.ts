// Audio clips played live in a browser with Web Audio, as the mux would mix
// them: placed at atMs, trimmed, looped, faded, with gain and gain keyframes
// (ducking arrives as keyframes, from applyDucking). The dev player and an
// exported file's player both schedule clips with this.
// ------------------------------------------------------------------
import type { AudioClip } from "./audio.ts";

/** dB at `ms` along linearly interpolated keyframes (held flat outside them). */
export function keyframeDb(kf: Array<{ atMs: number; gain: number }>, ms: number): number {
  if (kf.length === 0) return 0;
  if (ms <= kf[0]!.atMs) return kf[0]!.gain;
  for (let i = 1; i < kf.length; i++) {
    const a = kf[i - 1]!;
    const b = kf[i]!;
    if (ms <= b.atMs) return b.atMs === a.atMs ? b.gain : a.gain + ((b.gain - a.gain) * (ms - a.atMs)) / (b.atMs - a.atMs);
  }
  return kf[kf.length - 1]!.gain;
}

/** How long a clip sounds, given its source's length and the reel's. */
export function clipLength(c: AudioClip, sourceMs: number | undefined, reelMs: number): number | undefined {
  const rest = sourceMs != null ? Math.max(0, sourceMs - (c.trimStartMs ?? 0)) : undefined;
  if (c.loop) return c.durationMs ?? reelMs - c.atMs;
  if (c.durationMs != null) return rest != null ? Math.min(c.durationMs, rest) : c.durationMs;
  return rest;
}

/**
 * Schedule `c` on `a`, with the reel at `nowMs` at the context's current time,
 * into `out`. Returns the source node, or undefined when the clip is over.
 */
export function scheduleClip(
  a: BaseAudioContext,
  out: AudioNode,
  c: AudioClip,
  buf: AudioBuffer,
  nowMs: number,
  reelMs: number,
): AudioBufferSourceNode | undefined {
  const trim = c.trimStartMs ?? 0;
  const len = clipLength(c, buf.duration * 1000, reelMs)!;
  const end = Math.min(c.atMs + len, reelMs);
  if (end <= nowMs) return undefined;
  const startMs = Math.max(c.atMs, nowMs);
  const local = startMs - c.atMs;
  const when = a.currentTime + (startMs - nowMs) / 1000;

  const node = a.createBufferSource();
  node.buffer = buf;
  let offsetMs = trim + local;
  if (c.loop) {
    node.loop = true;
    node.loopStart = trim / 1000;
    node.loopEnd = buf.duration;
    const loopLen = buf.duration * 1000 - trim;
    offsetMs = trim + (loopLen > 0 ? local % loopLen : 0);
  }

  // The level over the clip's own time: gain + keyframes in dB, times the fades.
  const kf = c.gainKeyframes ?? [];
  const level = (ms: number) => {
    let v = 10 ** (((c.gain ?? 0) + keyframeDb(kf, ms)) / 20);
    if (c.fadeInMs && ms < c.fadeInMs) v *= ms / c.fadeInMs;
    if (c.fadeOutMs && ms > len - c.fadeOutMs) v *= Math.max(0, (len - ms) / c.fadeOutMs);
    return v;
  };
  const points = [...kf.map((k) => k.atMs), c.fadeInMs ?? 0, c.fadeOutMs ? len - c.fadeOutMs : 0, len]
    .filter((p) => p > local && p <= len)
    .sort((x, y) => x - y);
  const g = a.createGain();
  g.gain.setValueAtTime(level(local), when);
  for (const p of points) g.gain.linearRampToValueAtTime(level(p), when + (p - local) / 1000);

  node.connect(g).connect(out);
  node.start(when, offsetMs / 1000);
  node.stop(when + (end - startMs) / 1000);
  return node;
}
