import { Audio } from "@remotion/media";
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import {
  AbsoluteFill,
  Composition,
  Folder,
  interpolate,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Caption } from "./Caption";
import { EndScene } from "./EndScene";
import { ListScene } from "./ListScene";
import { TitleScene } from "./TitleScene";

export const MyComposition = () => {
  return (
    <>
      <Folder name="Scenes">
        <Composition
          id="Title"
          component={TitleScene}
          durationInFrames={128}
          fps={30}
          width={1920}
          height={1080}
        />
        <Composition
          id="List"
          component={ListScene}
          durationInFrames={135}
          fps={30}
          width={1920}
          height={1080}
        />
        <Composition
          id="End"
          component={EndScene}
          durationInFrames={127}
          fps={30}
          width={1920}
          height={1080}
        />
      </Folder>
      <Composition
        id="Scenes"
        component={ScenesVideo}
        durationInFrames={360}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};

export const ScenesVideo: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Scenes are on screen 0–4.25 s, 3.75–8.25 s and 7.75–12 s, joined by
  // 0.5 s crossfades. 4.25 s is 127.5 frames at 30 fps, so the cuts are
  // rounded to whole frames: 128 + 135 + 127 - 2 × 15 = 360 frames.
  return (
    <AbsoluteFill>
      <TransitionSeries name="Scenes">
        <TransitionSeries.Sequence
          name="Title"
          durationInFrames={128}
          premountFor={fps}
        >
          <TitleScene />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: 0.5 * fps })}
        />
        <TransitionSeries.Sequence
          name="List"
          durationInFrames={135}
          premountFor={fps}
        >
          <ListScene />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: 0.5 * fps })}
        />
        <TransitionSeries.Sequence
          name="End"
          durationInFrames={127}
          premountFor={fps}
        >
          <EndScene />
        </TransitionSeries.Sequence>
      </TransitionSeries>

      <Sequence
        name="Caption 1"
        from={0.5 * fps}
        durationInFrames={3 * fps}
        premountFor={fps}
      >
        <Caption>Every frame is rendered from its time.</Caption>
      </Sequence>
      <Sequence
        name="Caption 2"
        from={4.5 * fps}
        durationInFrames={3 * fps}
        premountFor={fps}
      >
        <Caption>We measure speed, tokens and success.</Caption>
      </Sequence>
      <Sequence
        name="Caption 3"
        from={8.5 * fps}
        durationInFrames={3 * fps}
        premountFor={fps}
      >
        <Caption>Same brief, three tools.</Caption>
      </Sequence>

      <Audio
        name="BGM"
        src={staticFile("bgm.mp3")}
        durationInFrames={12 * fps}
        premountFor={fps}
        volume={interpolate(
          frame,
          [0, 1 * fps, 10.5 * fps, 12 * fps],
          [0, 1, 1, 0],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
        )}
      />
    </AbsoluteFill>
  );
};
