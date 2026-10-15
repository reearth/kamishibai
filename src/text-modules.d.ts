// Markdown files imported as plain text (esbuild/tsup `text` loader).
declare module "*.md" {
  const content: string;
  export default content;
}

// subset-font ships no types (an optional peer: `kamishibai export` subsets fonts with it).
declare module "subset-font" {
  function subsetFont(
    font: Buffer | Uint8Array,
    text: string,
    options?: { targetFormat?: "sfnt" | "truetype" | "woff" | "woff2"; variationAxes?: Record<string, number | { min: number; max: number; default?: number }> },
  ): Promise<Buffer>;
  export default subsetFont;
}
