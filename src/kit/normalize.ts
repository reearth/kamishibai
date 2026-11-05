// A reel spec checked and made ready to lay out: scene shapes expanded into
// parts, and every part given an id. A reel read from JSON or YAML is checked
// here, with every problem named by its place, before anything is drawn.
// ------------------------------------------------------------------
import { parseAspect } from "../canvas/types.ts";
import { checkFields, closest, f, type Fields } from "./fields.ts";
import { kataDef, kataNames, SCENE_ENTER_FIELDS, SCENE_FIELDS, TRANSITION_FIELDS, TRANSITIONS, type PLACES } from "./kata.ts";
import { COMMON, partDef, partTypes, type Placed } from "./parts.ts";
import { KIT_VERSION, type KitReelSpec, type Pace, type PartSpec, type SayLine, type SceneEnter, type Transition, type TransitionSpec } from "./spec.ts";
import { sentences } from "./text.ts";

export type NormScene = {
  id: string;
  /** the narration, as sentences */
  say: SayLine[];
  /** its narration timing, the reel's laid under the scene's */
  pace: Required<Pace>;
  ms?: number;
  parts: Placed<PartSpec>[];
  /** the sentence each cued part (and every part inside it) comes in with, by id */
  cues: Map<string, number>;
  /** how it comes in after the scene before, and how long that takes (default: the transition's own) */
  transition: Transition;
  transMs?: number;
  /** when its new parts come in, unless a part says */
  enter: SceneEnter;
  /** each part's own timing (and every part's inside it), by id */
  enters: Map<string, PartEnter>;
  /** where the camera moves in, in order of their sentences */
  focus: Focus[];
  /** grow the parts below the heading to fill the room they leave: some, as much as fits (up to n times), or not */
  fill: boolean | "max" | number;
  /** where the parts below the heading sit in their room */
  place: (typeof PLACES)[number];
};

/** When a part comes in, and how long it takes, where its enter says. */
export type PartEnter = { delay?: number; ms?: number };

/** The camera on a part from a sentence on, at a zoom (or as close as fits). */
export type Focus = { on: string; cue: number; zoom?: number };

export const REEL_FIELDS: Fields = {
  kit: f.num(`the layout rules' version: ${KIT_VERSION}`, true),
  uses: f.strs("modules that define parts and shapes, relative to the reel (a JSON or YAML reel)"),
  title: f.str("the reel's name: an exported file's page title"),
  fps: f.num("frames per second (default 30)"),
  width: f.num("the default view's width (default 1920)"),
  height: f.num("the default view's height (default 1080)"),
  aspect: f.any('the shapes it lays out for: one, "9:16" (the default view takes it), or a range { min, max } as "9:16" or numbers (default 9:16 to 16:9)'),
  fonts: f.any("font files: [{ family, src, weight? }], paths relative to the reel"),
  theme: f.obj("over the default (light) theme: colours paper, card, well, ink, ink2, ink3, rule, accent, accentText, accentTint, onAccent, and any of your own by name; fonts { sans, mono, bold?, black? } (bold and black default to sans's family); weights { body, bold, black, mono? }"),
  voice: f.obj('the narration voice: { provider: "kokoro" | "openai" | "gemini" | … or a --tts-adapter provider, voice?, … }'),
  lexicon: f.obj("reading substitutions for the voice only"),
  music: f.obj("a track under the whole reel, looped: { src (relative to the reel), gain? (dB, default -14), duck? (lowered under the voice: true by default, or { amountDb, attackMs, releaseMs }), fadeInMs?, fadeOutMs? (default 1500), trimStartMs? }"),
  pace: f.obj("narration timing for every scene, in ms: { lead? (400), gap? (250), tail? (700) }; a scene's pace overrides it"),
  transition: f.oneOr(TRANSITIONS, TRANSITION_FIELDS, 'how every scene comes in, unless it says: "morph" (default), "cut", "fade", "push" or "wipe", or { type?, ms? } with how long it takes'),
  enter: f.obj("when new parts come in, in every scene, unless it says: { delay?, ms?, stagger? }", false, SCENE_ENTER_FIELDS),
  captions: f.any('captions from each scene\'s say: true (a subtitle track, the default), "burn" (drawn into the picture) or false'),
  captionStyle: f.obj('how burned captions look: { color? (#fff), box? (rgba(0,0,0,0.62)), size? (40 wide, 48 tall), font? (bold) }, colours by theme name or CSS'),
  captionRoom: f.bool("keep room at the foot for the captions (default true when there are captions); false gives it to the parts"),
  scenes: f.any("the scenes, in order", true),
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

/** Narration timing by default: the voice starts 400 ms into a scene, 250 ms between sentences, and the scene holds 700 ms after. */
export const PACE: Required<Pace> = { lead: 400, gap: 250, tail: 700 };

const PACE_FIELDS: Fields = {
  lead: f.num("ms before the first sentence (default 400)"),
  gap: f.num("ms between sentences (default 250)"),
  tail: f.num("ms the scene holds after the last (default 700)"),
};
const LINE_FIELDS: Fields = {
  text: f.str("what is spoken (and captioned, unless caption is given)", true),
  caption: f.str("what the caption shows instead"),
  voice: f.obj("the voice's options for this sentence alone, over the reel's (not its provider)"),
  pause: f.num("ms of silence after it: before the next sentence instead of the gap, or, after the last, before the scene ends instead of the tail"),
};

function checkPace(v: unknown, at: string): string[] {
  if (v === undefined) return [];
  if (!isObj(v)) return [`${at}: expected { lead?, gap?, tail? } in ms`];
  return checkFields(v, PACE_FIELDS, at);
}

/** A scene's say as sentences: a text split, or a list of texts and written-out lines. */
function sayLines(v: unknown, at: string, problems: string[]): SayLine[] {
  if (v === undefined) return [];
  if (typeof v === "string") return sentences(v).map((text) => ({ text }));
  if (!Array.isArray(v)) return void problems.push(`${at}: expected a text, or a list of sentences`), [];
  const out: SayLine[] = [];
  v.forEach((l, i) => {
    if (typeof l === "string") return void (l.trim() && out.push({ text: l }));
    if (!isObj(l)) return void problems.push(`${at}[${i}]: expected a sentence, or { text, caption?, voice?, pause? }`);
    if (typeof l.text !== "string" && Object.keys(l).length === 1) {
      // Unquoted YAML text with ": " in it is read as a map.
      return void problems.push(`${at}[${i}]: expected a sentence, got ${JSON.stringify(l)} (YAML reads "a: b" as a map: put the text in quotes)`);
    }
    const p = checkFields(l, LINE_FIELDS, `${at}[${i}]`);
    if (p.length) return void problems.push(...p);
    out.push(l as SayLine);
  });
  return out;
}

/** A scene's transition: the reel's, with the scene's fields over it (a name is its type). */
function transitionOf(reel: TransitionSpec | undefined, scene: TransitionSpec | undefined): { transition: Transition; transMs?: number } {
  const o = (t: TransitionSpec | undefined) => (typeof t === "string" ? { type: t } : isObj(t) ? t : {});
  const t = { ...o(reel), ...o(scene) };
  return { transition: t.type ?? "morph", ...(t.ms !== undefined ? { transMs: t.ms } : {}) };
}

/** Check `spec`, expand its shapes and place its parts; throws KitSpecError listing every problem. */
export function normalize(spec: KitReelSpec): NormScene[] {
  const problems: string[] = [];
  if (!isObj(spec)) throw new KitSpecError(["the reel must be an object with kit and scenes"]);
  problems.push(...checkFields(spec, REEL_FIELDS, "reel"));
  problems.push(...checkPace(spec.pace, "reel.pace"));
  const ratio = (v: unknown, at: string) => {
    if (v === undefined) return;
    try {
      if (typeof v !== "string" && typeof v !== "number") throw new Error();
      parseAspect(v);
    } catch {
      problems.push(`${at}: expected a shape such as "9:16" or a number, got ${JSON.stringify(v)}`);
    }
  };
  if (isObj(spec.aspect)) (ratio(spec.aspect.min, "reel.aspect.min"), ratio(spec.aspect.max, "reel.aspect.max"));
  else ratio(spec.aspect, "reel.aspect");
  if (spec.captions !== undefined && typeof spec.captions !== "boolean" && spec.captions !== "burn") {
    problems.push(`reel.captions: expected true, false or "burn", got ${JSON.stringify(spec.captions)}`);
  }
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
      return { id: `s${i}`, say: [], pace: PACE, parts: [], cues: new Map(), transition: "morph", enter: {}, enters: new Map(), focus: [], fill: true, place: "center" };
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
    if (sc.fill !== undefined && typeof sc.fill !== "boolean" && sc.fill !== "max" && !(typeof sc.fill === "number" && sc.fill >= 1)) problems.push(`${where}.fill: expected true, false, "max" or a number from 1, got ${JSON.stringify(sc.fill)}`);
    if (sc.kata === undefined && !sc.parts) problems.push(`${where}: a scene needs kata or parts`);

    const say = sayLines(sc.say, `${where}.say`, problems);
    problems.push(...checkPace(sc.pace, `${where}.pace`));
    const cues = new Map<string, number>();
    const enters = new Map<string, PartEnter>();
    const used = new Set<string>();
    // Things inside parts that focus may aim at too (a figure's items, as "figure.item").
    const inner = new Set<string>();
    const place = (p: unknown, pat: string, inherited?: number, timing?: PartEnter): Placed<PartSpec> | null => {
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
      for (const t of def.targets?.({ ...p, id } as never) ?? []) inner.add(t);
      if (cue) cues.set(id, cue);
      // An enter written out: its verb stays on the part, its timing with the scene, and the parts inside take it.
      let own = timing;
      let verb = p.enter;
      if (isObj(p.enter)) {
        const { type, ms, delay } = p.enter as { type?: string; ms?: number; delay?: number };
        own = { ...timing, ...(ms !== undefined ? { ms } : {}), ...(delay !== undefined ? { delay } : {}) };
        verb = type;
      }
      if (own) enters.set(id, own);
      for (const [what, n] of def.stepCues?.({ ...p, id } as never) ?? []) {
        if (!Number.isInteger(n) || n < 0 || n >= Math.max(1, say.length)) problems.push(`${label}: ${what} moves at cue ${n}, which is not a sentence of this scene's say (it has ${say.length})`);
      }
      for (const [turn, n] of def.cues?.({ ...p, id } as never) ?? []) {
        if (!Number.isInteger(n) || n < 0 || n >= Math.max(1, say.length)) problems.push(`${label}: the cue ${n} of ${turn} is not a sentence of this scene's say (it has ${say.length})`);
        else if (n) cues.set(turn, n);
      }
      const placed: Record<string, unknown> = { ...p, id };
      if (verb === undefined) delete placed.enter;
      else placed.enter = verb;
      // Parts inside parts (a row's, or a custom part's lists of parts).
      for (const [k, fd] of Object.entries(def.fields)) {
        if (fd.kind === "parts" && Array.isArray(p[k])) {
          placed[k] = (p[k] as unknown[]).map((c, j) => place(c, `${pat}.${k}[${j}]`, cue, own)).filter((c) => c !== null);
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
        if (!used.has(o.on) && !inner.has(o.on)) {
          const near = closest(o.on, [...used, ...inner]);
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
      pace: { ...PACE, ...(isObj(spec.pace) ? spec.pace : {}), ...(isObj(sc.pace) ? sc.pace : {}) } as Required<Pace>,
      ms: typeof sc.ms === "number" ? sc.ms : undefined,
      parts: [...kataParts, ...written].filter((p) => p !== null),
      cues,
      ...transitionOf(spec.transition, sc.transition),
      enter: { ...(isObj(spec.enter) ? spec.enter : {}), ...(isObj(sc.enter) ? sc.enter : {}) } as SceneEnter,
      enters,
      focus,
      fill: sc.fill === "max" || typeof sc.fill === "number" ? sc.fill : sc.fill !== false,
      place: (sc.place as NormScene["place"] | undefined) ?? "center",
    };
  });
  if (problems.length) throw new KitSpecError(problems);
  return out;
}
