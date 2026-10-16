// The JSON Schema of a kit reel, made from the same fields that check one:
// for an editor's completion, and for an agent to write a reel against.
// ------------------------------------------------------------------
import { fieldSchema, type Fields } from "./fields.ts";
import { kataDef, kataNames } from "./kata.ts";
import { REEL_FIELDS, SCENE_FIELDS } from "./normalize.ts";
import { COMMON, partDef, partTypes } from "./parts.ts";

function objectSchema(fields: Fields, part: object, extra: Record<string, unknown> = {}, required: string[] = []) {
  const props: Record<string, unknown> = { ...extra };
  for (const [k, fd] of Object.entries(fields)) {
    if (fd.kind === "function") continue;
    props[k] = fieldSchema(fd, part);
    if (fd.required) required.push(k);
  }
  return { type: "object", properties: props, required, additionalProperties: false };
}

/** The schema, with the parts and shapes defined so far (definePart and defineKata add to it). */
export function kitSchema(): Record<string, unknown> {
  const part = { $ref: "#/$defs/part" };
  // A part that takes a function (paint) is for code reels only.
  const types = partTypes().filter((t) => !Object.values(partDef(t)!.fields).some((fd) => fd.kind === "function" && fd.required));
  const parts = types.map((t) => {
    const def = partDef(t)!;
    return { description: def.doc, ...objectSchema({ ...COMMON, ...def.fields }, part, { type: { const: t } }, ["type"]) };
  });
  const scenes = [
    { description: "A scene written with parts.", ...objectSchema(SCENE_FIELDS, part, {}, ["parts"]) },
    ...kataNames().map((n) => {
      const def = kataDef(n)!;
      const { kata: _, ...rest } = SCENE_FIELDS;
      return { description: def.doc, ...objectSchema({ ...rest, ...def.fields }, part, { kata: { const: n } }, ["kata"]) };
    }),
  ];
  const reel = objectSchema(REEL_FIELDS, part);
  (reel.properties as Record<string, unknown>).scenes = { type: "array", minItems: 1, items: { $ref: "#/$defs/scene" }, description: "the scenes, in order" };
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "kamishibai kit reel",
    ...reel,
    $defs: { part: { oneOf: parts }, scene: { oneOf: scenes } },
  };
}
