// The HTML file `kamishibai export` writes, for a canvas reel or a page:
// a host element, the data the player reads, and one module script.
// ------------------------------------------------------------------
import { writeFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

export interface ExportHtml {
  out: string;
  title: string;
  /** no frame around the player, a transparent page (for an iframe) */
  bare: boolean;
  /** read by the player and the prelude from #kamishibai-data */
  data: unknown;
  /** the bundled module */
  js: string;
  /** a page reel draws into #kamishibai-root */
  pageRoot?: boolean;
}

/** Write the file; returns its size in bytes. */
export async function writeExportHtml(o: ExportHtml): Promise<number> {
  // In a <script> element, "</" must not appear: escape "<" in the data and "</script" in the code.
  const json = JSON.stringify(o.data).replace(/</g, "\\u003c");
  const title = o.title.replace(/[<&]/g, (c) => (c === "<" ? "&lt;" : "&amp;"));
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>html,body{margin:0;height:100%;background:${o.bare ? "transparent" : "#e7e5df"}}#kamishibai{position:fixed;inset:${o.bare ? "0" : "16px"}}</style>
</head>
<body>
<div id="kamishibai"></div>${o.pageRoot ? `\n<div id="kamishibai-root"></div>` : ""}
<script type="application/json" id="kamishibai-data">${json}</script>
<script type="module">${o.js.replace(/<\/script/gi, "<\\/script")}</script>
</body>
</html>
`;
  await writeFile(resolve(o.out), html);
  return (await stat(resolve(o.out))).size;
}
