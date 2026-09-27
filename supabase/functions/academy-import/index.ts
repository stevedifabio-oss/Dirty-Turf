import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { handlePreflight, jsonResponse } from "../_shared/http.ts";
import { academyImportGrantWindow } from "../_shared/import-access.ts";
import { importSortOrder, validImportSortOrder } from "../_shared/import-order.ts";

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

type MemberInput = {
  externalId: string;
  contactId?: string;
  email?: string;
  displayName: string;
  avatarUrl?: string;
  companyName?: string;
  location?: string;
  role?: "owner" | "admin" | "moderator" | "member";
  status?: "pending" | "active" | "suspended" | "cancelled";
  points?: number;
  level?: number;
  joinedAt?: string;
  lastSeenAt?: string;
};

type LessonInput = {
  externalId: string;
  sortOrder?: number;
  title: string;
  type?: "video" | "guide" | "quiz";
  body?: Json;
  videoUrl?: string;
  transcript?: string;
  resources?: Json[];
  durationSeconds?: number;
  status?: "draft" | "published" | "archived";
  sourceUrl?: string;
  updatedAt?: string;
};

type ModuleInput = {
  externalId: string;
  sortOrder?: number;
  title: string;
  groupTitle?: string;
  dripAfterDays?: number;
  updatedAt?: string;
  lessons?: LessonInput[];
};

type CourseInput = {
  externalId: string;
  sortOrder?: number;
  title: string;
  description?: string;
  category?: string;
  instructorName?: string;
  coverUrl?: string;
  status?: "draft" | "published" | "archived";
  accessType?: "open" | "level" | "purchase";
  requiredLevel?: number;
  priceCents?: number;
  sourceUrl?: string;
  updatedAt?: string;
  modules?: ModuleInput[];
};

type ImportManifest = {
  commit?: boolean;
  ownerOrganizationId?: string;
  sourceExportedAt?: string;
  archivePath?: string;
  community: {
    id?: string;
    externalId: string;
    name: string;
    slug: string;
    portalUrl?: string;
    metadata?: Record<string, Json>;
  };
  categories?: Array<{ externalId: string; name: string; color?: string; memberCanPost?: boolean }>;
  members?: MemberInput[];
  courses?: CourseInput[];
  enrollments?: Array<{
    externalId: string;
    memberExternalId: string;
    courseExternalId: string;
    status?: "pending" | "active" | "completed" | "cancelled" | "expired";
    enrolledAt?: string;
    completedAt?: string;
    accessExpiresAt?: string;
    updatedAt?: string;
    sourceProgressPercent?: number;
    sourceLoginCount?: number;
    sourceLastLoginAt?: string;
  }>;
  progress?: Array<{
    externalId: string;
    memberExternalId: string;
    lessonExternalId: string;
    progressPercent?: number;
    positionSeconds?: number;
    completedAt?: string;
    updatedAt?: string;
  }>;
  posts?: Array<{
    externalId: string;
    authorExternalId: string;
    categoryExternalId?: string;
    title: string;
    body: string;
    pinned?: boolean;
    media?: Json[];
    sourceUrl?: string;
    createdAt?: string;
    updatedAt?: string;
  }>;
  comments?: Array<{
    externalId: string;
    postExternalId: string;
    parentExternalId?: string;
    authorExternalId: string;
    body: string;
    isAnswer?: boolean;
    sourceUrl?: string;
    createdAt?: string;
    updatedAt?: string;
  }>;
  reactions?: Array<{
    externalId: string;
    memberExternalId: string;
    targetType: "post" | "comment";
    targetExternalId: string;
    reaction?: "like";
    createdAt?: string;
  }>;
  events?: Array<{
    externalId: string;
    title: string;
    description?: string;
    kind?: "live" | "workshop" | "office_hours";
    hostName?: string;
    startsAt: string;
    endsAt: string;
    meetingUrl?: string;
    recurrenceRule?: string;
    requiredLevel?: number;
    status?: "draft" | "published" | "archived";
    sourceUrl?: string;
    updatedAt?: string;
  }>;
  rsvps?: Array<{
    externalId: string;
    memberExternalId: string;
    eventExternalId: string;
    status?: "going" | "interested";
    createdAt?: string;
    updatedAt?: string;
  }>;
  assets?: Array<{
    externalId: string;
    courseExternalId?: string;
    lessonExternalId?: string;
    title: string;
    type: "video" | "audio" | "image" | "pdf" | "document" | "archive" | "link" | "other";
    storagePath?: string;
    originalUrl?: string;
    mimeType?: string;
    byteSize?: number;
    contentHash?: string;
    metadata?: Record<string, Json>;
  }>;
};

Deno.serve(async (request) => {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  if (request.method !== "POST") return jsonResponse(request, { error: "Method not allowed" }, { status: 405 });
  const environment = getEnvironment();
  if (!environment) return jsonResponse(request, { error: "Server is not configured" }, { status: 503 });

  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return jsonResponse(request, { error: "Authentication required" }, { status: 401 });
  const token = authorization.slice(7);
  const admin = createClient(environment.url, environment.serviceRoleKey, { auth: { persistSession: false } });
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return jsonResponse(request, { error: "Invalid session" }, { status: 401 });

  let manifest: ImportManifest;
  try {
    manifest = await request.json();
  } catch {
    return jsonResponse(request, { error: "Invalid JSON body" }, { status: 400 });
  }
  const validationError = validateManifest(manifest);
  if (validationError) return jsonResponse(request, { error: validationError }, { status: 422 });

  const existingCommunity = await resolveCommunity(admin, manifest.community);
  const ownerOrganizationId = existingCommunity?.owner_organization_id ?? manifest.ownerOrganizationId;
  if (!ownerOrganizationId) return jsonResponse(request, { error: "ownerOrganizationId is required for the first import" }, { status: 422 });
  if (!(await canManageImport(admin, userData.user.id, existingCommunity?.id, ownerOrganizationId))) {
    return jsonResponse(request, { error: "Academy owner access required" }, { status: 403 });
  }

  const counts = manifestCounts(manifest);
  if (!manifest.commit) {
    return jsonResponse(request, { valid: true, dryRun: true, counts, community: manifest.community.slug });
  }

  let batchId: string | undefined;
  try {
    const community = await upsertCommunity(admin, manifest, ownerOrganizationId, existingCommunity?.id);
    const batch = await requiredInsert(admin, "source_import_batches", {
      academy_community_id: community.id,
      provider: "highlevel",
      status: "capturing",
      archive_path: manifest.archivePath ?? null,
      manifest: { version: 1, community: manifest.community.slug },
      record_counts: counts,
      requested_by: userData.user.id,
      source_exported_at: manifest.sourceExportedAt ?? null,
    });
    batchId = batch.id;

    const maps = await importContent(admin, manifest, community.id, ownerOrganizationId, batch.id);
    await checked(admin.from("source_import_batches").update({
      status: "imported",
      validated_at: new Date().toISOString(),
      imported_at: new Date().toISOString(),
      record_counts: counts,
    }).eq("id", batch.id));

    return jsonResponse(request, {
      imported: true,
      batchId: batch.id,
      communityId: community.id,
      counts,
      mapped: Object.fromEntries(Object.entries(maps).map(([key, value]) => [key, value.size])),
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Import failed";
    if (batchId) {
      await admin.from("source_import_batches").update({ status: "failed", error_message: message }).eq("id", batchId);
    }
    console.error("Academy import failed", error);
    return jsonResponse(request, { error: message, batchId }, { status: 500 });
  }
});

async function importContent(admin: SupabaseClient, manifest: ImportManifest, communityId: string, organizationId: string, batchId: string) {
  const members = new Map<string, string>();
  const categories = new Map<string, string>();
  const courses = new Map<string, string>();
  const lessons = new Map<string, string>();
  const posts = new Map<string, string>();
  const comments = new Map<string, string>();
  const events = new Map<string, string>();

  await recordSource(admin, batchId, communityId, "community", manifest.community.externalId, manifest.community);

  for (const [index, item] of (manifest.categories ?? []).entries()) {
    let row = await maybeSingle(admin.from("community_categories").select("id")
      .eq("academy_community_id", communityId).eq("external_id", item.externalId));
    const values = {
      organization_id: organizationId,
      academy_community_id: communityId,
      external_id: item.externalId,
      source_import_batch_id: batchId,
      name: item.name,
      color: item.color ?? "#047631",
      sort_order: index,
      member_can_post: item.memberCanPost ?? true,
    };
    row = row ? await requiredUpdate(admin, "community_categories", row.id, values) : await requiredInsert(admin, "community_categories", values);
    if (!row) throw new Error(`Could not import category ${item.externalId}`);
    categories.set(item.externalId, row.id);
    await recordSource(admin, batchId, communityId, "channel", item.externalId, item, undefined, undefined, row.id, "community_categories");
  }

  for (const item of manifest.members ?? []) {
    const linkQuery = admin.from("academy_member_links").select("academy_member_id")
      .eq("academy_community_id", communityId).eq("external_provider", "highlevel");
    const existingLink = item.contactId
      ? await maybeSingle(linkQuery.eq("external_contact_id", item.contactId))
      : await maybeSingle(linkQuery.eq("external_member_id", item.externalId));
    const memberValues = {
      academy_community_id: communityId,
      role: item.role ?? "member",
      status: item.status ?? "active",
      display_name: item.displayName,
      avatar_url: item.avatarUrl ?? null,
      company_name: item.companyName ?? "",
      location: item.location ?? "",
      points: Math.max(0, item.points ?? 0),
      level: Math.max(1, item.level ?? 1),
      joined_at: item.joinedAt ?? null,
      last_seen_at: item.lastSeenAt ?? null,
    };
    const member = existingLink
      ? await requiredUpdate(admin, "academy_members", existingLink.academy_member_id, memberValues)
      : await requiredInsert(admin, "academy_members", memberValues);
    members.set(item.externalId, member.id);
    await checked(admin.from("academy_member_links").upsert({
      academy_community_id: communityId,
      academy_member_id: member.id,
      external_provider: "highlevel",
      external_contact_id: item.contactId ?? null,
      external_member_id: item.externalId,
      imported_at: new Date().toISOString(),
    }, { onConflict: "academy_member_id" }));
    if (item.email) {
      const normalizedEmail = item.email.trim().toLowerCase();
      const existingInvite = await maybeSingle(admin.from("academy_member_invites")
        .select("status,email,invited_user_id")
        .eq("academy_member_id", member.id));
      const emailChanged = Boolean(existingInvite && existingInvite.email.trim().toLowerCase() !== normalizedEmail);
      if (emailChanged && existingInvite?.invited_user_id) {
        throw new Error(`Member ${item.externalId} changed email after auth provisioning and requires manual review`);
      }
      const memberIsActive = (item.status ?? "active") === "active";
      const inviteStatus = memberIsActive
        ? emailChanged || existingInvite?.status === "cancelled" ? "pending" : existingInvite?.status ?? "pending"
        : "cancelled";
      await checked(admin.from("academy_member_invites").upsert({
        academy_community_id: communityId,
        academy_member_id: member.id,
        email: normalizedEmail,
        status: inviteStatus,
        source_provider: "highlevel",
        external_contact_id: item.contactId ?? null,
        ...(emailChanged ? {
          invited_user_id: null,
          provisioned_at: null,
          invite_sent_at: null,
          accepted_at: null,
          error_message: null,
        } : {}),
      }, { onConflict: "academy_member_id" }));
    }
    const memberGrant = academyImportGrantWindow(
      item.status ?? "active",
      item.joinedAt,
    );
    await syncImportAccessGrant(admin, {
      memberId: member.id,
      courseId: null,
      sourceKey: `member:${member.id}`,
      status: memberGrant.status,
      startsAt: memberGrant.startsAt,
      endsAt: memberGrant.endsAt,
      metadata: {
        sourceProvider: "highlevel",
        externalId: item.externalId,
        sourceStatus: item.status ?? "active",
      },
    });
    await recordSource(admin, batchId, communityId, "member", item.externalId, item, undefined, item.joinedAt, member.id, "academy_members");
  }

  for (const [courseIndex, item] of (manifest.courses ?? []).entries()) {
    let course = await maybeSingle(admin.from("courses").select("id,sort_order")
      .eq("academy_community_id", communityId).eq("external_id", item.externalId));
    const courseValues = {
      organization_id: organizationId,
      academy_community_id: communityId,
      external_id: item.externalId,
      source_provider: "highlevel",
      source_url: item.sourceUrl ?? null,
      source_updated_at: item.updatedAt ?? null,
      source_import_batch_id: batchId,
      title: item.title,
      description: item.description ?? "",
      category: item.category ?? "Core",
      instructor_name: item.instructorName ?? "Dirty Turf Academy",
      cover_url: item.coverUrl ?? null,
      status: item.status ?? "published",
      access_type: item.accessType ?? "open",
      required_level: item.requiredLevel ?? null,
      price_cents: item.priceCents ?? null,
      sort_order: importSortOrder(item.sortOrder, course?.sort_order, courseIndex),
      published_at: (item.status ?? "published") === "published" ? new Date().toISOString() : null,
    };
    course = course ? await requiredUpdate(admin, "courses", course.id, courseValues) : await requiredInsert(admin, "courses", courseValues);
    if (!course) throw new Error(`Could not import course ${item.externalId}`);
    courses.set(item.externalId, course.id);
    await recordSource(admin, batchId, communityId, "course", item.externalId, item, undefined, undefined, course.id, "courses", item.sourceUrl, item.updatedAt);

    for (const [moduleIndex, moduleInput] of (item.modules ?? []).entries()) {
      let moduleRow = await maybeSingle(admin.from("course_modules").select("id,sort_order")
        .eq("course_id", course.id).eq("external_id", moduleInput.externalId));
      const moduleValues = {
        course_id: course.id,
        external_id: moduleInput.externalId,
        title: moduleInput.title,
        group_title: moduleInput.groupTitle ?? null,
        sort_order: importSortOrder(moduleInput.sortOrder, moduleRow?.sort_order, moduleIndex),
        drip_after_days: moduleInput.dripAfterDays ?? null,
        source_updated_at: moduleInput.updatedAt ?? null,
        source_import_batch_id: batchId,
      };
      moduleRow = moduleRow ? await requiredUpdate(admin, "course_modules", moduleRow.id, moduleValues) : await requiredInsert(admin, "course_modules", moduleValues);
      if (!moduleRow) throw new Error(`Could not import module ${moduleInput.externalId}`);
      await recordSource(admin, batchId, communityId, "module", moduleInput.externalId, moduleInput, item.externalId, undefined, moduleRow.id, "course_modules", undefined, moduleInput.updatedAt);

      for (const [lessonIndex, lessonInput] of (moduleInput.lessons ?? []).entries()) {
        let lesson = await maybeSingle(admin.from("course_lessons").select("id,sort_order")
          .eq("module_id", moduleRow.id).eq("external_id", lessonInput.externalId));
        const lessonValues = {
          module_id: moduleRow.id,
          external_id: lessonInput.externalId,
          title: lessonInput.title,
          lesson_type: lessonInput.type ?? "video",
          body: lessonInput.body ?? {},
          video_url: lessonInput.videoUrl ?? null,
          transcript: lessonInput.transcript ?? null,
          resources: lessonInput.resources ?? [],
          duration_seconds: Math.max(0, lessonInput.durationSeconds ?? 0),
          sort_order: importSortOrder(lessonInput.sortOrder, lesson?.sort_order, lessonIndex),
          status: lessonInput.status ?? "published",
          source_url: lessonInput.sourceUrl ?? null,
          source_updated_at: lessonInput.updatedAt ?? null,
          source_import_batch_id: batchId,
        };
        lesson = lesson ? await requiredUpdate(admin, "course_lessons", lesson.id, lessonValues) : await requiredInsert(admin, "course_lessons", lessonValues);
        if (!lesson) throw new Error(`Could not import lesson ${lessonInput.externalId}`);
        lessons.set(lessonInput.externalId, lesson.id);
        await recordSource(admin, batchId, communityId, "lesson", lessonInput.externalId, lessonInput, moduleInput.externalId, undefined, lesson.id, "course_lessons", lessonInput.sourceUrl, lessonInput.updatedAt);
      }
    }
  }

  for (const item of manifest.enrollments ?? []) {
    const memberId = members.get(item.memberExternalId);
    const courseId = courses.get(item.courseExternalId);
    if (!memberId || !courseId) throw new Error(`Enrollment ${item.externalId} references an unknown member or course`);
    const { data, error } = await admin.from("course_enrollments").upsert({
      academy_community_id: communityId,
      academy_member_id: memberId,
      course_id: courseId,
      status: item.status ?? "active",
      source_provider: "highlevel",
      external_id: item.externalId,
      enrolled_at: item.enrolledAt ?? null,
      completed_at: item.completedAt ?? null,
      access_expires_at: item.accessExpiresAt ?? null,
      source_progress_percent: item.sourceProgressPercent ?? null,
      source_login_count: item.sourceLoginCount ?? null,
      source_last_login_at: item.sourceLastLoginAt ?? null,
      source_updated_at: item.updatedAt ?? null,
      source_import_batch_id: batchId,
    }, { onConflict: "academy_member_id,course_id" }).select("id").single();
    if (error) throw error;
    const enrollmentGrant = academyImportGrantWindow(
      item.status ?? "active",
      item.enrolledAt,
      item.accessExpiresAt,
    );
    await syncImportAccessGrant(admin, {
      memberId,
      courseId,
      sourceKey: `enrollment:${data.id}`,
      status: enrollmentGrant.status,
      startsAt: enrollmentGrant.startsAt,
      endsAt: enrollmentGrant.endsAt,
      metadata: {
        sourceProvider: "highlevel",
        externalId: item.externalId,
        sourceStatus: item.status ?? "active",
      },
    });
    await recordSource(admin, batchId, communityId, "enrollment", item.externalId, item, item.memberExternalId, item.enrolledAt, data.id, "course_enrollments", undefined, item.updatedAt);
  }

  for (const item of manifest.progress ?? []) {
    const memberId = members.get(item.memberExternalId);
    const lessonId = lessons.get(item.lessonExternalId);
    if (!memberId || !lessonId) throw new Error(`Progress ${item.externalId} references an unknown member or lesson`);
    const progressPercent = Math.min(100, Math.max(0, item.progressPercent ?? (item.completedAt ? 100 : 0)));
    await checked(admin.from("academy_member_lesson_progress").upsert({
      academy_member_id: memberId,
      lesson_id: lessonId,
      progress_percent: progressPercent,
      position_seconds: Math.max(0, item.positionSeconds ?? 0),
      completed_at: item.completedAt ?? (progressPercent === 100 ? item.updatedAt ?? new Date().toISOString() : null),
      source_updated_at: item.updatedAt ?? null,
    }, { onConflict: "academy_member_id,lesson_id" }));
    await recordSource(admin, batchId, communityId, "progress", item.externalId, item, item.lessonExternalId, item.updatedAt, undefined, "academy_member_lesson_progress", undefined, item.updatedAt);
  }

  for (const item of manifest.posts ?? []) {
    const authorId = members.get(item.authorExternalId);
    if (!authorId) throw new Error(`Post ${item.externalId} references unknown author ${item.authorExternalId}`);
    let post = await maybeSingle(admin.from("community_posts").select("id,media")
      .eq("academy_community_id", communityId).eq("source_provider", "highlevel").eq("external_id", item.externalId));
    const postValues = {
      organization_id: organizationId,
      author_id: null,
      academy_community_id: communityId,
      academy_author_id: authorId,
      category_id: item.categoryExternalId ? categories.get(item.categoryExternalId) ?? null : null,
      title: item.title,
      body: item.body,
      is_pinned: item.pinned ?? false,
      media: preserveImportedPostMedia(item.media ?? [], post?.media),
      status: "published",
      external_id: item.externalId,
      source_provider: "highlevel",
      source_url: item.sourceUrl ?? null,
      source_created_at: item.createdAt ?? null,
      source_updated_at: item.updatedAt ?? null,
      source_import_batch_id: batchId,
    };
    post = post ? await requiredUpdate(admin, "community_posts", post.id, postValues) : await requiredInsert(admin, "community_posts", postValues);
    if (!post) throw new Error(`Could not import post ${item.externalId}`);
    posts.set(item.externalId, post.id);
    await recordSource(admin, batchId, communityId, "post", item.externalId, item, item.categoryExternalId, item.createdAt, post.id, "community_posts", item.sourceUrl, item.updatedAt);
  }

  for (const item of manifest.comments ?? []) {
    const postId = posts.get(item.postExternalId);
    const authorId = members.get(item.authorExternalId);
    if (!postId || !authorId) throw new Error(`Comment ${item.externalId} references an unknown post or author`);
    let comment = await maybeSingle(admin.from("community_comments").select("id")
      .eq("academy_community_id", communityId).eq("source_provider", "highlevel").eq("external_id", item.externalId));
    const commentValues = {
      organization_id: organizationId,
      post_id: postId,
      parent_id: null,
      author_id: null,
      academy_community_id: communityId,
      academy_author_id: authorId,
      body: item.body,
      is_answer: item.isAnswer ?? false,
      external_id: item.externalId,
      source_provider: "highlevel",
      source_url: item.sourceUrl ?? null,
      source_created_at: item.createdAt ?? null,
      source_updated_at: item.updatedAt ?? null,
      source_import_batch_id: batchId,
    };
    comment = comment ? await requiredUpdate(admin, "community_comments", comment.id, commentValues) : await requiredInsert(admin, "community_comments", commentValues);
    if (!comment) throw new Error(`Could not import comment ${item.externalId}`);
    comments.set(item.externalId, comment.id);
    await recordSource(admin, batchId, communityId, "comment", item.externalId, item, item.postExternalId, item.createdAt, comment.id, "community_comments", item.sourceUrl, item.updatedAt);
  }

  for (const item of manifest.comments ?? []) {
    if (!item.parentExternalId) continue;
    const commentId = comments.get(item.externalId);
    const parentId = comments.get(item.parentExternalId);
    if (!commentId || !parentId) throw new Error(`Comment ${item.externalId} references unknown parent ${item.parentExternalId}`);
    await checked(admin.from("community_comments").update({ parent_id: parentId }).eq("id", commentId));
  }

  for (const item of manifest.reactions ?? []) {
    const memberId = members.get(item.memberExternalId);
    const targetId = item.targetType === "post"
      ? posts.get(item.targetExternalId)
      : comments.get(item.targetExternalId);
    if (!memberId || !targetId) throw new Error(`Reaction ${item.externalId} references an unknown member or target`);
    const table = item.targetType === "post" ? "academy_post_reactions" : "academy_comment_reactions";
    const targetColumn = item.targetType === "post" ? "post_id" : "comment_id";
    await checked(admin.from(table).upsert({
      [targetColumn]: targetId,
      academy_member_id: memberId,
      reaction: item.reaction ?? "like",
      source_provider: "highlevel",
      external_id: item.externalId,
      created_at: item.createdAt ?? new Date().toISOString(),
    }, { onConflict: `${targetColumn},academy_member_id,reaction` }));
    await recordSource(admin, batchId, communityId, "reaction", item.externalId, item, item.targetExternalId, item.createdAt, undefined, table);
  }

  for (const item of manifest.events ?? []) {
    let event = await maybeSingle(admin.from("academy_events").select("id")
      .eq("academy_community_id", communityId).eq("external_id", item.externalId));
    const eventValues = {
      organization_id: organizationId,
      academy_community_id: communityId,
      external_id: item.externalId,
      source_provider: "highlevel",
      source_url: item.sourceUrl ?? null,
      source_updated_at: item.updatedAt ?? null,
      source_import_batch_id: batchId,
      title: item.title,
      description: item.description ?? "",
      kind: item.kind ?? "live",
      host_name: item.hostName ?? "Dirty Turf Academy",
      starts_at: item.startsAt,
      ends_at: item.endsAt,
      meeting_url: item.meetingUrl ?? null,
      recurrence_rule: item.recurrenceRule ?? null,
      required_level: item.requiredLevel ?? null,
      status: item.status ?? "published",
    };
    event = event ? await requiredUpdate(admin, "academy_events", event.id, eventValues) : await requiredInsert(admin, "academy_events", eventValues);
    if (!event) throw new Error(`Could not import event ${item.externalId}`);
    events.set(item.externalId, event.id);
    await recordSource(admin, batchId, communityId, "event", item.externalId, item, undefined, item.startsAt, event.id, "academy_events", item.sourceUrl, item.updatedAt);
  }

  for (const item of manifest.rsvps ?? []) {
    const memberId = members.get(item.memberExternalId);
    const eventId = events.get(item.eventExternalId);
    if (!memberId || !eventId) throw new Error(`RSVP ${item.externalId} references an unknown member or event`);
    await checked(admin.from("academy_member_event_rsvps").upsert({
      event_id: eventId,
      academy_member_id: memberId,
      status: item.status ?? "going",
      source_updated_at: item.updatedAt ?? null,
      created_at: item.createdAt ?? new Date().toISOString(),
    }, { onConflict: "event_id,academy_member_id" }));
    await recordSource(admin, batchId, communityId, "rsvp", item.externalId, item, item.eventExternalId, item.createdAt, undefined, "academy_member_event_rsvps", undefined, item.updatedAt);
  }

  for (const item of manifest.assets ?? []) {
    const courseId = item.courseExternalId ? courses.get(item.courseExternalId) : undefined;
    const lessonId = item.lessonExternalId ? lessons.get(item.lessonExternalId) : undefined;
    const existingAsset = await maybeSingle(admin.from("academy_assets").select("id,storage_bucket,storage_path,mime_type,byte_size,content_hash")
      .eq("academy_community_id", communityId).eq("source_provider", "highlevel").eq("external_id", item.externalId));
    const values = {
      academy_community_id: communityId,
      course_id: courseId ?? null,
      lesson_id: lessonId ?? null,
      title: item.title,
      asset_type: item.type,
      storage_bucket: item.storagePath ? "academy-assets" : existingAsset?.storage_bucket ?? null,
      storage_path: item.storagePath ?? existingAsset?.storage_path ?? null,
      original_url: item.originalUrl ?? null,
      mime_type: item.mimeType ?? existingAsset?.mime_type ?? null,
      byte_size: item.byteSize ?? existingAsset?.byte_size ?? null,
      content_hash: item.contentHash ?? existingAsset?.content_hash ?? null,
      source_provider: "highlevel",
      external_id: item.externalId,
      metadata: item.metadata ?? {},
      source_import_batch_id: batchId,
    };
    const asset = existingAsset
      ? await requiredUpdate(admin, "academy_assets", existingAsset.id, values)
      : await requiredInsert(admin, "academy_assets", values);
    await recordSource(admin, batchId, communityId, "asset", item.externalId, item, item.lessonExternalId ?? item.courseExternalId, undefined, asset.id, "academy_assets", item.originalUrl);
  }

  return { members, categories, courses, lessons, posts, comments, events };
}

function preserveImportedPostMedia(sourceMedia: Json[], existingMedia: unknown): Json[] {
  if (!Array.isArray(existingMedia)) return sourceMedia;
  const existingByUrl = new Map<string, Record<string, Json>>();
  for (const item of existingMedia) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, Json>;
    if (typeof record.url === "string") existingByUrl.set(record.url, record);
  }

  return sourceMedia.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    const next = { ...(item as Record<string, Json>) };
    const existing = typeof next.url === "string" ? existingByUrl.get(next.url) : undefined;
    if (!existing) return next;
    for (const key of ["storage_bucket", "storage_path", "mime_type", "byte_size", "content_hash"] as const) {
      if (existing[key] !== undefined) next[key] = existing[key];
    }
    return next;
  });
}

async function resolveCommunity(admin: SupabaseClient, community: ImportManifest["community"]) {
  if (community.id) return await maybeSingle(admin.from("academy_communities").select("id,owner_organization_id").eq("id", community.id));
  return await maybeSingle(admin.from("academy_communities").select("id,owner_organization_id").eq("slug", community.slug));
}

async function upsertCommunity(admin: SupabaseClient, manifest: ImportManifest, ownerOrganizationId: string, existingId?: string) {
  const values = {
    owner_organization_id: ownerOrganizationId,
    name: manifest.community.name,
    slug: manifest.community.slug,
    external_provider: "highlevel",
    external_group_id: manifest.community.externalId,
    portal_url: manifest.community.portalUrl ?? "https://academy.dirtyturf.com",
    metadata: manifest.community.metadata ?? {},
  };
  return existingId
    ? await requiredUpdate(admin, "academy_communities", existingId, values)
    : await requiredInsert(admin, "academy_communities", values);
}

async function canManageImport(admin: SupabaseClient, userId: string, communityId: string | undefined, organizationId: string) {
  if (communityId) {
    const membership = await maybeSingle(admin.from("academy_members").select("id")
      .eq("academy_community_id", communityId).eq("user_id", userId).eq("status", "active").eq("role", "owner"));
    if (membership) return true;
  }
  return Boolean(await maybeSingle(admin.from("organization_members").select("user_id")
    .eq("organization_id", organizationId).eq("user_id", userId).eq("role", "owner")));
}

async function recordSource(
  admin: SupabaseClient,
  batchId: string,
  communityId: string,
  recordType: string,
  externalId: string,
  payload: unknown,
  parentExternalId?: string,
  sourceCreatedAt?: string,
  importedId?: string,
  importedTable?: string,
  sourceUrl?: string,
  sourceUpdatedAt?: string,
) {
  await checked(admin.from("source_import_records").upsert({
    batch_id: batchId,
    academy_community_id: communityId,
    record_type: recordType,
    external_id: externalId,
    parent_external_id: parentExternalId ?? null,
    source_url: sourceUrl ?? null,
    source_created_at: sourceCreatedAt ?? null,
    source_updated_at: sourceUpdatedAt ?? null,
    content_hash: await sha256(JSON.stringify(payload)),
    payload,
    imported_table: importedTable ?? null,
    imported_id: importedId ?? null,
  }, { onConflict: "batch_id,record_type,external_id" }));
}

async function syncImportAccessGrant(
  admin: SupabaseClient,
  values: {
    memberId: string;
    courseId: string | null;
    sourceKey: string;
    status: "active" | "suspended" | "revoked" | "expired";
    startsAt: string;
    endsAt: string | null;
    metadata: Record<string, Json>;
  },
) {
  const { error } = await admin.rpc("upsert_academy_import_access_grant", {
    p_member_id: values.memberId,
    p_course_id: values.courseId,
    p_source_key: values.sourceKey,
    p_status: values.status,
    p_starts_at: values.startsAt,
    p_ends_at: values.endsAt,
    p_metadata: values.metadata,
  });
  if (error) throw error;
}

function validateManifest(manifest: ImportManifest) {
  if (!manifest || typeof manifest !== "object") return "Import manifest is required";
  if (!manifest.community?.externalId || !manifest.community?.name || !manifest.community?.slug) {
    return "community.externalId, community.name, and community.slug are required";
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.community.slug)) return "community.slug is invalid";
  for (const member of manifest.members ?? []) {
    if (!member.externalId || !member.displayName) return "Every member requires externalId and displayName";
    if (member.email && !/^\S+@\S+\.\S+$/.test(member.email)) return `Invalid email for member ${member.externalId}`;
  }
  for (const course of manifest.courses ?? []) {
    if (course.sortOrder !== undefined && !validImportSortOrder(course.sortOrder)) return "Invalid course sortOrder";
    if (!course.externalId || !course.title) return "Every course requires externalId and title";
    for (const module of course.modules ?? []) {
      if (module.sortOrder !== undefined && !validImportSortOrder(module.sortOrder)) return "Invalid module sortOrder";
      if (!module.externalId || !module.title) return `Every module in ${course.externalId} requires externalId and title`;
      for (const lesson of module.lessons ?? []) {
        if (lesson.sortOrder !== undefined && !validImportSortOrder(lesson.sortOrder)) return "Invalid lesson sortOrder";
        if (!lesson.externalId || !lesson.title) return `Every lesson in ${module.externalId} requires externalId and title`;
      }
    }
  }
  return null;
}

function manifestCounts(manifest: ImportManifest) {
  const modules = (manifest.courses ?? []).flatMap((course) => course.modules ?? []);
  return {
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
}

async function requiredInsert(admin: SupabaseClient, table: string, values: Record<string, unknown>) {
  const { data, error } = await admin.from(table).insert(values).select("*").single();
  if (error) throw error;
  return data;
}

async function requiredUpdate(admin: SupabaseClient, table: string, id: string, values: Record<string, unknown>) {
  const { data, error } = await admin.from(table).update(values).eq("id", id).select("*").single();
  if (error) throw error;
  return data;
}

async function maybeSingle(query: PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>) {
  const { data, error } = await query;
  if (error && error.code !== "PGRST116") throw error;
  if (Array.isArray(data)) return (data[0] as Record<string, any> | undefined) ?? null;
  return data as Record<string, any> | null;
}

async function checked(query: PromiseLike<{ error: unknown }>) {
  const { error } = await query;
  if (error) throw error;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function getEnvironment() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  return url && serviceRoleKey ? { url, serviceRoleKey } : null;
}
