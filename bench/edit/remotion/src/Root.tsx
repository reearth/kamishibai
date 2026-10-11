import { Composition } from "remotion";
import spec from "../spec.json";
import { Long } from "./Long";

const fps = spec.fps;
const frames = (ms: number) => Math.round((ms * fps) / 1000);
const total = spec.scenes.length * frames(spec.sceneMs) - (spec.scenes.length - 1) * frames(spec.crossfadeMs);

export const RemotionRoot: React.FC = () => (
  <Composition id="Long" component={Long} durationInFrames={total} fps={fps} width={spec.width} height={spec.height} />
);
