// Edit benchmark: the reel described by spec.json (shared by all three
// tools). Each scene: a solid background, a heading, three bullets that enter
// one at a time, and an accent dot that crosses the bottom for the whole
// scene. Scenes are joined by crossfades; a music bed fades in and out.
import { Fragment } from "react";
import { Audio } from "@remotion/media";
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { AbsoluteFill, Easing, interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import spec from "../spec.json";

type Scene = (typeof spec.scenes)[number];
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

const Bullet: React.FC<{ readonly children: string }> = ({ children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = interpolate(frame, [0, 0.5 * fps], [0, 1], { ...clamp, easing: Easing.out(Easing.quad) });
  return <div style={{ fontSize: 56, marginBottom: 28, opacity: p, transform: `translateY(${(1 - p) * 20}px)` }}>• {children}</div>;
};

const SceneView: React.FC<{ readonly s: Scene }> = ({ s }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const x = interpolate(frame, [0, (spec.sceneMs / 1000) * fps], [260, 1660], clamp);
  return (
    <AbsoluteFill style={{ backgroundColor: s.bg }}>
      <div style={{ position: "absolute", left: 260, top: 230 }}>
        <div style={{ fontSize: 72, fontWeight: 700, marginBottom: 56 }}>{s.heading}</div>
        {s.bullets.map((text, i) => (
          <Sequence key={i} from={Math.round(((s.bulletStartMs + i * 600) / 1000) * fps)} layout="none">
            <Bullet>{text}</Bullet>
          </Sequence>
        ))}
      </div>
      <div style={{ position: "absolute", left: x - 30, top: 850, width: 60, height: 60, borderRadius: 30, background: s.accent }} />
    </AbsoluteFill>
  );
};

export const Long: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const sceneFrames = Math.round((spec.sceneMs / 1000) * fps);
  const fadeFrames = Math.round((spec.crossfadeMs / 1000) * fps);
  const volume = interpolate(
    frame,
    [0, (spec.fadeInMs / 1000) * fps, durationInFrames - (spec.fadeOutMs / 1000) * fps, durationInFrames],
    [0, 1, 1, 0],
    clamp,
  );
  return (
    <AbsoluteFill style={{ color: spec.textColor, fontFamily: spec.font }}>
      <TransitionSeries>
        {spec.scenes.map((s, i) => (
          <Fragment key={i}>
            {i > 0 && <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: fadeFrames })} />}
            <TransitionSeries.Sequence durationInFrames={sceneFrames}>
              <SceneView s={s} />
            </TransitionSeries.Sequence>
          </Fragment>
        ))}
      </TransitionSeries>
      <Audio src={staticFile("bgm.mp3")} volume={volume} />
    </AbsoluteFill>
  );
};
