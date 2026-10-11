import { AbsoluteFill } from "remotion";
import { fontFamily } from "./font";

export const Caption: React.FC<{ readonly children: string }> = ({
  children,
}) => {
  return (
    <AbsoluteFill
      style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 80 }}
    >
      <div
        style={{
          backgroundColor: "rgba(0, 0, 0, 0.6)",
          color: "white",
          fontFamily,
          fontSize: 40,
          lineHeight: 1.3,
          padding: "12px 28px",
          borderRadius: 8,
        }}
      >
        {children}
      </div>
    </AbsoluteFill>
  );
};
