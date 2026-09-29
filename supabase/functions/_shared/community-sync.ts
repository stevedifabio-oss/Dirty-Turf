/** Explicit app ingestion contract. This is NOT a GoHighLevel webhook adapter. */
export const COMMUNITY_SYNC_MAX_BYTES = 256 * 1024;
export type CommunitySyncMedia = {
  url: string;
  type: "source-asset" | "image" | "video" | "file";
  name?: string;
};
export type CommunitySyncEvent = {
  schemaVersion: 1;
  eventId: string;
  locationId: string;
  groupId: string;
  entity: "post" | "comment";
  operation: "upsert" | "delete";
  externalId: string;
  sourceUpdatedAt: string;
  sourceCreatedAt?: string;
  authorExternalId?: string;
  postExternalId?: string;
  parentExternalId?: string | null;
  title?: string;
  body?: string;
  categoryExternalId?: string | null;
  pinned?: boolean;
  media?: CommunitySyncMedia[];
};

export class CommunitySyncValidationError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "CommunitySyncValidationError";
  }
}
const invalid = (message: string): never => { throw new CommunitySyncValidationError(message); };
const object = (value: unknown, label: string): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return invalid(`${label} must be an object`);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return invalid(`${label} must be a plain object`);
  return value as Record<string, unknown>;
};
function keys(value: Record<string, unknown>, allowed: string[], label: string) {
  if (Object.keys(value).some(key => !allowed.includes(key))) invalid(`${label} has unsupported fields`);
}
function identifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/.test(value)) return invalid(`${label} must be a stable source ID (1-200 characters)`);
  return value;
}
function content(value: unknown, label: string, min: number, max: number): string {
  if (typeof value !== "string" || [...value.trim()].length < min || [...value].length > max || /\u0000/.test(value)) return invalid(`${label} must contain ${min}-${max} characters`);
  return value;
}
function timestamp(value: unknown, label: string): string {
  // UTC timestamps only, with optional milliseconds. Reject impossible dates, not just Date.parse NaN.
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)) return invalid(`${label} must be an ISO UTC timestamp`);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19) !== value.slice(0, 19)) return invalid(`${label} is invalid`);
  return date.toISOString();
}
function mediaItem(value: unknown): CommunitySyncMedia {
  const item = object(value, "media item");
  keys(item, ["url", "type", "name"], "media item");
  if (!["source-asset", "image", "video", "file"].includes(String(item.type))) return invalid("Unsupported media type");
  if (typeof item.url !== "string" || item.url.length > 4096 || /[\u0000-\u0020\\]/.test(item.url)) return invalid("Invalid media URL");
  let url: URL;
  try { url = new URL(item.url); } catch { return invalid("Invalid media URL"); }
  // URLs are rendered, never fetched by this validator. Do not permit credentials or local network destinations.
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") ||
      !url.hostname.includes(".") || /^(?:\d+\.){3}\d+$/.test(url.hostname) || url.hostname.includes(":") ||
      /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(url.hostname)) return invalid("Media URL must use a public HTTPS host");
  return { url: item.url, type: item.type as CommunitySyncMedia["type"], ...(item.name !== undefined ? { name: content(item.name, "media name", 1, 255) } : {}) };
}

export function validateCommunitySyncEvent(value: unknown): CommunitySyncEvent {
  const input = object(value, "event");
  keys(input, ["schemaVersion", "eventId", "locationId", "groupId", "entity", "operation", "externalId", "sourceUpdatedAt", "sourceCreatedAt", "authorExternalId", "postExternalId", "parentExternalId", "title", "body", "categoryExternalId", "pinned", "media"], "event");
  if (input.schemaVersion !== 1) return invalid("schemaVersion must be 1");
  if (input.entity !== "post" && input.entity !== "comment") return invalid("Unsupported entity");
  if (input.operation !== "upsert" && input.operation !== "delete") return invalid("Unsupported operation");
  const event: CommunitySyncEvent = {
    schemaVersion: 1, eventId: identifier(input.eventId, "eventId"),
    locationId: identifier(input.locationId, "locationId"), groupId: identifier(input.groupId, "groupId"),
    entity: input.entity, operation: input.operation, externalId: identifier(input.externalId, "externalId"),
    sourceUpdatedAt: timestamp(input.sourceUpdatedAt, "sourceUpdatedAt"),
  };
  if (input.sourceCreatedAt !== undefined) {
    event.sourceCreatedAt = timestamp(input.sourceCreatedAt, "sourceCreatedAt");
    if (event.sourceCreatedAt > event.sourceUpdatedAt) return invalid("sourceCreatedAt cannot follow sourceUpdatedAt");
  }
  if (input.authorExternalId !== undefined) event.authorExternalId = identifier(input.authorExternalId, "authorExternalId");
  if (event.entity === "comment") {
    event.postExternalId = identifier(input.postExternalId, "postExternalId");
    if (input.parentExternalId !== undefined) event.parentExternalId = input.parentExternalId === null ? null : identifier(input.parentExternalId, "parentExternalId");
    if (event.parentExternalId === event.externalId) return invalid("A comment cannot parent itself");
    if (["title", "categoryExternalId", "pinned", "media"].some(key => input[key] !== undefined)) return invalid("Comment title, category, pin and media fields are unsupported");
  } else {
    if (input.postExternalId !== undefined || input.parentExternalId !== undefined) return invalid("Post events cannot carry comment parent fields");
    if (input.title !== undefined) event.title = content(input.title, "title", 2, 120);
    if (input.categoryExternalId !== undefined) event.categoryExternalId = input.categoryExternalId === null ? null : identifier(input.categoryExternalId, "categoryExternalId");
    if (input.pinned !== undefined) {
      if (typeof input.pinned !== "boolean") return invalid("pinned must be boolean");
      event.pinned = input.pinned;
    }
    if (input.media !== undefined) {
      if (!Array.isArray(input.media) || input.media.length > 20) return invalid("media must be an array of at most 20 assets");
      event.media = input.media.map(mediaItem);
    }
  }
  if (input.body !== undefined) event.body = content(input.body, "body", event.entity === "post" ? 2 : 1, event.entity === "post" ? 5000 : 3000);
  if (event.operation === "upsert") {
    if (!event.authorExternalId || event.body === undefined || (event.entity === "post" && event.title === undefined)) return invalid("Upserts require authorExternalId, body, and a title for posts");
  } else if (["title", "body", "media", "categoryExternalId", "pinned"].some(key => input[key] !== undefined)) {
    return invalid("Delete events must not carry content fields");
  }
  return event;
}

/** A chunked body limit also applies without (or with a dishonest) Content-Length. */
export async function readCommunitySyncJson(request: Request, maxBytes = COMMUNITY_SYNC_MAX_BYTES): Promise<unknown> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > COMMUNITY_SYNC_MAX_BYTES) throw new Error("Invalid body limit");
  if (request.headers.get("content-encoding") && request.headers.get("content-encoding") !== "identity") return invalid("Encoded request bodies are unsupported");
  if (!(request.headers.get("content-type") ?? "").toLowerCase().split(";")[0].trim().match(/^application\/json$/)) return invalid("Content-Type must be application/json");
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) throw new CommunitySyncValidationError("Request body exceeds limit", 413);
  if (!request.body) return invalid("JSON body is required");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { await reader.cancel(); throw new CommunitySyncValidationError("Request body exceeds limit", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { return invalid("Malformed JSON body"); }
}

export function canonicalCommunityJson(value: unknown): string {
  const visit = (item: unknown): unknown => {
    if (item === null || typeof item === "string" || typeof item === "boolean") return item;
    if (typeof item === "number" && Number.isFinite(item)) return item;
    if (Array.isArray(item)) return item.map(visit);
    const record = object(item, "canonical value");
    return Object.fromEntries(Object.keys(record).sort().map(key => [key, visit(record[key])]));
  };
  return JSON.stringify(visit(value));
}
export async function communitySha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(hash, byte => byte.toString(16).padStart(2, "0")).join("");
}
/** Hash both secrets before a fixed-length comparison; never log either value. */
export async function secretMatches(actual: string | null | undefined, expected: string | null | undefined): Promise<boolean> {
  if (!actual || !expected) return false;
  const [a, b] = await Promise.all([communitySha256(actual), communitySha256(expected)]);
  let mismatch = 0;
  for (let i = 0; i < 64; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
