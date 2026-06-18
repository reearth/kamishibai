// Narration — TTS as a build pre-pass (kamishibai/tts + <Narration>).
// ------------------------------------------------------------------
// We synthesize the voice-over BEFORE capture (a top-level await), bake it to
// a content-hashed file, and get each line's measured duration back. Then we
// size each scene to its line and drop a <Narration> in — which plays the clip
// AND burns the same text as a caption. text → voice → subtitle, one source.
//
// The dev default is macOS `say` (free, offline, deterministic — macOS only).
// For the final render, swap the adapter for one line — same reel:
//   const voice = openaiAdapter({ model: "tts-1-hd", voice: "nova" });
//   const voice = googleAdapter({ name: "en-US-Neural2-F" });
//   const voice = pollyAdapter({ voiceId: "Matthew", engine: "neural" });
//   const voice = elevenLabsAdapter({ voiceId: "…" });
//
//   node dist/cli.js render examples/narration/index.tsx -o narration.mp4
import React from "react";
import { mount, Series, Stage, Enter, Narration, seriesDuration } from "../../src/react/index.tsx";
import { sayAdapter, prepareNarration, narrationLayout } from "../../src/tts/index.ts";

const FPS = 30;
const W = 1280;
const H = 720;
const PAD_MS = 500; // breathing room appended to each line

const voice = sayAdapter();

// The pre-pass: synthesize once, get { src, durationMs, text } per key. Awaited
// before mount(), so the scenes below can size themselves to the narration.
const vo = await prepareNarration(voice, {
  intro: "Welcome to kamishibai — a tiny engine that turns a web page into a video.",
  how: "Every frame is a pure function of its time, so capture is deterministic and parallel.",
  // A bare string uses the adapter's voice as-is; the object form overrides
  // its opts per line — here, slow this one down (say's words-per-minute rate).
  outro: { text: "Narration is no exception: synthesized up front, cached, and muxed.", opts: { rate: 150 } },
});

const XF = 400; // crossfade between scenes — overlaps, so it shortens the reel

const bg = ["#0B0E14", "#101826", "#0E1414"];

const Slide: React.FC<{ index: number; title: string }> = ({ index, title }) => (
  <Stage background={bg[index]}>
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 12%",
        textAlign: "center",
        color: "#F2F4F8",
        font: "700 56px 'Hiragino Sans', system-ui, sans-serif",
        lineHeight: 1.3,
      }}
    >
      <Enter at={120} dur={600}>{title}</Enter>
    </div>
  </Stage>
);

// narrationLayout sizes one scene per line to its *measured* duration (+ pad),
// with a uniform crossfade. We just add each scene's visuals; meta.durationMs
// is then derived from the same specs with seriesDuration, so the reel can't
// drift from what renders (forget the crossfades and you get trailing blanks).
const titles = ["kamishibai", "pure function of time", "voice baked up front"];

const scenes = narrationLayout([vo.intro, vo.how, vo.outro], {
  padMs: PAD_MS,
  crossfadeMs: XF,
}).map(({ clip, ...spec }, i) => ({
  ...spec,
  content: (
    <>
      <Slide index={i} title={titles[i]!} />
      <Narration clip={clip} subtitle fadeOutMs={i === titles.length - 1 ? 300 : undefined} />
    </>
  ),
}));

mount(<Series scenes={scenes} />, {
  fps: FPS,
  durationMs: seriesDuration(scenes),
  width: W,
  height: H,
});
