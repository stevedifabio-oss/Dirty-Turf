import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

// Read-only release gate. Supply credentials through the environment or the
// existing macOS Keychain item; never print credentials, sessions, or member data.
const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const email = process.env.REVIEWER_EMAIL;
const service = process.env.REVIEWER_KEYCHAIN_SERVICE;
const password = service
  ? execFileSync("/usr/bin/security", ["find-generic-password", "-s", service, "-w"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trimEnd()
  : process.env.REVIEWER_PASSWORD;

if (!url || !key || !email || !password) {
  throw new Error("Set the public Supabase URL/key, REVIEWER_EMAIL, and REVIEWER_PASSWORD or REVIEWER_KEYCHAIN_SERVICE.");
}
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const checks = [];
const check = (name, passed) => {
  checks.push({ name, passed: Boolean(passed) });
  if (!passed) process.exitCode = 1;
};
let signedIn = false;
try {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  check("password sign-in", !error && data.session);
  if (error || !data.session) throw new Error("Reviewer sign-in failed.");
  signedIn = true;
  const access = await client.rpc("get_academy_access_state");
  check("active app access", !access.error && access.data?.hasAccess === true);
  check("community access", access.data?.communityAccess === true);
  check("course access", Array.isArray(access.data?.courseIds) && access.data.courseIds.length > 0);
  check("measuring tool access", access.data?.features?.includes("measuring_tool"));
  check("reviewer has no management privileges", access.data?.canManage === false);
  const courses = await client.from("courses").select("id").eq("status", "published").limit(1);
  check("published course readable", !courses.error && courses.data?.length > 0);
  const posts = await client.from("community_posts").select("id").limit(1);
  check("community readable", !posts.error && posts.data?.length > 0);
} catch {
  process.exitCode = 1;
} finally {
  if (signedIn) {
    const { error } = await client.auth.signOut({ scope: "local" });
    check("probe session signed out", !error);
  }
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), passed: !process.exitCode, checks }, null, 2));
}
