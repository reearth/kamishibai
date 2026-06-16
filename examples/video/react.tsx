// Frame-accurate video inside a React reel (kamishibai/react <Video>).
// A title scene, then a scene that plays the clip — so the clip's scope
// starts at a non-zero epoch, exercising the barrier + local clock.
//
//   node dist/cli.js render examples/video/react.tsx \
//     --public examples/video/public -o video-react.mp4
import React from "react";
import { mount, Series, Video, Subtitle, Stage, Enter, useClock } from "../../src/react/index.tsx";

const Title: React.FC = () => (
  <Stage background="#0E1116">
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#F2F4F8",
        font: "700 40px sans-serif",
      }}
    >
      <Enter at={100} dur={500}>clip ↓</Enter>
    </div>
  </Stage>
);

const Clip: React.FC = () => {
  const { ms } = useClock(); // local to this scene
  return (
    <div style={{ position: "absolute", inset: 0, background: "#000" }}>
      {/* The clip's own audio (the 440Hz tone) is muxed automatically —
          trimmed to the scene and faded out at the end. The src is resolved
          against --public; pass muted to drop it. */}
      <Video src="/clip.mp4" fadeOutMs={400} style={{ position: "absolute", inset: 0 }} />
      {/* Captions burned in from a VTT file — cue times are local to this scene. */}
      <Subtitle src="/captions.vtt" bottom={40} style={{ fontSize: 28 }} />
      <div
        style={{
          position: "absolute",
          bottom: 8,
          left: 8,
          color: "#37ff8b",
          font: "20px monospace",
          background: "rgba(0,0,0,0.7)",
          padding: "2px 6px",
        }}
      >
        scene-local {Math.round(ms)}ms
      </div>
    </div>
  );
};

mount(
  <Series>
    <Series.Scene durationMs={1000}>
      <Title />
    </Series.Scene>
    <Series.Scene durationMs={3000} crossfadeMs={300}>
      <Clip />
    </Series.Scene>
  </Series>,
  // total = 1000 + 3000 - 300 (crossfade) = 3700ms
  { fps: 30, durationMs: 3700, width: 480, height: 270 },
);
