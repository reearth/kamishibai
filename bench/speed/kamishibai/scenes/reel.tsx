import type { ReactNode } from "react";
import { mount, Series, Stage, Enter, Cue, Bgm, Subtitle, useClock, ramp, eases, seriesDuration } from "kamishibai/react";

const TEXT = "#F2F4F8";
const FONT = '"Inter", "Helvetica Neue", Helvetica, Arial, sans-serif';
const CROSSFADE_MS = 500;

const Centered = ({ children }: { children: ReactNode }) => (
  <div
    style={{
      position: "absolute",
      inset: 0,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      textAlign: "center",
    }}
  >
    {children}
  </div>
);

const TitleScene = () => (
  <Stage background="#0B0E14">
    <Centered>
      <div style={{ fontSize: 110, fontWeight: 700 }}>kamishibai benchmark</div>
      <div style={{ fontSize: 48, opacity: 0.6, marginTop: 28 }}>T2 · scenes</div>
    </Centered>
  </Stage>
);

const BULLETS = ["Render time", "Tokens", "Success rate"];

const ListScene = () => (
  <Stage background="#13233A">
    <div style={{ position: "absolute", left: 260, top: 230 }}>
      <div style={{ fontSize: 72, fontWeight: 700, marginBottom: 56 }}>What we measure</div>
      {BULLETS.map((text, i) => (
        <Enter key={text} at={400 + i * 600} dur={500} lift={20} style={{ fontSize: 56, marginBottom: 28 }}>
          • {text}
        </Enter>
      ))}
    </div>
  </Stage>
);

const EndScene = () => {
  const { ms } = useClock();
  const scale = ramp(ms, 0, 1000, 0.9, 1, eases.smooth);
  return (
    <Stage background="#2A1630">
      <Centered>
        <div style={{ fontSize: 140, fontWeight: 700, transform: `scale(${scale})` }}>Thanks</div>
      </Centered>
    </Stage>
  );
};

const scenes = [
  { durationMs: 4250, content: <TitleScene /> },
  { durationMs: 4500, crossfadeMs: CROSSFADE_MS, content: <ListScene /> },
  { durationMs: 4250, crossfadeMs: CROSSFADE_MS, content: <EndScene /> },
];

const CAPTIONS = [
  { start: 500, end: 3500, text: "Every frame is rendered from its time." },
  { start: 4500, end: 7500, text: "We measure speed, tokens and success." },
  { start: 8500, end: 11500, text: "Same brief, three tools." },
];

const Reel = () => (
  <div style={{ position: "absolute", inset: 0, color: TEXT, fontFamily: FONT }}>
    <Bgm src="assets/bgm.mp3" fadeInMs={1000} fadeOutMs={1500} />
    <Series scenes={scenes} />
    {CAPTIONS.map((c) => (
      <Cue key={c.start} at={c.start} hold={c.end - c.start}>
        <Subtitle style={{ fontFamily: FONT, fontSize: 40, background: "rgba(0, 0, 0, 0.6)" }}>{c.text}</Subtitle>
      </Cue>
    ))}
  </div>
);

mount(<Reel />, { fps: 30, durationMs: seriesDuration(scenes), width: 1920, height: 1080 });
