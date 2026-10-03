import { createHash } from "node:crypto";

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const alias = value => typeof value === "string" ? value.trim().replace(/^@/, "").toLowerCase() : "";
// GHL channel slugs contain complete percent escapes, e.g. Chemistry-%26-Cleaners.
// Keep their exact stored identity; never decode or match display names.
const stableId = value => typeof value === "string" && value.length <= 200 && /^[a-zA-Z0-9](?:[a-zA-Z0-9._:-]|%[a-fA-F0-9]{2})*$/.test(value);
const text = (value, max, min = 1) => typeof value === "string" && [...value.trim()].length >= min && [...value].length <= max && !value.includes("\0");
const scopeMatches = (left, right) => left?.locationId === right?.locationId && left?.groupId === right?.groupId;
const snapshotHash = records => hash(records.map(({ entity, externalId, contentHash }) => ({ entity, externalId, contentHash })));
const byIdentity = (a, b) => `${a.entity}:${a.externalId}`.localeCompare(`${b.entity}:${b.externalId}`);
const recordKey = record => `${record.entity}:${record.externalId}`;
const holdReasons = new Set(["unknown_author", "unknown_category", "unobserved_media", "unobserved_category", "unobserved_pin", "unobserved_body", "empty_body", "unsupported_comment_media", "held_post", "held_parent"]);
const optionalFields = new Set(["media", "categoryExternalId", "pinned", "authorExternalId", "body"]);

function timestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 19) === value.slice(0, 19) ? date.toISOString() : null;
}

function publicUrl(value) {
  if (typeof value !== "string" || value.length > 4096 || /[\u0000-\u0020\\]/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && (!url.port || url.port === "443")
      && url.hostname.includes(".") && !/^(?:\d+\.){3}\d+$/.test(url.hostname) && !url.hostname.includes(":")
      && !/(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(url.hostname);
  } catch { return false; }
}

function identityIndex(entries, aliases, errors, kind) {
  const ids = new Set(), lookup = new Map();
  if (!Array.isArray(entries)) { errors.push({ code: `invalid_${kind}_mapping` }); return { ids, lookup }; }
  for (const entry of entries) {
    if (!stableId(entry?.externalId) || ids.has(entry.externalId) || (entry[aliases] !== undefined && !Array.isArray(entry[aliases]))) {
      errors.push({ code: `invalid_${kind}_mapping` }); continue;
    }
    ids.add(entry.externalId);
    for (const value of entry[aliases] ?? []) {
      const key = alias(value);
      if (!key) { errors.push({ code: `invalid_${kind}_alias` }); continue; }
      const matches = lookup.get(key) ?? new Set();
      matches.add(entry.externalId); lookup.set(key, matches);
    }
  }
  return { ids, lookup };
}

function resolveIdentity(input, idKey, aliasKey, index, fail) {
  const direct = input[idKey], label = input[aliasKey];
  if (direct !== undefined) {
    if (!stableId(direct) || !index.ids.has(direct)) { fail(`unknown_${idKey}`); return; }
    // A reconciled source ID wins only if a supplied, mapped alias agrees.
    const matches = index.lookup.get(alias(label));
    if (matches && (matches.size !== 1 || !matches.has(direct))) { fail(`conflicting_${idKey}`); return; }
    return direct;
  }
  const matches = index.lookup.get(alias(label));
  if (!matches || matches.size !== 1) { fail(matches?.size > 1 ? `ambiguous_${idKey}` : `unresolved_${idKey}`); return; }
  return [...matches][0];
}

function normalizeMedia(value, fail) {
  if (!Array.isArray(value) || value.length > 20) { fail("invalid_media"); return; }
  const result = [];
  for (const item of value) {
    if (!item || !publicUrl(item.url) || !["source-asset", "image", "video", "file"].includes(item.type)
        || (item.name !== undefined && !text(item.name, 255))) { fail("invalid_media"); continue; }
    result.push({ url: item.url, type: item.type, ...(item.name === undefined ? {} : { name: item.name }) });
  }
  return result;
}

function previousRecords(previous, scope, errors) {
  const records = new Map();
  if (!previous) return records;
  if (previous.schemaVersion !== 1 || !scopeMatches(previous.scope, scope) || !stableId(previous.captureId)
      || !timestamp(previous.observedStartedAt) || !timestamp(previous.observedCompletedAt)
      || !Array.isArray(previous.records) || !/^[a-f0-9]{64}$/.test(previous.captureHash ?? "")) {
    errors.push({ code: "invalid_previous_state" }); return records;
  }
  for (const record of previous.records) {
    const recordHeld = Array.isArray(previous.held) && previous.held.some(entry =>
      entry?.entity === record?.entity && entry?.externalId === record?.externalId && holdReasons.has(entry?.reason));
    const authorHeld = record?.authorComplete === false && Array.isArray(previous.held) && previous.held.some(entry =>
      entry?.entity === record?.entity && entry?.externalId === record?.externalId && entry?.reason === "unknown_author");
    const bodyHeld = record?.bodyComplete === false && recordHeld && Array.isArray(record?.unobservedFields) && record.unobservedFields.includes("body");
    const required = [...(authorHeld ? [] : ["authorExternalId"]), ...(bodyHeld ? [] : ["body"]), ...(record?.entity === "post" ? ["title"] : ["postExternalId", "parentExternalId"])];
    const allowed = new Set([...required, "authorExternalId", "body", "media", ...(record?.entity === "post" ? ["categoryExternalId", "pinned"] : [])]);
    if (!["post", "comment"].includes(record?.entity) || !stableId(record.externalId) || !record.content || Array.isArray(record.content)
        || !Array.isArray(record.observedFields) || required.some(key => !own(record.content, key))
        || Object.keys(record.content).some(key => !allowed.has(key) || !record.observedFields.includes(key))
        || record.observedFields.some(key => !own(record.content, key)) || record.contentHash !== hash(record.content)
        || (record.authorComplete !== undefined && typeof record.authorComplete !== "boolean")
        || (record.authorComplete === false && !authorHeld)
        || (record.bodyComplete !== undefined && typeof record.bodyComplete !== "boolean")
        || (record.bodyComplete === false && !bodyHeld)
        || (record.unobservedFields !== undefined && (!Array.isArray(record.unobservedFields) || record.unobservedFields.some(field => !optionalFields.has(field) || field === "authorExternalId" && !authorHeld || field === "body" && !bodyHeld)))
        || records.has(recordKey(record))) { errors.push({ code: "invalid_previous_record" }); continue; }
    records.set(recordKey(record), record);
  }
  if (previous.snapshotHash !== snapshotHash([...records.values()].sort(byIdentity))) errors.push({ code: "invalid_previous_hash" });
  if (previous.held !== undefined && (!Array.isArray(previous.held) || previous.held.some(entry =>
      !entry || !records.has(recordKey(entry)) || !holdReasons.has(entry.reason)) || new Set(previous.held.filter(Boolean).map(recordKey)).size !== previous.held.length)) errors.push({ code: "invalid_previous_holds" });
  return records;
}

function onlyEnrichesUnobservedFields(old, record) {
  const allowed = new Set(old.unobservedFields ?? []);
  const changed = [...new Set([...Object.keys(old.content), ...Object.keys(record.content)])]
    .filter(field => hash(old.content[field] ?? null) !== hash(record.content[field] ?? null) || own(old.content, field) !== own(record.content, field));
  return changed.length > 0 && changed.every(field => allowed.has(field));
}

/** Planner only. No database/API writes, scheduler, inferred deletion or source version.
 * Config identity aliases must be independently reconciled to real source IDs.
 * `observed*` belongs to this capture; optional source timestamps remain separate.
 */
export function planCommunitySnapshot(previous, capture, config) {
  const blocked = [], review = [];
  const result = {
    plannerOnly: true, productionWriterAvailable: false, applyReady: false,
    captureAccepted: false, status: "blocked", requiresReview: true, blocked, review,
    counts: { added: 0, updated: 0, unchanged: 0, missing: 0 }, changes: [], missing: [], held: [],
  };
  if (!stableId(config?.scope?.locationId) || !stableId(config?.scope?.groupId)) {
    blocked.push({ code: "invalid_config_scope" }); return result;
  }
  if (!capture || capture.schemaVersion !== 1 || capture.source !== "ghl-community-browser" || !stableId(capture.captureId)) {
    blocked.push({ code: "invalid_capture_envelope" }); return result;
  }
  if (!scopeMatches(capture.scope, config.scope)) blocked.push({ code: "wrong_scope" });
  const startedAt = timestamp(capture.observedStartedAt), completedAt = timestamp(capture.observedCompletedAt);
  if (!startedAt || !completedAt || startedAt > completedAt) blocked.push({ code: "invalid_observation_time" });
  for (const collection of ["posts", "comments"]) {
    if (capture.coverage?.[collection] !== "complete") blocked.push({ code: `incomplete_${collection}_coverage` });
    if (!Array.isArray(capture[collection]) || capture[collection].length > (collection === "posts" ? 10_000 : 50_000)) blocked.push({ code: `invalid_${collection}_collection` });
  }
  const prior = previousRecords(previous, config.scope, blocked);
  const authors = identityIndex(config.identities?.authors, "handles", blocked, "author");
  const categories = identityIndex(config.identities?.categories, "names", blocked, "category");
  if (blocked.length) return result;
  const captureHash = hash(capture);
  if (previous?.captureId === capture.captureId) {
    if (previous.captureHash !== captureHash) blocked.push({ code: "capture_id_reused" });
    else Object.assign(result, { captureAccepted: true, status: "duplicate", nextState: previous });
    return result;
  }
  if (previous && startedAt <= previous.observedCompletedAt) {
    blocked.push({ code: "out_of_order_or_overlapping_capture" }); return result;
  }

  const current = new Map(), held = new Map();
  const hold = (entity, externalId, reason) => {
    const key = `${entity}:${externalId}`;
    if (!held.has(key)) held.set(key, { entity, externalId, reason });
  };
  const partialRecords = config.capabilities?.partialRecords === true;
  const sourceFieldHolds = partialRecords && config.capabilities?.sourceFieldHolds === true;
  for (const [entity, inputs] of [["post", capture.posts], ["comment", capture.comments]]) {
    for (const input of inputs) {
      const externalId = input?.externalId;
      const fail = code => blocked.push({ code, entity, ...(stableId(externalId) ? { externalId } : {}) });
      if (!stableId(externalId)) { fail("missing_stable_source_id"); continue; }
      const key = `${entity}:${externalId}`, old = prior.get(key);
      if (current.has(key)) { fail("duplicate_source_id"); continue; }
      const content = {};
      if (input.authorComplete !== undefined && typeof input.authorComplete !== "boolean") fail("invalid_author_completeness");
      if (input.authorComplete === false && input.authorExternalId !== undefined) fail("contradictory_author_completeness");
      const unresolvedAuthor = sourceFieldHolds && input.authorComplete === false && input.authorExternalId === undefined;
      if (input.authorComplete === false && !sourceFieldHolds) fail("unsupported_source_field_holds");
      const author = unresolvedAuthor ? (hold(entity, externalId, "unknown_author"), undefined)
        : partialRecords && stableId(input.authorExternalId) && !authors.ids.has(input.authorExternalId) && !authors.lookup.has(alias(input.authorHandle))
        ? (hold(entity, externalId, "unknown_author"), input.authorExternalId)
        : resolveIdentity(input, "authorExternalId", "authorHandle", authors, fail);
      if (author) content.authorExternalId = author;
      const unresolvedBody = sourceFieldHolds && input.bodyComplete === false && !own(input, "body");
      const emptyComment = entity === "comment" && input.bodyComplete === true && input.body === "";
      if (input.bodyComplete === false && own(input, "body")) fail("contradictory_body_completeness");
      if (input.bodyComplete === false && !sourceFieldHolds) fail("unsupported_source_field_holds");
      if (unresolvedBody) hold(entity, externalId, "unobserved_body");
      else if (input.bodyComplete !== true || (!emptyComment && !text(input.body, entity === "post" ? 5000 : 3000, entity === "post" ? 2 : 1))) fail("incomplete_or_invalid_body");
      else content.body = input.body;
      if (entity === "post") {
        if (!text(input.title, 120, 2)) fail("invalid_title"); else content.title = input.title;
        if (input.commentsComplete !== true) fail("incomplete_post_comments");
        if (typeof input.categoryComplete !== "boolean" || typeof input.pinnedComplete !== "boolean") fail("missing_field_completeness");
        if (input.categoryComplete === true) {
          if (input.categoryExternalId === null && input.categoryName === undefined) content.categoryExternalId = null;
          else {
            const category = partialRecords && stableId(input.categoryExternalId) && !categories.ids.has(input.categoryExternalId) && !categories.lookup.has(alias(input.categoryName))
              ? (hold(entity, externalId, "unknown_category"), input.categoryExternalId)
              : resolveIdentity(input, "categoryExternalId", "categoryName", categories, fail);
            if (category) content.categoryExternalId = category;
          }
        }
        if (input.pinnedComplete === true) {
          if (typeof input.pinned !== "boolean") fail("invalid_pin_state"); else content.pinned = input.pinned;
        }
      } else {
        if (!stableId(input.postExternalId)) fail("unknown_post_identity"); else content.postExternalId = input.postExternalId;
        if (!own(input, "parentExternalId") || (input.parentExternalId !== null && !stableId(input.parentExternalId))) fail("ambiguous_parent");
        else content.parentExternalId = input.parentExternalId;
      }
      if (typeof input.mediaComplete !== "boolean") fail("missing_media_completeness");
      if (input.mediaComplete === true) {
        const media = normalizeMedia(input.media, fail);
        if (media) content.media = media;
      }
      const unobservedFields = [];
      if (unresolvedAuthor) unobservedFields.push("authorExternalId");
      if (unresolvedBody) unobservedFields.push("body");
      if (input.mediaComplete === false) { unobservedFields.push("media"); hold(entity, externalId, "unobserved_media"); }
      if (emptyComment && !(input.mediaComplete === true && content.media?.length && config.capabilities?.mediaOnlyComments === true)) {
        if (!sourceFieldHolds) fail("incomplete_or_invalid_body");
        else hold(entity, externalId, input.mediaComplete === false ? "unobserved_media" : "empty_body");
      }
      if (entity === "post" && input.categoryComplete === false) { unobservedFields.push("categoryExternalId"); hold(entity, externalId, "unobserved_category"); }
      if (entity === "post" && input.pinnedComplete === false) { unobservedFields.push("pinned"); hold(entity, externalId, "unobserved_pin"); }
      if (!old) {
        for (const field of entity === "post" ? ["media", "category", "pinned"] : ["media"]) {
          if (input[`${field}Complete`] === false) review.push({ code: `new_${entity}_${field}_unobserved`, entity, externalId });
        }
      }
      if (old?.content.authorExternalId !== undefined && !unresolvedAuthor && content.authorExternalId !== old.content.authorExternalId) fail("author_changed");
      if (entity === "comment" && old) {
        if (content.postExternalId !== old.content.postExternalId) fail("comment_post_changed");
        if (content.parentExternalId !== old.content.parentExternalId) fail("comment_parent_changed");
      }
      const source = { ...(old?.source ?? {}) };
      for (const field of ["sourceCreatedAt", "sourceUpdatedAt"]) {
        if (input[field] === undefined) continue;
        const value = timestamp(input[field]);
        if (!value) fail(`invalid_${field}`);
        else if (field === "sourceUpdatedAt" && old?.source?.[field] && value < old.source[field]) fail("source_version_regressed");
        else source[field] = value;
      }
      if (source.sourceCreatedAt && source.sourceUpdatedAt && source.sourceCreatedAt > source.sourceUpdatedAt) fail("invalid_source_timestamp_order");
      if (input.sourceUrl !== undefined) {
        if (!publicUrl(input.sourceUrl)) fail("invalid_source_url"); else source.sourceUrl = input.sourceUrl;
      }
      // Only verified fields from a prior accepted capture may fill unknown fields.
      const merged = { ...(old?.content ?? {}), ...content };
      const record = { entity, externalId, content: merged, observedFields: Object.keys(merged).sort(), authorComplete: !unresolvedAuthor, bodyComplete: !unresolvedBody,
        unobservedFields: unobservedFields.sort(), source, contentHash: hash(merged) };
      if (old && input.sourceUpdatedAt !== undefined && timestamp(input.sourceUpdatedAt) === old.source?.sourceUpdatedAt
          && record.contentHash !== old.contentHash && !onlyEnrichesUnobservedFields(old, record)) fail("same_source_version_changed");
      current.set(key, record);
      if (entity === "comment" && merged.media?.length && config.capabilities?.commentMedia !== true) {
        hold(entity, externalId, "unsupported_comment_media");
        review.push({ code: "comment_media_requires_target_support", entity, externalId });
      }
    }
  }

  for (const record of current.values()) {
    if (record.entity !== "comment") continue;
    const { postExternalId, parentExternalId } = record.content;
    if (!current.has(`post:${postExternalId}`)) blocked.push({ code: "comment_post_not_captured", entity: "comment", externalId: record.externalId });
    if (parentExternalId !== null) {
      const parent = current.get(`comment:${parentExternalId}`);
      if (!parent || parent.content.postExternalId !== postExternalId) blocked.push({ code: "parent_not_captured_in_thread", entity: "comment", externalId: record.externalId });
      const seen = new Set([record.externalId]);
      let ancestor = parent;
      while (ancestor) {
        if (seen.has(ancestor.externalId)) { blocked.push({ code: "parent_cycle", entity: "comment", externalId: record.externalId }); break; }
        seen.add(ancestor.externalId);
        ancestor = current.get(`comment:${ancestor.content.parentExternalId}`);
      }
    }
  }
  if (blocked.length) return result;

  // A missing source identity cannot release a previously unresolved hold.
  for (const entry of previous?.held ?? []) if (!current.has(recordKey(entry))) hold(entry.entity, entry.externalId, entry.reason);
  const allRecords = new Map([...prior, ...current]);
  // Cascade in graph order until every child of a held source row is held too.
  let changed;
  do {
    changed = false;
    for (const record of allRecords.values()) {
      if (record.entity !== "comment" || held.has(recordKey(record))) continue;
      const reason = held.has(`post:${record.content.postExternalId}`) ? "held_post"
        : held.has(`comment:${record.content.parentExternalId}`) ? "held_parent" : null;
      if (reason) { hold(record.entity, record.externalId, reason); changed = true; }
    }
  } while (changed);
  result.held = [...held.values()].sort(byIdentity);

  for (const [key, record] of current) {
    const old = prior.get(key);
    if (!old || old.contentHash !== record.contentHash) {
      const operation = old ? "update" : "add";
      result.counts[old ? "updated" : "added"] += 1;
      result.changes.push({ operation, ...record, expectedPreviousContentHash: old?.contentHash ?? null });
    } else result.counts.unchanged += 1;
  }
  for (const [key, record] of prior) {
    if (current.has(key)) continue;
    result.missing.push({ entity: record.entity, externalId: record.externalId, action: "review_only" });
    result.counts.missing += 1;
    review.push({ code: "missing_is_not_deletion", entity: record.entity, externalId: record.externalId });
  }
  // Retain missing identities in the comparison baseline; they are never deleted.
  const records = [...allRecords.values()].sort(byIdentity);
  result.changes.sort(byIdentity); result.missing.sort(byIdentity);
  Object.assign(result, {
    captureAccepted: true,
    requiresReview: review.length > 0 || result.held.length > 0,
    status: result.changes.length ? "captured" : "unchanged",
    nextState: { schemaVersion: 1, scope: { ...config.scope }, captureId: capture.captureId, captureHash,
      observedStartedAt: startedAt, observedCompletedAt: completedAt, records, held: result.held, snapshotHash: snapshotHash(records) },
  });
  return result;
}
