// Markdown files imported as plain text (esbuild/tsup `text` loader).
declare module "*.md" {
  const content: string;
  export default content;
}
