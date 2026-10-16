// Every Lexicon term at a few moments: drawn on the CPU (Skia, no browser) and
// in Chromium the way the site draws it, then compared pixel by pixel. Also
// times each term at 1080p. Writes results/lexicon/: a sheet per chapter
// (Chromium left, CPU right) and report.json.
//
//   node bench/lexicon/compare.ts
import { chromium } from "playwright";
import { build } from "esbuild";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { draw, unsupported, W, H } from "./cpu.ts";
import { FONTS, FONT_DIR } from "./fonts.ts";
import { TERMS, CHAPTERS } from "../../site/src/lib/terms.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const out = here + "../results/lexicon/";
mkdirSync(out, { recursive: true });
const NIGHT = "#1E1A17";
const TS = [0.15, 0.5, 0.85];

const bundle = await build({ entryPoints: [here + "browser-entry.ts"], bundle: true, write: false, format: "iife" });
const faces = FONTS.map((f) => `@font-face{font-family:"${f.family}";src:url(${pathToFileURL(join(FONT_DIR, f.src)).href});font-weight:${f.weight}}`).join("\n");
const html = `<!doctype html><style>
${faces}
body{margin:0}#f{position:relative;width:${W}px;height:${H}px;overflow:hidden}#f canvas{display:block}</style>
<div id="f"></div><script>${bundle.outputFiles[0]!.text}</script>`;
writeFileSync(out + "ref.html", html);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.goto("file://" + out + "ref.html");
await page.evaluate(() => document.fonts.load('800 40px Geist').then(() => document.fonts.load('900 40px "Zen Kaku Gothic New"')));

type Row = { id: string; cat: string; diff: number; bad: number; ms1080: number; error?: string };
const rows: Row[] = [];
const pairs = new Map<string, { cpu: Buffer; ref: Buffer }>();

for (const term of TERMS) {
  const bg = term.dark ? NIGHT : "#ffffff";
  let diff = 0, bad = 0, ms = 0, error: string | undefined;
  try {
    for (const t of TS) {
      const cpu = draw(term.id, t, 1, bg);
      await page.evaluate(([id, t, bg]) => (window as any).drawRef(id, t, bg), [term.id, t, bg] as const);
      const ref = await page.locator("#f").screenshot();
      const img = await loadImage(ref);
      const rc = createCanvas(W, H);
      rc.getContext("2d").drawImage(img, 0, 0);
      const a = cpu.getContext("2d").getImageData(0, 0, W, H).data;
      const b = rc.getContext("2d").getImageData(0, 0, W, H).data;
      let sum = 0, n = 0;
      for (let i = 0; i < a.length; i += 4) {
        const d = (Math.abs(a[i]! - b[i]!) + Math.abs(a[i + 1]! - b[i + 1]!) + Math.abs(a[i + 2]! - b[i + 2]!)) / 3;
        sum += d;
        if (d > 40) n++;
      }
      diff += sum / (W * H) / TS.length;
      bad += (n / (W * H)) * 100 / TS.length;
      if (t === 0.5) pairs.set(term.id, { cpu: cpu.toBuffer("image/png"), ref });
    }
    // Time at 1920×1440, 12 frames through the loop.
    const t0 = performance.now();
    // Reading the pixels makes sure the frame is really rasterized, not just recorded.
    for (let i = 0; i < 12; i++) draw(term.id, i / 12, 4.8, bg).getContext("2d").getImageData(0, 0, 1, 1);
    ms = (performance.now() - t0) / 12;
  } catch (e) {
    error = String((e as Error).message ?? e).slice(0, 100);
  }
  rows.push({ id: term.id, cat: term.cat, diff, bad, ms1080: ms, error });
}
await browser.close();

// One sheet per chapter: Chromium on the left, CPU on the right, per term.
for (const { cat } of CHAPTERS) {
  const ids = TERMS.filter((t) => t.cat === cat).map((t) => t.id).filter((id) => pairs.has(id));
  const cw = W * 2 + 24, chh = H + 30;
  const cols = 2;
  const sheet = createCanvas(cols * cw, Math.ceil(ids.length / cols) * chh);
  const g = sheet.getContext("2d");
  g.fillStyle = "#e7e5df";
  g.fillRect(0, 0, sheet.width, sheet.height);
  for (const [i, id] of ids.entries()) {
    const x = (i % cols) * cw, y = Math.floor(i / cols) * chh;
    const p = pairs.get(id)!;
    g.drawImage(await loadImage(p.ref), x, y + 26);
    g.drawImage(await loadImage(p.cpu), x + W + 4, y + 26);
    const r = rows.find((r) => r.id === id)!;
    g.fillStyle = "#121212";
    g.font = "700 16px Geist";
    g.fillText(`${id}   diff ${r.diff.toFixed(1)}  ·  ${r.bad.toFixed(1)}% px  ·  ${r.ms1080.toFixed(0)} ms@1080p   (left: Chromium, right: CPU)`, x + 4, y + 18);
  }
  writeFileSync(out + `${cat.toLowerCase()}.png`, sheet.toBuffer("image/png"));
}

writeFileSync(out + "report.json", JSON.stringify(rows, null, 1));
const sorted = [...rows].sort((a, b) => b.bad - a.bad);
console.log("worst by % of pixels that differ:");
for (const r of sorted.slice(0, 25)) console.log(`${r.id.padEnd(24)} ${r.cat.padEnd(11)} diff ${r.diff.toFixed(1).padStart(5)}  bad ${r.bad.toFixed(1).padStart(5)}%  ${r.ms1080.toFixed(1).padStart(6)} ms ${r.error ?? ""}`);
const ok = rows.filter((r) => !r.error);
console.log(`\n${ok.length}/${rows.length} drew without error; ${ok.filter((r) => r.bad < 1).length} within 1% of pixels; ${ok.filter((r) => r.bad < 5).length} within 5%`);
const msS = ok.map((r) => r.ms1080).sort((a, b) => a - b);
console.log(`1080p ms/frame: median ${msS[msS.length >> 1]!.toFixed(1)}, max ${msS.at(-1)!.toFixed(1)} (${ok.find((r) => r.ms1080 === msS.at(-1))!.id})`);
console.log("unsupported CSS in shapes:", [...new Set([...unsupported].map((s) => s.replace(/\(.*/, "")))]);
