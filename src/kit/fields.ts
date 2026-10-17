// The fields a part or a scene shape takes, written once: they check a reel
// read from JSON or YAML (with messages that name the place), and they make
// the JSON Schema an editor or an agent reads.
// ------------------------------------------------------------------

export type Field = {
  kind: "string" | "number" | "boolean" | "strings" | "text" | "parts" | "function" | "object" | "list" | "any";
  /** the values a string may take */
  enum?: readonly string[];
  required?: boolean;
  doc?: string;
};
export type Fields = Record<string, Field>;

export const f = {
  str: (doc?: string, required = false): Field => ({ kind: "string", doc, required }),
  num: (doc?: string, required = false): Field => ({ kind: "number", doc, required }),
  bool: (doc?: string): Field => ({ kind: "boolean", doc }),
  strs: (doc?: string, required = false): Field => ({ kind: "strings", doc, required }),
  text: (doc?: string, required = false): Field => ({ kind: "text", doc, required }),
  list: (doc?: string, required = false): Field => ({ kind: "list", doc, required }),
  parts: (doc?: string, required = false): Field => ({ kind: "parts", doc, required }),
  fn: (doc?: string, required = false): Field => ({ kind: "function", doc, required }),
  obj: (doc?: string, required = false): Field => ({ kind: "object", doc, required }),
  any: (doc?: string, required = false): Field => ({ kind: "any", doc, required }),
  one: (values: readonly string[], doc?: string): Field => ({ kind: "string", enum: values, doc }),
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
    const bad = (want: string) => out.push(`${at}.${k}: expected ${want}, got ${kindOf(v)} ${short(v)}`);
    switch (fd.kind) {
      case "string":
        if (typeof v !== "string") bad("a string");
        else if (fd.enum && !fd.enum.includes(v)) out.push(`${at}.${k}: "${v}" is not one of ${fd.enum.map((e) => `"${e}"`).join(", ")}`);
        break;
      case "number":
        if (typeof v !== "number" || !isFinite(v)) bad("a number");
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
    case "string":
      return { type: "string", ...(fd.enum ? { enum: fd.enum } : {}), ...doc };
    case "number":
      return { type: "number", ...doc };
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
      return { type: "object", ...doc };
    default:
      return { ...doc };
  }
}
