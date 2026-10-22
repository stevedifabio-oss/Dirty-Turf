import { supabase } from "./backend";

export type AdminStatus = "draft" | "published" | "archived";

export type AdminLesson = {
  id: string;
  moduleId: string;
  title: string;
  lessonType: "video" | "guide" | "quiz";
  body: Record<string, unknown>;
  videoUrl: string;
  transcript: string;
  resources: unknown[];
  durationSeconds: number;
  sortOrder: number;
  status: AdminStatus;
};

export type AdminModule = {
  id: string;
  courseId: string;
  title: string;
  groupTitle: string;
  sortOrder: number;
  dripAfterDays: number | null;
  lessons: AdminLesson[];
};

export type AdminCourse = {
  id: string;
  title: string;
  description: string;
  category: string;
  instructorName: string;
  accessType: "open" | "level" | "purchase";
  requiredLevel: number | null;
  priceCents: number | null;
  sortOrder: number;
  status: AdminStatus;
  modules: AdminModule[];
};

export type AdminMember = {
  id: string;
  displayName: string;
  companyName: string;
  location: string;
  role: "owner" | "admin" | "moderator" | "member";
  status: "pending" | "active" | "suspended" | "cancelled";
  level: number;
  points: number;
  userId: string | null;
  inviteEmail: string | null;
  inviteStatus: string | null;
  courseIds: string[];
  completedLessons: number;
};

export type AdminEvent = {
  id: string;
  title: string;
  description: string;
  kind: "live" | "workshop" | "office_hours";
  hostName: string;
  startsAt: string;
  endsAt: string;
  meetingUrl: string;
  recurrenceRule: string;
  requiredLevel: number | null;
  status: AdminStatus;
  attendeeCount: number;
};

export type AdminCategory = {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  memberCanPost: boolean;
};

export type AdminPost = {
  id: string;
  title: string;
  body: string;
  status: AdminStatus;
  isPinned: boolean;
  authorName: string;
  categoryName: string;
  createdAt: string;
};

export type AdminReport = {
  id: string;
  contentType: "post" | "comment" | "member";
  contentId: string;
  reason: string;
  status: "open" | "reviewing" | "resolved" | "dismissed";
  createdAt: string;
  targetTitle: string;
  targetDetail: string;
  targetRole: AdminMember["role"] | null;
};

export type CertificateTemplate = {
  id: string;
  name: string;
  title: string;
  description: string;
  signatoryName: string;
  signatoryTitle: string;
  active: boolean;
};

export type AdminCertificate = {
  id: string;
  memberId: string;
  courseId: string;
  recipientName: string;
  courseTitle: string;
  verificationCode: string;
  status: "active" | "revoked";
  issuedAt: string;
};

export type AdminSnapshot = {
  communityId: string;
  organizationId: string;
  communityName: string;
  courses: AdminCourse[];
  members: AdminMember[];
  events: AdminEvent[];
  categories: AdminCategory[];
  posts: AdminPost[];
  reports: AdminReport[];
  templates: CertificateTemplate[];
  certificates: AdminCertificate[];
  quizAttemptCount: number;
};

type AdminContext = {
  communityId: string;
  organizationId: string;
  communityName: string;
};

export async function loadAdminSnapshot(): Promise<AdminSnapshot> {
  const context = await requireAdminContext();
  const [courseResult, moduleResult, lessonResult, memberResult, inviteResult, enrollmentResult, progressResult, eventResult, rsvpResult, categoryResult, postResult, commentResult, reportResult, templateResult, certificateResult, quizResult] = await Promise.all([
    supabase!.from("courses").select("id,title,description,category,instructor_name,access_type,required_level,price_cents,sort_order,status").eq("academy_community_id", context.communityId).order("sort_order"),
    supabase!.from("course_modules").select("id,course_id,title,group_title,sort_order,drip_after_days").order("sort_order"),
    supabase!.from("course_lessons").select("id,module_id,title,lesson_type,body,video_url,transcript,resources,duration_seconds,sort_order,status").order("sort_order"),
    supabase!.from("academy_members").select("id,user_id,display_name,company_name,location,role,status,level,points").eq("academy_community_id", context.communityId).order("display_name"),
    supabase!.from("academy_member_invites").select("academy_member_id,email,status").eq("academy_community_id", context.communityId),
    supabase!.from("course_enrollments").select("academy_member_id,course_id,status").eq("academy_community_id", context.communityId),
    supabase!.from("academy_member_lesson_progress").select("academy_member_id,completed_at,progress_percent"),
    supabase!.from("academy_events").select("id,title,description,kind,host_name,starts_at,ends_at,meeting_url,recurrence_rule,required_level,status").eq("academy_community_id", context.communityId).order("starts_at"),
    supabase!.from("academy_member_event_rsvps").select("event_id"),
    supabase!.from("community_categories").select("id,name,color,sort_order,member_can_post").eq("academy_community_id", context.communityId).order("sort_order"),
    supabase!.from("community_posts").select("id,title,body,status,is_pinned,academy_author_id,category_id,created_at").eq("academy_community_id", context.communityId).order("created_at", { ascending: false }).limit(200),
    supabase!.from("community_comments").select("id,body,academy_author_id").eq("academy_community_id", context.communityId).limit(500),
    supabase!.from("content_reports").select("id,content_type,content_id,reason,status,created_at").eq("organization_id", context.organizationId).order("created_at", { ascending: false }),
    supabase!.from("academy_certificate_templates").select("id,name,title,description,signatory_name,signatory_title,active").eq("academy_community_id", context.communityId).order("created_at"),
    supabase!.from("academy_certificates").select("id,academy_member_id,course_id,recipient_name,course_title,verification_code,status,issued_at").eq("academy_community_id", context.communityId).order("issued_at", { ascending: false }),
    supabase!.from("academy_quiz_attempts").select("id", { count: "exact", head: true }).eq("academy_community_id", context.communityId),
  ]);
  throwFirstError([courseResult, moduleResult, lessonResult, memberResult, inviteResult, enrollmentResult, progressResult, eventResult, rsvpResult, categoryResult, postResult, commentResult, reportResult, templateResult, certificateResult, quizResult]);

  const courseRows = courseResult.data ?? [];
  const courseIds = new Set(courseRows.map((row) => row.id));
  const moduleRows = (moduleResult.data ?? []).filter((row) => courseIds.has(row.course_id));
  const moduleIds = new Set(moduleRows.map((row) => row.id));
  const lessonsByModule = new Map<string, AdminLesson[]>();
  for (const row of (lessonResult.data ?? []).filter((lesson) => moduleIds.has(lesson.module_id))) {
    const lesson: AdminLesson = {
      id: row.id,
      moduleId: row.module_id,
      title: row.title,
      lessonType: row.lesson_type,
      body: isRecord(row.body) ? row.body : {},
      videoUrl: row.video_url ?? "",
      transcript: row.transcript ?? "",
      resources: Array.isArray(row.resources) ? row.resources : [],
      durationSeconds: Number(row.duration_seconds),
      sortOrder: Number(row.sort_order),
      status: row.status,
    };
    lessonsByModule.set(row.module_id, [...(lessonsByModule.get(row.module_id) ?? []), lesson]);
  }
  const modulesByCourse = new Map<string, AdminModule[]>();
  for (const row of moduleRows) {
    const module: AdminModule = {
      id: row.id,
      courseId: row.course_id,
      title: row.title,
      groupTitle: row.group_title ?? "",
      sortOrder: Number(row.sort_order),
      dripAfterDays: row.drip_after_days,
      lessons: lessonsByModule.get(row.id) ?? [],
    };
    modulesByCourse.set(row.course_id, [...(modulesByCourse.get(row.course_id) ?? []), module]);
  }
  const courses: AdminCourse[] = courseRows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    instructorName: row.instructor_name,
    accessType: row.access_type,
    requiredLevel: row.required_level,
    priceCents: row.price_cents,
    sortOrder: Number(row.sort_order),
    status: row.status,
    modules: modulesByCourse.get(row.id) ?? [],
  }));

  const invites = new Map((inviteResult.data ?? []).map((row) => [row.academy_member_id, row]));
  const enrollmentsByMember = new Map<string, string[]>();
  for (const row of enrollmentResult.data ?? []) {
    if (!["active", "completed"].includes(row.status)) continue;
    enrollmentsByMember.set(row.academy_member_id, [...(enrollmentsByMember.get(row.academy_member_id) ?? []), row.course_id]);
  }
  const progressByMember = new Map<string, number>();
  for (const row of progressResult.data ?? []) {
    if (row.completed_at || Number(row.progress_percent) >= 100) progressByMember.set(row.academy_member_id, (progressByMember.get(row.academy_member_id) ?? 0) + 1);
  }
  const members: AdminMember[] = (memberResult.data ?? []).map((row) => {
    const invite = invites.get(row.id);
    return {
      id: row.id,
      userId: row.user_id,
      displayName: row.display_name,
      companyName: row.company_name,
      location: row.location,
      role: row.role,
      status: row.status,
      level: Number(row.level),
      points: Number(row.points),
      inviteEmail: invite?.email ?? null,
      inviteStatus: invite?.status ?? null,
      courseIds: enrollmentsByMember.get(row.id) ?? [],
      completedLessons: progressByMember.get(row.id) ?? 0,
    };
  });
  const memberName = new Map(members.map((member) => [member.id, member.displayName || "Academy member"]));
  const memberById = new Map(members.map((member) => [member.id, member]));
  const postById = new Map((postResult.data ?? []).map((post) => [post.id, post]));
  const commentById = new Map((commentResult.data ?? []).map((comment) => [comment.id, comment]));
  const categoryName = new Map((categoryResult.data ?? []).map((category) => [category.id, category.name]));
  const rsvpCounts = new Map<string, number>();
  for (const row of rsvpResult.data ?? []) rsvpCounts.set(row.event_id, (rsvpCounts.get(row.event_id) ?? 0) + 1);

  return {
    communityId: context.communityId,
    organizationId: context.organizationId,
    communityName: context.communityName,
    courses,
    members,
    events: (eventResult.data ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      kind: row.kind,
      hostName: row.host_name,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      meetingUrl: row.meeting_url ?? "",
      recurrenceRule: row.recurrence_rule ?? "",
      requiredLevel: row.required_level,
      status: row.status,
      attendeeCount: rsvpCounts.get(row.id) ?? 0,
    })),
    categories: (categoryResult.data ?? []).map((row) => ({ id: row.id, name: row.name, color: row.color, sortOrder: Number(row.sort_order), memberCanPost: Boolean(row.member_can_post) })),
    posts: (postResult.data ?? []).map((row) => ({ id: row.id, title: row.title, body: row.body, status: row.status, isPinned: Boolean(row.is_pinned), authorName: memberName.get(row.academy_author_id) ?? "Academy member", categoryName: categoryName.get(row.category_id) ?? "General", createdAt: row.created_at })),
    reports: (reportResult.data ?? []).map((row) => {
      const post = row.content_type === "post" ? postById.get(row.content_id) : undefined;
      const comment = row.content_type === "comment" ? commentById.get(row.content_id) : undefined;
      const member = row.content_type === "member" ? memberById.get(row.content_id) : undefined;
      return {
        id: row.id,
        contentType: row.content_type,
        contentId: row.content_id,
        reason: row.reason,
        status: row.status,
        createdAt: row.created_at,
        targetTitle: post?.title ?? (comment ? `Comment by ${memberName.get(comment.academy_author_id) ?? "Academy member"}` : member?.displayName ?? "Reported content"),
        targetDetail: post?.body ?? comment?.body ?? (member ? `${member.role} · ${member.companyName || member.location || "Academy member"}` : "The reported item is no longer available."),
        targetRole: member?.role ?? null,
      };
    }),
    templates: (templateResult.data ?? []).map((row) => ({ id: row.id, name: row.name, title: row.title, description: row.description, signatoryName: row.signatory_name, signatoryTitle: row.signatory_title, active: Boolean(row.active) })),
    certificates: (certificateResult.data ?? []).map((row) => ({ id: row.id, memberId: row.academy_member_id, courseId: row.course_id, recipientName: row.recipient_name, courseTitle: row.course_title, verificationCode: row.verification_code, status: row.status, issuedAt: row.issued_at })),
    quizAttemptCount: quizResult.count ?? 0,
  };
}

export async function saveAdminCourse(input: Partial<AdminCourse> & Pick<AdminCourse, "title">) {
  const context = await requireAdminContext();
  const status = input.status ?? "draft";
  let firstPublication = status === "published";
  if (input.id) {
    const { data: current, error } = await supabase!.from("courses").select("published_at")
      .eq("id", input.id).eq("academy_community_id", context.communityId).single();
    if (error) throw error;
    if (!current) throw new Error("The course is no longer available. Refresh and try again.");
    firstPublication = status === "published" && !current.published_at;
  }
  const values = {
    academy_community_id: context.communityId,
    organization_id: context.organizationId,
    title: input.title.trim(),
    description: input.description?.trim() ?? "",
    category: input.category?.trim() || "Core",
    instructor_name: input.instructorName?.trim() || "Dirty Turf Academy",
    access_type: input.accessType ?? "open",
    required_level: input.accessType === "level" ? input.requiredLevel ?? 1 : null,
    price_cents: input.accessType === "purchase" ? input.priceCents ?? 0 : null,
    sort_order: input.sortOrder ?? 0,
    status,
    // Keep the original publication date through edits, archiving and republishing.
    ...(firstPublication ? { published_at: new Date().toISOString() } : input.id ? {} : { published_at: null }),
  };
  let query = input.id
    ? supabase!.from("courses").update(values).eq("id", input.id).eq("academy_community_id", context.communityId)
    : supabase!.from("courses").insert(values);
  // A concurrent first publication must not be overwritten by this editor's read.
  if (input.id && firstPublication) query = query.is("published_at", null);
  const { data, error } = await query.select("id").single();
  if (error) throw error;
  return data.id;
}

export async function saveAdminModule(input: Partial<AdminModule> & Pick<AdminModule, "courseId" | "title">) {
  const values = { course_id: input.courseId, title: input.title.trim(), group_title: input.groupTitle?.trim() || null, sort_order: input.sortOrder ?? 0, drip_after_days: input.dripAfterDays ?? null };
  const id = input.id ?? crypto.randomUUID();
  const query = input.id ? supabase!.from("course_modules").update(values).eq("id", id) : supabase!.from("course_modules").insert({ id, ...values });
  // Visibility helpers re-read rows in a STABLE snapshot, so INSERT RETURNING
  // rejects authorized new rows. A successful minimal insert confirms this ID;
  // a second read could fail after commit and make a retry create a duplicate.
  const result = input.id ? await query.select("id").single() : await query;
  if (result.error) throw result.error;
  return input.id ? result.data!.id : id;
}

export async function saveAdminLesson(input: Partial<AdminLesson> & Pick<AdminLesson, "moduleId" | "title">) {
  const values = { module_id: input.moduleId, title: input.title.trim(), lesson_type: input.lessonType ?? "guide", body: input.body ?? {}, video_url: input.videoUrl?.trim() || null, transcript: input.transcript?.trim() || null, resources: input.resources ?? [], duration_seconds: input.durationSeconds ?? 0, sort_order: input.sortOrder ?? 0, status: input.status ?? "draft" };
  const id = input.id ?? crypto.randomUUID();
  const query = input.id ? supabase!.from("course_lessons").update(values).eq("id", id) : supabase!.from("course_lessons").insert({ id, ...values });
  const result = input.id ? await query.select("id").single() : await query;
  if (result.error) throw result.error;
  return input.id ? result.data!.id : id;
}

export async function saveAdminEvent(input: Partial<AdminEvent> & Pick<AdminEvent, "title" | "startsAt" | "endsAt">) {
  const context = await requireAdminContext();
  const values = { academy_community_id: context.communityId, organization_id: context.organizationId, title: input.title.trim(), description: input.description?.trim() ?? "", kind: input.kind ?? "live", host_name: input.hostName?.trim() || "Dirty Turf Academy", starts_at: input.startsAt, ends_at: input.endsAt, meeting_url: input.meetingUrl?.trim() || null, recurrence_rule: input.recurrenceRule?.trim() || null, required_level: input.requiredLevel ?? null, status: input.status ?? "draft" };
  const query = input.id ? supabase!.from("academy_events").update(values).eq("id", input.id) : supabase!.from("academy_events").insert(values);
  const { data, error } = await query.select("id").single();
  if (error) throw error;
  return data.id;
}

export async function saveAdminCategory(input: Partial<AdminCategory> & Pick<AdminCategory, "name">) {
  const context = await requireAdminContext();
  const values = { academy_community_id: context.communityId, organization_id: context.organizationId, name: input.name.trim(), color: input.color ?? "#047631", sort_order: input.sortOrder ?? 0, member_can_post: input.memberCanPost ?? true };
  const query = input.id ? supabase!.from("community_categories").update(values).eq("id", input.id) : supabase!.from("community_categories").insert(values);
  const { data, error } = await query.select("id").single();
  if (error) throw error;
  return data.id;
}

export async function moderateAdminPost(postId: string, changes: { status?: AdminStatus; isPinned?: boolean }) {
  const { error } = await supabase!.rpc("admin_moderate_community_post", {
    p_post_id: postId,
    p_status: changes.status ?? null,
    p_is_pinned: changes.isPinned ?? null,
  });
  if (error) throw error;
}

export async function removeAdminComment(commentId: string) {
  const { error } = await supabase!.rpc("admin_remove_community_comment", { p_comment_id: commentId });
  if (error) throw error;
}

export async function updateAdminReport(reportId: string, status: AdminReport["status"]) {
  const { data: user } = await supabase!.auth.getUser();
  const { error } = await supabase!.from("content_reports").update({ status, resolved_at: ["resolved", "dismissed"].includes(status) ? new Date().toISOString() : null, resolved_by: ["resolved", "dismissed"].includes(status) ? user.user?.id ?? null : null }).eq("id", reportId);
  if (error) throw error;
}

export async function createAdminMember(input: { displayName: string; email: string; role: AdminMember["role"] }) {
  const context = await requireAdminContext();
  const { data, error } = await supabase!.rpc("admin_create_academy_member", {
    p_academy_community_id: context.communityId,
    p_display_name: input.displayName.trim(),
    p_email: input.email.trim().toLowerCase(),
    p_role: input.role,
  });
  if (error) throw error;
  return String(data);
}

export async function updateAdminMember(memberId: string, changes: Partial<Pick<AdminMember, "role" | "status" | "level" | "points" | "displayName" | "companyName" | "location">>) {
  const { error } = await supabase!.rpc("admin_update_academy_member", {
    p_member_id: memberId,
    p_role: changes.role ?? null,
    p_status: changes.status ?? null,
    p_level: changes.level ?? null,
    p_points: changes.points ?? null,
    p_display_name: changes.displayName ?? null,
    p_company_name: changes.companyName ?? null,
    p_location: changes.location ?? null,
  });
  if (error) throw error;
}

export type AdminMemberInviteResult = { processed?: number; failed?: number; [key: string]: unknown };

export class MemberInvitePartialFailure extends Error {
  constructor(readonly action: "provision" | "notify", readonly result: AdminMemberInviteResult) {
    const label = action === "notify" ? "Sign-in email batch" : "Account preparation";
    const processed = typeof result.processed === "number" ? ` (${result.processed} processed)` : "";
    super(`${label} finished with ${result.failed} failure${result.failed === 1 ? "" : "s"}${processed}. Review member status before retrying.`);
    this.name = "MemberInvitePartialFailure";
  }
}

export async function runMemberInviteAction(action: "provision" | "notify") {
  const context = await requireAdminContext();
  const { data, error } = await supabase!.functions.invoke("academy-invite-members", { body: { academyCommunityId: context.communityId, action, limit: action === "notify" ? 25 : 50 } });
  if (error) throw error;
  if (!isRecord(data)) throw new Error("The member action returned no result. Refresh member status before retrying.");
  const result = data as AdminMemberInviteResult;
  if (typeof result.failed === "number" && result.failed > 0) throw new MemberInvitePartialFailure(action, result);
  return result;
}

export async function setAdminMemberCourseAccess(memberId: string, courseId: string, enabled: boolean) {
  const { error } = await supabase!.rpc("admin_set_member_course_access", { p_member_id: memberId, p_course_id: courseId, p_enabled: enabled });
  if (error) throw error;
}

export async function saveCertificateTemplate(input: Partial<CertificateTemplate> & Pick<CertificateTemplate, "name">) {
  const context = await requireAdminContext();
  const { data, error } = await supabase!.rpc("admin_save_certificate_template", {
    p_template_id: input.id ?? null,
    p_academy_community_id: context.communityId,
    p_name: input.name.trim(),
    p_title: input.title?.trim() || "Certificate of Completion",
    p_description: input.description?.trim() || "has successfully completed the course",
    p_signatory_name: input.signatoryName?.trim() || "Steve DiFabio",
    p_signatory_title: input.signatoryTitle?.trim() || "Dirty Turf Academy",
  });
  if (error) throw error;
  return String(data);
}

export async function issueAdminCertificate(memberId: string, courseId: string) {
  const { data, error } = await supabase!.rpc("admin_issue_academy_certificate", { p_member_id: memberId, p_course_id: courseId });
  if (error) throw error;
  return String(data);
}

export async function revokeAdminCertificate(certificateId: string, reason: string) {
  const { error } = await supabase!.rpc("admin_revoke_academy_certificate", { p_certificate_id: certificateId, p_reason: reason });
  if (error) throw error;
}

export async function uploadAdminLessonAsset(file: File, courseId: string, lessonId: string) {
  const context = await requireAdminContext();
  const safeName = file.name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "asset";
  const path = `${context.communityId}/${courseId}/${lessonId}/${crypto.randomUUID()}-${safeName}`;
  const { error: uploadError } = await supabase!.storage.from("academy-assets").upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (uploadError) throw uploadError;
  const assetType = file.type.startsWith("video/") ? "video" : file.type.startsWith("audio/") ? "audio" : file.type.startsWith("image/") ? "image" : file.type === "application/pdf" ? "pdf" : "document";
  const { error: assetError } = await supabase!.rpc("admin_attach_academy_lesson_asset", {
    p_academy_community_id: context.communityId,
    p_course_id: courseId,
    p_lesson_id: lessonId,
    p_title: file.name,
    p_asset_type: assetType,
    p_storage_bucket: "academy-assets",
    p_storage_path: path,
    p_mime_type: file.type || "",
    p_byte_size: file.size,
  });
  if (assetError) {
    await supabase!.storage.from("academy-assets").remove([path]);
    throw assetError;
  }
  return path;
}

export const ADMIN_LESSON_BLOCK_IMAGE_LIMIT_BYTES = 20 * 1024 * 1024;
export const ADMIN_LESSON_BLOCK_VIDEO_LIMIT_BYTES = 500 * 1024 * 1024;
export const ADMIN_LESSON_BLOCK_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"] as const;
export const ADMIN_LESSON_BLOCK_VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"] as const;

/** Register uploaded block media without changing the lesson's saved content. */
export async function uploadAdminLessonBlockAsset(file: File, courseId: string, lessonId: string): Promise<{ path: string; previewUrl: string }> {
  const mimeType = typeof file?.type === "string" ? file.type.trim().toLowerCase() : "";
  const image = (ADMIN_LESSON_BLOCK_IMAGE_TYPES as readonly string[]).includes(mimeType);
  const video = (ADMIN_LESSON_BLOCK_VIDEO_TYPES as readonly string[]).includes(mimeType);
  if (!image && !video) throw new Error("Choose a JPG, PNG, WebP, GIF, AVIF, MP4, WebM or MOV file.");
  const sizeLimit = image ? ADMIN_LESSON_BLOCK_IMAGE_LIMIT_BYTES : ADMIN_LESSON_BLOCK_VIDEO_LIMIT_BYTES;
  if (!Number.isSafeInteger(file.size) || file.size <= 0) throw new Error("Choose a file that is not empty.");
  if (file.size > sizeLimit) throw new Error(`${image ? "Images" : "Videos"} must be ${image ? "20" : "500"} MB or smaller.`);
  if (typeof file.name !== "string" || !file.name.trim()) throw new Error("This file has no name. Choose it again.");
  const context = await requireAdminLessonContext(courseId, lessonId);
  const assetId = crypto.randomUUID();
  const safeName = file.name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(-160) || "asset";
  const path = `${context.communityId}/${courseId}/${lessonId}/${assetId}-${safeName}`;
  const bucket = supabase!.storage.from("academy-assets");
  const { error: uploadError } = await bucket.upload(path, file, { contentType: mimeType, upsert: false });
  if (uploadError) throw uploadError;

  const { error: assetError } = await supabase!.from("academy_assets").insert({
    id: assetId,
    academy_community_id: context.communityId,
    course_id: courseId,
    lesson_id: lessonId,
    title: file.name.trim().slice(0, 180),
    asset_type: image ? "image" : "video",
    storage_bucket: "academy-assets",
    storage_path: path,
    original_url: `academy-asset:${path}`,
    mime_type: mimeType,
    byte_size: file.size,
    source_provider: "native",
  });
  if (assetError) {
    // A cleanup failure must not hide why registration failed. No lesson
    // content was changed, and successful registrations are never removed.
    try { await bucket.remove([path]); } catch { /* Preserve the registration error. */ }
    throw assetError;
  }

  try {
    const { data, error } = await bucket.createSignedUrl(path, 60 * 60);
    return { path, previewUrl: !error && typeof data?.signedUrl === "string" ? data.signedUrl : "" };
  } catch {
    // The asset is already saved. Losing its optional preview must not invite
    // another upload or remove a file that the final lesson can reference.
    return { path, previewUrl: "" };
  }
}

/** Resolve saved block references for this administrator's lesson editor. */
export async function loadAdminLessonBlockMedia(courseId: string, lessonId: string): Promise<Record<string, string>> {
  const context = await requireAdminLessonContext(courseId, lessonId);
  const { data: assets, error: assetError } = await supabase!.from("academy_assets").select("original_url,storage_path")
    .eq("academy_community_id", context.communityId).eq("course_id", courseId).eq("lesson_id", lessonId).eq("storage_bucket", "academy-assets");
  if (assetError) throw assetError;
  const prefix = `${context.communityId}/${courseId}/${lessonId}/`;
  const paths = [...new Set((assets ?? []).flatMap((asset) => {
    const path = typeof asset.storage_path === "string" ? asset.storage_path : "";
    return path.startsWith(prefix) && !/[\u0000-\u001f\\?#]/.test(path) && !path.split("/").some((part) => part === "." || part === "..")
      && asset.original_url === `academy-asset:${path}` ? [path] : [];
  }))];
  const previews: Record<string, string> = {};
  for (let offset = 0; offset < paths.length; offset += 100) {
    const batch = paths.slice(offset, offset + 100);
    const { data, error } = await supabase!.storage.from("academy-assets").createSignedUrls(batch, 60 * 60);
    if (error) throw error;
    for (const signed of data ?? []) {
      if (signed.path && batch.includes(signed.path) && !signed.error && typeof signed.signedUrl === "string" && signed.signedUrl) {
        previews[`academy-asset:${signed.path}`] = signed.signedUrl;
      }
    }
  }
  return previews;
}

async function requireAdminLessonContext(courseId: string, lessonId: string): Promise<AdminContext> {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(courseId) || !uuid.test(lessonId)) throw new Error("Save the lesson draft before adding files.");
  const context = await requireAdminContext();
  const [courseResult, lessonResult] = await Promise.all([
    supabase!.from("courses").select("id").eq("id", courseId).eq("academy_community_id", context.communityId).single(),
    supabase!.from("course_lessons").select("id,module_id").eq("id", lessonId).single(),
  ]);
  if (courseResult.error) throw courseResult.error;
  if (lessonResult.error) throw lessonResult.error;
  if (!courseResult.data || !lessonResult.data?.module_id) throw new Error("The lesson is no longer available in this Academy.");
  const { data: module, error: moduleError } = await supabase!.from("course_modules").select("id")
    .eq("id", lessonResult.data.module_id).eq("course_id", courseId).single();
  if (moduleError) throw moduleError;
  if (!module) throw new Error("The lesson does not belong to this Academy course.");
  return context;
}

async function requireAdminContext(): Promise<AdminContext> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data: access, error: accessError } = await supabase.rpc("get_academy_access_state");
  if (accessError) throw accessError;
  if (!isRecord(access) || access.canManage !== true) throw new Error("Academy administrator access required.");
  const communityId = typeof access.communityId === "string" ? access.communityId : "";
  if (!communityId) throw new Error("Academy administrator community is not configured.");
  const { data: community, error: communityError } = await supabase.from("academy_communities").select("id,name,owner_organization_id").eq("id", communityId).single();
  if (communityError || !community?.owner_organization_id) throw communityError || new Error("Academy organization is not configured.");
  return { communityId: community.id, organizationId: community.owner_organization_id, communityName: community.name };
}

function throwFirstError(results: Array<{ error: unknown }>) {
  const failed = results.find((result) => result.error);
  if (failed?.error) throw failed.error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
