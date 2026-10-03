import { planCommunitySnapshot } from "../_shared/community-snapshot.mjs";
import { CommunitySyncValidationError, canonicalCommunityJson, communitySha256 } from "../_shared/community-sync.ts";
import type { CommunitySyncAdmin } from "./handler.ts";

export const COMMUNITY_SNAPSHOT_MAX_BYTES = 2 * 1024 * 1024;
type ObjectValue = Record<string, unknown>;
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const invalid = (): never => { throw new CommunitySyncValidationError("Invalid snapshot contract", 422); };
const object = (value: unknown): ObjectValue => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return invalid();
  return value as ObjectValue;
};
const keys = (value: ObjectValue, allowed: string[]) => {
  if (Object.keys(value).some(key => !allowed.includes(key))) invalid();
};
const identifier = (value: unknown): string => {
  if (typeof value !== "string" || value.length > 200 || !/^[A-Za-z0-9](?:[A-Za-z0-9._:-]|%[a-fA-F0-9]{2})*$/.test(value)) return invalid();
  return value;
};
const leaseToken = (value: unknown): string => {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return invalid();
  return value;
};
const leaseSeconds = (value: unknown): number => {
  if (value === undefined) return 1800;
  if (!Number.isSafeInteger(value) || Number(value) < 60 || Number(value) > 3600) return invalid();
  return Number(value);
};

/** Authenticate before calling this reader. Enforce the limit on actual streamed bytes. */
export async function readCommunitySnapshotJson(request: Request): Promise<unknown> {
  if ((request.headers.get("content-type") ?? "").toLowerCase().split(";")[0].trim() !== "application/json" ||
      (request.headers.has("content-encoding") && request.headers.get("content-encoding") !== "identity")) {
    throw new CommunitySyncValidationError("Unsupported JSON body");
  }
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > COMMUNITY_SNAPSHOT_MAX_BYTES)) {
    throw new CommunitySyncValidationError("Request body exceeds limit", 413);
  }
  if (!request.body) throw new CommunitySyncValidationError("JSON body required");
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > COMMUNITY_SNAPSHOT_MAX_BYTES) {
        await reader.cancel();
        throw new CommunitySyncValidationError("Request body exceeds limit", 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new CommunitySyncValidationError("Malformed JSON body"); }
}

/** Capture metadata is kept outside the apply contract, never trusted as identity evidence. */
export function validateSnapshotCaptureShape(value: unknown): ObjectValue {
  const capture = object(value);
  keys(capture, ["schemaVersion", "source", "captureId", "scope", "observedStartedAt", "observedCompletedAt", "coverage", "posts", "comments"]);
  if (capture.schemaVersion !== 1 || capture.source !== "ghl-community-browser") invalid();
  identifier(capture.captureId);
  const scope = object(capture.scope); keys(scope, ["locationId", "groupId"]);
  identifier(scope.locationId); identifier(scope.groupId);
  const coverage = object(capture.coverage); keys(coverage, ["posts", "comments"]);
  for (const collection of ["posts", "comments"] as const) {
    if (!["partial", "complete"].includes(String(coverage[collection])) || !Array.isArray(capture[collection]) ||
        (capture[collection] as unknown[]).length > (collection === "posts" ? 10_000 : 50_000)) invalid();
    for (const item of capture[collection] as unknown[]) {
      const record = object(item);
      keys(record, ["externalId", "authorExternalId", "authorComplete", "body", "bodyComplete", "media", "mediaComplete", "sourceUrl", "sourceCreatedAt", "sourceUpdatedAt",
        ...(collection === "posts" ? ["title", "commentsComplete", "categoryExternalId", "categoryComplete", "pinned", "pinnedComplete"] : ["postExternalId", "parentExternalId"])]);
      if (record.media !== undefined) {
        if (!Array.isArray(record.media) || record.media.length > 20) invalid();
        for (const asset of record.media as unknown[]) keys(object(asset), ["url", "type", "name"]);
      }
    }
  }
  return capture;
}

function validatedContext(value: unknown, scope: { location_id: string; group_id: string }) {
  const context = object(value), contextScope = object(context.scope), identities = object(context.identities);
  if (context.enabled !== true || contextScope.locationId !== scope.location_id || contextScope.groupId !== scope.group_id) invalid();
  const clean: { authors: ObjectValue[]; categories: ObjectValue[] } = { authors: [], categories: [] };
  for (const kind of ["authors", "categories"] as const) {
    if (!Array.isArray(identities[kind])) invalid();
    clean[kind] = (identities[kind] as unknown[]).map(entry => {
      const item = object(entry);
      // Only direct source IDs currently come from the independently reconciled DB.
      // Never accept caller-provided handles or display-name matching.
      keys(item, ["externalId"]);
      return { externalId: identifier(item.externalId) };
    });
  }
  return {
    previousState: context.previousState ?? null,
    config: { scope: { locationId: scope.location_id, groupId: scope.group_id }, identities: clean,
      capabilities: { commentMedia: object(context.capabilities).commentMedia === true,
        partialRecords: object(context.capabilities).partialRecords === true,
        sourceFieldHolds: object(context.capabilities).sourceFieldHolds === true,
        mediaOnlyComments: object(context.capabilities).mediaOnlyComments === true } },
    run: context.run,
  };
}

function applyReceipt(value: unknown): ObjectValue {
  const result = object(value);
  if (result.status === "duplicate") return { status: "duplicate", result: applyReceipt(result.result) };
  if (!["applied", "partial"].includes(String(result.status)) || !Number.isSafeInteger(result.observationSequence) || Number(result.observationSequence) < 1 ||
      ["added", "updated", "unchanged"].some(key => !Number.isSafeInteger(result[key]) || Number(result[key]) < 0) ||
      !Array.isArray(result.conflicts) || !Array.isArray(result.missingReviewOnly)) invalid();
  const conflicts = (result.conflicts as unknown[]).map(entry => {
    const item = object(entry);
    if (!["post", "comment"].includes(String(item.entity)) || typeof item.reason !== "string" || !/^[a-z0-9_]{1,120}$/.test(item.reason)) invalid();
    return { entity: item.entity, externalId: identifier(item.externalId), reason: item.reason };
  });
  const missing = (result.missingReviewOnly as unknown[]).map(entry => {
    const item = object(entry);
    if (!["post", "comment"].includes(String(item.entity)) || item.action !== "review_only") invalid();
    return { entity: item.entity, externalId: identifier(item.externalId), action: "review_only" };
  });
  if (result.held !== undefined && !Array.isArray(result.held)) invalid();
  const held = ((result.held ?? []) as unknown[]).map(entry => {
    const item = object(entry);
    if (!["post", "comment"].includes(String(item.entity)) || !["unknown_author", "unknown_category", "unobserved_media", "unobserved_category", "unobserved_pin", "unobserved_body", "empty_body", "unsupported_comment_media", "held_post", "held_parent"].includes(String(item.reason))) invalid();
    return { entity: item.entity, externalId: identifier(item.externalId), reason: item.reason };
  });
  const fullSync = result.status !== "partial" && !held.length && !conflicts.length && !missing.length;
  return { status: fullSync ? "applied" : "partial", fullSync, observationSequence: result.observationSequence, added: result.added, updated: result.updated, unchanged: result.unchanged, held, conflicts, missingReviewOnly: missing };
}

/** Called only after shared secret and the configured source have been checked. */
export async function handleCommunitySnapshotRequest(
  request: Request, admin: CommunitySyncAdmin, configId: string,
  scope: { location_id: string; group_id: string }, action: string,
): Promise<Response> {
  if (!["begin", "renew", "fail", "apply", "status"].includes(action)) return reply({ error: "Unknown snapshot route" }, 404);
  let input: ObjectValue;
  try { input = object(await readCommunitySnapshotJson(request)); }
  catch (error) {
    return reply({ error: "Invalid or oversized snapshot JSON" }, (error as { status?: number }).status ?? 400);
  }
  try {
    keys(input, action === "begin" ? ["captureId", "leaseSeconds"] : action === "renew" ? ["captureId", "leaseToken", "leaseSeconds"] :
      action === "fail" ? ["captureId", "leaseToken", "errorCode"] : action === "apply" ? ["capture", "leaseToken"] : ["captureId"]);
    const capture = action === "apply" ? validateSnapshotCaptureShape(input.capture) : null;
    const captureId = capture ? identifier(capture.captureId) : input.captureId === undefined && action === "status" ? null : identifier(input.captureId);
    const token = ["renew", "fail", "apply"].includes(action) ? leaseToken(input.leaseToken) : null;
    if (capture && (object(capture.scope).locationId !== scope.location_id || object(capture.scope).groupId !== scope.group_id)) return reply({ error: "Source not allowed" }, 403);
    if (action === "begin" || action === "renew") {
      const seconds = leaseSeconds(input.leaseSeconds);
      const { data, error } = await admin.rpc(`${action}_academy_community_snapshot`, {
        p_config_id: configId, p_capture_id: captureId, ...(action === "renew" ? { p_lease_token: token } : {}), p_lease_seconds: seconds,
      });
      if (error) return reply({ error: "Snapshot lease temporarily unavailable" }, 503);
      if (action === "renew") return typeof data === "boolean" ? reply({ renewed: data }, data ? 200 : 409) : reply({ error: "Invalid snapshot lease result" }, 503);
      const result = object(data);
      if (!["capturing", "duplicate", "busy", "disabled"].includes(String(result.status))) return reply({ error: "Invalid snapshot lease result" }, 503);
      if (result.status === "capturing") {
        leaseToken(result.leaseToken);
        if (!Number.isSafeInteger(result.observationSequence) || Number(result.observationSequence) < 1 ||
            object(result.scope).locationId !== scope.location_id || object(result.scope).groupId !== scope.group_id) invalid();
      }
      const body = result.status === "capturing" ? { status: result.status, observationSequence: result.observationSequence, leaseToken: result.leaseToken, previousState: result.previousState ?? null, scope: result.scope } :
        result.status === "duplicate" ? { status: "duplicate", result: applyReceipt(result.result) } :
        result.status === "busy" ? { status: "busy", retryAt: result.retryAt } : { status: "disabled" };
      return reply(body, result.status === "busy" ? 409 : result.status === "disabled" ? 503 : 200);
    }
    if (action === "fail") {
      if (typeof input.errorCode !== "string" || !/^[a-z0-9_]{1,120}$/.test(input.errorCode)) invalid();
      const { data, error } = await admin.rpc("fail_academy_community_snapshot", { p_config_id: configId, p_capture_id: captureId, p_lease_token: token, p_error_code: input.errorCode });
      return !error && typeof data === "boolean" ? reply({ failed: data }, data ? 200 : 409) : reply({ error: "Snapshot status temporarily unavailable" }, 503);
    }
    const { data: contextData, error: contextError } = await admin.rpc("get_academy_community_snapshot_context", {
      p_config_id: configId, p_capture_id: captureId, p_lease_token: action === "apply" ? token : null,
    });
    if (contextError) return reply({ error: "Snapshot context or lease unavailable" }, 409);
    let context;
    try { context = validatedContext(contextData, scope); }
    catch { return reply({ error: "Invalid snapshot context" }, 503); }
    if (action === "status") return reply({ scope: context.config.scope, run: context.run ?? null, previousState: context.previousState });
    if (context.run && object(context.run).status === "applied") {
      if (object(context.run).captureHash !== await communitySha256(canonicalCommunityJson(capture))) return reply({ error: "Capture identity reused" }, 422);
      return reply({ status: "duplicate", result: applyReceipt(object(context.run).result) });
    }
    // Do not trust a locally generated plan, mapping, source version, or baseline.
    const plan = planCommunitySnapshot(context.previousState, capture, context.config);
    const heldIds = new Set(plan.held.map((entry: { entity: string; externalId: string }) => `${entry.entity}:${entry.externalId}`));
    const holdableReview = new Set(["new_post_media_unobserved", "new_post_category_unobserved", "new_post_pinned_unobserved", "new_comment_media_unobserved", "comment_media_requires_target_support"]);
    const unsafeReview = plan.review.filter((entry: { code: string; entity?: string; externalId?: string }) => entry.code !== "missing_is_not_deletion" &&
      !(context.config.capabilities.partialRecords && holdableReview.has(entry.code) && heldIds.has(`${entry.entity}:${entry.externalId}`)));
    if (!plan.captureAccepted || unsafeReview.length || (plan.held.length && !context.config.capabilities.partialRecords)) {
      return reply({ status: "blocked", fullSync: false, captureAccepted: plan.captureAccepted, counts: plan.counts, held: plan.held, blocked: plan.blocked, review: plan.review }, 422);
    }
    const { data, error } = await admin.rpc("apply_academy_community_snapshot", { p_config_id: configId, p_capture_id: captureId, p_lease_token: token, p_plan: plan });
    if (error) return reply({ error: "Unable to apply community snapshot" }, 503);
    let result;
    try { result = applyReceipt(data); }
    catch { return reply({ error: "Invalid snapshot apply result" }, 503); }
    const applied = result.status === "duplicate" ? object(result.result) : result;
    const heldKey = (entry: ObjectValue) => `${entry.entity}:${entry.externalId}`;
    const confirmedHolds = [...applied.held as ObjectValue[]].sort((a, b) => heldKey(a).localeCompare(heldKey(b)));
    if (canonicalCommunityJson(confirmedHolds) !== canonicalCommunityJson(plan.held)) return reply({ error: "Snapshot writer did not confirm record holds" }, 503);
    // Completeness derives from the verified capture and confirmed write receipt.
    // A writer receipt cannot erase the source records missing from this capture.
    applied.missingReviewOnly = plan.missing;
    if (plan.missing.length || plan.held.length) { applied.fullSync = false; applied.status = "partial"; }
    // Receipt contains counts/conflict identities only; never return source bodies or diagnostics.
    return reply(result);
  } catch (error) {
    return reply({ error: "Invalid snapshot contract" }, error instanceof CommunitySyncValidationError ? 422 : 503);
  }
}
