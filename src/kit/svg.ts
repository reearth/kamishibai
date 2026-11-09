// A one-colour SVG (an icon, most often) as one path: its viewBox, and its
// shapes (path, circle, ellipse, rect, line, polyline, polygon) joined into
// one path's data, filled or stroked the way the file says. A figure's path
// item draws it in the theme's colours, so colours in the file are not kept.
// ------------------------------------------------------------------

/** A path to draw: its data, its own box (the viewBox), and the width of its lines when it is drawn with lines. */
export type Vector = { d: string; vx: number; vy: number; vw: number; vh: number; lineWidth?: number };

const attrs = (tag: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g)) out[m[1]!] = m[3] ?? m[4] ?? "";
  return out;
};
const num = (v: string | undefined, d = 0) => (v === undefined || v === "" ? d : Number.parseFloat(v));

/** A shape element as path data, or undefined for one that draws nothing here. */
function shapeData(name: string, a: Record<string, string>): string | undefined {
  switch (name) {
    case "path": {
      // A path element's first "m" is absolute, but in the joined path it would follow the shape
      // before it and be read from that shape's last point, so it starts from 0 0 instead.
      const d = a.d?.trim();
      return d && d[0] === "m" ? `M0 0${d}` : d;
    }
    case "circle":
    case "ellipse": {
      const [cx, cy] = [num(a.cx), num(a.cy)];
      const [rx, ry] = name === "circle" ? [num(a.r), num(a.r)] : [num(a.rx), num(a.ry)];
      if (!(rx > 0 && ry > 0)) return undefined;
      return `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${rx * 2} 0a${rx} ${ry} 0 1 0 ${-rx * 2} 0z`;
    }
    case "rect": {
      const [x, y, w, h] = [num(a.x), num(a.y), num(a.width), num(a.height)];
      if (!(w > 0 && h > 0)) return undefined;
      const rx = Math.min(num(a.rx, num(a.ry)), w / 2);
      const ry = Math.min(num(a.ry, num(a.rx)), h / 2);
      if (!(rx > 0 && ry > 0)) return `M${x} ${y}h${w}v${h}h${-w}z`;
      return `M${x + rx} ${y}h${w - 2 * rx}a${rx} ${ry} 0 0 1 ${rx} ${ry}v${h - 2 * ry}a${rx} ${ry} 0 0 1 ${-rx} ${ry}h${-(w - 2 * rx)}a${rx} ${ry} 0 0 1 ${-rx} ${-ry}v${-(h - 2 * ry)}a${rx} ${ry} 0 0 1 ${rx} ${-ry}z`;
    }
    case "line":
      return `M${num(a.x1)} ${num(a.y1)}L${num(a.x2)} ${num(a.y2)}`;
    case "polyline":
    case "polygon": {
      const p = (a.points ?? "").trim().split(/[\s,]+/).map(Number);
      if (p.length < 4 || p.some((v) => !isFinite(v))) return undefined;
      let d = `M${p[0]} ${p[1]}`;
      for (let i = 2; i + 1 < p.length; i += 2) d += `L${p[i]} ${p[i + 1]}`;
      return name === "polygon" ? d + "z" : d;
    }
  }
  return undefined;
}

/**
 * An SVG file's text as a Vector: its shapes joined into one path, in its
 * viewBox (or its width and height). It is drawn with lines when the file
 * says fill="none" and gives a stroke (outline icon sets do), at its
 * stroke-width (1 by default); otherwise it is filled. Throws, saying why,
 * for a file with no shapes or with a transform (which this does not apply).
 */
export function svgVector(text: string, name = "the SVG"): Vector {
  const root = /<svg\b[^>]*>/i.exec(text);
  if (!root) throw new Error(`${name} is not an SVG file: no <svg> element`);
  const a = attrs(root[0]);
  const box = (a.viewBox ?? "").trim().split(/[\s,]+/).map(Number);
  const [vx, vy, vw, vh] = (box.length === 4 && box.every(isFinite) ? box : [0, 0, num(a.width, 24), num(a.height, 24)]) as [number, number, number, number];
  if (/\btransform\s*=/.test(text)) throw new Error(`${name} has a transform, which a path item does not apply: export the icon with its transforms flattened`);
  const parts: string[] = [];
  for (const m of text.matchAll(/<(path|circle|ellipse|rect|line|polyline|polygon)\b[^>]*?\/?>/gi)) {
    const d = shapeData(m[1]!.toLowerCase(), attrs(m[0]));
    if (d) parts.push(d);
  }
  if (!parts.length) throw new Error(`${name} has no shapes to draw (path, circle, ellipse, rect, line, polyline or polygon)`);
  const outline = a.fill === "none" && !!a.stroke && a.stroke !== "none";
  return { d: parts.join(" "), vx, vy, vw, vh, ...(outline ? { lineWidth: num(a["stroke-width"], 1) } : {}) };
}
