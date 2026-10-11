import { loadFont } from "@remotion/google-fonts/Inter";
import { ThreeCanvas } from "@remotion/three";
import { useThree } from "@react-three/fiber";
import { useLayoutEffect, useMemo } from "react";
import {
  AbsoluteFill,
  Composition,
  Easing,
  interpolate,
  random,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

const { fontFamily } = loadFont("normal", {
  weights: ["600"],
  subsets: ["latin"],
});

const SPHERE_COUNT = 500;
const BOX = { width: 40, height: 20, depth: 30 };
const ORBIT_RADIUS = 48;
const ORBIT_HEIGHT = 10;

export const MyComposition = () => {
  return (
    <Composition
      id="SphereField"
      component={SphereField}
      durationInFrames={180}
      fps={30}
      width={1920}
      height={1080}
    />
  );
};

type SphereData = {
  readonly position: [number, number, number];
  readonly radius: number;
  readonly color: string;
};

const Spheres: React.FC = () => {
  // Seeded with remotion's random(), so every render places them identically.
  const spheres = useMemo<SphereData[]>(() => {
    return new Array(SPHERE_COUNT).fill(true).map((_, i) => ({
      position: [
        (random(`x-${i}`) - 0.5) * BOX.width,
        (random(`y-${i}`) - 0.5) * BOX.height,
        (random(`z-${i}`) - 0.5) * BOX.depth,
      ],
      radius: 0.1 + random(`r-${i}`) * 0.2,
      color: `hsl(${Math.floor(random(`h-${i}`) * 360)}, 60%, 55%)`,
    }));
  }, []);

  return (
    <>
      {spheres.map((s, i) => (
        <mesh key={i} position={s.position}>
          <sphereGeometry args={[s.radius, 32, 16]} />
          <meshStandardMaterial color={s.color} />
        </mesh>
      ))}
    </>
  );
};

const OrbitingCamera: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const camera = useThree((state) => state.camera);

  // Constant speed: 30 degrees over the 6 seconds.
  const angle =
    (interpolate(frame, [0, 6 * fps], [0, 30]) * Math.PI) / 180;

  useLayoutEffect(() => {
    camera.position.set(
      Math.sin(angle) * ORBIT_RADIUS,
      ORBIT_HEIGHT,
      Math.cos(angle) * ORBIT_RADIUS,
    );
    camera.lookAt(0, 0, 0);
  }, [camera, angle]);

  return null;
};

const LowerThird: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        bottom: 120,
        paddingLeft: 96,
        translate: interpolate(
          frame,
          [0, 0.5 * fps, 3.5 * fps, 4 * fps],
          ["-100% 0%", "0% 0%", "0% 0%", "-100% 0%"],
          {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: [
              Easing.bezier(0.16, 1, 0.3, 1),
              Easing.linear,
              Easing.bezier(0.7, 0, 0.84, 0),
            ],
          },
        ),
      }}
    >
      <div
        style={{
          backgroundColor: "rgba(0, 0, 0, 0.6)",
          borderRadius: 12,
          padding: "20px 36px",
          color: "white",
          fontFamily,
          fontSize: 48,
          fontWeight: 600,
          whiteSpace: "nowrap",
        }}
      >
        Re:Earth · 3D
      </div>
    </div>
  );
};

export const SphereField: React.FC = () => {
  const { fps, width, height } = useVideoConfig();

  return (
    <AbsoluteFill style={{ backgroundColor: "#0B0E14" }}>
      <ThreeCanvas
        width={width}
        height={height}
        camera={{ fov: 45, near: 0.1, far: 200 }}
      >
        <color attach="background" args={["#0B0E14"]} />
        <ambientLight intensity={0.4} />
        <directionalLight position={[10, 20, 15]} intensity={1.6} />
        <OrbitingCamera />
        <Spheres />
      </ThreeCanvas>
      <Sequence
        name="Lower third"
        from={1 * fps}
        durationInFrames={4 * fps}
        premountFor={fps}
      >
        <LowerThird />
      </Sequence>
    </AbsoluteFill>
  );
};
