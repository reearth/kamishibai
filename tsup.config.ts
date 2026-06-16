import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/cli.ts",
    react: "src/react/index.tsx",
    video: "src/video.ts",
    easing: "src/easing.ts",
  },
  format: ["esm"],
  target: "node20",
  platform: "node",
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  // Inline the agent skill doc as a string so `kamishibai skill` works
  // without resolving a file path at runtime.
  loader: { ".md": "text" },
  // React sugar is consumed by the user's bundle, not by us — keep it external.
  external: ["react", "react-dom", "playwright"],
});
