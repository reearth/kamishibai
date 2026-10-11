// Write the HyperFrames project's HTML from spec.json: index.html (the scene
// clips and the music) and compositions/scene-<i>.html (one per scene). The
// edit benchmark changes spec.json and runs this, so an edit touches the same
// HTML a person would edit by hand: one scene's file, or index.html.
//
//   node gen-hyperframes.mjs <project dir>
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
const spec = JSON.parse(readFileSync(join(dir, "spec.json"), "utf8"));
const s = (ms) => +(ms / 1000).toFixed(3);
const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const n = spec.scenes.length;
const total = s(n * spec.sceneMs - (n - 1) * spec.crossfadeMs);
const startOf = (i) => s(i * (spec.sceneMs - spec.crossfadeMs));

// Only rewrite a file when its content changes, as an editor would.
const put = (file, text) => {
  let old = null;
  try {
    old = readFileSync(file, "utf8");
  } catch {}
  if (old !== text) writeFileSync(file, text);
};

mkdirSync(join(dir, "compositions"), { recursive: true });
for (const f of readdirSync(join(dir, "compositions"))) if (!/^scene-\d+\.html$/.test(f)) rmSync(join(dir, "compositions", f));

spec.scenes.forEach((sc, i) => {
  const id = `scene-${i}`;
  put(
    join(dir, "compositions", `${id}.html`),
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
  </head>
  <body>
    <template>
      <style>
        #${id}-root { position: absolute; inset: 0; background-color: ${sc.bg}; color: ${spec.textColor}; font-family: ${spec.font}; }
        #${id}-body { position: absolute; left: 260px; top: 230px; }
        #${id}-heading { font-size: 72px; font-weight: 700; margin-bottom: 56px; }
        #${id}-items li { list-style: none; font-size: 56px; margin-bottom: 28px; }
        #${id}-dot { position: absolute; left: 230px; top: 850px; width: 60px; height: 60px; border-radius: 30px; background: ${sc.accent}; }
      </style>

      <div id="${id}-root" data-composition-id="${id}" data-width="${spec.width}" data-height="${spec.height}">
        <div id="${id}-body" data-layout-allow-overlap>
          <div id="${id}-heading">${esc(sc.heading)}</div>
          <ul id="${id}-items">
${sc.bullets.map((b) => `            <li>• ${esc(b)}</li>`).join("\n")}
          </ul>
        </div>
        <div id="${id}-dot"></div>
      </div>

      <script>
        (() => {
          const tl = gsap.timeline({ paused: true });
${i > 0 ? `          tl.fromTo("#${id}-root", { opacity: 0 }, { opacity: 1, duration: ${s(spec.crossfadeMs)}, ease: "none" }, 0);\n` : ""}          tl.fromTo("#${id}-items li", { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.5, ease: "power2.out", stagger: 0.6 }, ${s(sc.bulletStartMs)});
          tl.fromTo("#${id}-dot", { x: 0 }, { x: 1400, duration: ${s(spec.sceneMs)}, ease: "none" }, 0);
          window.__timelines["${id}"] = tl;
        })();
      </script>
    </template>
  </body>
</html>
`,
  );
});

const fadeOut = s(spec.fadeOutMs);
put(
  join(dir, "index.html"),
  `<!doctype html>
<html lang="en" data-resolution="landscape">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${spec.width}, height=${spec.height}" />
    <title>Edit benchmark</title>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { margin: 0; width: ${spec.width}px; height: ${spec.height}px; overflow: hidden; background: #000; }
      #root { position: relative; width: 100%; height: 100%; overflow: hidden; }
      [data-composition-id="main"] > div[data-composition-src] { position: absolute; inset: 0; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${total}" data-width="${spec.width}" data-height="${spec.height}">
${spec.scenes
  .map(
    (_, i) => `      <div id="scene-${i}" class="clip" data-composition-id="scene-${i}" data-composition-src="compositions/scene-${i}.html" data-start="${startOf(i)}" data-duration="${s(spec.sceneMs)}" data-track-index="${i % 2}" data-track-kind="graphics" data-width="${spec.width}" data-height="${spec.height}"></div>`,
  )
  .join("\n")}
      <audio id="bgm" src="assets/bgm.mp3" data-start="0" data-duration="${total}" data-track-index="2" data-volume="1"
        data-automation='{"version":1,"lanes":[{"target":"volume","points":[{"t":0,"v":0},{"t":${s(spec.fadeInMs)},"v":1},{"t":${+(total - fadeOut).toFixed(3)},"v":1},{"t":${total},"v":0}]}]}'></audio>
    </div>
    <script>
      window.__timelines["main"] = gsap.timeline({ paused: true });
    </script>
  </body>
</html>
`,
);
