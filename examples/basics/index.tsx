// Basics — a showcase of the kamishibai/react sugar + motion primitives.
// ------------------------------------------------------------------
// Spring entrances, staggered reveals, multi-stop tracks, color tweens,
// and a circular iris-out centered on the "k" — all pure functions of the
// clock, so capture stays deterministic.
//
// In your own project the import would be "kamishibai/react"; here it
// points at the source so the example runs straight from the repo.
import React from "react";
import {
  mount,
  Stage,
  useClock,
  ramp,
  track,
  eases,
  spring,
  stagger,
  interpolateColor,
} from "../../src/react/index.tsx";

const FPS = 30;
const DURATION_MS = 6000;
const W = 1920;
const H = 1080;

const c = {
  bg: "#0B0E14",
  bgTo: "#121826",
  ink: "#F2F4F8",
  inkSoft: "#8A93A6",
  cyan: "#5CC8FF",
  violet: "#A78BFA",
  green: "#37FF8B",
  track: "#1B2230",
};
const font = '"Inter", "Helvetica Neue", Arial, sans-serif';

const pop = spring({ stiffness: 140, damping: 13 });
const settle = spring({ stiffness: 120, damping: 18 });

// Staggered "equalizer" — each bar springs to a deterministic height.
const Bars: React.FC = () => {
  const { ms } = useClock();
  const n = 9;
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 18, height: 220 }}>
      {Array.from({ length: n }, (_, i) => {
        const at = 1500 + stagger(i, { each: 70, from: "center", total: n });
        const target = 70 + Math.abs(Math.sin(i * 1.1)) * 150;
        const h = ramp(ms, at, at + 800, 0, target, settle);
        const col = interpolateColor(c.cyan, c.violet, i / (n - 1));
        return <div key={i} style={{ width: 34, height: h, borderRadius: 17, background: col }} />;
      })}
    </div>
  );
};

const Showcase: React.FC = () => {
  const { ms } = useClock();

  // Measure the "k" once so the iris-out can be centred on it. The title
  // settles by ~1.1s, but translateY only shifts the rect vertically, so we
  // subtract the mount-time offset (40px) to get the settled centre.
  const kRef = React.useRef<HTMLSpanElement>(null);
  const [kc, setKc] = React.useState<{ x: number; y: number } | null>(null);
  React.useLayoutEffect(() => {
    const el = kRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setKc({ x: r.left + r.width / 2, y: r.top + r.height / 2 - 40 });
  }, []);

  const bg = interpolateColor(c.bg, c.bgTo, track(ms, [
    { at: 0, value: 0 },
    { at: 3000, value: 1, ease: eases.inOut },
    { at: 6000, value: 0, ease: eases.inOut },
  ]));

  const titleY = ramp(ms, 200, 1100, 40, 0, pop);
  const titleO = ramp(ms, 200, 700, 0, 1, eases.smooth);
  const subO = ramp(ms, 600, 1100, 0, 1, eases.smooth);

  const pct = track(ms, [
    { at: 1600, value: 0 },
    { at: 3600, value: 100, ease: eases.smooth },
  ]);
  const pctColor = interpolateColor(c.cyan, c.green, pct / 100);
  const pctO = ramp(ms, 1600, 2000, 0, 1, eases.smooth);

  const lineW = track(ms, [
    { at: 700, value: 0 },
    { at: 5400, value: 100, ease: eases.inOut },
  ]);

  // Iris-out: a circle centred on the "k" shrinks to nothing at the end.
  const maxR = kc
    ? Math.max(
        Math.hypot(kc.x, kc.y),
        Math.hypot(W - kc.x, kc.y),
        Math.hypot(kc.x, H - kc.y),
        Math.hypot(W - kc.x, H - kc.y),
      )
    : 0;
  const irisR = ramp(ms, DURATION_MS - 650, DURATION_MS - 50, 1, 0, eases.inOut) * maxR;
  const clipPath = kc ? `circle(${irisR}px at ${kc.x}px ${kc.y}px)` : undefined;

  return (
    <Stage background={bg}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          fontFamily: font,
          color: c.ink,
          clipPath,
          WebkitClipPath: clipPath,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          gap: 56,
        }}
      >
        <div style={{ textAlign: "center", transform: `translateY(${titleY}px)` }}>
          <div style={{ fontSize: 104, fontWeight: 800, letterSpacing: 1, opacity: titleO }}>
            <span ref={kRef}>k</span>amishibai
          </div>
          <div style={{ fontSize: 32, color: c.inkSoft, marginTop: 6, opacity: subO }}>
            spring · stagger · track · color — pure functions of time
          </div>
        </div>

        <Bars />

        <div
          style={{
            fontSize: 30,
            color: c.inkSoft,
            display: "flex",
            alignItems: "baseline",
            gap: 14,
            opacity: pctO,
          }}
        >
          rendered
          <span
            style={{ fontSize: 64, fontWeight: 800, color: pctColor, fontVariantNumeric: "tabular-nums" }}
          >
            {Math.round(pct)}%
          </span>
        </div>

        <div style={{ position: "absolute", bottom: 90, width: 980, height: 6, borderRadius: 3, background: c.track }}>
          <div style={{ width: `${lineW}%`, height: "100%", borderRadius: 3, background: c.cyan }} />
        </div>
      </div>
    </Stage>
  );
};

mount(<Showcase />, { fps: FPS, durationMs: DURATION_MS, width: W, height: H });
