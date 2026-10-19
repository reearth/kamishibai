import { defineConfig } from "vitest/config";

// Only this package's tests: bench/ installs other tools, whose skills ship tests of their own.
export default defineConfig({
  test: { include: ["test/**/*.test.ts"] },
  // Markdown imported as text, as tsup's loader does in the build.
  plugins: [{ name: "md-text", transform: (code, id) => (id.endsWith(".md") ? `export default ${JSON.stringify(code)};` : undefined) }],
});
