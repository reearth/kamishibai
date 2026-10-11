// Edit benchmark: the reel described by spec.json (shared by all three
// tools). Each scene: a solid background, a heading, three bullets that enter
// one at a time, and an accent dot that crosses the bottom for the whole
// scene. Scenes are joined by crossfades; a music bed fades in and out.
import { mount, Series, Stage, Enter, Bgm, useClock, ramp } from "kamishibai/react";
import spec from "./spec.json";

type Scene = (typeof spec.scenes)[number];

const Dot = ({ color }: { color: string }) => {
  const { ms } = useClock();
  const x = ramp(ms, 0, spec.sceneMs, 260, 1660);
  return <div style={{ position: "absolute", left: x - 30, top: 850, width: 60, height: 60, borderRadius: 30, background: color }} />;
};

const SceneView = ({ s }: { s: Scene }) => (
  <Stage background={s.bg}>
    <div style={{ position: "absolute", left: 260, top: 230 }}>
      <div style={{ fontSize: 72, fontWeight: 700, marginBottom: 56 }}>{s.heading}</div>
      {s.bullets.map((text, i) => (
        <Enter key={i} at={s.bulletStartMs + i * 600} dur={500} lift={20} style={{ fontSize: 56, marginBottom: 28 }}>
          • {text}
        </Enter>
      ))}
    </div>
    <Dot color={s.accent} />
  </Stage>
);

const scenes = spec.scenes.map((s, i) => ({
  durationMs: spec.sceneMs,
  ...(i > 0 ? { crossfadeMs: spec.crossfadeMs } : {}),
  content: <SceneView s={s} />,
}));
const durationMs = spec.scenes.length * spec.sceneMs - (spec.scenes.length - 1) * spec.crossfadeMs;

const Reel = () => (
  <div style={{ position: "absolute", inset: 0, color: spec.textColor, fontFamily: spec.font }}>
    <Bgm src="assets/bgm.mp3" fadeInMs={spec.fadeInMs} fadeOutMs={spec.fadeOutMs} />
    <Series scenes={scenes} />
  </div>
);

mount(<Reel />, { fps: spec.fps, durationMs, width: spec.width, height: spec.height });
