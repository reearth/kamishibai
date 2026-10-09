import { defineConfig } from "astro/config";

// Served from GitHub Pages as a project site: https://reearth.github.io/kamishibai/
export default defineConfig({
  site: "https://reearth.github.io",
  base: "/kamishibai",
  trailingSlash: "always",
});
