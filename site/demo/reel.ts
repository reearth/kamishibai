// The README's reel: a stack of kamishibai cards pulled one by one, faster and
// faster, each with a Lexicon loop; then every Lexicon term at once, under
// "Anything a page can draw."; then the end card. Plain DOM and the one
// contract (window.kamishibai = { meta, seek }), drawn with the site's own
// Lexicon code.
//
//   node dist/cli.js render site/demo/reel.ts -o site/demo/demo.mp4
//   node dist/cli.js render site/demo/reel.ts -o site/demo/demo.gif --fps 20 --max-width 640
//
// from the repo root, after `pnpm build`. It loads its fonts from Google Fonts.
import { H, SHAPES, W } from "../src/lib/draw.ts";
import { drawTerm, shapeStyle } from "../src/lib/reel.ts";
import { CHAPTERS, LOOP_MS, TERMS, type Term } from "../src/lib/terms.ts";

const meta = { fps: 30, durationMs: 11_500, width: 1280, height: 720 };

const DESK = "#e7e5df", PAPER = "#fafaf7", INK = "#121212", INK_3 = "#6e6e69", KAKI = "#d9662a", KAKI_TEXT = "#b84e14", NIGHT = "#1e1a17";
const SANS = `Geist, "Zen Kaku Gothic New", system-ui, sans-serif`;
const MONO = `"Geist Mono", ui-monospace, monospace`;

// ---- time ----
const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const span = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
const inOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
const out = (p: number) => 1 - Math.pow(1 - p, 3);
const inQuad = (p: number) => p * p;

// ---- the cards ----
// The title card, then terms, each held a little less long than the last.
const PICKS = ["marquee", "orbit", "kinetic-typography", "halftone", "shape-morph", "time-lapse", "particles", "dutch-angle", "metaballs", "typewriter", "crash-zoom", "slit-scan"];
const HOLDS = [1500, 1000, 820, 680, 560, 460, 380, 320, 270, 240, 220, 200, 200];
const PULL = (k: number) => Math.min(520, 220 + HOLDS[k]! * 0.25);
const byId = new Map(TERMS.map((t) => [t.id, t]));
const picks = PICKS.map((id) => byId.get(id)!);
/** when card k starts being pulled */
const pullAt: number[] = [];
HOLDS.reduce((at, h) => (pullAt.push(at + h), at + h), 0);
// The last term card isn't pulled: the grid grows out of its frame.
const GRID_AT = pullAt[picks.length]!;
const ZOOM_MS = 1500;
const LINE_AT = GRID_AT + ZOOM_MS - 300;
const END_AT = LINE_AT + 1300;

// ---- layout ----
const CW = 640, CH = 560; // a card
const FW = 576, FH = 432; // its frame, 4:3
const CX = (meta.width - CW) / 2, CY = (meta.height - CH) / 2;
const FX = CX + 32, FY = CY + 96;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, css: string, parent: HTMLElement, text?: string) => {
  const e = document.createElement(tag);
  e.style.cssText = css;
  if (text) e.textContent = text;
  parent.appendChild(e);
  return e;
};

/** A 4:3 frame with a term in it: shapes as spans, or a canvas painted at 400×300. */
function frame(parent: HTMLElement, t: Term, css: string): HTMLElement {
  const f = el("div", `position:absolute;overflow:hidden;border:1px solid ${INK};background:${t.dark ? NIGHT : "#fff"};${css}`, parent);
  f.dataset.term = t.id;
  if (SHAPES[t.id]) for (const s of SHAPES[t.id]!(0)) el("span", `position:absolute;display:block;${shapeStyle(s)}`, f);
  else el("canvas", "position:absolute;inset:0;width:100%;height:100%;display:block", f);
  return f;
}

/**
 * Paint a frame at loop progress t, its canvas at least `px` wide. drawTerm
 * sizes a canvas from its laid-out width, which a zoomed grid cell understates.
 */
function paint(f: HTMLElement, t: number, px: number): void {
  const cv = f.firstElementChild;
  if (cv instanceof HTMLCanvasElement) {
    Object.defineProperty(cv, "clientWidth", { value: px, configurable: true });
    Object.defineProperty(cv, "clientHeight", { value: (px * H) / W, configurable: true });
  }
  drawTerm(f, f.dataset.term!, t);
}

const chapterJa = (t: Term) => CHAPTERS.find((c) => c.cat === t.cat)!.ja;

function build() {
  document.body.style.cssText = `margin:0;background:${DESK};-webkit-font-smoothing:antialiased`;
  const root = el("div", `position:relative;width:${meta.width}px;height:${meta.height}px;overflow:hidden;background:${DESK};font-family:${SANS};color:${INK}`, document.body);

  // Every term, in a grid: 16 × 9 cells of 80 × 80.
  const grid = el("div", `position:absolute;left:0;top:0;width:${meta.width}px;height:${meta.height}px;transform-origin:0 0`, root);
  const COLS = 16, CELL = 80, GW = 68, GH = 51;
  const cells = TERMS.map((t, i) => {
    const x = (i % COLS) * CELL + (CELL - GW) / 2, y = Math.floor(i / COLS) * CELL + (CELL - GH) / 2 + 2;
    return { t, f: frame(grid, t, `left:${x}px;top:${y}px;width:${GW}px;height:${GH}px`), cx: x + GW / 2, cy: y + GH / 2 };
  });
  // The last card's term sits in the middle of the grid, where the zoom ends.
  const last = picks[picks.length - 1]!;
  const focus = cells.find((c) => c.t.id === last.id)!;

  // The stack: the title card on top, the terms under it.
  const stack = el("div", "position:absolute;inset:0", root);
  const card = (k: number) => {
    const c = el("div", `position:absolute;left:${CX}px;top:${CY}px;width:${CW}px;height:${CH}px;background:${PAPER};box-shadow:0 2px 6px rgba(0,0,0,.08);transform-origin:50% 100%`, stack);
    return c;
  };
  const cards: HTMLElement[] = [];
  const frames: HTMLElement[] = [];
  // title
  {
    const c = card(0);
    el("div", `position:absolute;left:32px;top:30px;font-size:15px;font-weight:500;color:${KAKI_TEXT}`, c, "紙芝居 · kamishibai");
    const h = el("div", `position:absolute;left:32px;top:58px;font-size:30px;font-weight:800;letter-spacing:-0.03em`, c, "Turn any web page into a video.");
    h.style.whiteSpace = "nowrap";
    const f = el("div", `position:absolute;left:32px;top:96px;width:${FW}px;height:${FH}px;border:1px solid ${INK};background:#fff;overflow:hidden`, c);
    el("div", `position:absolute;left:0;right:0;top:84%;height:1px;background:${INK}`, f);
    const ball = el("div", `position:absolute;width:11%;aspect-ratio:1;border-radius:50%;background:${KAKI};left:44.5%;bottom:16%`, f);
    ball.dataset.ball = "1";
    cards.push(c);
    frames.push(f);
  }
  for (const t of picks) {
    const c = card(cards.length);
    el("div", `position:absolute;left:32px;top:30px;font-size:15px;font-weight:500;color:${KAKI_TEXT}`, c, `${t.cat} · ${chapterJa(t)}`);
    el("div", `position:absolute;left:32px;top:54px;font-size:30px;font-weight:800;letter-spacing:-0.03em`, c, t.en);
    el("div", `position:absolute;right:32px;top:66px;font-size:16px;color:${INK_3}`, c, t.ja);
    frames.push(frame(c, t, `left:32px;top:96px;width:${FW}px;height:${FH}px`));
    cards.push(c);
  }
  // Bottom of the stack is the last card; DOM order puts the title on top.
  for (const c of [...cards].reverse()) stack.appendChild(c);

  // The line over the grid, and the end card.
  const band = el("div", `position:absolute;left:0;right:0;top:${meta.height / 2 - 70}px;height:140px;background:${PAPER};box-shadow:0 2px 10px rgba(0,0,0,.12);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px`, root);
  el("div", "font-size:52px;font-weight:800;letter-spacing:-0.045em;line-height:1", band, "Anything a page can draw.");
  el("div", `font-size:22px;color:${INK_3}`, band, "kamishibai seeks it to each moment and captures it.");

  const end = el("div", `position:absolute;left:${CX}px;top:${CY}px;width:${CW}px;height:${CH}px;background:${PAPER};box-shadow:0 2px 10px rgba(0,0,0,.14);padding:48px 44px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between`, root);
  el("div", `font-size:15px;font-weight:500;color:${KAKI_TEXT}`, end, "紙芝居 · kamishibai");
  const big = el("div", "font-size:54px;font-weight:800;letter-spacing:-0.05em;line-height:1.02", end);
  for (const s of ["If your agent can", "write a web page,", "it can make a video."]) el("div", "white-space:nowrap", big, s);
  const foot = el("div", "display:flex;justify-content:space-between;align-items:baseline", end);
  el("div", `font-family:${MONO};font-size:22px;color:${INK}`, foot, "npm i kamishibai");
  el("div", `font-family:${MONO};font-size:16px;color:${INK_3}`, foot, "reearth.github.io/kamishibai");

  return { root, grid, cells, focus, cards, frames, band, end };
}

function seekTo(ui: ReturnType<typeof build>, ms: number): void {
  const t = (ms % LOOP_MS) / LOOP_MS;

  // The stack: card k leaves to the left over PULL(k) ms from pullAt[k],
  // turning a little, and is gone for good after.
  ui.cards.forEach((c, k) => {
    const at = pullAt[k];
    const p = at === undefined || k === ui.cards.length - 1 ? 0 : span(ms, at, at + PULL(k));
    const lean = (k % 2 ? -0.7 : 0.5) * (1 - p);
    const x = -inQuad(p) * (CX + CW + 120);
    c.style.transform = `translateX(${x.toFixed(1)}px) rotate(${(lean - 8 * inQuad(p)).toFixed(2)}deg)`;
    c.style.display = p >= 1 ? "none" : "";
    // The last card's paper fades off its frame, onto the same term in the grid.
    if (k === ui.cards.length - 1) c.style.opacity = (1 - span(ms, GRID_AT, GRID_AT + 200)).toFixed(3);
  });
  // The title card's ball drops onto the floor and settles.
  const ball = ui.frames[0]!.querySelector<HTMLElement>("[data-ball]")!;
  const fall = span(ms, 150, 900);
  const h = fall < 1 ? (1 - Math.abs(Math.cos(fall * Math.PI * 2.2)) * Math.exp(-fall * 3)) : 1;
  ball.style.transform = `translateY(${(-(1 - h) * 220).toFixed(1)}px)`;
  // Paint only the frames that can show: the top two cards before the grid.
  let top = ui.cards.length - 1;
  for (let k = 0; k < ui.cards.length - 1; k++) if (ms < pullAt[k]! + PULL(k)) { top = k; break; }
  ui.frames.forEach((f, k) => {
    if (k > 0 && (k === top || k === top + 1)) paint(f, t, FW);
  });

  // The grid: from the last card's frame out to the whole screen.
  const z = inOut(span(ms, GRID_AT, GRID_AT + ZOOM_MS));
  const gridOn = ms >= GRID_AT;
  ui.grid.style.visibility = gridOn ? "visible" : "hidden";
  if (gridOn) {
    const { cx, cy } = ui.focus;
    const s0 = FW / 68;
    const s = Math.exp(lerp(Math.log(s0), 0, z));
    const px = lerp(FX + FW / 2, cx, z), py = lerp(FY + FH / 2, cy, z);
    ui.grid.style.transform = `translate(${(px - s * cx).toFixed(2)}px, ${(py - s * cy).toFixed(2)}px) scale(${s.toFixed(4)})`;
    for (const c of ui.cells) paint(c.f, t, c === ui.focus ? FW : W);
  }

  // The line, then the end card dropped on top.
  const b = out(span(ms, LINE_AT - 300, LINE_AT + 200)) * (1 - span(ms, END_AT, END_AT + 300));
  ui.band.style.opacity = b.toFixed(3);
  ui.band.style.transform = `scaleY(${lerp(0.6, 1, b).toFixed(3)})`;
  const e = out(span(ms, END_AT - 100, END_AT + 450));
  ui.end.style.opacity = e > 0 ? "1" : "0";
  ui.end.style.transform = `translateY(${((1 - e) * (meta.height - CY + 40)).toFixed(1)}px) rotate(${((1 - e) * 4).toFixed(2)}deg)`;
}

async function main() {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;700;800&family=Geist+Mono:wght@400;500&family=Zen+Kaku+Gothic+New:wght@400;500;700&display=block";
  const loaded = new Promise((r) => (link.onload = r));
  document.head.appendChild(link);
  await loaded;
  await Promise.all(["800 30px Geist", "500 15px Geist", "400 22px Geist", "500 22px 'Geist Mono'", "400 16px 'Zen Kaku Gothic New'"].map((f) => document.fonts.load(f, "紙芝居 kamishibai")));
  const ui = build();
  window.kamishibai = {
    meta,
    async seek(ms: number) {
      seekTo(ui, ms);
    },
  };
}
void main();
