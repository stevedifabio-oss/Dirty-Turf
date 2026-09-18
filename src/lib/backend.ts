import { Capacitor } from "@capacitor/core";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AcademyEvent, AppNotification, CommunityComment, CommunityPost, Course, Job, LessonQuiz, Member, NotificationPreferences } from "../domain";
import { NATIVE_AUTH_REDIRECT, parseNativeAuthRedirect } from "./authRedirect";
import { clampProgress, combinedCourseProgress } from "./courseProgress";
import { memberMagicLinkOptions, normalizeLoginEmail } from "./memberAuth";

const JOBS_KEY = "dirty-turf-jobs-v3";
const POSTS_KEY = "dirty-turf-posts-v1";
const COMMENTS_KEY = "dirty-turf-comments-v1";
const COURSES_KEY = "dirty-turf-courses-v1";
const EVENTS_KEY = "dirty-turf-events-v1";
const NOTIFICATION_PREFERENCES_KEY = "dirty-turf-notification-preferences-v1";
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabasePublishableKey = (
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY
)?.trim();

type DirtyTurfWindow = Window & { __dirtyTurfSupabase?: SupabaseClient };

const browserWindow = window as DirtyTurfWindow;

export const supabase = supabaseUrl && supabasePublishableKey
  ? browserWindow.__dirtyTurfSupabase ??= createClient(supabaseUrl, supabasePublishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" },
    })
  : null;

export type DataMode = "device" | "cloud";

export type WorkspaceAccessState =
  | { status: "preview" }
  | { status: "signed_out" }
  | { status: "member"; canManage: boolean }
  | { status: "no_access" };

export type AcademyBillingPlan = {
  id: string;
  name: string;
  description: string;
  billingType: "subscription" | "one_time";
  billingInterval: "month" | "year" | "one_time";
  amountCents: number;
  currency: string;
  trialDays: number;
};

export type AcademyBillingOverview = {
  plans: AcademyBillingPlan[];
  subscription: {
    status: string;
    cancelAtPeriodEnd: boolean;
    currentPeriodEnd: string | null;
    planName: string;
    billingType: "subscription" | "one_time";
  } | null;
};

type AcademyContext = {
  memberId: string;
  communityId: string;
  userId: string;
};

export type HighLevelStatus = {
  connected: boolean;
  location: { available: boolean; id?: string; name?: string; status?: number };
  pipelines: { available: boolean; count?: number; status?: number };
  workflows: { available: boolean; count?: number; status?: number };
  products: { available: boolean; accessible?: boolean; status?: number };
};

export type MemberAccessSummary = {
  inviteRows: number;
  eligibleMembers: number;
  provisionedMembers: number;
  membersNotReady: number;
  allEligibleReady: boolean;
  enrolledMembers: number;
  enrolledReady: number;
  enrolledNotReady: number;
  enrolledMissingInvite: number;
  allEnrolledReady: boolean;
  statusCounts: Record<string, number>;
};

export type AccountDeletionRequest = {
  id: string;
  status: "requested" | "in_review" | "completed" | "declined";
  requestedAt: string;
};

export const defaultNotificationPreferences: NotificationPreferences = {
  emailEnabled: true,
  replies: true,
  mentions: true,
  reactions: true,
  newPosts: true,
  adminAnnouncements: true,
  eventReminders: true,
  courseUpdates: true,
  weeklyDigest: true,
};

type MemberAccessResponse = {
  processed?: number;
  failed?: number;
  remainingForAction?: number;
  readyToProcess?: number;
  summary: MemberAccessSummary;
};

export async function requestMagicLink(email: string) {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase.auth.signInWithOtp({
    email: normalizeLoginEmail(email),
    options: memberMagicLinkOptions(Capacitor.isNativePlatform() ? NATIVE_AUTH_REDIRECT : window.location.origin),
  });
}

export async function getWorkspaceAccessState(): Promise<WorkspaceAccessState> {
  if (!supabase) return { status: "preview" };
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return { status: "signed_out" };
  const { data, error } = await supabase.rpc("get_academy_access_state");
  if (error) throw error;
  const value = data && typeof data === "object"
    ? data as Record<string, unknown>
    : {};
  return value.hasAccess === true
    ? { status: "member", canManage: value.canManage === true }
    : { status: "no_access" };
}

export async function loadAcademyBillingOverview(): Promise<AcademyBillingOverview> {
  if (!supabase) return { plans: [], subscription: null };
  const { data, error } = await supabase.rpc("get_academy_billing_overview");
  if (error) throw error;
  const value = data && typeof data === "object"
    ? data as Record<string, unknown>
    : {};
  const plans = Array.isArray(value.plans)
    ? value.plans.filter(isBillingPlan)
    : [];
  const subscription = isBillingSubscription(value.subscription)
    ? value.subscription
    : null;
  return { plans, subscription };
}

export function webBillingAvailable() {
  return Boolean(supabase) && !Capacitor.isNativePlatform();
}

export async function startAcademyCheckout(planId: string) {
  if (!supabase || Capacitor.isNativePlatform()) {
    throw new Error("Checkout is available on the Academy website.");
  }
  const { data, error } = await supabase.functions.invoke<{ url?: string }>(
    "create-checkout",
    { body: { planId, requestId: crypto.randomUUID() } },
  );
  if (error || !data?.url) throw error || new Error("Checkout returned no URL.");
  window.location.assign(data.url);
}

export async function openAcademyBillingPortal() {
  if (!supabase || Capacitor.isNativePlatform()) {
    throw new Error("Billing management is available on the Academy website.");
  }
  const { data, error } = await supabase.functions.invoke<{ url?: string }>(
    "create-billing-portal",
    { body: {} },
  );
  if (error || !data?.url) throw error || new Error("Billing portal returned no URL.");
  window.location.assign(data.url);
}

export async function claimAcademyMemberships() {
  if (!supabase) return { claimed: 0, memberships: 0 };
  const { data, error } = await supabase.rpc("claim_academy_memberships");
  if (error) throw error;
  const result = data && typeof data === "object" ? data as Record<string, unknown> : {};
  return {
    claimed: Number(result.claimed ?? 0),
    memberships: Number(result.memberships ?? 0),
  };
}

export async function loadMemberAccessSummary() {
  return invokeMemberAccess("preview");
}

export async function provisionAcademyMemberAccounts() {
  let finalResponse: MemberAccessResponse | null = null;
  for (let batch = 0; batch < 10; batch += 1) {
    const response = await invokeMemberAccess("provision", 50);
    finalResponse = response;
    if ((response.failed ?? 0) > 0 || (response.remainingForAction ?? 0) === 0 || (response.processed ?? 0) === 0) break;
  }
  if (!finalResponse) throw new Error("Member provisioning returned no result.");
  return finalResponse;
}

async function invokeMemberAccess(action: "preview" | "provision", limit?: number) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const context = await getAcademyContext();
  if (!context) throw new Error("An Academy administrator account is required.");
  const { data, error } = await supabase.functions.invoke<MemberAccessResponse>("academy-invite-members", {
    body: { academyCommunityId: context.communityId, action, limit },
  });
  if (error) throw error;
  if (!data?.summary) throw new Error("Member access service returned no readiness summary.");
  return data;
}

export async function initializeNativeAuth(onError: (message: string) => void = () => undefined) {
  if (!supabase || !Capacitor.isNativePlatform()) return () => undefined;
  const { App } = await import("@capacitor/app");
  const handledUrls = new Set<string>();

  const handleUrl = async (rawUrl?: string) => {
    if (!rawUrl || handledUrls.has(rawUrl)) return;
    const redirect = parseNativeAuthRedirect(rawUrl);
    if (!redirect) return;
    handledUrls.add(rawUrl);
    if (redirect.error) {
      onError(redirect.error);
      return;
    }

    const { error } = redirect.code
      ? await supabase.auth.exchangeCodeForSession(redirect.code)
      : redirect.accessToken && redirect.refreshToken
        ? await supabase.auth.setSession({ access_token: redirect.accessToken, refresh_token: redirect.refreshToken })
        : { error: new Error("The sign-in link is incomplete.") };
    if (error) onError(error.message || "The sign-in link could not be completed.");
  };

  const listener = await App.addListener("appUrlOpen", ({ url }) => { void handleUrl(url); });
  const launch = await App.getLaunchUrl();
  await handleUrl(launch?.url);
  return () => { void listener.remove(); };
}

export async function signOut() {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function loadAccountDeletionRequest(): Promise<AccountDeletionRequest | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("account_deletion_requests")
    .select("id,status,requested_at")
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    status: data.status as AccountDeletionRequest["status"],
    requestedAt: data.requested_at,
  };
}

export async function requestAccountDeletion(reason?: string): Promise<AccountDeletionRequest> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) throw new Error("Sign in before requesting account deletion.");

  const { data, error } = await supabase
    .from("account_deletion_requests")
    .insert({ user_id: userId, reason: reason?.trim() || null })
    .select("id,status,requested_at")
    .single();
  if (error?.code === "23505") {
    const existing = await loadAccountDeletionRequest();
    if (existing) return existing;
  }
  if (error || !data) throw error || new Error("The deletion request was not saved.");
  return {
    id: data.id,
    status: data.status as AccountDeletionRequest["status"],
    requestedAt: data.requested_at,
  };
}

export async function getHighLevelStatus(): Promise<HighLevelStatus> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.functions.invoke<HighLevelStatus>("ghl-status", { method: "GET" });
  if (error) throw error;
  if (!data) throw new Error("HighLevel status returned no data.");
  return data;
}

export async function uploadJobPhoto(organizationId: string, propertyId: string, file: File) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `${organizationId}/${propertyId}/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from("job-photos").upload(path, file, {
    cacheControl: "3600",
    contentType: file.type,
    upsert: false,
  });
  if (error) throw error;
  return path;
}

export async function getDataMode(): Promise<DataMode> {
  if (!supabase) return "device";
  const { data } = await supabase.auth.getSession();
  return data.session ? "cloud" : "device";
}

function isBillingPlan(value: unknown): value is AcademyBillingPlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as Record<string, unknown>;
  return typeof plan.id === "string" &&
    typeof plan.name === "string" &&
    typeof plan.description === "string" &&
    (plan.billingType === "subscription" || plan.billingType === "one_time") &&
    (plan.billingInterval === "month" || plan.billingInterval === "year" || plan.billingInterval === "one_time") &&
    typeof plan.amountCents === "number" &&
    typeof plan.currency === "string" &&
    typeof plan.trialDays === "number";
}

function isBillingSubscription(value: unknown): value is NonNullable<AcademyBillingOverview["subscription"]> {
  if (!value || typeof value !== "object") return false;
  const subscription = value as Record<string, unknown>;
  return typeof subscription.status === "string" &&
    typeof subscription.cancelAtPeriodEnd === "boolean" &&
    (subscription.currentPeriodEnd === null || typeof subscription.currentPeriodEnd === "string") &&
    typeof subscription.planName === "string" &&
    (subscription.billingType === "subscription" || subscription.billingType === "one_time");
}

export async function loadJobs(seed: Job[]): Promise<Job[]> {
  if (!(await hasCloudSession())) return readLocal(JOBS_KEY, seed);

  const { data, error } = await supabase!
    .from("job_cards")
    .select("id,property_name,square_feet,bag_count,total_infill_pounds,bag_count_50,infill_rate,service_rate,total,status,measurement_method,created_at,photo_count")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: stableNumericId(row.id),
    address: row.property_name,
    area: Number(row.square_feet),
    preciseArea: Number(row.square_feet),
    infill: Number(row.bag_count),
    infillPounds: Number(row.total_infill_pounds),
    bags50: Number(row.bag_count_50),
    infillRate: Number(row.infill_rate),
    serviceRate: Number(row.service_rate),
    quote: Number(row.total),
    status: row.status === "ready_to_quote" ? "Calculated" : titleCase(row.status),
    method: row.measurement_method,
    createdAt: relativeDate(row.created_at),
    photos: Number(row.photo_count),
  }));
}

export async function saveJob(job: Job): Promise<Job> {
  if (!(await hasCloudSession())) {
    const current = readLocal<Job[]>(JOBS_KEY, []);
    writeLocal(JOBS_KEY, [job, ...current.filter((item) => item.id !== job.id)]);
    return job;
  }

  const { data, error } = await supabase!.rpc("create_infill_calculation", {
    p_label: job.address,
    p_square_feet: job.preciseArea ?? job.area,
    p_infill_rate: job.infillRate ?? 0.25,
    p_service_rate: job.serviceRate ?? 0,
    p_measurement_method: job.method,
  });
  if (error) throw error;
  return { ...job, id: stableNumericId(data) };
}

export async function loadPosts(seed: CommunityPost[]): Promise<CommunityPost[]> {
  const context = await getAcademyContext();
  if (!context) return (await hasCloudSession()) ? [] : readLocal(POSTS_KEY, seed);

  const { data, error } = await supabase!
    .from("community_feed")
    .select("id,academy_community_id,title,body,author_name,reply_count,created_at,category_name,is_pinned,media,like_count")
    .eq("academy_community_id", context.communityId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw error;
  const postIds = (data ?? []).map((row) => row.id);
  const [reactionResult, bookmarkResult] = postIds.length
    ? await Promise.all([
        supabase!.from("academy_post_reactions").select("post_id").eq("academy_member_id", context.memberId).in("post_id", postIds),
        supabase!.from("academy_post_bookmarks").select("post_id").eq("academy_member_id", context.memberId).in("post_id", postIds),
      ])
    : [{ data: [] }, { data: [] }];
  const liked = new Set((reactionResult.data ?? []).map((row) => row.post_id));
  const saved = new Set((bookmarkResult.data ?? []).map((row) => row.post_id));

  return (data ?? []).map((row) => ({
    id: stableNumericId(row.id),
    cloudId: row.id,
    name: row.title,
    author: row.author_name,
    body: row.body,
    replies: Number(row.reply_count),
    age: relativeDate(row.created_at),
    category: row.category_name,
    likes: Number(row.like_count),
    liked: liked.has(row.id),
    saved: saved.has(row.id),
    pinned: Boolean(row.is_pinned),
    media: Array.isArray(row.media) && row.media.length ? "photo" : undefined,
  }));
}

export async function savePost(post: CommunityPost): Promise<CommunityPost> {
  const context = await getAcademyContext();
  if (!context) {
    if (await hasCloudSession()) throw new Error("Academy membership is required.");
    const current = readLocal<CommunityPost[]>(POSTS_KEY, []);
    writeLocal(POSTS_KEY, [post, ...current.filter((item) => item.id !== post.id)]);
    return post;
  }

  const { data, error } = await supabase!.rpc("create_community_post", {
    p_title: post.name,
    p_body: post.body,
    p_category_name: post.category ?? "General",
    p_mentioned_member_ids: post.mentionedMemberIds ?? [],
  });
  if (error) throw error;
  return { ...post, id: stableNumericId(data), cloudId: String(data) };
}

export async function loadComments(seed: CommunityComment[]): Promise<CommunityComment[]> {
  const context = await getAcademyContext();
  if (!context) return (await hasCloudSession()) ? [] : readLocal(COMMENTS_KEY, seed);

  const { data, error } = await supabase!
    .from("academy_comment_feed")
    .select("id,post_id,parent_id,author_name,body,created_at,like_count,is_answer")
    .eq("academy_community_id", context.communityId)
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) throw error;

  const commentIds = (data ?? []).map((row) => row.id);
  const { data: reactionRows, error: reactionError } = commentIds.length
    ? await supabase!
        .from("academy_comment_reactions")
        .select("comment_id")
        .eq("academy_member_id", context.memberId)
        .in("comment_id", commentIds)
    : { data: [], error: null };
  if (reactionError) throw reactionError;
  const liked = new Set((reactionRows ?? []).map((row) => row.comment_id));

  return (data ?? []).map((row) => ({
    id: stableNumericId(row.id),
    cloudId: row.id,
    postId: stableNumericId(row.post_id),
    parentId: row.parent_id ? stableNumericId(row.parent_id) : undefined,
    parentCloudId: row.parent_id ?? undefined,
    author: row.author_name,
    body: row.body,
    age: relativeDate(row.created_at),
    likes: Number(row.like_count),
    liked: liked.has(row.id),
    answer: Boolean(row.is_answer),
  }));
}

export async function saveComment(comment: CommunityComment, postCloudId?: string): Promise<CommunityComment> {
  const context = await getAcademyContext();
  if (!context || !postCloudId) {
    if (await hasCloudSession()) throw new Error("Academy membership and a synced post are required.");
    const current = readLocal<CommunityComment[]>(COMMENTS_KEY, []);
    writeLocal(COMMENTS_KEY, [...current.filter((item) => item.id !== comment.id), comment]);
    return comment;
  }

  const { data, error } = await supabase!.rpc("create_academy_comment", {
    p_post_id: postCloudId,
    p_body: comment.body,
    p_parent_id: comment.parentCloudId ?? null,
    p_mentioned_member_ids: comment.mentionedMemberIds ?? [],
  });
  if (error) throw error;
  return { ...comment, id: stableNumericId(data), cloudId: String(data) };
}

export async function loadCourses(seed: Course[]): Promise<Course[]> {
  const context = await getAcademyContext();
  if (!context) return (await hasCloudSession()) ? [] : readLocal(COURSES_KEY, seed);

  const { data: courseRows, error: courseError } = await supabase!
    .from("courses")
    .select("id,title,description,category,instructor_name,access_type,required_level,sort_order")
    .eq("academy_community_id", context.communityId)
    .eq("status", "published")
    .order("sort_order");
  if (courseError) throw courseError;
  if (!courseRows?.length) return [];

  const courseIds = courseRows.map((row) => row.id);
  const { data: moduleRows, error: moduleError } = await supabase!
    .from("course_modules")
    .select("id,course_id,title,group_title,sort_order")
    .in("course_id", courseIds)
    .order("sort_order");
  if (moduleError) throw moduleError;

  const moduleIds = (moduleRows ?? []).map((row) => row.id);
  const { data: lessonRows, error: lessonError } = moduleIds.length
    ? await supabase!
        .from("course_lessons")
        .select("id,module_id,title,lesson_type,body,video_url,transcript,resources,duration_seconds,sort_order")
        .in("module_id", moduleIds)
        .eq("status", "published")
        .order("sort_order")
    : { data: [], error: null };
  if (lessonError) throw lessonError;

  const lessonIds = (lessonRows ?? []).map((row) => row.id);
  const { data: progressRows, error: progressError } = lessonIds.length
    ? await supabase!
        .from("academy_member_lesson_progress")
        .select("lesson_id,progress_percent,completed_at")
        .eq("academy_member_id", context.memberId)
        .in("lesson_id", lessonIds)
    : { data: [], error: null };
  if (progressError) throw progressError;
  const progress = new Map((progressRows ?? []).map((row) => [row.lesson_id, row]));

  const { data: enrollmentRows, error: enrollmentError } = await supabase!
    .from("course_enrollments")
    .select("*")
    .eq("academy_member_id", context.memberId)
    .in("course_id", courseIds);
  if (enrollmentError) throw enrollmentError;
  const importedProgress = new Map((enrollmentRows ?? []).map((row) => [
    row.course_id,
    clampProgress(row.source_progress_percent),
  ]));

  return courseRows.map((course) => {
    const modules = (moduleRows ?? []).filter((module) => module.course_id === course.id).map((module) => ({
      title: module.title,
      groupTitle: module.group_title ?? undefined,
      lessons: (lessonRows ?? []).filter((lesson) => lesson.module_id === module.id).map((lesson) => ({
        id: lesson.id,
        cloudId: lesson.id,
        title: lesson.title,
        duration: formatDuration(Number(lesson.duration_seconds)),
        type: lesson.lesson_type as "video" | "guide" | "quiz",
        completed: Boolean(progress.get(lesson.id)?.completed_at),
        body: normalizeLessonBody(lesson.body),
        bodyHtml: normalizeLessonHtml(lesson.body),
        videoUrl: lesson.video_url ?? undefined,
        transcript: lesson.transcript ?? undefined,
        resources: normalizeResources(lesson.resources),
        quiz: normalizeQuiz(lesson.body),
      })),
    }));
    const lessons = modules.flatMap((module) => module.lessons);
    const sourceProgress = importedProgress.get(course.id) ?? 0;
    const durationSeconds = (lessonRows ?? [])
      .filter((lesson) => (moduleRows ?? []).some((module) => module.id === lesson.module_id && module.course_id === course.id))
      .reduce((sum, lesson) => sum + Number(lesson.duration_seconds), 0);
    return {
      id: course.id,
      cloudId: course.id,
      title: course.title,
      description: course.description,
      category: course.category,
      instructor: course.instructor_name || "Dirty Turf Academy",
      progress: combinedCourseProgress(lessons.filter((lesson) => lesson.completed).length, lessons.length, sourceProgress),
      importedProgress: sourceProgress || undefined,
      duration: formatDuration(durationSeconds),
      modules,
      access: course.access_type as "open" | "level" | "purchase",
      requiredLevel: course.required_level ?? undefined,
    };
  });
}

export async function saveLessonCompletion(lessonCloudId: string, completed: boolean) {
  const context = await getAcademyContext();
  if (!context) return;
  const { error } = await supabase!.rpc("set_academy_lesson_completion", {
    p_lesson_id: lessonCloudId,
    p_completed: completed,
  });
  if (error) throw error;
}

export async function loadMembers(seed: Member[]): Promise<Member[]> {
  const context = await getAcademyContext();
  if (!context) return (await hasCloudSession()) ? [] : seed;
  const { data, error } = await supabase!
    .from("academy_members")
    .select("id,display_name,avatar_url,company_name,location,role,level,points,last_seen_at")
    .eq("academy_community_id", context.communityId)
    .eq("status", "active")
    .order("points", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: stableNumericId(row.id),
    cloudId: row.id,
    name: row.display_name || "Academy member",
    initials: initials(row.display_name),
    avatarUrl: row.avatar_url ?? undefined,
    company: row.company_name,
    location: row.location,
    role: academyRole(row.role),
    level: Number(row.level),
    points: Number(row.points),
    following: false,
    online: row.last_seen_at ? Date.now() - new Date(row.last_seen_at).getTime() < 15 * 60_000 : false,
  }));
}

export async function loadEvents(seed: AcademyEvent[]): Promise<AcademyEvent[]> {
  const context = await getAcademyContext();
  if (!context) return (await hasCloudSession()) ? [] : readLocal(EVENTS_KEY, seed);
  const { data, error } = await supabase!
    .from("academy_event_feed")
    .select("id,title,description,kind,starts_at,ends_at,host_name,meeting_url,attendee_count,is_attending")
    .eq("academy_community_id", context.communityId)
    .order("starts_at");
  if (error) throw error;
  return (data ?? []).map((row) => {
    const startsAt = new Date(row.starts_at);
    const endsAt = new Date(row.ends_at);
    return {
      id: stableNumericId(row.id),
      cloudId: row.id,
      title: row.title,
      description: row.description,
      date: new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(startsAt),
      time: new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(startsAt),
      duration: formatDuration(Math.max(0, (endsAt.getTime() - startsAt.getTime()) / 1000)),
      host: row.host_name || "Dirty Turf Academy",
      kind: String(row.kind).replace("_", "-") as AcademyEvent["kind"],
      attending: Boolean(row.is_attending),
      attendeeCount: Number(row.attendee_count),
      meetingUrl: row.meeting_url ?? undefined,
    };
  });
}

export async function toggleAcademyEventRsvp(eventCloudId: string) {
  const context = await getAcademyContext();
  if (!context) return null;
  const { data, error } = await supabase!.rpc("toggle_academy_event_rsvp", { p_event_id: eventCloudId });
  if (error) throw error;
  return Boolean(data);
}

export async function togglePostReaction(cloudPostId: string) {
  const context = await getAcademyContext();
  if (!context) return null;
  const { data, error } = await supabase!.rpc("toggle_academy_post_reaction", { p_post_id: cloudPostId });
  if (error) throw error;
  return Boolean(data);
}

export async function toggleCommentReaction(cloudCommentId: string) {
  const context = await getAcademyContext();
  if (!context) return null;
  const { data, error } = await supabase!.rpc("toggle_academy_comment_reaction", { p_comment_id: cloudCommentId });
  if (error) throw error;
  return Boolean(data);
}

export async function loadNotifications(seed: AppNotification[]): Promise<AppNotification[]> {
  const context = await getAcademyContext();
  if (!context) return (await hasCloudSession()) ? [] : seed;
  const { data, error } = await supabase!
    .from("notifications")
    .select("id,title,detail,kind,target_type,target_id,read_at,created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: stableNumericId(row.id),
    cloudId: row.id,
    title: row.title,
    detail: row.detail,
    age: relativeDate(row.created_at),
    kind: row.kind as AppNotification["kind"],
    read: Boolean(row.read_at),
    targetType: row.target_type ?? undefined,
    targetCloudId: row.target_id ?? undefined,
  }));
}

export async function markNotificationRead(notificationCloudId: string) {
  if (!(await hasCloudSession())) return;
  const { error } = await supabase!
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationCloudId);
  if (error) throw error;
}

export async function markAllNotificationsRead() {
  if (!(await hasCloudSession())) return;
  const { error } = await supabase!
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .is("read_at", null);
  if (error) throw error;
}

export async function loadNotificationPreferences(): Promise<NotificationPreferences> {
  if (!(await hasCloudSession())) return readLocal(NOTIFICATION_PREFERENCES_KEY, defaultNotificationPreferences);
  const { data, error } = await supabase!
    .from("notification_preferences")
    .select("email_enabled,replies,mentions,reactions,new_posts,admin_announcements,event_reminders,course_updates,weekly_digest")
    .maybeSingle();
  if (error) throw error;
  if (!data) return defaultNotificationPreferences;
  return {
    emailEnabled: Boolean(data.email_enabled),
    replies: Boolean(data.replies),
    mentions: Boolean(data.mentions),
    reactions: Boolean(data.reactions),
    newPosts: Boolean(data.new_posts),
    adminAnnouncements: Boolean(data.admin_announcements),
    eventReminders: Boolean(data.event_reminders),
    courseUpdates: Boolean(data.course_updates),
    weeklyDigest: Boolean(data.weekly_digest),
  };
}

export async function saveNotificationPreferences(preferences: NotificationPreferences) {
  if (!(await hasCloudSession())) {
    writeLocal(NOTIFICATION_PREFERENCES_KEY, preferences);
    return preferences;
  }
  const { data: sessionData } = await supabase!.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) throw new Error("Sign in before changing notification settings.");
  const { error } = await supabase!.from("notification_preferences").upsert({
    user_id: userId,
    email_enabled: preferences.emailEnabled,
    replies: preferences.replies,
    mentions: preferences.mentions,
    reactions: preferences.reactions,
    new_posts: preferences.newPosts,
    admin_announcements: preferences.adminAnnouncements,
    event_reminders: preferences.eventReminders,
    course_updates: preferences.courseUpdates,
    weekly_digest: preferences.weeklyDigest,
  }, { onConflict: "user_id" });
  if (error) throw error;
  return preferences;
}

export async function togglePostBookmark(cloudPostId: string) {
  const context = await getAcademyContext();
  if (!context) return null;
  const { data, error } = await supabase!.rpc("toggle_academy_post_bookmark", { p_post_id: cloudPostId });
  if (error) throw error;
  return Boolean(data);
}

export async function toggleEventRsvp(cloudEventId: string) {
  if (!(await hasCloudSession())) return null;
  const { data, error } = await supabase!.rpc("toggle_event_rsvp", { target_event_id: cloudEventId });
  if (error) throw error;
  return Boolean(data);
}

export async function setLessonCompletion(cloudLessonId: string, completed: boolean) {
  if (!(await hasCloudSession())) return;
  const { error } = await supabase!.rpc("set_lesson_completion", { target_lesson_id: cloudLessonId, is_complete: completed });
  if (error) throw error;
}

export function subscribeToWorkspaceChanges(onChange: () => void) {
  if (!supabase) return () => undefined;
  const channel = supabase
    .channel("dirty-turf-workspace")
    .on("postgres_changes", { event: "*", schema: "public", table: "community_posts" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "community_comments" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, onChange)
    .subscribe();
  return () => { void supabase.removeChannel(channel); };
}

export function subscribeToNotifications(onChange: () => void) {
  if (!supabase) return () => undefined;
  const channel = supabase
    .channel(`dirty-turf-notifications-${crypto.randomUUID()}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, onChange)
    .subscribe();
  return () => { void supabase.removeChannel(channel); };
}

async function hasCloudSession() {
  if (!supabase) return false;
  const { data } = await supabase.auth.getSession();
  return Boolean(data.session);
}

async function getAcademyContext(): Promise<AcademyContext | null> {
  if (!supabase) return null;
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) return null;
  const { data, error } = await supabase
    .from("academy_members")
    .select("id,academy_community_id")
    .eq("user_id", userId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? { memberId: data.id, communityId: data.academy_community_id, userId } : null;
}

function readLocal<T>(key: string, fallback: T): T {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocal(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

function stableNumericId(value: string | number) {
  if (typeof value === "number") return value;
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = (hash * 31 + value.charCodeAt(index)) | 0;
  return Math.abs(hash);
}

function titleCase(value: string) {
  return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function relativeDate(value: string) {
  const elapsed = Date.now() - new Date(value).getTime();
  if (elapsed < 60_000) return "Just now";
  if (elapsed < 86_400_000) return `${Math.max(1, Math.floor(elapsed / 3_600_000))} hr`;
  if (elapsed < 172_800_000) return "Yesterday";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(value));
}

function formatDuration(seconds: number) {
  const minutes = Math.max(0, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function normalizeLessonBody(value: unknown) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const body = value as Record<string, unknown>;
  for (const key of ["text", "content", "description"]) {
    if (typeof body[key] === "string") return body[key] as string;
  }
  if (typeof body.html === "string") {
    return new DOMParser().parseFromString(body.html, "text/html").body.textContent?.trim() ?? "";
  }
  return "";
}

function normalizeLessonHtml(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const html = (value as Record<string, unknown>).html;
  return typeof html === "string" && html.trim() ? html : undefined;
}

function normalizeResources(value: unknown): { title: string; url: string; type?: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const resource = item as Record<string, unknown>;
    if (typeof resource.url !== "string") return [];
    return [{
      title: typeof resource.title === "string" ? resource.title : "Lesson resource",
      url: resource.url,
      type: typeof resource.type === "string" ? resource.type : undefined,
    }];
  });
}

function normalizeQuiz(value: unknown): LessonQuiz | undefined {
  if (!value || typeof value !== "object") return undefined;
  const quizValue = (value as Record<string, unknown>).quiz;
  if (!quizValue || typeof quizValue !== "object") return undefined;
  const quiz = quizValue as Record<string, unknown>;
  if (!Array.isArray(quiz.questions)) return undefined;

  const questions = quiz.questions.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const question = item as Record<string, unknown>;
    const prompt = richTextValue(question.prompt);
    const options = Array.isArray(question.options)
      ? question.options.flatMap((option) => {
          const value = richTextValue(option);
          return value.text || value.html ? [{ text: value.text, html: value.html || undefined }] : [];
        })
      : [];
    if ((!prompt.text && !prompt.html) || options.length < 2) return [];

    const explanation = richTextValue(question.explanation);
    const normalizedExplanation = normalizeAnswerText(explanation.text);
    const correctOptionIndex = normalizedExplanation
      ? options.findIndex((option) => normalizeAnswerText(option.text) === normalizedExplanation)
      : -1;
    return [{
      prompt: prompt.text,
      promptHtml: prompt.html || undefined,
      options,
      explanation: explanation.text || undefined,
      explanationHtml: explanation.html || undefined,
      correctOptionIndex: correctOptionIndex >= 0 ? correctOptionIndex : undefined,
    }];
  });
  if (!questions.length) return undefined;

  return {
    name: typeof quiz.name === "string" && quiz.name.trim() ? quiz.name : "Knowledge check",
    requiresPassing: Boolean(quiz.requiresPassing),
    passingPercent: typeof quiz.passingPercent === "number" ? quiz.passingPercent : undefined,
    completionMessage: typeof quiz.completionMessage === "string" ? quiz.completionMessage : undefined,
    questions,
  };
}

function richTextValue(value: unknown) {
  if (typeof value === "string") return { text: value.trim(), html: "" };
  if (!value || typeof value !== "object") return { text: "", html: "" };
  const richText = value as Record<string, unknown>;
  return {
    text: typeof richText.text === "string" ? richText.text.trim() : "",
    html: typeof richText.html === "string" ? richText.html.trim() : "",
  };
}

function normalizeAnswerText(value: string) {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "DT";
}

function academyRole(value: string): Member["role"] {
  if (value === "owner") return "Owner";
  if (value === "admin") return "Admin";
  if (value === "moderator") return "Moderator";
  return "Operator";
}
