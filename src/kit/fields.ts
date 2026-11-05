// The fields a part or a scene shape takes, written once: they check a reel
// read from JSON or YAML (with messages that name the place), and they make
// the JSON Schema an editor or an agent reads.
// ------------------------------------------------------------------

export type Field = {
  kind: "string" | "number" | "boolean" | "strings" | "text" | "parts" | "function" | "object" | "list" | "any";
  /** the least a number may be */
  min?: number;
  /** the values a string may take */
  enum?: readonly string[];
  /** a string, or an object written out */
  orObject?: boolean;
  /** the fields of the object (an object field's, or the object a string may be instead), checked with it */
  of?: Fields;
  required?: boolean;
  doc?: string;
};
export type Fields = Record<string, Field>;

export const f = {
  str: (doc?: string, required = false): Field => ({ kind: "string", doc, required }),
  num: (doc?: string, required = false): Field => ({ kind: "number", doc, required }),
  /** a length (of time in ms, or of room): 0 or more */
  ms: (doc?: string): Field => ({ kind: "number", min: 0, doc }),
  bool: (doc?: string): Field => ({ kind: "boolean", doc }),
  strs: (doc?: string, required = false): Field => ({ kind: "strings", doc, required }),
  text: (doc?: string, required = false): Field => ({ kind: "text", doc, required }),
  list: (doc?: string, required = false): Field => ({ kind: "list", doc, required }),
  parts: (doc?: string, required = false): Field => ({ kind: "parts", doc, required }),
  fn: (doc?: string, required = false): Field => ({ kind: "function", doc, required }),
  obj: (doc?: string, required = false, of?: Fields): Field => ({ kind: "object", doc, required, ...(of ? { of } : {}) }),
  any: (doc?: string, required = false): Field => ({ kind: "any", doc, required }),
  one: (values: readonly string[], doc?: string): Field => ({ kind: "string", enum: values, doc }),
  /** one of `values`, or an object that says more */
  oneOr: (values: readonly string[], of: Fields, doc?: string): Field => ({ kind: "string", enum: values, orObject: true, of, doc }),
};

const kindOf = (v: unknown): string =>
  Array.isArray(v) ? "array" : v === null ? "null" : typeof v;

/** What is wrong with `o` against `fields`, each message led by `at`. */
export function checkFields(o: Record<string, unknown>, fields: Fields, at: string, known: readonly string[] = []): string[] {
  const out: string[] = [];
  for (const [k, fd] of Object.entries(fields)) {
    const v = o[k];
    if (v === undefined) {
      if (fd.required) out.push(`${at}: "${k}" is required${fd.doc ? ` (${fd.doc})` : ""}`);
      continue;
    }
    // Unquoted YAML text with ": " in it is read as a map; say how to keep it text.
    const quote = (fd.kind === "string" && !fd.orObject || fd.kind === "strings" || fd.kind === "text") && hasMap(v) ? ' (YAML reads "a: b" as a map: put the text in quotes)' : "";
    const bad = (want: string) => out.push(`${at}.${k}: expected ${want}, got ${kindOf(v)} ${short(v)}${quote}`);
    switch (fd.kind) {
      case "string":
        if (fd.orObject && kindOf(v) === "object") {
          out.push(...checkFields(v as Record<string, unknown>, fd.of ?? {}, `${at}.${k}`));
          break;
        }
        if (typeof v !== "string") bad(fd.orObject ? "a string or an object" : "a string");
        else if (fd.enum && !fd.enum.includes(v)) out.push(`${at}.${k}: "${v}" is not one of ${fd.enum.map((e) => `"${e}"`).join(", ")}`);
        break;
      case "number":
        if (typeof v !== "number" || !isFinite(v)) bad("a number");
        else if (fd.min !== undefined && v < fd.min) out.push(`${at}.${k}: ${v} is under ${fd.min}`);
        break;
      case "boolean":
        if (typeof v !== "boolean") bad("true or false");
        break;
      case "strings":
        if (!Array.isArray(v) || v.some((s) => typeof s !== "string")) bad("a list of strings");
        break;
      case "text":
        if (typeof v !== "string" && (!Array.isArray(v) || v.some((s) => typeof s !== "string"))) bad("a string or a list of strings");
        break;
      case "parts":
        if (!Array.isArray(v)) bad("a list of parts");
        break;
      case "list":
        if (!Array.isArray(v)) bad("a list");
        break;
      case "function":
        if (typeof v !== "function") bad("a function (only in a code reel)");
        break;
      case "object":
        if (kindOf(v) !== "object") bad("an object");
        else if (fd.of) out.push(...checkFields(v as Record<string, unknown>, fd.of, `${at}.${k}`));
        break;
    }
  }
  for (const k of Object.keys(o)) {
    if (!(k in fields) && !known.includes(k)) {
      const near = closest(k, [...Object.keys(fields), ...known]);
      out.push(`${at}: unknown field "${k}"${near ? ` (did you mean "${near}"?)` : ""}`);
    }
  }
  return out;
}

const hasMap = (v: unknown): boolean => kindOf(v) === "object" || (Array.isArray(v) && v.some((x) => kindOf(x) === "object"));

function short(v: unknown): string {
  const s = typeof v === "function" ? "function" : JSON.stringify(v) ?? String(v);
  return s.length > 40 ? s.slice(0, 37) + "…" : s;
}

/** The candidate a typo most likely meant, if any is near. */
export function closest(s: string, from: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestD = Math.max(2, Math.floor(s.length / 3)) + 1;
  for (const c of from) {
    const d = distance(s.toLowerCase(), c.toLowerCase());
    if (d < bestD) (best = c), (bestD = d);
  }
  return best;
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length]!;
}

/** A field as JSON Schema. `part` is the schema a part is, for lists of parts. */
export function fieldSchema(fd: Field, part: object): Record<string, unknown> {
  const doc = fd.doc ? { description: fd.doc } : {};
  switch (fd.kind) {
    case "string": {
      const str = { type: "string", ...(fd.enum ? { enum: fd.enum } : {}) };
      return fd.orObject ? { anyOf: [str, objectOf(fd.of ?? {}, part)], ...doc } : { ...str, ...doc };
    }
    case "number":
      return { type: "number", ...(fd.min !== undefined ? { minimum: fd.min } : {}), ...doc };
    case "boolean":
      return { type: "boolean", ...doc };
    case "strings":
      return { type: "array", items: { type: "string" }, ...doc };
    case "text":
      return { anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }], ...doc };
    case "list":
      return { type: "array", ...doc };
    case "parts":
      return { type: "array", items: part, ...doc };
    case "object":
      return fd.of ? { ...objectOf(fd.of, part), ...doc } : { type: "object", ...doc };
    default:
      return { ...doc };
  }
}

/** The object `fields` describe, as JSON Schema. */
function objectOf(fields: Fields, part: object): Record<string, unknown> {
  const properties = Object.fromEntries(Object.entries(fields).map(([k, fd]) => [k, fieldSchema(fd, part)]));
  return { type: "object", properties, additionalProperties: false };
}
