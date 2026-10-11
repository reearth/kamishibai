import { defineConfig } from "vitest/config";

// Only this package's tests: bench/ installs other tools, whose skills ship tests of their own.
export default defineConfig({
  test: { include: ["test/**/*.test.ts"] },
});
