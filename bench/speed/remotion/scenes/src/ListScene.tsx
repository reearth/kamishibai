import {
  AbsoluteFill,
  Easing,
  interpolate,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { fontFamily, TEXT_COLOR } from "./font";

const Bullet: React.FC<{ readonly children: string }> = ({ children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <div
      style={{
        fontSize: 56,
        opacity: interpolate(frame, [0, 0.5 * fps], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.bezier(0.16, 1, 0.3, 1),
        }),
        translate: interpolate(
          frame,
          [0, 0.5 * fps],
          ["0px 20px", "0px 0px"],
          {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          },
        ),
      }}
    >
      • {children}
    </div>
  );
};

const BULLET_TOP = 420;
const BULLET_SPACING = 96;

export const ListScene: React.FC = () => {
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill
      style={{ backgroundColor: "#13233A", fontFamily, color: TEXT_COLOR }}
    >
      <div
        style={{
          position: "absolute",
          top: 240,
          left: 360,
          fontSize: 72,
          fontWeight: 700,
        }}
      >
        What we measure
      </div>
      <Sequence
        name="Render time"
        from={0.4 * fps}
        premountFor={fps}
        style={{ top: BULLET_TOP, left: 360 }}
      >
        <Bullet>Render time</Bullet>
      </Sequence>
      <Sequence
        name="Tokens"
        from={1.0 * fps}
        premountFor={fps}
        style={{ top: BULLET_TOP + BULLET_SPACING, left: 360 }}
      >
        <Bullet>Tokens</Bullet>
      </Sequence>
      <Sequence
        name="Success rate"
        from={1.6 * fps}
        premountFor={fps}
        style={{ top: BULLET_TOP + 2 * BULLET_SPACING, left: 360 }}
      >
        <Bullet>Success rate</Bullet>
      </Sequence>
    </AbsoluteFill>
  );
};
