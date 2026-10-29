import { supabase } from "./backend";

export type CommunityScheduleState = "draft" | "active" | "paused" | "cancelled";
export type CommunityScheduleDraft = {
  id?: string;
  clientRequestId?: string;
  communityId: string;
  authorMemberId: string;
  categoryId: string;
  title: string;
  body: string;
  kind: "once" | "weekly";
  timeZone: string;
  startsOn: string;
  endsOn: string | null;
  localTime: string;
  weekdays: number[];
  state: CommunityScheduleState;
  catchupMinutes: number;
  expectedRevision?: number;
};
export type CommunitySchedule = CommunityScheduleDraft & {
  id: string;
  clientRequestId: string;
  createdBy: string;
  revision: number;
  isAnnouncement: boolean;
  createdAt: string;
  updatedAt: string;
};
export type CommunityScheduleOccurrence = {
  id: string;
  scheduleId: string;
  communityId: string;
  scheduledFor: string;
  state: "published" | "skipped" | "failed";
  postId: string | null;
  reasonCode: string | null;
  scheduleRevision: number;
  snapshot: { title: string; timeZone: string };
};
export type CommunitySchedulerStatus = {
  databaseEnabled: boolean;
  workerActivationVerified: boolean;
  deliveryActivationVerified: boolean;
};
export type CommunityScheduleOverview = {
  schedules: CommunitySchedule[];
  occurrences: CommunityScheduleOccurrence[];
  author: { id: string; displayName: string };
  currentUserId: string;
  status: CommunitySchedulerStatus;
};

const states: readonly string[] = ["draft", "active", "paused", "cancelled"];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const scheduleColumns = "id,client_request_id,created_by,academy_community_id,author_member_id,category_id,title,body,kind,time_zone,starts_on,ends_on,local_time,weekdays,state,catchup_minutes,revision,is_announcement,created_at,updated_at";
const occurrenceColumns = "id,schedule_id,academy_community_id,scheduled_for,state,post_id,reason_code,schedule_revision,approved_snapshot";

export const scheduleWeekdays = [
  { value: 1, label: "Monday", short: "Mon" }, { value: 2, label: "Tuesday", short: "Tue" },
  { value: 3, label: "Wednesday", short: "Wed" }, { value: 4, label: "Thursday", short: "Thu" },
  { value: 5, label: "Friday", short: "Fri" }, { value: 6, label: "Saturday", short: "Sat" },
  { value: 7, label: "Sunday", short: "Sun" },
] as const;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The scheduling response was incomplete. Refresh before making changes.");
  return value as Record<string, unknown>;
}
function stringField(row: Record<string, unknown>, key: string) {
  const value = row[key];
  if (typeof value !== "string") throw new Error("The scheduling response was incomplete. Refresh before making changes.");
  return value;
}
function idField(row: Record<string, unknown>, key: string) {
  const value = stringField(row, key);
  if (!uuid.test(value)) throw new Error("The scheduling response contained an invalid identifier.");
  return value;
}
function timestampField(row: Record<string, unknown>, key: string) {
  const value = stringField(row, key);
  if (!Number.isFinite(Date.parse(value))) throw new Error("The scheduling response contained an invalid date.");
  return value;
}
function positiveInteger(value: unknown): value is number { return typeof value === "number" && Number.isInteger(value) && value > 0; }

export function validScheduleDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "1000-01-01") return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
export function validScheduleTimeZone(value: string) {
  if (!value.trim() || value !== value.trim()) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }).format(); return true; } catch { return false; }
}
export function scheduleValidationMessage(draft: CommunityScheduleDraft): string | null {
  if (![draft.communityId, draft.authorMemberId, draft.categoryId].every(value => uuid.test(value))) return "Choose a channel and sign in with an active administrator account.";
  if (draft.id !== undefined && !uuid.test(draft.id)) return "Refresh before editing this schedule.";
  if (!draft.id && (!draft.clientRequestId || !uuid.test(draft.clientRequestId))) return "Start a new draft to create its retry identifier.";
  if (draft.title.trim().length < 2 || draft.title.trim().length > 120) return "Enter a title between 2 and 120 characters.";
  if (draft.body.trim().length < 2 || draft.body.trim().length > 5_000) return "Enter a post between 2 and 5,000 characters.";
  if (!validScheduleTimeZone(draft.timeZone)) return "Choose a valid IANA time zone, such as America/Phoenix.";
  if (!validScheduleDate(draft.startsOn)) return "Choose a valid publishing date.";
  if (draft.endsOn !== null && (!validScheduleDate(draft.endsOn) || draft.endsOn < draft.startsOn)) return "The end date must be on or after the start date.";
  if (!/^([01]\d|2[0-3]):[0-5]\d(?::00)?$/.test(draft.localTime)) return "Choose a valid publishing time.";
  if (draft.kind !== "once" && draft.kind !== "weekly") return "Choose a one-time or weekly schedule.";
  if (!Array.isArray(draft.weekdays) || draft.weekdays.some(day => !Number.isInteger(day) || day < 1 || day > 7) || new Set(draft.weekdays).size !== draft.weekdays.length) return "Choose valid weekdays.";
  if (draft.kind === "weekly" && draft.weekdays.length === 0) return "Choose at least one weekday.";
  if (draft.kind === "once" && draft.weekdays.length !== 0) return "A one-time schedule cannot contain repeating weekdays.";
  if (!states.includes(draft.state)) return "Choose a valid schedule state.";
  if (!Number.isInteger(draft.catchupMinutes) || draft.catchupMinutes < 1 || draft.catchupMinutes > 60) return "The late-publishing window must be between 1 and 60 minutes.";
  if (draft.id !== undefined && !positiveInteger(draft.expectedRevision)) return "Refresh this schedule before saving its changes.";
  return null;
}

export function parseCommunitySchedule(value: unknown): CommunitySchedule {
  const row = record(value);
  if (!positiveInteger(row.revision) || typeof row.is_announcement !== "boolean" || (row.ends_on !== null && typeof row.ends_on !== "string")) throw new Error("The scheduling response was incomplete. Refresh before making changes.");
  if (!/^([01]\d|2[0-3]):[0-5]\d(?::00)?$/.test(stringField(row, "local_time"))) throw new Error("The scheduling response contained an invalid publishing time.");
  const schedule: CommunitySchedule = {
    id: idField(row, "id"), clientRequestId: idField(row, "client_request_id"), createdBy: idField(row, "created_by"), communityId: idField(row, "academy_community_id"), authorMemberId: idField(row, "author_member_id"), categoryId: idField(row, "category_id"),
    title: stringField(row, "title"), body: stringField(row, "body"), kind: stringField(row, "kind") as CommunitySchedule["kind"],
    timeZone: stringField(row, "time_zone"), startsOn: stringField(row, "starts_on"), endsOn: row.ends_on as string | null,
    localTime: stringField(row, "local_time").slice(0, 5), weekdays: row.weekdays as number[], state: stringField(row, "state") as CommunityScheduleState,
    catchupMinutes: row.catchup_minutes as number, revision: row.revision, expectedRevision: row.revision, isAnnouncement: row.is_announcement,
    createdAt: timestampField(row, "created_at"), updatedAt: timestampField(row, "updated_at"),
  };
  const invalid = scheduleValidationMessage(schedule);
  if (invalid) throw new Error(`The saved schedule is invalid. ${invalid}`);
  return schedule;
}
export function parseCommunityScheduleOccurrence(value: unknown): CommunityScheduleOccurrence {
  const row = record(value);
  if (!["published", "skipped", "failed"].includes(String(row.state)) || !positiveInteger(row.schedule_revision) || (row.post_id !== null && (typeof row.post_id !== "string" || !uuid.test(row.post_id))) || (row.reason_code !== null && typeof row.reason_code !== "string")) throw new Error("The publishing history response was incomplete.");
  const snapshot = record(row.approved_snapshot);
  const title = stringField(snapshot, "title");
  const timeZone = stringField(snapshot, "time_zone");
  if (title.trim().length < 2 || title.length > 120 || !validScheduleTimeZone(timeZone)) throw new Error("The publishing history response was incomplete.");
  return { id: idField(row, "id"), scheduleId: idField(row, "schedule_id"), communityId: idField(row, "academy_community_id"), scheduledFor: timestampField(row, "scheduled_for"), state: row.state as CommunityScheduleOccurrence["state"], postId: row.post_id as string | null, reasonCode: row.reason_code as string | null, scheduleRevision: row.schedule_revision, snapshot: { title, timeZone } };
}

function schedulerError(error: unknown): Error {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (["PGRST202", "PGRST205", "42P01", "42883"].includes(code)) return new Error("Scheduled publishing needs its database update before it can be used.");
  if (["40001", "P0002"].includes(code)) return new Error("This schedule changed in another session. Refresh and review it before trying again.");
  if (["42501", "PGRST301"].includes(code)) return new Error("An active Academy administrator account is required to manage schedules.");
  return new Error("The scheduling change could not be confirmed. Refresh to check its saved state before retrying.");
}
function client() { if (!supabase) throw new Error("Sign in to manage scheduled publishing."); return supabase; }
async function mutationAccessToken(expectedUserId: string): Promise<string> {
  if (!uuid.test(expectedUserId)) throw new Error("Refresh the administrator account before making changes.");
  const { data, error } = await client().auth.getSession();
  if (error || data.session?.user.id !== expectedUserId || !data.session.access_token) throw new Error("The account changed. This action was not submitted.");
  return data.session.access_token;
}

export async function loadCommunityScheduleOverview(communityId: string): Promise<CommunityScheduleOverview> {
  if (!uuid.test(communityId)) throw new Error("Choose a valid Academy community.");
  const db = client();
  const userResult = await db.auth.getUser();
  if (userResult.error || !userResult.data.user) throw new Error("Sign in to manage scheduled publishing.");
  const authorResult = await db.from("academy_members").select("id,display_name,role,status").eq("academy_community_id", communityId).eq("user_id", userResult.data.user.id).single();
  if (authorResult.error) throw schedulerError(authorResult.error);
  const author = record(authorResult.data);
  if (!["owner", "admin"].includes(String(author.role)) || author.status !== "active") throw new Error("An active Academy administrator account is required to manage schedules.");
  const results = await Promise.all([
    db.from("academy_post_schedules").select(scheduleColumns).eq("academy_community_id", communityId).order("created_at", { ascending: false }).limit(200),
    db.from("academy_post_schedule_occurrences").select(occurrenceColumns).eq("academy_community_id", communityId).order("scheduled_for", { ascending: false }).limit(100),
    db.rpc("get_academy_post_scheduler_status", { p_community_id: communityId }),
  ]);
  for (const result of results) if (result.error) throw schedulerError(result.error);
  if (!Array.isArray(results[0].data) || !Array.isArray(results[1].data)) throw new Error("The scheduling response was incomplete. Refresh before making changes.");
  const schedules = results[0].data.map(parseCommunitySchedule);
  const occurrences = results[1].data.map(parseCommunityScheduleOccurrence);
  if (schedules.some(item => item.communityId !== communityId) || occurrences.some(item => item.communityId !== communityId)) throw new Error("Scheduling data belongs to a different Academy. Refresh before making changes.");
  const status = record(results[2].data);
  if ([status.databaseEnabled, status.workerActivationVerified, status.deliveryActivationVerified].some(value => typeof value !== "boolean")) throw new Error("Scheduled publishing status could not be verified.");
  return { schedules, occurrences, author: { id: idField(author, "id"), displayName: stringField(author, "display_name") }, currentUserId: userResult.data.user.id, status: status as CommunitySchedulerStatus };
}

export async function saveCommunitySchedule(input: CommunityScheduleDraft, expectedUserId: string): Promise<CommunitySchedule> {
  const invalid = scheduleValidationMessage(input);
  if (invalid) throw new Error(invalid);
  const accessToken = await mutationAccessToken(expectedUserId);
  const { data, error } = await client().rpc("save_academy_post_schedule", { p_schedule: {
    ...(input.id ? { id: input.id, expectedRevision: input.expectedRevision } : { clientRequestId: input.clientRequestId }), communityId: input.communityId,
    authorMemberId: input.authorMemberId, categoryId: input.categoryId, title: input.title.trim(), body: input.body.trim(), kind: input.kind,
    timeZone: input.timeZone, startsOn: input.startsOn, endsOn: input.endsOn, localTime: input.localTime.slice(0, 5),
    weekdays: input.kind === "once" ? [] : [...input.weekdays].sort((a, b) => a - b), state: input.id ? input.state : "draft", catchupMinutes: input.catchupMinutes,
  } }).setHeader("Authorization", `Bearer ${accessToken}`);
  if (error) throw schedulerError(error);
  const saved = parseCommunitySchedule(data);
  if (saved.communityId !== input.communityId || (input.id && saved.id !== input.id) || (!input.id && saved.clientRequestId !== input.clientRequestId)) throw new Error("The saved schedule could not be verified. Refresh before retrying.");
  return saved;
}
export async function setCommunityScheduleState(schedule: CommunitySchedule, state: CommunityScheduleState, expectedUserId: string): Promise<CommunitySchedule> {
  if (!uuid.test(schedule.id) || !positiveInteger(schedule.revision) || !states.includes(state) || schedule.state === "cancelled") throw new Error("Refresh before changing this schedule.");
  const accessToken = await mutationAccessToken(expectedUserId);
  const { data, error } = await client().rpc("set_academy_post_schedule_state", { p_schedule_id: schedule.id, p_state: state, p_expected_revision: schedule.revision }).setHeader("Authorization", `Bearer ${accessToken}`);
  if (error) throw schedulerError(error);
  const saved = parseCommunitySchedule(data);
  if (saved.id !== schedule.id || saved.communityId !== schedule.communityId || saved.state !== state) throw new Error("The schedule state could not be verified. Refresh before retrying.");
  return saved;
}

function localParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(instant);
  const number = (name: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === name)?.value);
  return { year: number("year"), month: number("month"), day: number("day"), hour: number("hour"), minute: number("minute"), second: number("second") };
}
function dateInZone(instant: Date, timeZone: string) {
  const parts = localParts(instant, timeZone);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

// Match the server's DST policy: skip a missing wall-clock time, and choose
// the later instant if a repeated wall-clock time occurs when clocks fall back.
export function scheduleLocalInstant(date: string, time: string, timeZone: string): Date | null {
  if (!validScheduleDate(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || !validScheduleTimeZone(timeZone)) return null;
  const nominal = Date.parse(`${date}T${time}:00Z`);
  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 6) {
    const sample = new Date(nominal + hours * 3_600_000);
    const part = localParts(sample, timeZone);
    offsets.add(Date.UTC(part.year, part.month - 1, part.day, part.hour, part.minute, part.second) - sample.valueOf());
  }
  const matches = [...offsets].map(offset => new Date(nominal - offset)).filter(instant => dateInZone(instant, timeZone) === date && (() => { const p = localParts(instant, timeZone); return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}` === time; })());
  return matches.length ? new Date(Math.max(...matches.map(value => value.valueOf()))) : null;
}

export function nextCommunityScheduleOccurrence(schedule: Pick<CommunityScheduleDraft, "kind" | "startsOn" | "endsOn" | "localTime" | "timeZone" | "weekdays">, now = new Date()): Date | null {
  if (!validScheduleDate(schedule.startsOn) || !validScheduleTimeZone(schedule.timeZone) || !Number.isFinite(now.valueOf()) || (schedule.endsOn && (!validScheduleDate(schedule.endsOn) || schedule.endsOn < schedule.startsOn))) return null;
  if (schedule.kind === "once") { const instant = scheduleLocalInstant(schedule.startsOn, schedule.localTime.slice(0, 5), schedule.timeZone); return instant && instant >= now ? instant : null; }
  if (schedule.kind !== "weekly" || !schedule.weekdays.length) return null;
  const today = dateInZone(now, schedule.timeZone);
  let cursor = new Date(`${today > schedule.startsOn ? today : schedule.startsOn}T12:00:00Z`);
  for (let attempts = 0; attempts < 370; attempts++) {
    const date = cursor.toISOString().slice(0, 10);
    if (schedule.endsOn && date > schedule.endsOn) return null;
    if (schedule.weekdays.includes(cursor.getUTCDay() || 7)) {
      const instant = scheduleLocalInstant(date, schedule.localTime.slice(0, 5), schedule.timeZone);
      if (instant && instant >= now) return instant;
    }
    cursor = new Date(cursor.valueOf() + 86_400_000);
  }
  return null;
}

export function scheduleOccurrenceReason(code: string | null): string {
  if (!code) return "No additional detail recorded.";
  const descriptions: Record<string, string> = {
    catchup_expired: "Missed the allowed late-publishing window.",
    nonexistent_local_time: "This local time did not occur because the clocks changed.",
    before_activation: "This publishing time was before the schedule was activated.",
    author_access_changed: "The author no longer has active administrator access.",
    channel_changed: "The channel changed; review its audience before reactivating.",
    publication_rejected: "The post could not pass publication checks. Review its content and channel.",
  };
  return descriptions[code] ?? "This occurrence needs administrator review.";
}
