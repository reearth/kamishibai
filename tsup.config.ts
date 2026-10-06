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
  external: ["react", "react-dom", "playwright"],
});
