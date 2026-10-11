import { AbsoluteFill } from "remotion";
import { fontFamily, TEXT_COLOR } from "./font";

export const TitleScene: React.FC = () => {
  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#0B0E14",
        justifyContent: "center",
        alignItems: "center",
        fontFamily,
        color: TEXT_COLOR,
      }}
    >
      <div style={{ fontSize: 110, fontWeight: 700 }}>kamishibai benchmark</div>
      <div style={{ fontSize: 48, opacity: 0.6, marginTop: 24 }}>
        T2 · scenes
      </div>
    </AbsoluteFill>
  );
};
