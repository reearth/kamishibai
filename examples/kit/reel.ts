// A kit reel in code: the same data as reel.yaml, built with the part
// functions, plus a part of its own (route-map.ts).
//
//   kamishibai check  examples/kit/reel.ts
//   kamishibai render examples/kit/reel.ts -o route.mp4
import { kit, row, card, arrow, title, text } from "kamishibai/kit";
import { routeMap, type Net } from "./route-map.ts";

const net: Net = {
  stations: {
    A1: { name: "Harbor", x: 0, y: 2 },
    A2: { name: "Beach", x: 2, y: 2 },
    A3: { name: "Central", x: 4, y: 2 },
    A4: { name: "Hill", x: 6, y: 2 },
    A5: { name: "River", x: 8, y: 2 },
    A6: { name: "North", x: 10, y: 0 },
    B1: { name: "City Hall", x: 4, y: 0 },
    B2: { name: "College", x: 6, y: 4 },
  },
  lines: [
    { id: "A", name: "A line", color: "#d9662a", stations: ["A1", "A2", "A3", "A4", "A5", "A6"] },
    { id: "B", name: "B line", color: "#6e6e69", stations: ["B1", "A3", "B2"] },
  ],
};

export default await kit({
  kit: 1,
  title: "Where the coupons failed",
  fonts: [
    { family: "Geist", src: "fonts/Geist.ttf", weight: "100 900" },
    { family: "Geist Mono", src: "fonts/GeistMono.ttf", weight: "100 900" },
  ],
  theme: { fonts: { sans: "Geist", mono: '"Geist Mono"' } },
  scenes: [
    { kata: "cover", say: "Which shops saw the coupon bug?", kicker: "Bug review", title: "Where the coupons failed" },
    {
      say: "Three shops on the A line reported it.",
      parts: [title("Shops that reported it", { id: "title" }), routeMap({ id: "map", net, focus: ["A3", "A5", "A6"], size: "large" })],
    },
    {
      say: "All three had switched to the new coupon code that week.",
      parts: [
        title("What they had in common", { id: "title" }),
        row([card({ label: "Before", body: "Paper coupons" }), arrow(), card({ label: "That week", body: "The new coupon code", tone: "accent" })]),
        text("The map stays in the corner while the rest changes.", { role: "note" }),
        routeMap({ id: "map", net, focus: ["A3", "A5", "A6"], size: "small", at: "corner" }),
      ],
    },
  ],
});
