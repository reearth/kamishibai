// Audio is a declaration, not a generation step.
// ------------------------------------------------------------------
// kamishibai never makes sound. You hand it files + start times (from a
// TTS, a music track, whatever), and they get muxed at assembly time.
// ------------------------------------------------------------------

export interface AudioClip {
  /** path to an audio file, or a video file whose audio track to use
   *  (relative to the render's working dir, or absolute) */
  src: string;
  /** when this clip starts, in milliseconds from the reel start */
  atMs: number;
  /** volume adjustment in decibels (negative = quieter); default 0 */
  gain?: number;
  /** start offset into the source file, in ms (trim the head) */
  trimStartMs?: number;
  /** how much of the source to use, in ms (trim the tail) */
  durationMs?: number;
  /** linear fade-in over this many ms from the clip's start */
  fadeInMs?: number;
  /** linear fade-out over this many ms at the clip's end (needs durationMs) */
  fadeOutMs?: number;
}

export type AudioManifest = AudioClip[];

/** Identity helper for authoring a manifest with types. */
export function audio(clips: AudioManifest): AudioManifest {
  return clips;
}
