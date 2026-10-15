// The first module in a page exported by `kamishibai export`: it runs before
// the reel's own code, and answers from the data in the file what the page
// would otherwise ask a server for. The file is opened from anywhere, file://
// included, with no server behind it.
//
// - prepareNarration gets the lines recorded at export.
// - A file the page read while it was recorded (an image, a font, a video
//   clip, JSON…) is served from the file: fetch and XMLHttpRequest are
//   redirected to it, src/href/poster attributes and CSS url()s are rewritten
//   to it, in elements and FontFace sources alike.
//
// Paths are matched as the page asked for them on the server it was recorded
// from, where the page was the root: "x.png" and "/x.png" are the same file.
// ------------------------------------------------------------------
import { TTS_HOOK } from "./tts/index.ts";

interface ExportData {
  narration?: [string, unknown][];
  /** path (with query) → [content type, base64] */
  files?: Record<string, [string, string]>;
}

const data = JSON.parse(document.getElementById("kamishibai-data")?.textContent ?? "{}") as ExportData;

// ---- narration --------------------------------------------------------------

const lines = new Map(data.narration ?? []);
(globalThis as Record<string, unknown>)[TTS_HOOK] = async (body: unknown) => {
  const clips = lines.get(JSON.stringify(body));
  if (!clips) throw new Error("this narration was not exported with the reel: run kamishibai export again");
  return clips;
};

// ---- files ------------------------------------------------------------------

const files = data.files ?? {};
const ROOT = "http://kamishibai.invalid/";
// The folder the exported file is in: a URL the browser already resolved
// against the file:// page maps back to the recorded root from here.
const here = location.href.replace(/[?#].*$/, "").replace(/[^/]*$/, "");
const blobs = new Map<string, string>();

/** The embedded file for a URL the page asked for, as a blob: URL, or undefined. */
export function embedded(u: string): string | undefined {
  if (!u || /^(data|blob|about|javascript):/i.test(u)) return undefined;
  let path: string;
  if (u.startsWith(here)) path = "/" + u.slice(here.length);
  else {
    let url: URL;
    try {
      url = new URL(u, ROOT);
    } catch {
      return undefined;
    }
    if (`${url.protocol}//${url.host}/` !== ROOT) return undefined;
    path = url.pathname + url.search;
  }
  const key = path in files ? path : path.replace(/\?.*$/, "");
  const file = files[key];
  if (!file) return undefined;
  let blob = blobs.get(key);
  if (!blob) {
    const bytes = Uint8Array.from(atob(file[1]), (c) => c.charCodeAt(0));
    // A stylesheet's own url()s are relative to it, and a blob: URL has no folder.
    const body = /css/.test(file[0]) ? rewriteCss(new TextDecoder().decode(bytes), key) : bytes;
    blob = URL.createObjectURL(new Blob([body], { type: file[0] }));
    blobs.set(key, blob);
  }
  return blob;
}

/** Point the url()s in `css` at embedded files; `from` is the stylesheet's own path, if it has one. */
function rewriteCss(css: string, from?: string): string {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (whole, _q, u: string) => {
    const ref = u.trim();
    const b = embedded(from && !/^[a-z]+:|^\//i.test(ref) ? new URL(ref, ROOT + from.replace(/^\//, "")).href : ref);
    return b ? `url("${b}")` : whole;
  });
}

if (Object.keys(files).length) {
  const fetch0 = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const u = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const b = embedded(u);
    return b ? fetch0(b, init) : fetch0(input, init);
  };

  const open0 = XMLHttpRequest.prototype.open as (this: XMLHttpRequest, ...a: unknown[]) => void;
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
    return open0.call(this, method, embedded(String(url)) ?? url, ...rest);
  } as typeof XMLHttpRequest.prototype.open;

  const FontFace0 = window.FontFace;
  window.FontFace = function (family: string, source: string | BufferSource, desc?: FontFaceDescriptors) {
    return new FontFace0(family, typeof source === "string" ? rewriteCss(source) : source, desc);
  } as unknown as typeof FontFace;
  window.FontFace.prototype = FontFace0.prototype;

  // An element's URL, set as a property (often before it is in the document,
  // as `new Image()` is) or as an attribute.
  for (const [Ctor, prop] of [
    [HTMLImageElement, "src"],
    [HTMLMediaElement, "src"],
    [HTMLSourceElement, "src"],
    [HTMLVideoElement, "poster"],
    [HTMLLinkElement, "href"],
  ] as const) {
    const d = Object.getOwnPropertyDescriptor(Ctor.prototype, prop);
    if (!d?.set) continue;
    Object.defineProperty(Ctor.prototype, prop, {
      ...d,
      set(this: Element, v: string) {
        d.set!.call(this, embedded(String(v)) ?? v);
      },
    });
  }
  const setAttribute0 = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (this: Element, name: string, value: string) {
    const n = name.toLowerCase();
    const v = n === "style" ? rewriteCss(String(value)) : n === "src" || n === "href" || n === "poster" ? (embedded(String(value)) ?? value) : value;
    return setAttribute0.call(this, name, v);
  };

  // What the attributes above don't see: markup parsed from HTML, inline
  // styles set property by property, <style> text, and <link> stylesheets.
  const fix = (el: Element) => {
    for (const a of ["src", "href", "poster"]) {
      const v = el.getAttribute(a);
      const b = v && embedded(v);
      if (b) setAttribute0.call(el, a, b);
    }
    const style = el.getAttribute("style");
    if (style && /url\(/.test(style)) {
      const next = rewriteCss(style);
      if (next !== style) setAttribute0.call(el, "style", next);
    }
    if (el instanceof HTMLStyleElement && el.textContent && /url\(/.test(el.textContent)) {
      const next = rewriteCss(el.textContent);
      if (next !== el.textContent) el.textContent = next;
    }
  };
  const walk = (n: Node) => {
    if (!(n instanceof Element)) return;
    fix(n);
    for (const e of n.querySelectorAll("*")) fix(e);
  };
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "childList") r.addedNodes.forEach(walk);
      else if (r.type === "attributes" && r.target instanceof Element) fix(r.target);
      else if (r.type === "characterData" && r.target.parentElement instanceof HTMLStyleElement) fix(r.target.parentElement);
    }
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["src", "href", "poster", "style"], characterData: true });
}
