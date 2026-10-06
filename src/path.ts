// kamishibai/path — positions along an SVG path, for motion along a line.
// ------------------------------------------------------------------
// "Move a dot along this curve" needs the point at a given length of an SVG
// path. The browser already measures paths exactly (getTotalLength /
// getPointAtLength), so we lean on it: one hidden <path> per distinct `d`,
// cached, measured on demand. It's a pure function of (d, length) — so frames
// stay deterministic and parallel workers agree pixel for pixel.
//
// Browser-only (needs `document`). Use it from the reel, not from Node.

/** A point on a path, with the tangent direction there. */
export interface PathPoint {
  x: number;
  y: number;
  /** tangent direction in degrees (0 = +x, clockwise in screen space) */
  angle: number;
}

const SVG_NS = "http://www.w3.org/2000/svg";
let host: SVGSVGElement | undefined;
const paths = new Map<string, { el: SVGPathElement; length: number }>();

function measure(d: string): { el: SVGPathElement; length: number } {
  let m = paths.get(d);
  if (m) return m;
  if (!host) {
    // Attached (but invisible) so measurement works in every engine.
    host = document.createElementNS(SVG_NS, "svg");
    host.setAttribute("aria-hidden", "true");
    // Never painted, and it grows with whichever paths this worker happened to
    // measure first — keep it out of the kamishibai/react frame fingerprint.
    host.setAttribute("data-kamishibai-ignore", "");
    host.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;visibility:hidden;";
    document.body.appendChild(host);
  }
  const el = document.createElementNS(SVG_NS, "path");
  el.setAttribute("d", d);
  host.appendChild(el);
  m = { el, length: el.getTotalLength() };
  paths.set(d, m);
  return m;
}

/** Total length of the path `d`, in user units. */
export function pathLength(d: string): number {
  return measure(d).length;
}

/** The point `length` units along `d` (clamped to the path's ends). */
export function pointAtLength(d: string, length: number): PathPoint {
  const { el, length: total } = measure(d);
  const at = Math.min(total, Math.max(0, length));
  const p = el.getPointAtLength(at);
  // Tangent from a small symmetric step (one-sided at the ends).
  const h = Math.min(0.5, total / 2);
  const a = el.getPointAtLength(Math.max(0, at - h));
  const b = el.getPointAtLength(Math.min(total, at + h));
  const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  return { x: p.x, y: p.y, angle };
}

/** The point at progress `t` (0 = start, 1 = end; clamped) along `d`. */
export function pointAt(d: string, t: number): PathPoint {
  return pointAtLength(d, measure(d).length * Math.min(1, Math.max(0, t)));
}
