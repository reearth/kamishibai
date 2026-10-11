import { mount, Stage, useClock, ramp, eases, interpolateColor } from "kamishibai/react";

const FPS = 30;
const DURATION_MS = 8000;

const TEXT = "#F2F4F8";
const ACCENT = "#F2C94C";
const FONT = '"Inter", "Helvetica Neue", Helvetica, Arial, sans-serif';

const BAR_MAX_PX = 900;
const BARS = [
  { label: "Seek", share: 0.4 },
  { label: "Capture", share: 0.7 },
  { label: "Encode", share: 0.95 },
];

const Title = () => {
  const { ms } = useClock();
  const p = ramp(ms, 0, 800, 0, 1, eases.smooth); // ease-out, no overshoot
  return (
    <div
      style={{
        position: "absolute",
        top: 200,
        left: 0,
        right: 0,
        textAlign: "center",
        fontSize: 96,
        fontWeight: 700,
        opacity: p,
        transform: `translateY(${(1 - p) * 60}px)`,
      }}
    >
      Every frame is a function of time
    </div>
  );
};

const Bars = () => {
  const { ms } = useClock();
  return (
    <div
      style={{
        position: "absolute",
        top: 420,
        left: (1920 - (220 + 32 + BAR_MAX_PX)) / 2,
        display: "flex",
        flexDirection: "column",
        gap: 36,
      }}
    >
      {BARS.map((bar, i) => {
        const start = 1000 + i * 500;
        const t = ramp(ms, start, start + 500, 0, 1, eases.smooth);
        return (
          <div key={bar.label} style={{ display: "flex", alignItems: "center", gap: 32, opacity: ms < start ? 0 : 1 }}>
            <div style={{ width: 220, textAlign: "right", fontSize: 44, fontWeight: 500 }}>{bar.label}</div>
            <div style={{ width: BAR_MAX_PX * bar.share * t, height: 48, borderRadius: 6, background: ACCENT }} />
          </div>
        );
      })}
    </div>
  );
};

const Counter = () => {
  const { ms } = useClock();
  const value = Math.round(ramp(ms, 2500, 4500, 0, 2026, eases.smooth));
  return (
    <div
      style={{
        position: "absolute",
        top: 720,
        left: 0,
        right: 0,
        textAlign: "center",
        fontSize: 120,
        lineHeight: 1,
        fontWeight: 700,
        fontVariantNumeric: "tabular-nums",
        opacity: ms < 2500 ? 0 : 1,
      }}
    >
      {value}
    </div>
  );
};

const Reel = () => {
  const { ms, durationMs, fps } = useClock();
  const background = interpolateColor("#0B0E14", "#121826", ms / durationMs);
  // Fade out from 6.5 s so the last sampled frame is pure background.
  const lastFrameMs = durationMs - 1000 / fps;
  const contentOpacity = ramp(ms, 6500, lastFrameMs, 1, 0);
  return (
    <Stage background={background} style={{ color: TEXT, fontFamily: FONT }}>
      <div style={{ position: "absolute", inset: 0, opacity: contentOpacity }}>
        <Title />
        <Bars />
        <Counter />
      </div>
    </Stage>
  );
};

mount(<Reel />, { fps: FPS, durationMs: DURATION_MS, width: 1920, height: 1080 });
