// A reel spec checked and made ready to lay out: scene shapes expanded into
// parts, and every part given an id. A reel read from JSON or YAML is checked
// here, with every problem named by its place, before anything is drawn.
// ------------------------------------------------------------------
import { checkFields, closest, f, type Fields } from "./fields.ts";
import { kataDef, kataNames } from "./kata.ts";
import { COMMON, partDef, partTypes, type Placed } from "./parts.ts";
import { KIT_VERSION, type KitReelSpec, type PartSpec } from "./spec.ts";

export type NormScene = { id: string; say: string; ms?: number; parts: Placed<PartSpec>[] };

export const REEL_FIELDS: Fields = {
  kit: f.num(`the layout rules' version: ${KIT_VERSION}`, true),
  title: f.str(),
  fps: f.num("frames per second (default 30)"),
  width: f.num("the default view's width (default 1920)"),
  height: f.num("the default view's height (default 1080)"),
  aspect: f.obj('the shapes it lays out for: { min, max } as "9:16" or numbers (default 9:16 to 16:9)'),
  fonts: f.any("font files: [{ family, src, weight? }], paths relative to the reel"),
  theme: f.obj("colours and font families over the default theme"),
  voice: f.obj('the narration voice: { provider: "kokoro" | "openai" | "gemini" | …, voice?, … }'),
  lexicon: f.obj("reading substitutions for the voice only"),
  music: f.obj("a track under the whole reel: { src, gain?, duck? }"),
  captions: f.bool("captions from each scene's say (default true)"),
  scenes: f.any("the scenes, in order", true),
};

export const SCENE_FIELDS: Fields = {
  id: f.str("a name for messages and the scene list"),
  say: f.str("the narration, also the caption"),
  ms: f.num("hold this long instead of the narration's length"),
  kata: f.str("a scene shape, filled in with the fields beside it"),
  parts: f.parts("parts, after the shape's"),
};

export class KitSpecError extends Error {
  constructor(readonly problems: string[]) {
    super(`the reel has ${problems.length} problem${problems.length === 1 ? "" : "s"}:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "KitSpecError";
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Check `spec`, expand its shapes and place its parts; throws KitSpecError listing every problem. */
export function normalize(spec: KitReelSpec): NormScene[] {
  const problems: string[] = [];
  if (!isObj(spec)) throw new KitSpecError(["the reel must be an object with kit and scenes"]);
  problems.push(...checkFields(spec, REEL_FIELDS, "reel"));
  if (typeof spec.kit === "number" && spec.kit > KIT_VERSION) {
    problems.push(`reel.kit: ${spec.kit} is newer than this kamishibai's layout rules (${KIT_VERSION}); update kamishibai`);
  }
  if (!Array.isArray(spec.scenes) || spec.scenes.length === 0) {
    problems.push("reel.scenes: expected a list of at least one scene");
    throw new KitSpecError(problems);
  }

  const sceneIds = new Set<string>();
  const out: NormScene[] = spec.scenes.map((sc, i) => {
    const at = `scenes[${i}]`;
    if (!isObj(sc)) {
      problems.push(`${at}: expected an object`);
      return { id: `s${i}`, say: "", parts: [] };
    }
    const id = typeof sc.id === "string" ? sc.id : `s${i + 1}`;
    if (sceneIds.has(id)) problems.push(`${at}: the scene id "${id}" is used twice`);
    sceneIds.add(id);
    const where = `${at}${typeof sc.id === "string" ? ` (${sc.id})` : ""}`;

    let fromKata: PartSpec[] = [];
    if (sc.kata !== undefined) {
      const def = typeof sc.kata === "string" ? kataDef(sc.kata) : undefined;
      if (!def) {
        const near = typeof sc.kata === "string" ? closest(sc.kata, kataNames()) : undefined;
        problems.push(`${where}.kata: no shape "${String(sc.kata)}"${near ? ` (did you mean "${near}"?)` : ""}; the shapes are ${kataNames().join(", ")}`);
      } else {
        const own = Object.fromEntries(Object.entries(sc).filter(([k]) => !(k in SCENE_FIELDS)));
        const bad = checkFields(own, def.fields, `${where} (kata ${sc.kata})`);
        problems.push(...bad);
        if (!bad.length) fromKata = def.parts(own);
      }
    }
    // With a shape, the fields beside it were checked against the shape's.
    problems.push(...checkFields(sc, SCENE_FIELDS, where, sc.kata !== undefined ? Object.keys(sc) : []));
    if (sc.kata === undefined && !sc.parts) problems.push(`${where}: a scene needs kata or parts`);

    const used = new Set<string>();
    const place = (p: unknown, pat: string): Placed<PartSpec> | null => {
      if (!isObj(p)) {
        problems.push(`${pat}: expected a part ({ type, … }), got ${JSON.stringify(p)}`);
        return null;
      }
      const def = typeof p.type === "string" ? partDef(p.type) : undefined;
      if (!def) {
        const near = typeof p.type === "string" ? closest(p.type, partTypes()) : undefined;
        problems.push(`${pat}.type: no part "${String(p.type)}"${near ? ` (did you mean "${near}"?)` : ""}; the parts are ${partTypes().join(", ")}`);
        return null;
      }
      const pid = typeof p.id === "string" ? p.id : undefined;
      problems.push(...checkFields(p, { ...COMMON, ...def.fields }, `${pat} (${p.type}${pid ? ` ${pid}` : ""})`, ["type"]));
      let id = pid;
      if (id === undefined) {
        id = p.type as string;
        for (let n = 2; used.has(id); n++) id = `${p.type}.${n}`;
      } else if (used.has(id)) problems.push(`${pat}: the id "${id}" is used twice in this scene`);
      used.add(id);
      const placed: Record<string, unknown> = { ...p, id };
      // Parts inside parts (a row's, or a custom part's lists of parts).
      for (const [k, fd] of Object.entries(def.fields)) {
        if (fd.kind === "parts" && Array.isArray(p[k])) {
          placed[k] = (p[k] as unknown[]).map((c, j) => place(c, `${pat}.${k}[${j}]`)).filter((c) => c !== null);
        }
      }
      return placed as Placed<PartSpec>;
    };
    // The shape's ids are fixed: mark them first, so a written part never takes one.
    const kataParts = fromKata.map((p, j) => place(p, `${where} (kata ${String(sc.kata)}) part ${j}`));
    const written = Array.isArray(sc.parts) ? sc.parts.map((p, j) => place(p, `${where}.parts[${j}]`)) : [];
    return {
      id,
      say: typeof sc.say === "string" ? sc.say : "",
      ms: typeof sc.ms === "number" ? sc.ms : undefined,
      parts: [...kataParts, ...written].filter((p) => p !== null),
    };
  });
  if (problems.length) throw new KitSpecError(problems);
  return out;
}
