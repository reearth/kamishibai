// The same drawings in Chromium, the way the site draws them, as the reference.
import { SHAPES, PAINT, W, H } from "../../site/src/lib/draw.ts";
import { shapeStyle } from "../../site/src/lib/reel.ts";

(window as unknown as Record<string, unknown>).drawRef = (id: string, t: number, bg: string) => {
  const f = document.getElementById("f")!;
  f.innerHTML = "";
  f.style.background = bg;
  if (PAINT[id]) {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    f.appendChild(c);
    PAINT[id]!(c.getContext("2d")!, t);
  } else {
    for (const s of SHAPES[id]!(t)) {
      const d = document.createElement("div");
      d.setAttribute("style", "position:absolute;" + shapeStyle(s));
      f.appendChild(d);
    }
  }
};
