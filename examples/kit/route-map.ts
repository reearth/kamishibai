// A part of your own: a schematic route map, defined with definePart. A scene
// uses it like a built-in part, through routeMap() (or { type: "route-map" }),
// and the kit lays it out, moves it between scenes and checks it.
import { definePart, f, isTall, rect, type Paint } from "kamishibai/kit";

export type Net = {
  stations: Record<string, { name: string; x: number; y: number }>;
  lines: { id: string; name: string; color: string; stations: string[] }[];
};

export type RouteMap = { id: string; net: Net; focus?: string[]; size?: "small" | "large"; at?: "corner" };

definePart<RouteMap>("route-map", {
  doc: "A schematic route map; the stations in focus are ringed and named.",
  fields: {
    net: f.obj("{ stations: { code: { name, x, y } }, lines: [{ id, name, color, stations }] }", true),
    focus: f.strs("station codes to ring and name"),
    size: f.one(["small", "large"]),
    at: f.one(["corner"], "pin a small map to the top-right corner on a wide stage"),
  },
  corner: (s) => s.at === "corner",
  box: (s, ctx) => {
    const T = ctx.theme;
    const small = s.size === "small";
    const focus = new Set(s.focus ?? []);
    const pts = Object.values(s.net.stations);
    const [x0, x1] = [Math.min(...pts.map((p) => p.x)), Math.max(...pts.map((p) => p.x))];
    const [y0, y1] = [Math.min(...pts.map((p) => p.y)), Math.max(...pts.map((p) => p.y))];
    return {
      // On a tall stage a small map is a strip across the body.
      style: small ? (isTall(ctx.stage) ? { self: "stretch", h: 240, shrink: 0 } : { w: 400, h: 270 }) : { grow: 1, self: "stretch", minW: 800 },
      paint: (r) => {
        const pad = small ? 48 : 96;
        const k = Math.min((r.w - pad * 2) / (x1 - x0 || 1), (r.h - pad * 2) / (y1 - y0 || 1));
        const ox = r.x + (r.w - (x1 - x0) * k) / 2;
        const oy = r.y + (r.h - (y1 - y0) * k) / 2;
        const P = (code: string): [number, number] => {
          const st = s.net.stations[code]!;
          return [ox + (st.x - x0) * k, oy + (st.y - y0) * k];
        };
        const out: Paint[] = [rect(s.id, r, { fill: T.card, stroke: T.rule, sw: 2, r: 20, ground: true })];
        const lit = (l: Net["lines"][number]) => !focus.size || l.stations.some((c) => focus.has(c));
        for (const l of s.net.lines) {
          out.push({ t: "path", id: `${s.id}.L.${l.id}`, pts: l.stations.map(P), stroke: lit(l) ? l.color : T.rule, sw: small ? 8 : 14, prog: 1, head: "none", o: 1, enter: "draw" });
        }
        const rad = small ? 7 : 12;
        for (const code of Object.keys(s.net.stations)) {
          const [cx, cy] = P(code);
          const on = focus.has(code);
          out.push({ t: "circle", id: `${s.id}.S.${code}`, cx, cy, r: on ? rad * 1.9 : rad, fill: T.card, stroke: on ? T.accent : T.ink, sw: on ? (small ? 5 : 8) : small ? 3 : 4, o: 1, enter: "pop" });
        }
        // Each name goes on the side of its station that no line leaves from.
        const legs = (code: string) =>
          s.net.lines.flatMap((l) => {
            const i = l.stations.indexOf(code);
            return [l.stations[i - 1], l.stations[i + 1]]
              .filter((n): n is string => i >= 0 && !!n)
              .map((n) => Math.atan2(P(n)[1] - P(code)[1], P(n)[0] - P(code)[0]));
          });
        const sides = [
          { a: Math.PI / 2, dx: 0, dy: 1 },
          { a: -Math.PI / 2, dx: 0, dy: -1 },
          { a: 0, dx: 1, dy: 0 },
          { a: Math.PI, dx: -1, dy: 0 },
        ];
        const gap = (x: number, y: number) => Math.abs(Math.atan2(Math.sin(x - y), Math.cos(x - y)));
        const clear = (ls: number[], a: number) => Math.min(9, ...ls.map((l) => gap(l, a)));
        for (const [code, st] of Object.entries(s.net.stations)) {
          if (small && !focus.has(code)) continue;
          const [cx, cy] = P(code);
          const size = small ? 22 : focus.has(code) ? 32 : 24;
          const w = ctx.fonts.measure(st.name, "bold", size);
          const h = size * 1.3;
          const ls = legs(code);
          const off = rad * 2 + 8;
          // Only the sides with room for the name inside the map.
          const fits = sides.filter((c) => (c.dx > 0 ? cx + off + w <= r.x + r.w - 12 : c.dx < 0 ? cx - off - w >= r.x + 12 : true));
          const side = fits.reduce((best, c) => (clear(ls, c.a) > clear(ls, best.a) ? c : best));
          const x = Math.min(r.x + r.w - w - 12, Math.max(r.x + 12, side.dx > 0 ? cx + off : side.dx < 0 ? cx - off - w : cx - w / 2));
          const y = side.dy > 0 ? cy + off - 4 : side.dy < 0 ? cy - off - h + 4 : cy - h / 2;
          out.push({ t: "text", id: `${s.id}.N.${code}`, x, y, w, h, lines: [st.name], font: "bold", size, lh: 1.3, track: 0, color: focus.has(code) ? T.accentText : T.ink2, align: "center", o: 1, need: w });
        }
        return out;
      },
    };
  },
});

/** A route map part. Importing this (not just the file) keeps the definition in the bundle. */
export const routeMap = (o: Omit<RouteMap, "id"> & { id?: string }) => ({ type: "route-map", ...o });
