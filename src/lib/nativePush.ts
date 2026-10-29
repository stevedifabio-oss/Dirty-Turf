import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { createClient } from "@supabase/supabase-js";
import { supabase } from "./backend";

export type NativePushTarget = { notificationId: string; targetType: "post" | "event" | "course" | "community"; targetId: string; commentId?: string };
export type PushPreferences = { push_replies: boolean; push_mentions: boolean; push_reactions: boolean; push_new_posts: boolean; push_admin_announcements: boolean; push_event_reminders: boolean; push_course_updates: boolean };
export type NativePushStatus = { supported: boolean; ready: boolean; enabled: boolean; permission: string; preferences: PushPreferences; error?: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STORAGE = "dirty-turf-native-push-installation-v1";
const defaults: PushPreferences = { push_replies: true, push_mentions: true, push_reactions: false, push_new_posts: false, push_admin_announcements: true, push_event_reminders: true, push_course_updates: true };
type Installation = { id: string; secret: string; revision: number; userId?: string; enabled: boolean; revokePending?: boolean };
let registrationUser: string | undefined;
let registrationRevision: number | undefined;
let explicitRegistration = false;
let generation = 0;
let listenerCleanup: (() => void) | undefined;
let pendingRegistration: { attempt: number; userId: string; resolve: () => void; reject: (error: Error) => void } | undefined;
let registrationInProgress = false;
let cleanupPromise: Promise<void> | undefined;
const changes = new Set<() => void>();
const changed = () => changes.forEach(callback => callback());
function installation(): Installation {
  const raw = localStorage.getItem(STORAGE);
  if (raw) { const value = JSON.parse(raw); if (UUID.test(value.id) && UUID.test(value.secret) && typeof value.enabled === "boolean" && Number.isSafeInteger(value.revision) && value.revision >= 0) return value; throw new Error("Phone notification settings need resetting."); }
  const value: Installation = { id: crypto.randomUUID(), secret: crypto.randomUUID(), revision: 0, enabled: false };
  localStorage.setItem(STORAGE, JSON.stringify(value));
  return value;
}
const saveInstallation = (value: Installation) => localStorage.setItem(STORAGE, JSON.stringify(value));
function invalidateRegistrationAttempt(attempt: number, userId: string, revision: number) {
  if (attempt !== generation) return;
  const current = installation();
  if (current.revision !== revision || current.userId !== userId) return;
  generation++; registrationUser = undefined; registrationRevision = undefined; explicitRegistration = false;
  current.revision++; current.enabled = false; current.revokePending = true; saveInstallation(current);
  changed();
}
const environment = () => import.meta.env.VITE_PUSH_ENVIRONMENT;
export function isNativePushSupported() { return Capacitor.isNativePlatform() && ["ios", "android"].includes(Capacitor.getPlatform()) && Capacitor.isPluginAvailable("PushNotifications"); }
export function subscribeNativePushStatus(callback: () => void) { changes.add(callback); return () => { changes.delete(callback); }; }
export function parseNativePushTarget(data: unknown): NativePushTarget | null {
  if (!data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  if (typeof row.notificationId !== "string" || !UUID.test(row.notificationId) || typeof row.targetId !== "string" || !UUID.test(row.targetId) || !["post", "event", "course", "community"].includes(String(row.targetType))) return null;
  return { notificationId: row.notificationId, targetType: row.targetType as NativePushTarget["targetType"], targetId: row.targetId, ...(row.targetType === "post" && typeof row.commentId === "string" && UUID.test(row.commentId) ? { commentId: row.commentId } : {}) };
}
export async function resolveNativePushTarget(notificationId: string): Promise<NativePushTarget | null> {
  if (!supabase || !UUID.test(notificationId)) return null;
  const context = await sessionContext();
  const { data, error } = await supabase.rpc("resolve_academy_push_notification", { p_notification_id: notificationId }).setHeader("Authorization", `Bearer ${context.token}`);
  if (error) throw new Error("That notification could not be opened. Try again.");
  const row = data?.[0];
  return row ? parseNativePushTarget({ notificationId, targetType: row.target_type, targetId: row.target_id, commentId: row.comment_id }) : null;
}
async function sessionContext() {
  const { data, error } = await supabase!.auth.getSession();
  if (error || !data.session?.user.id) throw new Error("Sign in before changing phone notifications.");
  return { userId: data.session.user.id, token: data.session.access_token };
}
async function revokeRemote(value: Installation) {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY)?.trim();
  if (!url || !key) throw new Error("Phone notifications are unavailable.");
  // Separate anonymous client allows disabling this one secret-bound installation
  // after a session expires. It has no access to tokens or account preferences.
  const anonymous = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(8000) }) } });
  const { error } = await anonymous.rpc("unregister_academy_push_device", { p_installation_id: value.id, p_installation_secret: value.secret, p_revision: value.revision });
  if (error) throw new Error("Phone notification cleanup will retry when connected.");
}
export function clearNativePushForSignOut() {
  if (cleanupPromise) return cleanupPromise;
  const task = clearInstallation().finally(() => { if (cleanupPromise === task) cleanupPromise = undefined; });
  cleanupPromise = task;
  return task;
}
async function clearInstallation() {
  generation++; registrationUser = undefined; registrationRevision = undefined; explicitRegistration = false;
  pendingRegistration?.reject(new Error("Phone notification registration was cancelled.")); pendingRegistration = undefined;
  if (!localStorage.getItem(STORAGE)) return;
  const value = installation(); value.revision++; value.enabled = false; value.userId = undefined; value.revokePending = true; saveInstallation(value);
  // Stop OS delivery before any network wait; keep the secret-bound revocation
  // pending if offline, so it can be retried without the expired login session.
  let deviceError: unknown;
  if (isNativePushSupported()) {
    try { await PushNotifications.unregister(); } catch (error) { deviceError = error; }
    try { await PushNotifications.removeAllDeliveredNotifications(); } catch (error) { deviceError ??= error; }
  }
  let remoteError: unknown;
  try { await revokeRemote(value); const current = installation(); if (current.revision === value.revision) { current.revokePending = false; saveInstallation(current); } } catch (error) { remoteError = error; }
  changed();
  if (remoteError) throw remoteError;
  if (deviceError) throw new Error("Phone notification cleanup needs another attempt.");
}
export async function disableNativePush() {
  if (!supabase) throw new Error("Phone notifications are unavailable.");
  const context = await sessionContext();
  const { error } = await supabase.from("notification_preferences").upsert({ user_id: context.userId, push_enabled: false }, { onConflict: "user_id" }).setHeader("Authorization", `Bearer ${context.token}`);
  if (error) throw new Error("Phone notification preference could not be saved.");
  await clearNativePushForSignOut();
}
export async function saveNativePushPreferences(preferences: PushPreferences) {
  if (!supabase) throw new Error("Phone notifications are unavailable.");
  const context = await sessionContext();
  const values = Object.fromEntries(Object.keys(defaults).map(key => [key, preferences[key as keyof PushPreferences] === true]));
  const { error } = await supabase.from("notification_preferences").upsert({ user_id: context.userId, ...values }, { onConflict: "user_id" }).setHeader("Authorization", `Bearer ${context.token}`);
  if (error) throw new Error("Phone notification preferences could not be saved.");
  changed();
}
export async function readNativePushStatus(): Promise<NativePushStatus> {
  if (!isNativePushSupported()) return { supported: false, ready: false, enabled: false, permission: "unavailable", preferences: defaults };
  if (!supabase) throw new Error("Phone notifications are unavailable.");
  const context = await sessionContext(); const uid = context.userId;
  const { data, error } = await supabase.from("notification_preferences").select("push_enabled,push_replies,push_mentions,push_reactions,push_new_posts,push_admin_announcements,push_event_reminders,push_course_updates").eq("user_id", uid).maybeSingle().setHeader("Authorization", `Bearer ${context.token}`);
  if (error) throw new Error("Phone notification preferences could not load.");
  const permission = (await PushNotifications.checkPermissions()).receive;
  const value = localStorage.getItem(STORAGE) ? installation() : undefined;
  const { data: readiness, error: readinessError } = await supabase.rpc("academy_push_readiness").setHeader("Authorization", `Bearer ${context.token}`);
  const ready = !readinessError && Boolean(readiness?.[0]?.ready && readiness[0].environment === environment());
  return { supported: true, ready, enabled: Boolean(data?.push_enabled && value?.enabled && value.userId === uid && permission === "granted"), permission, preferences: Object.fromEntries((Object.keys(defaults) as (keyof PushPreferences)[]).map(key => [key, data?.[key] ?? defaults[key]])) as PushPreferences };
}
async function requestRegistration(explicit: boolean) {
  if (cleanupPromise) throw new Error("Phone notification cleanup is still in progress. Try again.");
  if (pendingRegistration || registrationInProgress) { if (!explicit) return; throw new Error("Phone notification registration is already in progress."); }
  registrationInProgress = true;
  try {
  if (!supabase || !isNativePushSupported()) throw new Error("Install the updated native app to use phone notifications.");
  if (environment() !== "sandbox" && environment() !== "production") throw new Error("Phone notification setup is not available in this app version.");
  if (!listenerCleanup) throw new Error("Phone notifications are still starting. Try again.");
  const setupGeneration = generation;
  const beforeSessionStorage = localStorage.getItem(STORAGE);
  const context = await sessionContext(); const uid = context.userId;
  if (generation !== setupGeneration || localStorage.getItem(STORAGE) !== beforeSessionStorage) throw new Error("Your account changed. Try again.");
  const value = installation();
  let expectedStorage = localStorage.getItem(STORAGE);
  const assertSetupCurrent = () => { if (generation !== setupGeneration || localStorage.getItem(STORAGE) !== expectedStorage) throw new Error("Your account changed. Try again."); };
  const { data: readiness, error: readinessError } = await supabase.rpc("academy_push_readiness").setHeader("Authorization", `Bearer ${context.token}`);
  assertSetupCurrent();
  if (readinessError || !readiness?.[0]?.ready || readiness[0].environment !== environment()) throw new Error("Phone notifications are not available yet. Your existing email and in-app alerts are unchanged.");
  if (value.revokePending) { await revokeRemote(value); assertSetupCurrent(); value.revokePending = false; saveInstallation(value); expectedStorage = localStorage.getItem(STORAGE); }
  if (!explicit && (!value.enabled || value.userId !== uid)) return;
  const currentContext = await sessionContext(); assertSetupCurrent();
  if (currentContext.userId !== uid) throw new Error("Your account changed. Try again.");
  const attempt = ++generation; value.revision++; saveInstallation(value);
  const assertAttemptCurrent = () => { if (attempt !== generation || installation().revision !== value.revision) throw new Error("Your account changed. Try again."); };
  const verifyAttemptIdentity = async () => { const current = await sessionContext(); assertAttemptCurrent(); if (current.userId !== uid) throw new Error("Your account changed. Try again."); };
  const { error: beginError } = await supabase.rpc("begin_academy_push_registration", { p_installation_id: value.id, p_installation_secret: value.secret, p_revision: value.revision }).setHeader("Authorization", `Bearer ${context.token}`);
  if (beginError) throw new Error("Phone notification registration could not start. Try again.");
  await verifyAttemptIdentity();
  let permission = await PushNotifications.checkPermissions();
  await verifyAttemptIdentity();
  if (explicit && (permission.receive === "prompt" || permission.receive === "prompt-with-rationale")) permission = await PushNotifications.requestPermissions();
  if (permission.receive !== "granted") {
    if (!explicit) return;
    throw new Error("Allow notifications in your phone settings, then try again.");
  }
  if (!explicit) { const state = await readNativePushStatus(); if (!state.enabled) return; }
  await verifyAttemptIdentity();
  registrationUser = uid; registrationRevision = value.revision; explicitRegistration = explicit;
  value.userId = uid; value.enabled = true; saveInstallation(value);
  if (Capacitor.getPlatform() === "android") await PushNotifications.createChannel({ id: "academy", name: "Academy updates", description: "Academy discussions, events and updates", importance: 3, visibility: 0 });
  assertAttemptCurrent();
  if (explicit) {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = () => { clearTimeout(timeout); if (pendingRegistration === pending) pendingRegistration = undefined; };
      // A failed attempt must not accept a late OS token. Keep revocation pending
      // for resume/retry, and never invalidate a newer account or settled success.
      const pending = { attempt, userId: uid, resolve: () => { if (settled) return; settled = true; finish(); resolve(); }, reject: (error: Error) => { if (settled) return; settled = true; finish(); invalidateRegistrationAttempt(attempt, uid, value.revision); reject(error); } };
      const timeout = setTimeout(() => pending.reject(new Error("Phone registration timed out. Try again when connected.")), 20_000);
      pendingRegistration = pending;
      void PushNotifications.register().catch(() => pending.reject(new Error("Phone notification registration failed.")));
    });
  } else {
    try { await PushNotifications.register(); }
    catch { invalidateRegistrationAttempt(attempt, uid, value.revision); throw new Error("Phone notification registration failed."); }
  }
  } finally { registrationInProgress = false; }
}
export const enableNativePush = () => requestRegistration(true);
export async function refreshNativePush() {
  if (!isNativePushSupported()) return;
  if (!localStorage.getItem(STORAGE)) return;
  const value = installation();
  if (value.revokePending) { await revokeRemote(value); if (installation().revision !== value.revision) return; value.revokePending = false; saveInstallation(value); }
  if (!value.enabled) return;
  let uid: string; try { uid = (await sessionContext()).userId; } catch { return; }
  if (value.userId !== uid) { await clearNativePushForSignOut(); return; }
  await requestRegistration(false);
}
export async function startNativePush(onTap: (target: NativePushTarget) => void, onChange?: () => void) {
  if (!isNativePushSupported()) return () => undefined;
  listenerCleanup?.();
  const handles: PluginListenerHandle[] = [];
  let disposed = false;
  if (onChange) changes.add(onChange);
  try {
  handles.push(await PushNotifications.addListener("registration", ({ value: token }) => {
    const attempt = generation;
    const expectedUser = registrationUser;
    const explicit = explicitRegistration; explicitRegistration = false;
    const pending = pendingRegistration?.attempt === attempt && pendingRegistration.userId === expectedUser ? pendingRegistration : undefined;
    void (async () => {
      if (disposed || !expectedUser || !supabase) return;
      const value = installation();
      const context = await sessionContext();
      if (!value.enabled || value.userId !== expectedUser || context.userId !== expectedUser || attempt !== generation) return;
      const { error } = await supabase.rpc("register_academy_push_device", { p_installation_id: value.id, p_installation_secret: value.secret, p_platform: Capacitor.getPlatform(), p_environment: environment(), p_token: token, p_enable: explicit, p_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", p_revision: value.revision }).setHeader("Authorization", `Bearer ${context.token}`);
      const current = installation();
      const stillCurrent = attempt === generation && current.revision === value.revision && current.userId === expectedUser;
      if (error) { if (stillCurrent) { current.enabled = false; saveInstallation(current); } throw new Error("Phone notification registration could not be saved. Try enabling it again."); }
      if (!stillCurrent) return; // Server installation revision fences any late completion.
      pending?.resolve();
      changed();
    })().catch(() => { pending?.reject(new Error("Phone notification registration could not be saved. Try again.")); changed(); });
  }));
  handles.push(await PushNotifications.addListener("registrationError", () => {
    if (disposed) return;
    const pending = pendingRegistration;
    if (pending?.attempt === generation) pending.reject(new Error("The phone could not register for notifications. Try again."));
    else if (registrationUser && registrationRevision !== undefined) invalidateRegistrationAttempt(generation, registrationUser, registrationRevision);
  }));
  handles.push(await PushNotifications.addListener("pushNotificationActionPerformed", ({ notification }) => { if (!disposed) { const target = parseNativePushTarget(notification.data); if (target) onTap(target); } }));
  } catch {
    disposed = true; if (onChange) changes.delete(onChange);
    for (const handle of handles) await handle.remove().catch(() => undefined);
    throw new Error("Phone notification controls could not start. Try reopening the app.");
  }
  const cleanup = () => { disposed = true; if (onChange) changes.delete(onChange); for (const handle of handles) void handle.remove(); if (listenerCleanup === cleanup) listenerCleanup = undefined; };
  listenerCleanup = cleanup;
  return cleanup;
}
