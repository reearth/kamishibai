import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { fontFamily, TEXT_COLOR } from "./font";

export const EndScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#2A1630",
        justifyContent: "center",
        alignItems: "center",
        fontFamily,
        color: TEXT_COLOR,
      }}
    >
      <div
        style={{
          fontSize: 140,
          fontWeight: 700,
          scale: interpolate(frame, [0, 1 * fps], [0.9, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
            output: "perceptual-scale",
          }),
        }}
      >
        Thanks
      </div>
    </AbsoluteFill>
  );
};
