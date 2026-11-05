import { defineConfig } from "vitest/config";

// Only this package's tests: bench/ installs other tools, whose skills ship tests of their own.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/global-setup.ts"],
    // Bundling, exporting and running ffmpeg take a second or so alone, but
    // several seconds with every test file's worker busy at once: vitest's 5 s
    // default failed them now and then with nothing wrong.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  // Markdown imported as text, as tsup's loader does in the build.
  plugins: [{ name: "md-text", transform: (code, id) => (id.endsWith(".md") ? `export default ${JSON.stringify(code)};` : undefined) }],
});
