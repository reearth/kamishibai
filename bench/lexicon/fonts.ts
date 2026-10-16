// The faces the Lexicon draws with (the site's: Geist, Geist Mono, Zen Kaku
// Gothic New), for both sides of the comparison. Geist comes from the
// examples; Zen Kaku Gothic New (OFL, about 7 MB) is fetched from Google
// Fonts' repository into .work/fonts the first time.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Font paths are relative to this: the repo's root. */
export const FONT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ZEN = "bench/.work/fonts";
const ZEN_URL = "https://github.com/google/fonts/raw/main/ofl/zenkakugothicnew";

export const FONTS = [
  { family: "Geist", src: "examples/canvas/fonts/Geist.ttf", weight: "100 900" },
  { family: "Geist Mono", src: "examples/kit/fonts/GeistMono.ttf", weight: "100 900" },
  ...(["Regular", "Bold", "Black"] as const).map((w) => ({
    family: "Zen Kaku Gothic New",
    src: `${ZEN}/ZenKakuGothicNew-${w}.ttf`,
    weight: { Regular: "400", Bold: "700", Black: "900" }[w],
  })),
];

for (const f of FONTS) {
  const path = join(FONT_DIR, f.src);
  if (existsSync(path)) continue;
  mkdirSync(dirname(path), { recursive: true });
  const res = await fetch(`${ZEN_URL}/${f.src.split("/").pop()}`);
  if (!res.ok) throw new Error(`fetching ${f.src}: HTTP ${res.status}`);
  writeFileSync(path, Buffer.from(await res.arrayBuffer()));
}
