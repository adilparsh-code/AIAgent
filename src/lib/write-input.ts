/**
 * MEDIUM-2 — strict, bounded validation for owner write routes.
 *
 * `POST /api/opportunities`, `POST /api/products` and `POST /api/revenue`
 * read `request.json()` with no size cap and then spread the whole body into
 * the repository:
 *
 *   const body = await request.json();
 *   create({ ...body, ownerId: user.id });
 *
 * Two problems. First, the body was unbounded, so a single authenticated
 * request could stream an arbitrarily large payload into memory. Second, the
 * spread is a mass assignment: any field the client invents — including
 * `overallScore`, `halalStatus`, `halalScore` or `isSample` — reached the
 * create call, so a caller could write server-owned scoring and provenance
 * fields that are supposed to be derived from research.
 *
 * The fix here is deliberately structural rather than a per-field deny list:
 * `pickFields` copies ONLY the keys a route explicitly allows, so a field that
 * is not allowlisted cannot reach persistence no matter what the client sends.
 * Ownership is still assigned server-side from the session and can never come
 * from the body.
 */
export const WRITE_INPUT_LIMITS = {
  /** Max accepted request body, in characters (all payloads are UTF-8 JSON). */
  MAX_BODY_BYTES: 16 * 1024,
  MAX_SHORT_TEXT: 500,
  MAX_LONG_TEXT: 4_000,
  MAX_LIST_ITEMS: 50,
} as const;

export interface ParsedWriteBody {
  ok: true;
  body: Record<string, unknown>;
}

export interface WriteBodyFailure {
  ok: false;
  error: string;
  status: number;
}

export type ParsedWriteBodyResult = ParsedWriteBody | WriteBodyFailure;

/**
 * Read a write request body with a hard size cap and a strict JSON parse.
 * Mirrors the existing `MAX_BODY_BYTES` convention used by the handoff,
 * auth and discovery routes.
 */
export function readWriteBody(raw: string | null): ParsedWriteBodyResult {
  if (raw == null) return { ok: false, error: "Invalid JSON body", status: 400 };
  if (raw.length > WRITE_INPUT_LIMITS.MAX_BODY_BYTES) {
    return { ok: false, error: "Request body too large", status: 413 };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || "{}");
  } catch {
    return { ok: false, error: "Invalid JSON body", status: 400 };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: "Request body must be a JSON object", status: 400 };
  }
  return { ok: true, body: parsed as Record<string, unknown> };
}

export interface FieldDefinition {
  /** "string" | "number" | "stringArray" | "any" */
  kind: "string" | "number" | "stringArray" | "any";
  required?: boolean;
  maxLength?: number;
  /** Inclusive lower/upper bound for numbers. */
  min?: number;
  max?: number;
  /** Optional fixed set of allowed values. */
  oneOf?: readonly string[];
  default?: unknown;
}

export type FieldSpec = Record<string, FieldDefinition>;

export interface PickedBody {
  ok: true;
  value: Record<string, unknown>;
}

export interface PickFailure {
  ok: false;
  error: string;
  status: 400;
}

export type PickResult = PickedBody | PickFailure;

/**
 * Copy the allowlisted fields out of an untrusted body, validating each one.
 *
 * A field the client omits takes its declared default and is then omitted from
 * the result, so the repository keeps applying its own default. A field the
 * client sends with the wrong type, an out-of-range number, an over-long
 * string, or a value outside `oneOf` is a hard 400 — never a silent
 * coercion.
 */
export function pickFields(body: Record<string, unknown>, spec: FieldSpec): PickResult {
  const value: Record<string, unknown> = {};
  for (const [field, definition] of Object.entries(spec)) {
    const raw = body[field];
    if (raw === undefined || raw === null) {
      if (definition.required) return { ok: false, error: `${field} is required`, status: 400 };
      if (definition.default !== undefined) value[field] = definition.default;
      continue;
    }
    if (definition.kind === "string") {
      if (typeof raw !== "string") return { ok: false, error: `${field} must be a string`, status: 400 };
      const trimmed = raw.trim();
      if (definition.required && trimmed.length === 0) {
        return { ok: false, error: `${field} is required`, status: 400 };
      }
      const maxLength = definition.maxLength ?? WRITE_INPUT_LIMITS.MAX_LONG_TEXT;
      if (trimmed.length > maxLength) {
        return { ok: false, error: `${field} must be at most ${maxLength} characters`, status: 400 };
      }
      if (definition.oneOf && !definition.oneOf.includes(trimmed)) {
        return { ok: false, error: `${field} must be one of: ${definition.oneOf.join(", ")}`, status: 400 };
      }
      if (trimmed.length > 0 || definition.default !== undefined) value[field] = trimmed;
      continue;
    }
    if (definition.kind === "number") {
      if (typeof raw !== "number" || !Number.isFinite(raw)) {
        return { ok: false, error: `${field} must be a finite number`, status: 400 };
      }
      if (definition.min !== undefined && raw < definition.min) {
        return { ok: false, error: `${field} must be >= ${definition.min}`, status: 400 };
      }
      if (definition.max !== undefined && raw > definition.max) {
        return { ok: false, error: `${field} must be <= ${definition.max}`, status: 400 };
      }
      value[field] = raw;
      continue;
    }
    if (definition.kind === "stringArray") {
      if (!Array.isArray(raw)) return { ok: false, error: `${field} must be an array of strings`, status: 400 };
      if (raw.length > WRITE_INPUT_LIMITS.MAX_LIST_ITEMS) {
        return { ok: false, error: `${field} must contain at most ${WRITE_INPUT_LIMITS.MAX_LIST_ITEMS} items`, status: 400 };
      }
      const maxLength = definition.maxLength ?? WRITE_INPUT_LIMITS.MAX_LONG_TEXT;
      const items: string[] = [];
      for (const item of raw) {
        if (typeof item !== "string") return { ok: false, error: `${field} must be an array of strings`, status: 400 };
        if (item.length > maxLength) {
          return { ok: false, error: `${field} items must be at most ${maxLength} characters`, status: 400 };
        }
        items.push(item.trim());
      }
      value[field] = items;
      continue;
    }
    value[field] = raw;
  }
  return { ok: true, value };
}
