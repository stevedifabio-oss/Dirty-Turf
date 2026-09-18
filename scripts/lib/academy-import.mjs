import { createHash } from "node:crypto";

const MONTHS = new Map([
  ["jan", 0], ["feb", 1], ["mar", 2], ["apr", 3], ["may", 4], ["jun", 5],
  ["jul", 6], ["aug", 7], ["sep", 8], ["oct", 9], ["nov", 10], ["dec", 11],
]);

export function normalizeIdentity(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function isCommunityPostMediaUrl(value) {
  try {
    const url = new URL(String(value ?? "").trim());
    if (!new Set(["http:", "https:"]).has(url.protocol)) return false;
    if (url.hostname === "assetsdrm.clientclub.net" && (
      (url.pathname.includes("/images/client-portal/") && url.pathname.includes("/users/"))
      || url.pathname.includes("/profile-avatars/")
    )) return false;
    if (url.hostname === "academy.dirtyturf.com" && url.pathname.startsWith("/communities/users/")) return false;
    return true;
  } catch {
    return false;
  }
}

export function parseSourceDateTime(value, offsetMinutes = -300) {
  const match = String(value ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})\s+(AM|PM)$/i);
  if (!match) return undefined;
  const [, year, month, day, rawHour, minute, meridiem] = match;
  let hour = Number(rawHour) % 12;
  if (meridiem.toUpperCase() === "PM") hour += 12;
  const timestamp = Date.UTC(Number(year), Number(month) - 1, Number(day), hour, Number(minute)) - offsetMinutes * 60_000;
  return new Date(timestamp).toISOString();
}

export function parseJoinedDate(value) {
  const match = String(value ?? "").trim().match(/^Joined\s+(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/i);
  if (!match) return undefined;
  const month = MONTHS.get(match[2].toLowerCase());
  if (month === undefined) return undefined;
  return new Date(Date.UTC(Number(match[3]), month, Number(match[1]), 12)).toISOString();
}

export function parseRelativeTimestamp(value, capturedAt) {
  const source = String(value ?? "").trim().toLowerCase();
  if (!source) return undefined;
  const compact = source.match(/^(\d+)\s*(mo|[smhdw])$/);
  const verbose = source.match(/^(?:active\s+)?(\d+)\s+(seconds?|minutes?|hours?|days?|weeks?|months?)\s+ago$/);
  if (!compact && !verbose) return undefined;

  const amount = Number((compact ?? verbose)[1]);
  const unit = compact?.[2] ?? verbose?.[2].replace(/s$/, "");
  const date = new Date(capturedAt);
  if (Number.isNaN(date.getTime())) return undefined;
  if (unit === "mo" || unit === "month") date.setUTCMonth(date.getUTCMonth() - amount);
  else {
    const factor = unit === "s" || unit === "second" ? 1_000
      : unit === "m" || unit === "minute" ? 60_000
      : unit === "h" || unit === "hour" ? 3_600_000
      : unit === "d" || unit === "day" ? 86_400_000
      : unit === "w" || unit === "week" ? 604_800_000
      : 0;
    if (!factor) return undefined;
    date.setTime(date.getTime() - amount * factor);
  }
  return date.toISOString();
}

function parseClock(hour, minute, meridiem) {
  let value = Number(hour) % 12;
  if (String(meridiem).toUpperCase() === "PM") value += 12;
  return { hour: value, minute: Number(minute) };
}

function zonedIso(year, month, day, clock, offsetMinutes) {
  return new Date(Date.UTC(year, month, day, clock.hour, clock.minute) - offsetMinutes * 60_000).toISOString();
}

export function parseCommunityEvent(event) {
  const rawText = String(event?.rawText ?? "").trim();
  const lines = rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const dateMatch = rawText.match(/\b(\d{1,2})(?:st|nd|rd|th)\s+([A-Za-z]{3})\s+(\d{4})\b/i);
  const timeMatch = rawText.match(/\b(\d{1,2}):(\d{2})\s+(AM|PM)\s+-\s+(\d{1,2}):(\d{2})\s+(AM|PM)\s+GMT([+-]\d{1,2})(?::(\d{2}))?\b/i);
  if (!dateMatch || !timeMatch) return undefined;
  const month = MONTHS.get(dateMatch[2].toLowerCase());
  if (month === undefined) return undefined;

  const offsetSign = timeMatch[7].startsWith("-") ? -1 : 1;
  const offsetMinutes = offsetSign * (Math.abs(Number(timeMatch[7])) * 60 + Number(timeMatch[8] ?? 0));
  const startClock = parseClock(timeMatch[1], timeMatch[2], timeMatch[3]);
  const endClock = parseClock(timeMatch[4], timeMatch[5], timeMatch[6]);
  const year = Number(dateMatch[3]);
  const day = Number(dateMatch[1]);
  const startsAt = zonedIso(year, month, day, startClock, offsetMinutes);
  let endsAt = zonedIso(year, month, day, endClock, offsetMinutes);
  if (new Date(endsAt) <= new Date(startsAt)) {
    endsAt = new Date(new Date(endsAt).getTime() + 86_400_000).toISOString();
  }

  const descriptionIndex = lines.findIndex((line) => line.toLowerCase() === "description");
  const descriptionEnd = lines.findIndex((line, index) => index > descriptionIndex && line.toLowerCase() === "entry fee");
  const description = descriptionIndex >= 0
    ? lines.slice(descriptionIndex + 1, descriptionEnd > descriptionIndex ? descriptionEnd : undefined).filter((line) => line.toLowerCase() !== "more").join("\n")
    : "";
  const title = String(event?.title ?? lines[0] ?? "Academy event").trim();
  const lowerTitle = title.toLowerCase();
  const kind = /q\s*&\s*a|question/.test(lowerTitle) ? "office_hours"
    : /marketing|sales|equipment|chemistry/.test(lowerTitle) ? "workshop"
    : "live";

  return {
    externalId: String(event.sourceId),
    title,
    description,
    kind,
    hostName: "Dirty Turf Academy",
    startsAt,
    endsAt,
    meetingUrl: event.links?.find((link) => /^https:\/\//i.test(link)),
    status: "published",
    sourceUrl: event.links?.find((link) => /^https:\/\//i.test(link)),
  };
}

function stableExternalId(prefix, ...values) {
  const digest = createHash("sha256").update(values.map((value) => String(value ?? "")).join("\u0000")).digest("hex").slice(0, 24);
  return `${prefix}:${digest}`;
}

function addAlias(index, value, externalId) {
  const key = normalizeIdentity(value);
  if (!key) return;
  const ids = index.get(key) ?? new Set();
  ids.add(externalId);
  index.set(key, ids);
}

function resolveAlias(index, ...values) {
  const ids = new Set();
  for (const value of values) {
    const key = normalizeIdentity(value);
    for (const id of index.get(key) ?? []) ids.add(id);
  }
  return ids.size === 1 ? [...ids][0] : undefined;
}

function resolvePreferredAlias(index, primary, secondary) {
  return resolveAlias(index, primary) ?? resolveAlias(index, secondary);
}

function normalizeChannelName(value) {
  return normalizeIdentity(String(value ?? "").replace(/^posted\s+in\s*/i, ""));
}

function cleanText(value) {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function contactName(contact, fallback) {
  const name = [contact?.firstName, contact?.lastName].map(cleanText).filter(Boolean).join(" ");
  return name || cleanText(contact?.name) || cleanText(fallback) || "Academy Member";
}

function contactLocation(contact) {
  const place = [contact?.city, contact?.state].map(cleanText).filter(Boolean).join(", ");
  return place || cleanText(contact?.country);
}

function leaderboardPoints(leaderboard, name) {
  const key = normalizeIdentity(name);
  const matches = (leaderboard ?? []).filter((item) => normalizeIdentity(item.name) === key);
  if (matches.length !== 1) return 0;
  const points = Number(matches[0].points);
  return Number.isFinite(points) && points >= 0 ? Math.round(points) : 0;
}

function uniqueEmailIndex(contacts, errors) {
  const byEmail = new Map();
  for (const contact of contacts) {
    const email = normalizeEmail(contact.email);
    if (!email) continue;
    const existing = byEmail.get(email);
    if (existing && existing.sourceId !== contact.sourceId) {
      errors.push(`Duplicate reconciled email for contacts ${existing.sourceId} and ${contact.sourceId}`);
      continue;
    }
    byEmail.set(email, contact);
  }
  return byEmail;
}

export function composeAcademyImport({ courseArchive, communityArchive, contactReconciliation, sourceOffsetMinutes = -300 }) {
  const errors = [];
  const warnings = [];
  const capturedAt = communityArchive?.capturedAt ?? courseArchive?.sourceExportedAt;
  const rawMembers = communityArchive?.members ?? [];
  const contacts = contactReconciliation?.contacts ?? [];
  const contactsById = new Map(contacts.map((contact) => [String(contact.sourceId), contact]));
  const contactsByEmail = uniqueEmailIndex(contacts, errors);
  const expectedLocationId = communityArchive?.source?.locationId;
  if (contactReconciliation?.locationId && expectedLocationId && contactReconciliation.locationId !== expectedLocationId) {
    errors.push("Contact reconciliation belongs to a different HighLevel location");
  }

  const categoryByName = new Map();
  const categories = [];
  let mergedCategoryCount = 0;
  for (const channel of communityArchive?.channels ?? []) {
    const name = cleanText(channel.name);
    if (!name) continue;
    const key = normalizeIdentity(name);
    if (categoryByName.has(key)) {
      mergedCategoryCount += 1;
      continue;
    }
    const category = {
      externalId: cleanText(channel.slug) || stableExternalId("channel", name),
      name,
      color: "#047631",
      memberCanPost: key !== "announcements",
    };
    categoryByName.set(key, category.externalId);
    categories.push(category);
  }
  if (mergedCategoryCount) warnings.push(`${mergedCategoryCount} duplicate channel name was merged`);

  const allTimeLeaderboard = communityArchive?.leaderboards?.allTime ?? [];
  const members = [];
  const membersById = new Map();
  const memberAliases = new Map();
  const missingCurrentContactIds = [];
  const currentMembersWithoutEmail = [];
  for (const rawMember of rawMembers) {
    const externalId = String(rawMember.sourceId ?? "").trim();
    if (!externalId) {
      errors.push("A community member is missing its source ID");
      continue;
    }
    if (membersById.has(externalId)) {
      errors.push(`Duplicate community member source ID ${externalId}`);
      continue;
    }
    const contact = contactsById.get(externalId);
    if (!contact) missingCurrentContactIds.push(externalId);
    const email = normalizeEmail(contact?.email) || undefined;
    if (!email) currentMembersWithoutEmail.push(externalId);
    const displayName = contactName(contact, rawMember.name);
    const member = {
      externalId,
      contactId: externalId,
      ...(email ? { email } : {}),
      displayName,
      ...(cleanText(rawMember.avatarUrl) ? { avatarUrl: cleanText(rawMember.avatarUrl) } : {}),
      ...(cleanText(contact?.companyName) ? { companyName: cleanText(contact.companyName) } : {}),
      ...(contactLocation(contact) ? { location: contactLocation(contact) } : {}),
      role: rawMember.role === "admin" ? "admin" : "member",
      status: "active",
      points: leaderboardPoints(allTimeLeaderboard, rawMember.name),
      level: 1,
      ...(parseJoinedDate(rawMember.joined) ? { joinedAt: parseJoinedDate(rawMember.joined) } : {}),
      ...(parseRelativeTimestamp(rawMember.active, capturedAt) ? { lastSeenAt: parseRelativeTimestamp(rawMember.active, capturedAt) } : {}),
    };
    members.push(member);
    membersById.set(externalId, member);
    addAlias(memberAliases, rawMember.name, externalId);
    addAlias(memberAliases, rawMember.handle, externalId);
    addAlias(memberAliases, displayName, externalId);
  }
  if (missingCurrentContactIds.length) warnings.push(`${missingCurrentContactIds.length} current member contact was not returned by HighLevel`);
  if (currentMembersWithoutEmail.length) warnings.push(`${currentMembersWithoutEmail.length} current member cannot receive an invite because no email was resolved`);

  const posts = [];
  const comments = [];
  const rawPosts = communityArchive?.posts ?? [];
  for (const rawPost of rawPosts) {
    const externalId = String(rawPost.sourceId ?? "").trim();
    const authorExternalId = String(rawPost.authorSourceId ?? "").trim();
    if (!externalId) {
      errors.push("A community post is missing its source ID");
      continue;
    }
    if (!membersById.has(authorExternalId)) errors.push(`Post ${externalId} references unknown member ${authorExternalId || "<missing>"}`);
    const categoryExternalId = categoryByName.get(normalizeChannelName(rawPost.channel));
    if (!categoryExternalId) errors.push(`Post ${externalId} references an unknown channel`);
    const media = (rawPost.assets ?? []).filter(isCommunityPostMediaUrl).map((url) => ({ type: "source-asset", url }));
    posts.push({
      externalId,
      authorExternalId,
      ...(categoryExternalId ? { categoryExternalId } : {}),
      title: cleanText(rawPost.title) ?? "Community post",
      body: cleanText(rawPost.body) ?? cleanText(rawPost.title) ?? "Imported community post",
      pinned: normalizeChannelName(rawPost.channel) === "announcements",
      ...(media.length ? { media } : {}),
      ...(cleanText(rawPost.sourceUrl) ? { sourceUrl: cleanText(rawPost.sourceUrl) } : {}),
      ...(parseRelativeTimestamp(rawPost.timestamp, capturedAt) ? { createdAt: parseRelativeTimestamp(rawPost.timestamp, capturedAt) } : {}),
      sourceReactionText: cleanText(rawPost.reactionText),
      sourceCommentCountText: cleanText(rawPost.commentCountText),
    });

    for (const rawComment of rawPost.comments ?? []) {
      const commentExternalId = String(rawComment.sourceId ?? "").trim();
      if (!commentExternalId) {
        errors.push(`A comment on post ${externalId} is missing its source ID`);
        continue;
      }
      let commentAuthorId = resolvePreferredAlias(memberAliases, rawComment.handle, rawComment.author);
      if (!commentAuthorId) {
        commentAuthorId = stableExternalId("historical-member", rawComment.handle, rawComment.author);
        if (!membersById.has(commentAuthorId)) {
          const historical = {
            externalId: commentAuthorId,
            displayName: cleanText(rawComment.author) ?? cleanText(rawComment.handle) ?? "Former Academy Member",
            role: "member",
            status: "cancelled",
            points: 0,
            level: 1,
          };
          members.push(historical);
          membersById.set(commentAuthorId, historical);
          addAlias(memberAliases, rawComment.author, commentAuthorId);
          addAlias(memberAliases, rawComment.handle, commentAuthorId);
        }
      }
      comments.push({
        externalId: commentExternalId,
        postExternalId: externalId,
        ...(cleanText(rawComment.parentSourceId) ? { parentExternalId: cleanText(rawComment.parentSourceId) } : {}),
        authorExternalId: commentAuthorId,
        body: cleanText(rawComment.body) ?? cleanText(rawComment.rawText) ?? "Imported comment",
        ...(cleanText(rawPost.sourceUrl) ? { sourceUrl: cleanText(rawPost.sourceUrl) } : {}),
        ...(parseRelativeTimestamp(rawComment.timestamp, capturedAt) ? { createdAt: parseRelativeTimestamp(rawComment.timestamp, capturedAt) } : {}),
        sourceReactionText: cleanText(rawComment.reactionText),
      });
    }
  }

  const commentIds = new Set(comments.map((comment) => comment.externalId));
  for (const comment of comments) {
    if (comment.parentExternalId && !commentIds.has(comment.parentExternalId)) {
      errors.push(`Comment ${comment.externalId} references missing parent ${comment.parentExternalId}`);
    }
  }

  const courses = structuredClone(courseArchive?.courses ?? []);
  const courseExternalId = communityArchive?.source?.courseProductId ?? courses[0]?.externalId;
  if (!courses.some((course) => course.externalId === courseExternalId)) errors.push("The community course roster references an unknown course product");
  const enrollments = [];
  const enrollmentEmails = new Map();
  let courseOnlyMemberCount = 0;
  for (const rawEnrollment of communityArchive?.courseEnrollments ?? []) {
    const externalId = String(rawEnrollment.sourceId ?? "").trim();
    const email = normalizeEmail(rawEnrollment.email);
    if (!externalId || !email) {
      errors.push(`Course enrollment ${externalId || "<missing>"} is missing its source ID or email`);
      continue;
    }
    if (enrollmentEmails.has(email)) {
      errors.push(`Duplicate course roster email on enrollments ${enrollmentEmails.get(email)} and ${externalId}`);
      continue;
    }
    enrollmentEmails.set(email, externalId);
    const contact = contactsByEmail.get(email);
    let memberExternalId = contact?.sourceId;
    if (!memberExternalId || !membersById.has(memberExternalId)) {
      memberExternalId = `course-member:${externalId}`;
      const member = {
        externalId: memberExternalId,
        email,
        displayName: "Academy Member",
        role: "member",
        status: "active",
        points: 0,
        level: 1,
      };
      members.push(member);
      membersById.set(memberExternalId, member);
      courseOnlyMemberCount += 1;
    }
    const sourceProgressPercent = Number(rawEnrollment.progress);
    const sourceLoginCount = Number(rawEnrollment.logins);
    const enrolledAt = parseSourceDateTime(rawEnrollment.startDate, sourceOffsetMinutes);
    const sourceLastLoginAt = parseSourceDateTime(rawEnrollment.lastLogin, sourceOffsetMinutes);
    enrollments.push({
      externalId,
      memberExternalId,
      courseExternalId,
      status: sourceProgressPercent >= 100 ? "completed" : "active",
      ...(enrolledAt ? { enrolledAt } : {}),
      ...(sourceProgressPercent >= 100 && sourceLastLoginAt ? { completedAt: sourceLastLoginAt } : {}),
      sourceProgressPercent: Number.isFinite(sourceProgressPercent) ? Math.min(100, Math.max(0, Math.round(sourceProgressPercent))) : 0,
      sourceLoginCount: Number.isFinite(sourceLoginCount) ? Math.max(0, Math.round(sourceLoginCount)) : 0,
      ...(sourceLastLoginAt ? { sourceLastLoginAt } : {}),
      sourceStartDate: cleanText(rawEnrollment.startDate),
      sourceLastLogin: cleanText(rawEnrollment.lastLogin),
    });
  }

  const events = [];
  for (const rawEvent of communityArchive?.events ?? []) {
    const event = parseCommunityEvent(rawEvent);
    if (!event) errors.push(`Event ${rawEvent.sourceId ?? "<missing>"} has an unparseable date or time`);
    else events.push(event);
  }

  const currentMemberCount = rawMembers.length;
  const historicalMemberCount = members.filter((member) => member.status === "cancelled").length;
  const manifest = {
    commit: false,
    ...(courseArchive?.ownerOrganizationId ? { ownerOrganizationId: courseArchive.ownerOrganizationId } : {}),
    sourceExportedAt: capturedAt,
    archivePath: courseArchive?.archivePath ?? "client-local://dirty-turf/highlevel-export",
    community: {
      ...(courseArchive?.community ?? {}),
      externalId: courseArchive?.community?.externalId ?? communityArchive?.source?.communitySlug,
      name: courseArchive?.community?.name ?? communityArchive?.summary?.title,
      slug: courseArchive?.community?.slug ?? communityArchive?.source?.communitySlug,
      portalUrl: courseArchive?.community?.portalUrl ?? communityArchive?.summary?.sourceUrl,
      metadata: {
        ...(courseArchive?.community?.metadata ?? {}),
        source: "highlevel",
        locationId: expectedLocationId,
        capturedMemberCount: currentMemberCount,
        capturedPostCount: rawPosts.length,
        captureSchema: communityArchive?.schemaVersion,
      },
    },
    categories,
    members,
    courses,
    enrollments,
    progress: structuredClone(courseArchive?.progress ?? []),
    posts,
    comments,
    reactions: [],
    events,
    rsvps: [],
    assets: structuredClone(courseArchive?.assets ?? []),
  };

  const report = {
    readyForDryRun: errors.length === 0,
    ownerOrganizationIdPresent: Boolean(manifest.ownerOrganizationId),
    errors,
    warnings,
    assumptions: [
      "Relative community timestamps are anchored to the capturedAt timestamp.",
      `Course analytics timestamps are interpreted with a UTC${sourceOffsetMinutes <= 0 ? "-" : "+"}${String(Math.abs(sourceOffsetMinutes / 60)).padStart(2, "0")}:00 offset.`,
      "Course-level progress is preserved on enrollments; no lesson completions are fabricated.",
      "Aggregate reaction and RSVP counts are retained in source records; no member identities are fabricated.",
    ],
    reconciliation: {
      currentMemberCount,
      contactCount: contacts.length,
      missingCurrentContactCount: missingCurrentContactIds.length,
      currentMembersWithoutEmailCount: currentMembersWithoutEmail.length,
      historicalContentAuthorCount: historicalMemberCount,
      courseOnlyMemberCount,
      mergedCategoryCount,
    },
    counts: {
      categories: categories.length,
      members: members.length,
      courses: courses.length,
      modules: courses.flatMap((course) => course.modules ?? []).length,
      lessons: courses.flatMap((course) => course.modules ?? []).flatMap((module) => module.lessons ?? []).length,
      enrollments: enrollments.length,
      progress: manifest.progress.length,
      posts: posts.length,
      comments: comments.length,
      reactions: 0,
      events: events.length,
      rsvps: 0,
      assets: manifest.assets.length,
    },
  };
  return { manifest, report };
}
