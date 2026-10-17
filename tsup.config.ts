import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/cli.ts",
    react: "src/react/index.tsx",
    video: "src/video.ts",
    easing: "src/easing.ts",
    subtitle: "src/subtitle.ts",
    tts: "src/tts/index.ts",
    path: "src/path.ts",
    // The dev player's browser script, served by `kamishibai dev`.
    "dev-player": "src/dev/player.ts",
    // Canvas reels: the contract and the browser host (kamishibai/canvas), and
    // the worker thread that paints them on the CPU.
    canvas: "src/canvas/browser.ts",
    "canvas-worker": "src/canvas/worker.ts",
    // Keyframe reels from a kit of parts (kamishibai/kit), in code, JSON or YAML.
    kit: "src/kit/index.ts",
    // What `kamishibai export` bundles into a page's file: the player, and
    // the module that serves the page its recorded files.
    player: "src/player.ts",
    "export-prelude": "src/export-prelude.ts",
  },
  format: ["esm"],
  target: "node20",
  platform: "node",
  // tsup's dts build sets `baseUrl` internally, which TypeScript 6 deprecates.
  dts: { compilerOptions: { ignoreDeprecations: "6.0" } },
  clean: true,
  splitting: false,
  sourcemap: true,
  // Inline the agent skill doc as a string so `kamishibai skill` works
  // without resolving a file path at runtime.
  loader: { ".md": "text" },
  // React sugar is consumed by the user's bundle, not by us — keep it external.
  external: ["react", "react-dom", "playwright", "@napi-rs/canvas", "yoga-layout", "yaml"],
});
