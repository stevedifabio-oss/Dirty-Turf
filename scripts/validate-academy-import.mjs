import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: npm run academy:validate -- /absolute/path/to/academy-import.json");
  process.exit(1);
}

const absolutePath = path.resolve(inputPath);
let source;
try {
  source = await readFile(absolutePath, "utf8");
} catch (error) {
  console.error(`Could not read ${absolutePath}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

let manifest;
try {
  manifest = JSON.parse(source);
} catch (error) {
  console.error(`Manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const failures = [];
const warnings = [];
const requireText = (value, label) => {
  if (typeof value !== "string" || !value.trim()) failures.push(`${label} is required`);
};

requireText(manifest.community?.externalId, "community.externalId");
requireText(manifest.community?.name, "community.name");
requireText(manifest.community?.slug, "community.slug");
if (manifest.community?.slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.community.slug)) {
  failures.push("community.slug must use lowercase letters, numbers, and single hyphens");
}

const arrays = ["categories", "members", "courses", "enrollments", "progress", "posts", "comments", "reactions", "events", "rsvps", "assets"];
for (const key of arrays) if (manifest[key] !== undefined && !Array.isArray(manifest[key])) failures.push(`${key} must be an array`);

const duplicateCheck = (items, label) => {
  const seen = new Set();
  for (const item of items ?? []) {
    requireText(item?.externalId, `${label}.externalId`);
    if (!item?.externalId) continue;
    if (seen.has(item.externalId)) failures.push(`Duplicate ${label} externalId: ${item.externalId}`);
    seen.add(item.externalId);
  }
  return seen;
};

const categoryIds = duplicateCheck(manifest.categories, "category");
const memberIds = duplicateCheck(manifest.members, "member");
const courseIds = duplicateCheck(manifest.courses, "course");
const postIds = duplicateCheck(manifest.posts, "post");
const commentIds = duplicateCheck(manifest.comments, "comment");
const eventIds = duplicateCheck(manifest.events, "event");
duplicateCheck(manifest.assets, "asset");
duplicateCheck(manifest.enrollments, "enrollment");
duplicateCheck(manifest.progress, "progress");
duplicateCheck(manifest.reactions, "reaction");
duplicateCheck(manifest.rsvps, "rsvp");

const moduleIds = new Set();
const lessonIds = new Set();
for (const course of manifest.courses ?? []) {
  requireText(course.title, `course ${course.externalId || "<unknown>"}.title`);
  for (const module of course.modules ?? []) {
    requireText(module.externalId, `module in ${course.externalId}.externalId`);
    requireText(module.title, `module ${module.externalId || "<unknown>"}.title`);
    if (module.groupTitle !== undefined && (typeof module.groupTitle !== "string" || !module.groupTitle.trim())) {
      failures.push(`module ${module.externalId || "<unknown>"}.groupTitle must be a non-empty string`);
    }
    if (moduleIds.has(module.externalId)) failures.push(`Duplicate module externalId: ${module.externalId}`);
    moduleIds.add(module.externalId);
    for (const lesson of module.lessons ?? []) {
      requireText(lesson.externalId, `lesson in ${module.externalId}.externalId`);
      requireText(lesson.title, `lesson ${lesson.externalId || "<unknown>"}.title`);
      if (lessonIds.has(lesson.externalId)) failures.push(`Duplicate lesson externalId: ${lesson.externalId}`);
      lessonIds.add(lesson.externalId);
    }
  }
}

for (const member of manifest.members ?? []) {
  requireText(member.displayName, `member ${member.externalId}.displayName`);
  if (member.email && !/^\S+@\S+\.\S+$/.test(member.email)) failures.push(`Invalid member email: ${member.externalId}`);
  if (!member.email) warnings.push(`Member ${member.externalId} has no email and cannot receive an app invite`);
}
for (const enrollment of manifest.enrollments ?? []) {
  if (!memberIds.has(enrollment.memberExternalId)) failures.push(`Enrollment ${enrollment.externalId} references unknown member ${enrollment.memberExternalId}`);
  if (!courseIds.has(enrollment.courseExternalId)) failures.push(`Enrollment ${enrollment.externalId} references unknown course ${enrollment.courseExternalId}`);
  if (enrollment.sourceProgressPercent !== undefined && (!Number.isInteger(enrollment.sourceProgressPercent) || enrollment.sourceProgressPercent < 0 || enrollment.sourceProgressPercent > 100)) {
    failures.push(`Enrollment ${enrollment.externalId} must use an integer sourceProgressPercent from 0 to 100`);
  }
  if (enrollment.sourceLoginCount !== undefined && (!Number.isInteger(enrollment.sourceLoginCount) || enrollment.sourceLoginCount < 0)) {
    failures.push(`Enrollment ${enrollment.externalId} has an invalid sourceLoginCount`);
  }
}
for (const progress of manifest.progress ?? []) {
  if (!memberIds.has(progress.memberExternalId)) failures.push(`Progress ${progress.externalId} references unknown member ${progress.memberExternalId}`);
  if (!lessonIds.has(progress.lessonExternalId)) failures.push(`Progress ${progress.externalId} references unknown lesson ${progress.lessonExternalId}`);
  if (progress.progressPercent !== undefined && (!Number.isInteger(progress.progressPercent) || progress.progressPercent < 0 || progress.progressPercent > 100)) {
    failures.push(`Progress ${progress.externalId} must use an integer progressPercent from 0 to 100`);
  }
  if (progress.positionSeconds !== undefined && (!Number.isInteger(progress.positionSeconds) || progress.positionSeconds < 0)) {
    failures.push(`Progress ${progress.externalId} has an invalid positionSeconds`);
  }
}
for (const post of manifest.posts ?? []) {
  if (!memberIds.has(post.authorExternalId)) failures.push(`Post ${post.externalId} references unknown author ${post.authorExternalId}`);
  if (post.categoryExternalId && !categoryIds.has(post.categoryExternalId)) failures.push(`Post ${post.externalId} references unknown category ${post.categoryExternalId}`);
  requireText(post.title, `post ${post.externalId}.title`);
  requireText(post.body, `post ${post.externalId}.body`);
}
for (const comment of manifest.comments ?? []) {
  if (!postIds.has(comment.postExternalId)) failures.push(`Comment ${comment.externalId} references unknown post ${comment.postExternalId}`);
  if (!memberIds.has(comment.authorExternalId)) failures.push(`Comment ${comment.externalId} references unknown author ${comment.authorExternalId}`);
  if (comment.parentExternalId && !commentIds.has(comment.parentExternalId)) failures.push(`Comment ${comment.externalId} references unknown parent ${comment.parentExternalId}`);
  requireText(comment.body, `comment ${comment.externalId}.body`);
}
for (const reaction of manifest.reactions ?? []) {
  if (!memberIds.has(reaction.memberExternalId)) failures.push(`Reaction ${reaction.externalId} references unknown member ${reaction.memberExternalId}`);
  if (!['post', 'comment'].includes(reaction.targetType)) failures.push(`Reaction ${reaction.externalId} has an invalid targetType`);
  if (reaction.targetType === 'post' && !postIds.has(reaction.targetExternalId)) failures.push(`Reaction ${reaction.externalId} references unknown post ${reaction.targetExternalId}`);
  if (reaction.targetType === 'comment' && !commentIds.has(reaction.targetExternalId)) failures.push(`Reaction ${reaction.externalId} references unknown comment ${reaction.targetExternalId}`);
}
for (const event of manifest.events ?? []) {
  requireText(event.title, `event ${event.externalId}.title`);
  requireText(event.startsAt, `event ${event.externalId}.startsAt`);
  requireText(event.endsAt, `event ${event.externalId}.endsAt`);
}
for (const rsvp of manifest.rsvps ?? []) {
  if (!memberIds.has(rsvp.memberExternalId)) failures.push(`RSVP ${rsvp.externalId} references unknown member ${rsvp.memberExternalId}`);
  if (!eventIds.has(rsvp.eventExternalId)) failures.push(`RSVP ${rsvp.externalId} references unknown event ${rsvp.eventExternalId}`);
}
for (const asset of manifest.assets ?? []) {
  if (asset.courseExternalId && !courseIds.has(asset.courseExternalId)) failures.push(`Asset ${asset.externalId} references unknown course ${asset.courseExternalId}`);
  if (asset.lessonExternalId && !lessonIds.has(asset.lessonExternalId)) failures.push(`Asset ${asset.externalId} references unknown lesson ${asset.lessonExternalId}`);
  if (!asset.storagePath && !asset.originalUrl) failures.push(`Asset ${asset.externalId} needs storagePath or originalUrl`);
  if (asset.contentHash && !/^[a-f0-9]{64}$/i.test(asset.contentHash)) failures.push(`Asset ${asset.externalId} has an invalid SHA-256 hash`);
}

const modules = (manifest.courses ?? []).flatMap((course) => course.modules ?? []);
const counts = {
  categories: manifest.categories?.length ?? 0,
  members: manifest.members?.length ?? 0,
  courses: manifest.courses?.length ?? 0,
  modules: modules.length,
  lessons: modules.flatMap((module) => module.lessons ?? []).length,
  enrollments: manifest.enrollments?.length ?? 0,
  progress: manifest.progress?.length ?? 0,
  posts: manifest.posts?.length ?? 0,
  comments: manifest.comments?.length ?? 0,
  reactions: manifest.reactions?.length ?? 0,
  events: manifest.events?.length ?? 0,
  rsvps: manifest.rsvps?.length ?? 0,
  assets: manifest.assets?.length ?? 0,
};

if (manifest.commit === true) warnings.push("commit is true; the server import will write data after its own dry-run checks");
if (warnings.length) console.warn(warnings.map((warning) => `Warning: ${warning}`).join("\n"));
if (failures.length) {
  console.error(failures.map((failure) => `Error: ${failure}`).join("\n"));
  process.exit(1);
}

console.log(JSON.stringify({
  valid: true,
  file: absolutePath,
  sha256: createHash("sha256").update(source).digest("hex"),
  community: manifest.community.slug,
  counts,
}, null, 2));
