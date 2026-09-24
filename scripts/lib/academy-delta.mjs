import { createHash } from "node:crypto";

const COLLECTIONS = [
  ["category", "categories"],
  ["member", "members"],
  ["enrollment", "enrollments"],
  ["progress", "progress"],
  ["post", "posts"],
  ["comment", "comments"],
  ["reaction", "reactions"],
  ["event", "events"],
  ["rsvp", "rsvps"],
  ["asset", "assets"],
];

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function fingerprint(value) {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function sourceTimestamp(manifest) {
  const value = manifest?.sourceExportedAt;
  const timestamp = Date.parse(value);
  if (typeof value !== "string" || !Number.isFinite(timestamp)) {
    throw new Error("Both manifests require a valid sourceExportedAt timestamp");
  }
  return timestamp;
}

function collect(manifest) {
  const rows = new Map();
  const add = (type, record, context = {}) => {
    const id = record?.externalId;
    if (typeof id !== "string" || !id.trim()) throw new Error(`${type} is missing externalId`);
    const key = `${type}:${id}`;
    if (rows.has(key)) throw new Error(`Duplicate ${type} externalId in capture`);
    rows.set(key, { type, externalId: id, hash: fingerprint({ ...record, ...context }) });
  };

  add("community", manifest.community);
  for (const [type, property] of COLLECTIONS) {
    for (const record of manifest[property] ?? []) add(type, record);
  }
  for (const [courseOrder, course] of (manifest.courses ?? []).entries()) {
    const { modules = [], ...courseFields } = course;
    add("course", courseFields, { courseOrder });
    for (const [moduleOrder, module] of modules.entries()) {
      const { lessons = [], ...moduleFields } = module;
      add("module", moduleFields, { courseExternalId: course.externalId, moduleOrder });
      for (const [lessonOrder, lesson] of lessons.entries()) {
        add("lesson", lesson, { moduleExternalId: module.externalId, lessonOrder });
      }
    }
  }
  return rows;
}

export function planAcademyDelta(previous, current) {
  if (!previous?.community?.externalId || !current?.community?.externalId) {
    throw new Error("Both manifests require a community externalId");
  }
  if (previous.community.externalId !== current.community.externalId) {
    throw new Error("Captures belong to different HighLevel communities");
  }
  if (sourceTimestamp(current) <= sourceTimestamp(previous)) {
    throw new Error("The new capture must be newer than the previous capture");
  }

  const oldRows = collect(previous);
  const newRows = collect(current);
  const changes = { added: [], updated: [], missing: [] };
  for (const [key, row] of newRows) {
    const old = oldRows.get(key);
    if (!old) changes.added.push({ type: row.type, externalId: row.externalId });
    else if (old.hash !== row.hash) changes.updated.push({ type: row.type, externalId: row.externalId });
  }
  for (const [key, row] of oldRows) {
    if (!newRows.has(key)) changes.missing.push({ type: row.type, externalId: row.externalId });
  }
  for (const rows of Object.values(changes)) {
    rows.sort((left, right) => left.type.localeCompare(right.type) || left.externalId.localeCompare(right.externalId));
  }
  return {
    previousExportedAt: previous.sourceExportedAt,
    currentExportedAt: current.sourceExportedAt,
    previousCount: oldRows.size,
    currentCount: newRows.size,
    counts: Object.fromEntries(Object.entries(changes).map(([kind, rows]) => [kind, rows.length])),
    changes,
  };
}
