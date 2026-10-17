// `kamishibai check`: a kit reel's layout checked for every shape it lays out
// for, with no frame drawn: overlaps, things off the stage, text that spills
// or can't break, weak contrast, a word left alone on a line.
// ------------------------------------------------------------------
import { loadCanvasEntry, nodeEnv, registerFonts, setTTSHook } from "./canvas/node.ts";
import { resolveView, viewKey, type ViewRequest, type View } from "./canvas/types.ts";
import type { Issue } from "./kit/check.ts";
import { estimateMs } from "./tts/index.ts";

export interface CheckOptions {
  entry: string;
  /** one view to check; default: meta's own and the ends of meta.aspect */
  view?: ViewRequest;
}

export interface CheckResult {
  views: Array<{ width: number; height: number; issues: Issue[] }>;
  count: number;
}

export async function checkEntry(opts: CheckOptions): Promise<CheckResult> {
  // The layout doesn't wait on the voice: every line gets an estimated length.
  setTTSHook(async (body) => {
    const { items } = body as { items: Record<string, { text: string; caption: string }> };
    return Object.fromEntries(Object.entries(items).map(([k, it]) => [k, { src: "", durationMs: estimateMs(it.text), text: it.caption }]));
  });
  let entry;
  try {
    entry = await loadCanvasEntry(opts.entry);
  } finally {
    setTTSHook(undefined);
  }
  if (!entry) throw new Error(`${opts.entry} is not a canvas reel: check reads a kit reel (kamishibai/kit, or a .json / .yaml one)`);
  try {
    const reel = entry.reel as typeof entry.reel & { check?: (view: View, env: unknown) => Promise<Issue[]> };
    if (typeof reel.check !== "function") throw new Error(`${opts.entry} is a canvas reel without a layout to check: check reads a kit reel (kamishibai/kit)`);
    const m = reel.meta;
    const asks: ViewRequest[] = opts.view ? [opts.view] : [{}, ...(m.aspect ? [{ aspect: m.aspect.min }, { aspect: m.aspect.max }] : [])];
    await registerFonts(reel, entry.dir);
    const env = await nodeEnv(entry.dir);
    const seen = new Set<string>();
    const views: CheckResult["views"] = [];
    for (const ask of asks) {
      const view = resolveView(m, ask);
      if (seen.has(viewKey(view))) continue;
      seen.add(viewKey(view));
      views.push({ width: view.width, height: view.height, issues: await reel.check(view, env) });
    }
    return { views, count: views.reduce((n, v) => n + v.issues.length, 0) };
  } finally {
    await entry.close();
  }
}

/** The result as lines for a terminal. */
export function formatCheck(r: CheckResult): string {
  const out: string[] = [];
  for (const v of r.views) {
    out.push(`${v.width}×${v.height}: ${v.issues.length ? `${v.issues.length} issue${v.issues.length === 1 ? "" : "s"}` : "no issues"}`);
    for (const i of v.issues) out.push(`  ${i.scene}  ${i.kind}  ${i.msg}`);
  }
  return out.join("\n") + "\n";
}
