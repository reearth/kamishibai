// A reel spec checked and made ready to lay out: scene shapes expanded into
// parts, and every part given an id. A reel read from JSON or YAML is checked
// here, with every problem named by its place, before anything is drawn.
// ------------------------------------------------------------------
import { checkFields, closest, f, type Fields } from "./fields.ts";
import { kataDef, kataNames } from "./kata.ts";
import { COMMON, partDef, partTypes, type Placed } from "./parts.ts";
import { KIT_VERSION, type KitReelSpec, type PartSpec, type Transition } from "./spec.ts";
import { sentences } from "./text.ts";

export type NormScene = {
  id: string;
  /** the narration, as sentences */
  say: string[];
  ms?: number;
  parts: Placed<PartSpec>[];
  /** the sentence each cued part (and every part inside it) comes in with, by id */
  cues: Map<string, number>;
  /** how it comes in after the scene before */
  transition: Transition;
  /** where the camera moves in, in order of their sentences */
  focus: Focus[];
};

/** The camera on a part from a sentence on, at a zoom (or as close as fits). */
export type Focus = { on: string; cue: number; zoom?: number };

const TRANSITIONS = ["morph", "cut", "fade", "push", "wipe"] as const;

export const REEL_FIELDS: Fields = {
  kit: f.num(`the layout rules' version: ${KIT_VERSION}`, true),
  uses: f.strs("modules that define parts and shapes, relative to the reel (a JSON or YAML reel)"),
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
  say: f.text("the narration, and its captions: a text split into sentences, or a list of sentences"),
  ms: f.num("hold this long instead of the narration's length"),
  kata: f.str("a scene shape, filled in with the fields beside it"),
  parts: f.parts("parts, after the shape's"),
  transition: f.one(TRANSITIONS, 'how it comes in after the scene before: "morph" (default: what stays moves), "cut", "fade", "push" or "wipe"'),
  focus: f.any("move the camera in on a part: its id, { on, cue?, zoom? }, or a list of those"),
};

const FOCUS_FIELDS: Fields = {
  on: f.str("the id of the part to frame", true),
  cue: f.num("move as this sentence of the scene's say starts (default 0, with the scene)"),
  zoom: f.num("how far in at most, 1 or more (default: as close as frames the part)"),
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
      return { id: `s${i}`, say: [], parts: [], cues: new Map(), transition: "morph", focus: [] };
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

    const say = typeof sc.say === "string" ? sentences(sc.say) : Array.isArray(sc.say) ? sc.say.filter((s): s is string => typeof s === "string" && s.trim() !== "") : [];
    const cues = new Map<string, number>();
    const used = new Set<string>();
    const place = (p: unknown, pat: string, inherited?: number): Placed<PartSpec> | null => {
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
      const label = `${pat} (${p.type}${pid ? ` ${pid}` : ""})`;
      problems.push(...checkFields(p, { ...COMMON, ...def.fields }, label, ["type"]));
      problems.push(...(def.check?.(p as never, label) ?? []));
      let cue = inherited;
      if (typeof p.cue === "number") {
        if (!Number.isInteger(p.cue) || p.cue < 0 || p.cue >= Math.max(1, say.length)) {
          problems.push(`${label}.cue: ${p.cue} is not a sentence of this scene's say (it has ${say.length}: 0${say.length > 1 ? `…${say.length - 1}` : ""})`);
        } else cue = p.cue;
      }
      let id = pid;
      if (id === undefined) {
        id = p.type as string;
        for (let n = 2; used.has(id); n++) id = `${p.type}.${n}`;
      } else if (used.has(id)) problems.push(`${pat}: the id "${id}" is used twice in this scene`);
      used.add(id);
      if (cue) cues.set(id, cue);
      for (const [turn, n] of def.cues?.({ ...p, id } as never) ?? []) {
        if (!Number.isInteger(n) || n < 0 || n >= Math.max(1, say.length)) problems.push(`${label}: the cue ${n} of ${turn} is not a sentence of this scene's say (it has ${say.length})`);
        else if (n) cues.set(turn, n);
      }
      const placed: Record<string, unknown> = { ...p, id };
      // Parts inside parts (a row's, or a custom part's lists of parts).
      for (const [k, fd] of Object.entries(def.fields)) {
        if (fd.kind === "parts" && Array.isArray(p[k])) {
          placed[k] = (p[k] as unknown[]).map((c, j) => place(c, `${pat}.${k}[${j}]`, cue)).filter((c) => c !== null);
        }
      }
      return placed as Placed<PartSpec>;
    };
    // The shape's ids are fixed: mark them first, so a written part never takes one.
    const kataParts = fromKata.map((p, j) => place(p, `${where} (kata ${String(sc.kata)}) part ${j}`));
    const written = Array.isArray(sc.parts) ? sc.parts.map((p, j) => place(p, `${where}.parts[${j}]`)) : [];
    const focus: Focus[] = [];
    if (sc.focus !== undefined) {
      const list = Array.isArray(sc.focus) ? sc.focus : [sc.focus];
      list.forEach((fc, j) => {
        const fat = `${where}.focus${Array.isArray(sc.focus) ? `[${j}]` : ""}`;
        const o = typeof fc === "string" ? { on: fc } : isObj(fc) ? fc : undefined;
        if (!o) return problems.push(`${fat}: expected a part's id or { on, cue?, zoom? }, got ${JSON.stringify(fc)}`);
        problems.push(...checkFields(o, FOCUS_FIELDS, fat));
        if (typeof o.on !== "string") return;
        if (!used.has(o.on)) {
          const near = closest(o.on, [...used]);
          return problems.push(`${fat}: no part "${o.on}" in this scene${near ? ` (did you mean "${near}"?)` : ""}`);
        }
        const cue = typeof o.cue === "number" ? o.cue : 0;
        if (!Number.isInteger(cue) || cue < 0 || cue >= Math.max(1, say.length)) return problems.push(`${fat}.cue: ${cue} is not a sentence of this scene's say (it has ${say.length})`);
        if (typeof o.zoom === "number" && !(o.zoom >= 1)) return problems.push(`${fat}.zoom: ${o.zoom} is under 1 (the camera only moves in)`);
        if (focus.length && cue <= focus.at(-1)!.cue) return problems.push(`${fat}.cue: the camera moves in sentence order, so this cue must be after ${focus.at(-1)!.cue}`);
        focus.push({ on: o.on, cue, zoom: typeof o.zoom === "number" ? o.zoom : undefined });
      });
    }
    return {
      id,
      say,
      ms: typeof sc.ms === "number" ? sc.ms : undefined,
      parts: [...kataParts, ...written].filter((p) => p !== null),
      cues,
      transition: (sc.transition as Transition | undefined) ?? "morph",
      focus,
    };
  });
  if (problems.length) throw new KitSpecError(problems);
  return out;
}
