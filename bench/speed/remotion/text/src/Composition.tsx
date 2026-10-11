import { loadFont } from "@remotion/google-fonts/Inter";
import {
  AbsoluteFill,
  Composition,
  Easing,
  interpolate,
  interpolateColors,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

const { fontFamily } = loadFont("normal", {
  weights: ["500", "700"],
  subsets: ["latin"],
});

const TEXT_COLOR = "#F2F4F8";
const ACCENT_COLOR = "#F2C94C";
const BAR_MAX_WIDTH = 900;
const LABEL_WIDTH = 220;
const LABEL_GAP = 32;
const COLUMN_LEFT = (1920 - (LABEL_WIDTH + LABEL_GAP + BAR_MAX_WIDTH)) / 2;

export const MyComposition = () => {
  return (
    <Composition
      id="TitleSequence"
      component={TitleSequence}
      durationInFrames={240}
      fps={30}
      width={1920}
      height={1080}
    />
  );
};

type BarProps = {
  readonly label: string;
  readonly value: number;
  readonly top: number;
};

const Bar: React.FC<BarProps> = ({ label, value, top }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <div
      style={{
        position: "absolute",
        top,
        left: COLUMN_LEFT,
        height: 48,
        display: "flex",
        alignItems: "center",
        gap: LABEL_GAP,
      }}
    >
      <div
        style={{
          width: LABEL_WIDTH,
          textAlign: "right",
          fontSize: 40,
          fontWeight: 500,
          color: TEXT_COLOR,
        }}
      >
        {label}
      </div>
      <div
        style={{
          height: 40,
          borderRadius: 6,
          backgroundColor: ACCENT_COLOR,
          width: interpolate(
            frame,
            [0, 0.5 * fps],
            [0, value * BAR_MAX_WIDTH],
            {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.out(Easing.cubic),
            },
          ),
        }}
      />
    </div>
  );
};

export const TitleSequence: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const count = Math.round(
    interpolate(frame, [2.5 * fps, 4.5 * fps], [0, 2026], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    }),
  );

  return (
    <AbsoluteFill
      style={{
        backgroundColor: interpolateColors(
          frame,
          [0, 8 * fps],
          ["#0B0E14", "#121826"],
        ),
        fontFamily,
      }}
    >
      <AbsoluteFill
        style={{
          // Fade everything out so that the last frame shows only the background.
          opacity: interpolate(
            frame,
            [6.5 * fps, durationInFrames - 1],
            [1, 0],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
          ),
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 200,
            width: "100%",
            textAlign: "center",
            fontSize: 96,
            fontWeight: 700,
            color: TEXT_COLOR,
            opacity: interpolate(frame, [0, 0.8 * fps], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
            translate: interpolate(
              frame,
              [0, 0.8 * fps],
              ["0px 60px", "0px 0px"],
              {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              },
            ),
          }}
        >
          Every frame is a function of time
        </div>

        <Sequence name="Seek" from={1 * fps} premountFor={fps}>
          <Bar label="Seek" value={0.4} top={440} />
        </Sequence>
        <Sequence name="Capture" from={1.5 * fps} premountFor={fps}>
          <Bar label="Capture" value={0.7} top={520} />
        </Sequence>
        <Sequence name="Encode" from={2 * fps} premountFor={fps}>
          <Bar label="Encode" value={0.95} top={600} />
        </Sequence>

        <Sequence name="Counter" from={2.5 * fps} premountFor={fps}>
          <div
            style={{
              position: "absolute",
              top: 700,
              width: "100%",
              textAlign: "center",
              fontSize: 120,
              lineHeight: "120px",
              fontWeight: 700,
              fontVariantNumeric: "tabular-nums",
              color: TEXT_COLOR,
            }}
          >
            {count}
          </div>
        </Sequence>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
