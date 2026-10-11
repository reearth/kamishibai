import { useCallback, useLayoutEffect, useRef } from "react";
import * as THREE from "three";
import { mount, Stage, useClock, useFingerprint, ramp, track, eases } from "kamishibai/react";

const W = 1920;
const H = 1080;
const FPS = 30;
const DURATION_MS = 6000;

const SPHERE_COUNT = 500;
const SEED = 20260101;
const ORBIT_DEG = 30;
const ORBIT_RADIUS = 48;
const CAMERA_HEIGHT = 10;

// mulberry32: a small seeded PRNG, so every worker builds the identical field.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildScene(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#0B0E14");
  scene.add(new THREE.AmbientLight(0xffffff, 0.45));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(10, 20, 15);
  scene.add(sun);

  const rand = mulberry32(SEED);
  const geometry = new THREE.SphereGeometry(1, 32, 16);
  for (let i = 0; i < SPHERE_COUNT; i++) {
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(rand(), 0.6, 0.55, THREE.SRGBColorSpace),
      roughness: 0.5,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set((rand() - 0.5) * 40, (rand() - 0.5) * 20, (rand() - 0.5) * 30);
    mesh.scale.setScalar(0.1 + rand() * 0.2);
    scene.add(mesh);
  }
  return scene;
}

const orbitAngle = (ms: number) => THREE.MathUtils.degToRad(ramp(ms, 0, DURATION_MS, 0, ORBIT_DEG));

const Field = () => {
  const { ms } = useClock();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const three = useRef<{ renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera }>(null);

  // WebGL pixels are invisible to the DOM fingerprint: name what we draw.
  useFingerprint(useCallback((t: number) => `orbit:${orbitAngle(t).toFixed(6)}`, []));

  useLayoutEffect(() => {
    const renderer = new THREE.WebGLRenderer({ canvas: canvasRef.current!, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(W, H, false);
    const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 200);
    three.current = { renderer, scene: buildScene(), camera };
    return () => renderer.dispose();
  }, []);

  useLayoutEffect(() => {
    const { renderer, scene, camera } = three.current!;
    const a = orbitAngle(ms);
    camera.position.set(Math.sin(a) * ORBIT_RADIUS, CAMERA_HEIGHT, Math.cos(a) * ORBIT_RADIUS);
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
  }, [ms]);

  return <canvas ref={canvasRef} width={W} height={H} style={{ position: "absolute", inset: 0, width: W, height: H }} />;
};

const LowerThird = () => {
  const { ms } = useClock();
  // 0 = resting at 96 px from the left, 1 = fully off the left edge
  const off = track(ms, [
    { at: 1000, value: 1 },
    { at: 1500, value: 0, ease: eases.smooth },
    { at: 4500, value: 0 },
    { at: 5000, value: 1, ease: eases.inOut },
  ]);
  if (off >= 1) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: 96,
        bottom: 120,
        transform: `translateX(calc(${-off} * (100% + 96px)))`,
        padding: "22px 36px",
        borderRadius: 12,
        background: "rgba(0, 0, 0, 0.6)",
        color: "#fff",
        fontFamily: '"Inter", "Helvetica Neue", Helvetica, Arial, sans-serif',
        fontSize: 48,
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      Re:Earth · 3D
    </div>
  );
};

const Reel = () => (
  <Stage background="#0B0E14">
    <Field />
    <LowerThird />
  </Stage>
);

mount(<Reel />, { fps: FPS, durationMs: DURATION_MS, width: W, height: H });
