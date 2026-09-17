import { createClient } from "@supabase/supabase-js";
import type { CleaningPlan, CommunityPost, Job } from "../domain";

const JOBS_KEY = "dirty-turf-jobs-v3";
const POSTS_KEY = "dirty-turf-posts-v1";
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabasePublishableKey = (
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY
)?.trim();

export const supabase = supabaseUrl && supabasePublishableKey
  ? createClient(supabaseUrl, supabasePublishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

export type DataMode = "device" | "cloud";

export type HighLevelStatus = {
  connected: boolean;
  location: { available: boolean; id?: string; name?: string; status?: number };
  pipelines: { available: boolean; count?: number; status?: number };
  workflows: { available: boolean; count?: number; status?: number };
  products: { available: boolean; accessible?: boolean; status?: number };
};

export async function requestMagicLink(email: string) {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin },
  });
}

export async function signOut() {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
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

export async function loadJobs(seed: Job[]): Promise<Job[]> {
  if (!(await hasCloudSession())) return readLocal(JOBS_KEY, seed);

  const { data, error } = await supabase!
    .from("job_cards")
    .select("id,property_name,square_feet,bag_count,total,status,measurement_method,created_at,photo_count")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: stableNumericId(row.id),
    address: row.property_name,
    area: Number(row.square_feet),
    infill: Number(row.bag_count),
    quote: Number(row.total),
    status: titleCase(row.status),
    method: row.measurement_method,
    createdAt: relativeDate(row.created_at),
    photos: Number(row.photo_count),
  }));
}

export async function saveJob(job: Job, plan: CleaningPlan = "premium"): Promise<Job> {
  if (!(await hasCloudSession())) {
    const current = readLocal<Job[]>(JOBS_KEY, []);
    writeLocal(JOBS_KEY, [job, ...current.filter((item) => item.id !== job.id)]);
    return job;
  }

  const { data, error } = await supabase!.rpc("create_property_estimate", {
    p_property_name: job.address,
    p_square_feet: job.area,
    p_bag_count: job.infill,
    p_total: job.quote,
    p_measurement_method: job.method,
    p_plan: plan,
  });
  if (error) throw error;
  return { ...job, id: stableNumericId(data) };
}

export async function loadPosts(seed: CommunityPost[]): Promise<CommunityPost[]> {
  if (!(await hasCloudSession())) return readLocal(POSTS_KEY, seed);

  const { data, error } = await supabase!
    .from("community_feed")
    .select("id,title,body,author_name,reply_count,created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: stableNumericId(row.id),
    name: row.title,
    author: row.author_name,
    body: row.body,
    replies: Number(row.reply_count),
    age: relativeDate(row.created_at),
  }));
}

export async function savePost(post: CommunityPost): Promise<CommunityPost> {
  if (!(await hasCloudSession())) {
    const current = readLocal<CommunityPost[]>(POSTS_KEY, []);
    writeLocal(POSTS_KEY, [post, ...current.filter((item) => item.id !== post.id)]);
    return post;
  }

  const { data, error } = await supabase!.rpc("create_community_post", {
    p_title: post.name,
    p_body: post.body,
  });
  if (error) throw error;
  return { ...post, id: stableNumericId(data) };
}

export async function togglePostReaction(cloudPostId: string) {
  if (!(await hasCloudSession())) return null;
  const { data, error } = await supabase!.rpc("toggle_post_reaction", { target_post_id: cloudPostId });
  if (error) throw error;
  return Boolean(data);
}

export async function togglePostBookmark(cloudPostId: string) {
  if (!(await hasCloudSession())) return null;
  const { data, error } = await supabase!.rpc("toggle_post_bookmark", { target_post_id: cloudPostId });
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

async function hasCloudSession() {
  if (!supabase) return false;
  const { data } = await supabase.auth.getSession();
  return Boolean(data.session);
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
