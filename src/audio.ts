// Audio is a declaration, not a generation step.
// ------------------------------------------------------------------
// kamishibai never makes sound. You hand it files + start times (from a
// TTS, a music track, whatever), and they get muxed at assembly time.
// ------------------------------------------------------------------

export interface AudioClip {
  /** path to an audio file (relative to cwd or absolute) */
  src: string;
  /** when this clip starts, in milliseconds from the reel start */
  atMs: number;
  /** volume adjustment in decibels (negative = quieter); default 0 */
  gain?: number;
}

export type AudioManifest = AudioClip[];

/** Identity helper for authoring a manifest with types. */
export function audio(clips: AudioManifest): AudioManifest {
  return clips;
}
