// Basics — a generic showcase of the kamishibai/react sugar.
// ------------------------------------------------------------------
// Demonstrates the core moves with no domain knowledge required:
//   - fade + rise in, and fade out         (opacity / transform from `ms`)
//   - an eased progress meter + count-up    (ramp + eases)
//   - staggered "pop" reveals               (Cue + Enter)
//   - eased motion across the screen        (ramp + eases.inOut)
//
// In your own project the import would be "kamishibai/react"; here it
// points at the source so the example runs straight from the repo.
import React from "react";
import { mount, Stage, Cue, Enter, ramp, eases, useClock } from "../../src/react/index.tsx";

const FPS = 30;
const DURATION_MS = 6000;

const c = {
  bg: "#0E1116",
  panel: "#1A1F27",
  ink: "#F2F4F8",
  inkSoft: "#9AA4B2",
  line: "#2A313C",
  accent: "#5CC8FF",
  accent2: "#A78BFA",
  track: "#222932",
};

const font = '"Inter", "Helvetica Neue", Arial, sans-serif';

// A number that eases from 0 up to `to` over a time window.
const CountUp: React.FC<{ to: number; at: number; dur: number; suffix?: string }> = ({
  to,
  at,
  dur,
  suffix = "",
}) => {
  const { ms } = useClock();
  const v = ramp(ms, at, at + dur, 0, to, eases.smooth);
  return (
    <span style={{ fontVariantNumeric: "tabular-nums" }}>
      {Math.round(v)}
      {suffix}
    </span>
  );
};

// A horizontal bar that fills from 0 to `to` (0..1) over a time window.
const Meter: React.FC<{ to: number; at: number; dur: number; color: string }> = ({
  to,
  at,
  dur,
  color,
}) => {
  const { ms } = useClock();
  const p = ramp(ms, at, at + dur, 0, to, eases.smooth);
  return (
    <div
      style={{
        width: 720,
        height: 22,
        borderRadius: 11,
        background: c.track,
        overflow: "hidden",
      }}
    >
      <div style={{ width: `${p * 100}%`, height: "100%", borderRadius: 11, background: color }} />
    </div>
  );
};

const Showcase: React.FC = () => {
  const { ms } = useClock();

  // Title fades + rises in early, then gently fades out near the end.
  const titleOut = ramp(ms, DURATION_MS - 700, DURATION_MS - 200, 1, 0, eases.inOut);

  // A dot glides across with an ease-in-out curve.
  const dotX = ramp(ms, 1200, 4200, 0, 560, eases.inOut);

  return (
    <Stage background={c.bg}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          fontFamily: font,
          color: c.ink,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          gap: 64,
        }}
      >
        {/* Title: fade + rise in, then fade out */}
        <div style={{ opacity: titleOut, textAlign: "center" }}>
          <Enter at={150} dur={650} lift={30}>
            <div style={{ fontSize: 96, fontWeight: 800, letterSpacing: 1 }}>kamishibai</div>
          </Enter>
          <Enter at={400} dur={650}>
            <div style={{ fontSize: 34, color: c.inkSoft, marginTop: 8 }}>
              a web page, captured frame by frame
            </div>
          </Enter>
        </div>

        {/* Progress meter + count-up */}
        <Cue at={900}>
          <Enter dur={500} style={{ display: "flex", flexDirection: "column", gap: 18, alignItems: "center" }}>
            <div style={{ display: "flex", justifyContent: "space-between", width: 720, fontSize: 26 }}>
              <span style={{ color: c.inkSoft }}>progress</span>
              <span style={{ color: c.accent, fontWeight: 700 }}>
                <CountUp to={100} at={900} dur={2400} suffix="%" />
              </span>
            </div>
            <Meter to={1} at={900} dur={2400} color={c.accent} />
          </Enter>
        </Cue>

        {/* Staggered "pop" reveals */}
        <div style={{ display: "flex", gap: 22 }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <Cue key={i} at={2600 + i * 130}>
              <Enter dur={420} lift={20} ease={eases.pop}>
                <div
                  style={{
                    width: 96,
                    height: 96,
                    borderRadius: 20,
                    background: c.panel,
                    border: `1px solid ${c.line}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 40,
                    color: c.accent2,
                  }}
                >
                  {i + 1}
                </div>
              </Enter>
            </Cue>
          ))}
        </div>

        {/* Eased motion: a dot glides left → right */}
        <div style={{ position: "relative", width: 560, height: 16 }}>
          <div
            style={{
              position: "absolute",
              top: 0,
              left: dotX,
              width: 16,
              height: 16,
              borderRadius: "50%",
              background: c.accent2,
            }}
          />
        </div>

        {/* Caption appears partway through */}
        <Cue at={3800}>
          <Enter dur={600} style={{ position: "absolute", bottom: 90 }}>
            <div style={{ fontSize: 26, color: c.inkSoft }}>
              every frame is a pure function of time
            </div>
          </Enter>
        </Cue>
      </div>
    </Stage>
  );
};

mount(<Showcase />, { fps: FPS, durationMs: DURATION_MS, width: 1920, height: 1080 });
